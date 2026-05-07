import { usageService } from './usageService';
import { supabase } from './supabaseClient';
import AsyncStorage from '@react-native-async-storage/async-storage';

const LOCAL_HABITS_KEY = 'local_habits_v1';
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

function getLastNDates(n) {
  const days = [];
  const now = new Date();
  for (let i = n - 1; i >= 0; i -= 1) {
    const day = new Date(now);
    day.setHours(0, 0, 0, 0);
    day.setDate(now.getDate() - i);
    days.push(day);
  }
  return days;
}

function getCurrentWeekMondayFirst() {
  const now = new Date();
  const day = now.getDay(); // 0=Sun, 1=Mon, ... 6=Sat
  const diffToMonday = day === 0 ? -6 : 1 - day;
  const monday = new Date(now);
  monday.setHours(0, 0, 0, 0);
  monday.setDate(now.getDate() + diffToMonday);

  const week = [];
  for (let i = 0; i < 7; i += 1) {
    const d = new Date(monday);
    d.setDate(monday.getDate() + i);
    week.push(d);
  }
  return week;
}

function withTimeout(promise, timeoutMs, fallbackValue) {
  return Promise.race([
    promise,
    new Promise((resolve) => setTimeout(() => resolve(fallbackValue), timeoutMs)),
  ]);
}

// Integrated API (uses real data when available)
export async function fetchUserData() {
  try {
    const { data: { session } } = await supabase.auth.getSession();
    const userId = session?.user?.id;
    const [screenTime, dailySteps] = await Promise.all([
      withTimeout(usageService.getDailyScreenTime(), 3000, 0),
      withTimeout(usageService.getDailyStepCount(), 5000, 0),
    ]);
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
    return {
      steps: dailySteps,
      screenTime: screenTime || 0,
      mood,
      habitsCompleted,
      habitsTotal,
      streak: 0,
    };
  } catch (error) {
    console.error('Error fetching user data:', error);
    return DEFAULT_DASHBOARD_DATA;
  }
}

export async function fetchWeeklyStepTrend(todaySteps = 0) {
  const days = getCurrentWeekMondayFirst();
  const fallback = days.map((date, index) => ({
    day: formatShortDay(date),
    steps: index === days.length - 1 ? Math.max(0, Math.round(todaySteps || 0)) : 0,
  }));

  try {
    const { data: { session } } = await supabase.auth.getSession();
    const userId = session?.user?.id;
    if (!userId) {
      return fallback;
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
      return fallback;
    }

    const stepMap = new Map(
      data.map((item) => [item.date, Number.isFinite(item.steps) ? item.steps : 0])
    );

    return days.map((date, index) => {
      const key = date.toISOString().slice(0, 10);
      const dbSteps = stepMap.has(key) ? stepMap.get(key) : 0;
      const steps = index === days.length - 1 ? Math.max(dbSteps, Math.round(todaySteps || 0)) : dbSteps;
      return {
        day: formatShortDay(date),
        steps,
      };
    });
  } catch (_error) {
    return fallback;
  }
}
