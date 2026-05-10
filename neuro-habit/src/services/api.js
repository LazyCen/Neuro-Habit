import { usageService } from './usageService';
import { supabase } from './supabaseClient';
import AsyncStorage from '@react-native-async-storage/async-storage';

const LOCAL_HABITS_KEY = 'local_habits_v1';
const DAILY_STEPS_CACHE_KEY = '@NeuroHabit:DailyStepsCache';
// Persistent map of { "YYYY-MM-DD": steps } for the Activity Trend chart.
// Kept for up to 14 days so weekly boundaries are always covered.
const WEEKLY_STEPS_HISTORY_KEY = '@NeuroHabit:WeeklyStepsHistory';
const HISTORY_RETENTION_DAYS = 14;
const DEFAULT_DASHBOARD_DATA = {
  steps: 0,
  screenTime: 0,
  mood: null,
  habitsCompleted: 0,
  habitsTotal: 0,
  streak: 0,
};

function formatShortDay(date) {
  return date.toLocaleDateString('en-US', { weekday: 'short' });
}

function getLastNDates(n, endDateStr = null) {
  const days = [];
  const now = endDateStr ? new Date(endDateStr) : new Date();
  // Ensure we take timezone offset into account if parsing YYYY-MM-DD
  if (endDateStr && now.getTimezoneOffset() !== 0) {
     now.setMinutes(now.getMinutes() + now.getTimezoneOffset());
  }
  for (let i = n - 1; i >= 0; i -= 1) {
    const day = new Date(now);
    day.setHours(0, 0, 0, 0);
    day.setDate(now.getDate() - i);
    days.push(day);
  }
  return days;
}



function withTimeout(promise, timeoutMs, fallbackValue) {
  return Promise.race([
    promise,
    new Promise((resolve) => setTimeout(() => resolve(fallbackValue), timeoutMs)),
  ]);
}

// ---------- Local weekly-step history helpers ----------

async function getLocalStepHistory() {
  try {
    const raw = await AsyncStorage.getItem(WEEKLY_STEPS_HISTORY_KEY);
    const parsed = raw ? JSON.parse(raw) : {};
    return typeof parsed === 'object' && parsed !== null ? parsed : {};
  } catch (_e) {
    return {};
  }
}

async function saveLocalStepHistory(history) {
  try {
    // Prune entries older than HISTORY_RETENTION_DAYS to keep the key small
    const cutoff = new Date();
    cutoff.setDate(cutoff.getDate() - HISTORY_RETENTION_DAYS);
    const cutoffStr = cutoff.toISOString().slice(0, 10);
    const pruned = {};
    for (const [date, steps] of Object.entries(history)) {
      if (date >= cutoffStr) pruned[date] = steps;
    }
    await AsyncStorage.setItem(WEEKLY_STEPS_HISTORY_KEY, JSON.stringify(pruned));
  } catch (_e) {}
}

async function recordTodaySteps(steps) {
  if (!Number.isFinite(steps) || steps <= 0) return;
  const todayKey = new Date().toISOString().slice(0, 10);
  const history = await getLocalStepHistory();
  // Only update if the new value is higher (avoids overwriting a good reading
  // with a lower one from a partial-day query on the next open).
  if ((history[todayKey] || 0) < steps) {
    history[todayKey] = steps;
    await saveLocalStepHistory(history);
  }
}

// ---------- Supabase direct-write helpers ----------

/**
 * Upserts { steps, screen_time } for a single date directly into Supabase
 * daily_metrics. This is intentionally separate from backendService.syncMetrics
 * so that Supabase always has accurate data for the trend chart even when the
 * custom backend API is the primary sync target.
 *
 * Only the columns that have meaningful values are updated — a zero screen-time
 * never overwrites a valid stored value.
 */
async function upsertDailyMetricsToSupabase({ date, steps, screenTime, userId }) {
  if (!userId) return;
  if ((!Number.isFinite(steps) || steps <= 0) && (!Number.isFinite(screenTime) || screenTime <= 0)) return;

  try {
    const payload = {
      user_id: userId,
      date: date || new Date().toISOString().slice(0, 10),
      ...(Number.isFinite(steps) && steps > 0 ? { steps } : {}),
      ...(Number.isFinite(screenTime) && screenTime > 0 ? { screen_time: screenTime } : {}),
    };

    const { error } = await supabase
      .from('daily_metrics')
      .upsert(payload, { onConflict: 'user_id,date', ignoreDuplicates: false })
      .select();

    if (error) {
      console.warn('[API] Supabase daily_metrics upsert failed:', error.message);
    } else {
      console.log('[API] daily_metrics upserted for', payload.date, '→ steps:', payload.steps ?? 'unchanged');
    }
  } catch (e) {
    console.warn('[API] upsertDailyMetricsToSupabase exception:', e?.message);
  }
}

/**
 * Backfills any days in localHistory that are missing from Supabase.
 * Called in the background after fetchWeeklyStepTrend resolves the db rows.
 */
async function backfillSupabaseFromLocalHistory(localHistory, userId, stepMap) {
  if (!userId) return;
  const entries = Object.entries(localHistory);
  for (const [date, steps] of entries) {
    const dbSteps = stepMap.has(date) ? stepMap.get(date) : 0;
    if (steps > 0 && steps > dbSteps) {
      // Fire-and-forget individual upserts; errors are swallowed
      upsertDailyMetricsToSupabase({ date, steps, userId }).catch(() => {});
    }
  }
}

// Background sync helper to push all locally cached history (like yesterday's final step count) to Supabase
export async function syncHistoricalStepsToSupabase() {
  try {
    const { data: { session } } = await supabase.auth.getSession();
    const userId = session?.user?.id;
    if (!userId) return;

    const localHistory = await getLocalStepHistory();
    const entries = Object.entries(localHistory);
    if (entries.length === 0) return;

    const dates = entries.map(([date]) => date);
    const { data, error } = await supabase
      .from('daily_metrics')
      .select('date,steps')
      .eq('user_id', userId)
      .in('date', dates);
      
    if (error || !Array.isArray(data)) return;

    const stepMap = new Map(data.map(item => [item.date, item.steps || 0]));
    await backfillSupabaseFromLocalHistory(localHistory, userId, stepMap);
  } catch (e) {
    console.warn('[API] Failed to sync historical steps:', e);
  }
}

// Integrated API (uses real data when available)
export async function fetchUserData() {
  try {
    const { data: { session } } = await supabase.auth.getSession();
    const userId = session?.user?.id;

    // Fast-path: seed today's step count from the on-device cache so the
    // dashboard shows a real value instantly while HC initialises in the
    // background. The slow HC path below will overwrite this if it returns
    // a higher (more accurate) number.
    let cachedStepsToday = 0;
    try {
      const cachedRaw = await AsyncStorage.getItem(DAILY_STEPS_CACHE_KEY);
      if (cachedRaw) {
        const { date: cDate, steps: cSteps } = JSON.parse(cachedRaw);
        if (cDate === new Date().toISOString().slice(0, 10) && Number.isFinite(cSteps)) {
          cachedStepsToday = cSteps;
        }
      }
    } catch (_e) {}

    const [screenTime, freshSteps] = await Promise.all([
      withTimeout(usageService.getDailyScreenTime(), 3000, 0),
      withTimeout(usageService.getDailyStepCount(), 3000, 0),
    ]);
    // Use whichever is higher: the cached today value or the freshly-read value
    const dailySteps = Math.max(cachedStepsToday, freshSteps);
    console.log('[API] Fetched metrics - Steps:', dailySteps, 'Screen Time:', screenTime);
    let mood = null;
    let habitsCompleted = 0;
    let habitsTotal = 0;
    let localHabits = [];

    try {
      const raw = await AsyncStorage.getItem(LOCAL_HABITS_KEY);
      const parsed = raw ? JSON.parse(raw) : [];
      localHabits = Array.isArray(parsed) ? parsed : [];
    } catch (_error) {
      localHabits = [];
    }

    if (userId) {
      // Fast path: use single RPC call for dashboard metrics
      const { data: rpcData, error: rpcError } = await supabase.rpc('get_dashboard_metrics');

      if (!rpcError && rpcData) {
        mood = rpcData.mood || null;
        habitsTotal = rpcData.habits_total || 0;
        habitsCompleted = rpcData.habits_completed || 0;
      } else {
        // Fallback: N+1 parallel queries if the RPC hasn't been deployed yet
        const [latestMoodRes, habitsRes] = await Promise.all([
          supabase
            .from('mood_logs')
            .select('mood_score')
            .eq('user_id', userId)
            .order('timestamp', { ascending: false })
            .limit(1)
            .maybeSingle(),
          supabase
            .from('habits')
            .select('*')
            .eq('user_id', userId),
        ]);

        if (!latestMoodRes.error && latestMoodRes.data?.mood_score) {
          mood = latestMoodRes.data.mood_score;
        }

        if (!habitsRes.error && Array.isArray(habitsRes.data)) {
          const remoteHabits = habitsRes.data;
          habitsTotal = remoteHabits.length;

          const startOfDay = new Date();
          startOfDay.setHours(0, 0, 0, 0);
          const endOfDay = new Date();
          endOfDay.setHours(23, 59, 59, 999);

          const { data: logs, error: logsError } = await supabase
            .from('habit_logs')
            .select('habit_id,status,created_at')
            .eq('user_id', userId)
            .gte('created_at', startOfDay.toISOString())
            .lte('created_at', endOfDay.toISOString());

          if (!logsError && Array.isArray(logs)) {
            const completedToday = new Set(
              logs
                .filter((log) => (log.status || '').toLowerCase() === 'completed')
                .map((log) => log.habit_id)
                .filter(Boolean)
            );
            habitsCompleted = completedToday.size;
          }
        }
      }
    }

    if (localHabits.length > 0) {
      habitsTotal += localHabits.length;
      habitsCompleted += localHabits.filter((habit) => Boolean(habit?.completed)).length;
    }

    // Steps are sourced from pedometer APIs; screen time remains from usage stats.
    const result = {
      steps: dailySteps,
      screenTime: screenTime || 0,
      mood,
      habitsCompleted,
      habitsTotal,
      streak: 0,
    };

    // Cache today's step count so the live-step baseline can be seeded on next open
    if (dailySteps > 0) {
      const todayKey = new Date().toISOString().slice(0, 10);
      AsyncStorage.setItem(DAILY_STEPS_CACHE_KEY, JSON.stringify({ date: todayKey, steps: dailySteps })).catch(() => {});
      // Persist into the rolling local history used by the Activity Trend chart
      recordTodaySteps(dailySteps).catch(() => {});
    }

    // Always write today's metrics directly to Supabase so the trend chart
    // has real data even when the custom backend API handles the primary sync.
    if (userId && (dailySteps > 0 || (screenTime || 0) > 0)) {
      upsertDailyMetricsToSupabase({
        date: new Date().toISOString().slice(0, 10),
        steps: dailySteps,
        screenTime: screenTime || 0,
        userId,
      }).catch(() => {});
    }

    // Sync any unsynced past days (e.g. from a midnight rollover) automatically
    syncHistoricalStepsToSupabase().catch(() => {});

    return result;
  } catch (error) {
    console.error('Error fetching user data:', error);
    return DEFAULT_DASHBOARD_DATA;
  }
}

export async function fetchWeeklyStepTrend(todaySteps = 0, daysCount = 7, endDateStr = null) {
  const days = getLastNDates(daysCount, endDateStr);
  const realTodayStr = new Date().toISOString().slice(0, 10);

  // Load the local rolling history as a baseline before hitting any remote source
  const localHistory = await getLocalStepHistory();

  // Also ensure today's live value is recorded immediately (covers the case
  // where the user opens Insights before the dashboard sync has completed).
  if (todaySteps > 0) {
    recordTodaySteps(todaySteps).catch(() => {});
  }

  // Build a fallback using whatever we have locally
  const localFallback = days.map((date) => {
    const key = date.toISOString().slice(0, 10);
    const localSteps = localHistory[key] || 0;
    const steps =
      key === realTodayStr
        ? Math.max(localSteps, Math.round(todaySteps || 0))
        : localSteps;
    return { day: formatShortDay(date), steps };
  });

  try {
    const { data: { session } } = await supabase.auth.getSession();
    const userId = session?.user?.id;
    if (!userId) {
      return localFallback;
    }

    const startDate = days[0].toISOString().slice(0, 10);
    const endDate = days[days.length - 1].toISOString().slice(0, 10);

    const { data, error } = await supabase
      .from('daily_metrics')
      .select('date,steps')
      .eq('user_id', userId)
      .gte('date', startDate)
      .lte('date', endDate)
      .order('date', { ascending: true });

    if (error || !Array.isArray(data)) {
      return localFallback;
    }

    const stepMap = new Map(
      data.map((item) => [item.date, Number.isFinite(item.steps) ? item.steps : 0])
    );

    // Backfill Supabase for any historical days present in local cache but
    // absent (or lower) in the DB — runs silently in the background.
    backfillSupabaseFromLocalHistory(localHistory, userId, stepMap).catch(() => {});

    return days.map((date) => {
      const key = date.toISOString().slice(0, 10);
      const dbSteps = stepMap.has(key) ? stepMap.get(key) : 0;
      // Fall back to local history for days where the DB has no record yet
      const localSteps = localHistory[key] || 0;
      const bestHistorical = Math.max(dbSteps, localSteps);
      // For real today, also factor in the live reading passed in
      const steps =
        key === realTodayStr
          ? Math.max(bestHistorical, Math.round(todaySteps || 0))
          : bestHistorical;
      return { day: formatShortDay(date), steps };
    });
  } catch (_error) {
    return localFallback;
  }
}
