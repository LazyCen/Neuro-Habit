import * as SecureStore from 'expo-secure-store';
import AsyncStorage from '@react-native-async-storage/async-storage';
import { MMKV } from 'react-native-mmkv';
import * as Crypto from 'expo-crypto';
import Constants from 'expo-constants';
import * as Sentry from '@sentry/react-native';
import { supabase } from './supabaseClient';

const LOCAL_MOOD_LOGS_KEY = 'local_mood_logs_v1';
const PENDING_MOODS_KEY = 'pending_moods_v1';
const PENDING_METRICS_KEY = 'pending_metrics_v1';
const CACHED_INSIGHTS_KEY = 'cached_insights_v1';
const LOCAL_HABITS_KEY = 'local_habits_v1';
const PENDING_HABIT_TOGGLES_KEY = 'pending_habit_toggles_v1';
const HABIT_META_KEY = 'habit_meta_v2';
const DASHBOARD_CACHE_KEY = 'dashboard_data_cache_v1';
const HIDE_SYNC_CARD_KEY = 'hideSyncCard_v2';
const SYNC_BATCH_SIZE = 100;

let timeOffsetMs = 0;
let timeSynced = false;
let isFetchingTime = false;

function trimTrailingSlash(url) {
  if (!url) return '';
  return url.replace(/\/+$/, '');
}

function getApiBaseUrls() {
  const urls = [];
  const configuredUrl = process.env.EXPO_PUBLIC_API_URL;

  if (configuredUrl) {
    urls.push(trimTrailingSlash(configuredUrl));
  }

  // In development, automatically attempt to resolve the host machine's IP
  // to support real devices without hardcoding local IPs.
  if (__DEV__) {
    const debuggerHost = Constants.expoConfig?.hostUri;
    if (debuggerHost) {
      const hostIp = debuggerHost.split(':')[0];
      // Assume backend is running on port 8000 if not specified
      urls.push(`http://${hostIp}:8000`);
    }
    // Fallback to localhost for emulators
    urls.push('http://localhost:8000');
  }

  // Filter out placeholders
  return [...new Set(urls.filter(url => url && !url.includes('your-production-api-url.com')))];
}

let activeBackendUrl = null;

async function getActiveBackendUrl() {
  if (activeBackendUrl) return activeBackendUrl;
  
  const baseUrls = getApiBaseUrls();
  
  Sentry.addBreadcrumb({
    category: 'backend',
    message: 'Starting backend URL selection',
    data: { baseUrls },
    level: 'info',
  });
  
  if (baseUrls.length === 0) {
    Sentry.addBreadcrumb({
      category: 'backend',
      message: 'Failed to select backend: No URLs configured',
      level: 'error',
    });
    throw new Error("No API URLs configured");
  }
  
  if (baseUrls.length === 1) {
    activeBackendUrl = baseUrls[0];
    Sentry.addBreadcrumb({
      category: 'backend',
      message: 'Single backend URL available, selecting it',
      data: { selected: activeBackendUrl },
      level: 'info',
    });
    return activeBackendUrl;
  }
  
  try {
    Sentry.addBreadcrumb({
      category: 'backend',
      message: 'Pinging multiple backend URLs',
      data: { count: baseUrls.length },
      level: 'info',
    });

    activeBackendUrl = await Promise.any(
      baseUrls.map(async (url) => {
        const res = await fetchWithTimeout(`${url}/`, {}, 2000);
        if (res.ok) {
          Sentry.addBreadcrumb({
            category: 'backend',
            message: 'Backend ping successful',
            data: { url },
            level: 'info',
          });
          return url;
        }
        throw new Error(`Ping failed for ${url}`);
      })
    );
    
    Sentry.addBreadcrumb({
      category: 'backend',
      message: 'Active backend selected via ping',
      data: { selected: activeBackendUrl },
      level: 'info',
    });
    return activeBackendUrl;
  } catch (e) {
    activeBackendUrl = baseUrls[0];
    Sentry.addBreadcrumb({
      category: 'backend',
      message: 'All backend pings failed, falling back to first URL',
      data: { fallback: activeBackendUrl, error: e.message },
      level: 'warning',
    });
    return activeBackendUrl;
  }
}

async function fetchFromBackend(path, options = {}, timeoutMs = 8000) {
  const baseUrl = await getActiveBackendUrl();
  
  try {
    const { data: { session } } = await supabase.auth.getSession();
    const token = session?.access_token;

    const headers = {
      ...options.headers,
    };

    if (token) {
      headers.Authorization = `Bearer ${token}`;
    }

    const updatedOptions = {
      ...options,
      headers,
    };

    const response = await fetchWithTimeout(`${baseUrl}${path}`, updatedOptions, timeoutMs);
    if (!response.ok) {
      // Attach the HTTP status so callers can distinguish permanent (4xx) from
      // transient (5xx / network) failures without re-parsing error messages.
      const err = new Error(`Request failed (${response.status}) at ${baseUrl}${path}`);
      err.status = response.status;
      err.isPermanent = response.status >= 400 && response.status < 500;
      throw err;
    }
    return await response.json();
  } catch (error) {
    // Clear cache on failure so we can re-evaluate active backend on next request
    activeBackendUrl = null;
    throw error;
  }
}
async function fetchWithTimeout(url, options = {}, timeoutMs = 5000) {
  const controller = new AbortController();
  const timeoutId = setTimeout(() => controller.abort(), timeoutMs);
  try {
    return await fetch(url, { ...options, signal: controller.signal });
  } finally {
    clearTimeout(timeoutId);
  }
}

// Sensitive health-data queues are persisted in an encrypted MMKV instance
// to prevent overflowing the OS-level keystore.
let encryptedStorage = null;

async function getEncryptedStorage() {
  if (encryptedStorage) return encryptedStorage;
  try {
    let key = await SecureStore.getItemAsync('mmkv_encryption_key');
    if (!key) {
      try {
        const randomBytes = await Crypto.getRandomBytesAsync(32);
        // Ensure we have a regular array for mapping to hex strings
        const bytesArray = Array.from(randomBytes);
        key = bytesArray
          .map((b) => b.toString(16).padStart(2, '0'))
          .join('');
        await SecureStore.setItemAsync('mmkv_encryption_key', key);
      } catch (cryptoError) {
        console.warn('Crypto key generation failed, falling back to unencrypted storage:', cryptoError);
        encryptedStorage = new MMKV({ id: 'secure-offline-data' });
        return encryptedStorage;
      }
    }

    if (typeof MMKV !== 'function') {
      throw new Error('MMKV undefined');
    }

    encryptedStorage = new MMKV({
      id: 'secure-offline-data',
      encryptionKey: key,
    });
    return encryptedStorage;
  } catch (e) {
    // Final fallback to unencrypted storage if MMKV exists
    if (typeof MMKV === 'function') {
        encryptedStorage = new MMKV({ id: 'secure-offline-data' });
        return encryptedStorage;
    }
    throw e;
  }
}

async function getSecureArray(key) {
  try {
    const storage = await getEncryptedStorage();
    const raw = storage.getString(key);
    const parsed = raw ? JSON.parse(raw) : [];
    return Array.isArray(parsed) ? parsed : [];
  } catch (e) {
    try {
      const raw = await AsyncStorage.getItem(`fallback_${key}`);
      const parsed = raw ? JSON.parse(raw) : [];
      return Array.isArray(parsed) ? parsed : [];
    } catch (fallbackError) {
      console.error(`[AsyncStorage] Fallback read error for ${key}:`, fallbackError);
      return [];
    }
  }
}

async function setSecureArray(key, value) {
  try {
    const storage = await getEncryptedStorage();
    storage.set(key, JSON.stringify(value));
  } catch (e) {
    try {
      await AsyncStorage.setItem(`fallback_${key}`, JSON.stringify(value));
    } catch (fallbackError) {
      console.error(`[AsyncStorage] Fallback write error for ${key}:`, fallbackError);
    }
  }
}

// Alias kept for call-sites that previously used AsyncStorage helpers.
const getArrayStorage = getSecureArray;
const setArrayStorage = setSecureArray;

async function appendArrayStorage(key, value) {
  const current = await getSecureArray(key);
  current.push(value);
  await setSecureArray(key, current);
}

// Data retention policy: Purge entries older than 30 days
async function pruneOldLocalData() {
  const thirtyDaysAgo = Date.now() - 30 * 24 * 60 * 60 * 1000;

  try {
    // 1. Prune local mood history (offline fallback logs)
    const localMoods = await getSecureArray(LOCAL_MOOD_LOGS_KEY);
    const validLocalMoods = localMoods.filter((item) => {
      const time = new Date(item.created_at || item.queuedAt || Date.now()).getTime();
      return time >= thirtyDaysAgo;
    });
    if (validLocalMoods.length !== localMoods.length) {
      await setSecureArray(LOCAL_MOOD_LOGS_KEY, validLocalMoods);
    }

    // 2. Prune pending queues that are hopelessly stale (avoid infinite retry loops)
    const pendingMoods = await getSecureArray(PENDING_MOODS_KEY);
    const validPendingMoods = pendingMoods.filter((item) => {
      const time = new Date(item.queuedAt || Date.now()).getTime();
      return time >= thirtyDaysAgo;
    });
    if (validPendingMoods.length !== pendingMoods.length) {
      await setSecureArray(PENDING_MOODS_KEY, validPendingMoods);
    }

    const pendingMetrics = await getSecureArray(PENDING_METRICS_KEY);
    const validPendingMetrics = pendingMetrics.filter((item) => {
      const time = new Date(item.queuedAt || Date.now()).getTime();
      return time >= thirtyDaysAgo;
    });
    if (validPendingMetrics.length !== pendingMetrics.length) {
      await setSecureArray(PENDING_METRICS_KEY, validPendingMetrics);
    }
  } catch (error) {
    console.error('Error during data retention pruning:', error);
  }
}

async function saveMoodLocally(mood, note) {
  const entry = {
    mood,
    note,
    created_at: new Date().toISOString(),
    source: 'local_fallback',
  };

  try {
    // Health data persisted in the encrypted local database.
    const logs = await getSecureArray(LOCAL_MOOD_LOGS_KEY);
    logs.push(entry);
    await setSecureArray(LOCAL_MOOD_LOGS_KEY, logs);
  } catch (storageError) {
    console.error('Error saving mood locally:', storageError);
  }

  return { success: true, offline: true, data: entry };
}

async function saveMoodViaSupabase(mood, note) {
  const { data: { session } } = await supabase.auth.getSession();
  const userId = session?.user?.id;
  if (!userId) {
    throw new Error('No authenticated user for Supabase mood insert');
  }

  const payload = {
    user_id: userId,
    mood_score: mood,
    note: note || null,
    timestamp: new Date().toISOString(),
  };

  const { data, error } = await supabase
    .from('mood_logs')
    .insert([payload])
    .select()
    .single();

  if (error) {
    throw error;
  }

  return { success: true, via: 'supabase', data };
}

async function postMoodOnline(mood, note) {
  try {
    const { data: { session } } = await supabase.auth.getSession();
    const userId = session?.user?.id;
    
    return await fetchFromBackend(`/mood${userId ? `?user_id=${userId}` : ''}`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ mood, note }),
    });
  } catch (backendError) {
    return await saveMoodViaSupabase(mood, note);
  }
}

async function postMetricsOnline(steps, screenTime) {
  const { data: { session } } = await supabase.auth.getSession();
  const userId = session?.user?.id;
  
  const params = new URLSearchParams();
  if (userId) params.append('user_id', userId);
  
  return await fetchFromBackend(`/metrics${userId ? `?user_id=${userId}` : ''}`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ steps, screen_time: screenTime }),
  });
}

async function postMoodBulkOnline(moods) {
  if (!moods || moods.length === 0) return { success: true };
  if (moods.length > SYNC_BATCH_SIZE) {
    throw new Error(`Bulk mood payload exceeds maximum batch size of ${SYNC_BATCH_SIZE}`);
  }
  try {
    const { data: { session } } = await supabase.auth.getSession();
    const userId = session?.user?.id;
    
    return await fetchFromBackend(`/mood/bulk${userId ? `?user_id=${userId}` : ''}`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(moods),
    });
  } catch (backendError) {
    const { data: { session } } = await supabase.auth.getSession();
    const userId = session?.user?.id;
    if (!userId) throw new Error('No authenticated user for Supabase mood bulk insert');
    
    const payloads = moods.map(m => ({
      user_id: userId,
      mood_score: m.mood,
      note: m.note || null,
      timestamp: m.timestamp || new Date().toISOString(),
    }));
    
    const { data, error } = await supabase
      .from('mood_logs')
      .insert(payloads)
      .select();
      
    if (error) throw error;
    return { success: true, via: 'supabase', data };
  }
}

async function postMetricsBulkOnline(metricsList) {
  if (!metricsList || metricsList.length === 0) return { success: true };
  if (metricsList.length > SYNC_BATCH_SIZE) {
    throw new Error(`Bulk metrics payload exceeds maximum batch size of ${SYNC_BATCH_SIZE}`);
  }
  try {
    const { data: { session } } = await supabase.auth.getSession();
    const userId = session?.user?.id;
    
    return await fetchFromBackend(`/metrics/bulk${userId ? `?user_id=${userId}` : ''}`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(metricsList),
    });
  } catch (backendError) {
    const { data: { session } } = await supabase.auth.getSession();
    const userId = session?.user?.id;
    if (!userId) throw new Error('No authenticated user for Supabase metrics bulk upsert');
    
    const payloads = metricsList.map(m => ({
      user_id: userId,
      steps: m.steps,
      screen_time: m.screen_time,
      date: m.date || new Date().toISOString().slice(0, 10),
    }));
    
    const { data, error } = await supabase
      .from('daily_metrics')
      .upsert(payloads, { onConflict: 'user_id,date' })
      .select();
      
    if (error) throw error;
    return { success: true, via: 'supabase', data };
  }
}

async function saveMetricsViaSupabase(steps, screenTime) {
  const { data: { session } } = await supabase.auth.getSession();
  const userId = session?.user?.id;
  if (!userId) {
    throw new Error('No authenticated user for Supabase metrics upsert');
  }

  const payload = {
    user_id: userId,
    steps,
    screen_time: screenTime,
    date: new Date().toISOString().slice(0, 10),
  };

  const { data, error } = await supabase
    .from('daily_metrics')
    .upsert(payload, { onConflict: 'user_id,date' })
    .select()
    .single();

  if (error) throw error;
  return { success: true, via: 'supabase', data };
}

async function cacheInsights(insights) {
  try {
    // Insights cache can be large (AI response data); AsyncStorage is fine
    // here as it contains no auth tokens or PII beyond what is in the DB.
    await AsyncStorage.setItem(CACHED_INSIGHTS_KEY, JSON.stringify(insights));
  } catch (e) {
    console.error('Error caching insights:', e);
  }
}

async function fetchInsightsViaSupabase() {
  const { data: { session } } = await supabase.auth.getSession();
  const userId = session?.user?.id;
  if (!userId) return [];

  const { data, error } = await supabase
    .from('ai_insights')
    .select('text, type, icon, created_at')
    .eq('user_id', userId)
    .order('created_at', { ascending: false })
    .limit(5);

  if (error) throw error;
  return Array.isArray(data) ? data : [];
}

async function createHabitViaSupabase(title) {
  const trimmedValue = typeof title === 'string' ? title.trim() : '';
  if (!trimmedValue) {
    throw new Error('Habit name is required');
  }

  const { data: { session } } = await supabase.auth.getSession();
  const userId = session?.user?.id;
  if (!userId) {
    throw new Error('No authenticated user for habit creation');
  }

  const { data, error } = await supabase
    .from('habits')
    .insert([{ user_id: userId, title: trimmedValue }])
    .select()
    .single();

  if (error) {
    throw error;
  }

  return { success: true, via: 'supabase', data };
}

export const backendService = {
  async fetchTrustedTime(retryCount = 0) {
    if (timeSynced) return;
    
    // Prevent multiple concurrent fetch chains from starting at once
    if (retryCount === 0 && isFetchingTime) return;
    isFetchingTime = true;

    try {
      const response = await fetchFromBackend('/time');
      if (response && response.utc_time) {
        const serverTime = new Date(response.utc_time).getTime();
        const localTime = Date.now();
        timeOffsetMs = serverTime - localTime;
        timeSynced = true;
        isFetchingTime = false;
        console.log(`[backendService] Trusted time synchronized. Offset: ${timeOffsetMs}ms`);
      } else {
        isFetchingTime = false;
        console.warn('[backendService] /time returned successfully but without utc_time field');
      }
    } catch (e) {
      const MAX_RETRIES = 10;
      if (retryCount < MAX_RETRIES) {
        // Exponential backoff: 2s, 4s, 8s, 16s, 32s, 64s, 128s, 256s, 512s, 1024s (~17 mins total)
        const delay = Math.pow(2, retryCount + 1) * 1000;
        console.warn(`[backendService] Failed to fetch trusted time. Retrying in ${delay / 1000}s...`);
        setTimeout(() => {
          this.fetchTrustedTime(retryCount + 1);
        }, delay);
      } else {
        isFetchingTime = false;
        console.error('[backendService] Max retries reached for trusted time fetch. Using local clock.', e);
      }
    }
  },

  getTrustedTime() {
    return Date.now() + timeOffsetMs;
  },

  async isOnline() {
    const baseUrls = getApiBaseUrls();
    try {
      // 1. Try to ping the custom backend(s)
      await Promise.any(
        baseUrls.map(async (baseUrl) => {
          const response = await fetchWithTimeout(`${baseUrl}/`, {}, 3000);
          if (response.ok) return true;
          throw new Error('Ping failed');
        })
      );
      return true;
    } catch (e) {
      // 2. If custom backend is down, check general internet connectivity (e.g., Supabase or Google)
      try {
        const publicPing = await fetchWithTimeout(process.env.EXPO_PUBLIC_SUPABASE_URL || 'https://www.google.com', { method: 'HEAD' }, 3000);
        // If we can reach Supabase or Google, we are "online"
        return publicPing.ok || publicPing.status < 500;
      } catch (internetError) {
        return false;
      }
    }
  },

  async getCachedInsights() {
    try {
      const raw = await AsyncStorage.getItem(CACHED_INSIGHTS_KEY);
      const parsed = raw ? JSON.parse(raw) : [];
      return Array.isArray(parsed) ? parsed : [];
    } catch (e) {
      console.error('[AsyncStorage] Error reading cached insights:', e);
      return [];
    }
  },

  async syncPendingData() {
    // Enforce data retention policy before syncing
    await pruneOldLocalData();

    const isOnline = await this.isOnline();
    if (!isOnline) return;

    // Retry fetching trusted time if it failed earlier (e.g. during tunnel traversal)
    if (!timeSynced) {
      this.fetchTrustedTime().catch(() => {});
    }

    // Sync offline habits first
    try {
      const localHabits = await getArrayStorage(LOCAL_HABITS_KEY);
      if (localHabits.length > 0) {
        const remainingHabits = [];
        let anySynced = false;
        
        for (const habit of localHabits) {
          try {
            // Check if it's already a UUID (just in case), local ones start with 'local-'
            if (habit.id && !habit.id.toString().startsWith('local-')) {
              continue;
            }
            
            const res = await this.createHabit(habit.name);
            if (res && !res.error) {
              anySynced = true;
            } else {
              remainingHabits.push(habit);
            }
          } catch (e) {
            remainingHabits.push(habit);
          }
        }
        
        if (anySynced || remainingHabits.length !== localHabits.length) {
          await setArrayStorage(LOCAL_HABITS_KEY, remainingHabits);
        }
      }
    } catch (e) {
      console.error('[Sync] Error syncing local habits:', e);
    }

    // Sync offline habit toggles
    try {
      const pendingToggles = await getArrayStorage(PENDING_HABIT_TOGGLES_KEY);
      if (pendingToggles.length > 0) {
        const remainingToggles = [];
        const { data: { session } } = await supabase.auth.getSession();
        
        for (const item of pendingToggles) {
          try {
            if (!session?.user?.id) throw new Error('No user');
            
            // Sync to habits table
            const { error: updateError } = await supabase
              .from('habits')
              .update({ streak: item.streak, last_completed_at: item.lastCompletedAt })
              .eq('id', item.id);
              
            if (updateError) throw updateError;
            
            // Sync to habit_logs
            if (item.completed) {
               await supabase
                 .from('habit_logs')
                 .insert({ habit_id: item.id, user_id: session.user.id, status: 'completed', created_at: item.lastCompletedAt });
            } else {
               const startOfDay = new Date();
               startOfDay.setHours(0, 0, 0, 0);
               await supabase
                 .from('habit_logs')
                 .delete()
                 .eq('habit_id', item.id)
                 .gte('created_at', startOfDay.toISOString());
            }
          } catch (e) {
            remainingToggles.push(item);
          }
        }
        await setArrayStorage(PENDING_HABIT_TOGGLES_KEY, remainingToggles);
      }
    } catch (e) {
      console.error('[Sync] Error syncing habit toggles:', e);
    }

    const MAX_RETRIES = 8;

    const shouldRetry = (item) => {
      const retryCount = item.retryCount || 0;
      if (retryCount >= MAX_RETRIES) return false;
      const nextRetryAt = item.nextRetryAt ? new Date(item.nextRetryAt).getTime() : 0;
      return Date.now() >= nextRetryAt;
    };

    const markFailure = (item, error, type) => {
      // 400 (Bad Request) could be a payload limit error from the backend.
      // We treat it as transient if it looks like a limit issue, allowing chunking/retries to handle it.
      const isPayloadLimit = error?.status === 400; // Backend returns 400 for exceeds limit
      
      if (error?.isPermanent && !isPayloadLimit) {
        console.error(`[Telemetry] Permanent rejection (HTTP ${error.status}) for ${type} — dropping:`, error);
        return null;
      }
      const retryCount = (item.retryCount || 0) + 1;
      if (retryCount >= MAX_RETRIES) {
        // Log to telemetry
        Sentry.captureException(error, {
          tags: { type, service: 'sync' },
          extra: { item }
        });
        console.error(`[Telemetry] Permanent sync failure for ${type}:`, error);
        return null; // Drop from queue
      }
      // Exponential backoff: 2^retryCount minutes (only for transient / network / limit errors)
      const backoffMinutes = Math.pow(2, retryCount);
      const nextRetryAt = new Date(Date.now() + backoffMinutes * 60 * 1000).toISOString();
      return { ...item, retryCount, nextRetryAt };
    };

    const pendingMoods = await getArrayStorage(PENDING_MOODS_KEY);
    if (pendingMoods.length > 0) {
      const remainingMoods = [];
      const moodsToSync = [];
      for (const item of pendingMoods) {
        if (!shouldRetry(item)) {
          if ((item.retryCount || 0) < MAX_RETRIES) remainingMoods.push(item);
          continue;
        }
        moodsToSync.push(item);
      }
      
      if (moodsToSync.length > 0) {
        const CHUNK_SIZE = SYNC_BATCH_SIZE;
        for (let i = 0; i < moodsToSync.length; i += CHUNK_SIZE) {
          const chunk = moodsToSync.slice(i, i + CHUNK_SIZE);
          try {
            const payload = chunk.map(m => ({ 
              mood: m.mood, 
              note: m.note, 
              timestamp: m.queuedAt || new Date().toISOString() 
            }));
            await postMoodBulkOnline(payload);
          } catch (e) {
            for (const item of chunk) {
              const updatedItem = markFailure(item, e, 'mood');
              if (updatedItem) remainingMoods.push(updatedItem);
            }
          }
        }
      }
      await setArrayStorage(PENDING_MOODS_KEY, remainingMoods);
    }

    const pendingMetrics = await getArrayStorage(PENDING_METRICS_KEY);
    if (pendingMetrics.length > 0) {
      const remainingMetrics = [];
      const metricsToSync = [];
      for (const item of pendingMetrics) {
        if (!shouldRetry(item)) {
          if ((item.retryCount || 0) < MAX_RETRIES) remainingMetrics.push(item);
          continue;
        }
        metricsToSync.push(item);
      }
      
      if (metricsToSync.length > 0) {
        const CHUNK_SIZE = SYNC_BATCH_SIZE;
        for (let i = 0; i < metricsToSync.length; i += CHUNK_SIZE) {
          const chunk = metricsToSync.slice(i, i + CHUNK_SIZE);
          try {
            const payload = chunk.map(m => ({
              steps: m.steps,
              screen_time: m.screenTime,
              date: new Date(m.queuedAt || Date.now()).toISOString().slice(0, 10)
            }));
            await postMetricsBulkOnline(payload);
          } catch (e) {
            for (const item of chunk) {
              const updatedItem = markFailure(item, e, 'metrics');
              if (updatedItem) remainingMetrics.push(updatedItem);
            }
          }
        }
      }
      await setArrayStorage(PENDING_METRICS_KEY, remainingMetrics);
    }
  },

  async getInsights() {
    try {
      const insights = await fetchFromBackend('/insights');
      if (Array.isArray(insights) && insights.length > 0) {
        await cacheInsights(insights);
      }
      return insights;
    } catch (backendError) {
      try {
        const supabaseInsights = await fetchInsightsViaSupabase();
        if (supabaseInsights.length > 0) {
          await cacheInsights(supabaseInsights);
          return supabaseInsights;
        }
      } catch (supabaseError) {
        console.warn('Insights fetch failed on backend and Supabase fallback.');
      }
      return await this.getCachedInsights();
    }
  },

  async logMood(mood, note) {
    if (typeof mood !== 'number') return null;
    try {
      return await postMoodOnline(mood, note);
    } catch (error) {
      console.error('Error logging mood:', error);
      await appendArrayStorage(PENDING_MOODS_KEY, { mood, note, queuedAt: new Date().toISOString() });
      return await saveMoodLocally(mood, note);
    }
  },

  async syncMetrics(steps, screenTime) {
    try {
      return await postMetricsOnline(steps, screenTime);
    } catch (backendError) {
      try {
        return await saveMetricsViaSupabase(steps, screenTime);
      } catch (supabaseError) {
        console.warn('Metrics sync failed online; queued for retry.');
        await appendArrayStorage(PENDING_METRICS_KEY, {
          steps,
          screenTime,
          queuedAt: new Date().toISOString(),
        });
        return { success: false, queued: true };
      }
    }
  },

  async createHabit(title) {
    try {
      const { data: { session } } = await supabase.auth.getSession();
      const userId = session?.user?.id;
      
      return await fetchFromBackend(`/habits${userId ? `?user_id=${userId}` : ''}`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ title }),
      });
    } catch (backendError) {
      try {
        return await createHabitViaSupabase(title);
      } catch (supabaseError) {
        console.error('Error creating habit:', supabaseError);
        return {
          error: true,
          message: supabaseError?.message || backendError?.message || 'Failed to create habit',
          details: {
            backend: backendError?.message || null,
            supabase: supabaseError?.message || null,
          },
        };
      }
    }
  },

  async queueHabitToggle(id, completed, streak, lastCompletedAt) {
    await appendArrayStorage(PENDING_HABIT_TOGGLES_KEY, {
      id,
      completed,
      streak,
      lastCompletedAt,
      queuedAt: new Date().toISOString()
    });
  },

  async deleteAccount() {
    const { data: { session } } = await supabase.auth.getSession();
    const token = session?.access_token;
    if (!token) throw new Error("No authenticated session");

    return await fetchFromBackend('/account', {
      method: 'DELETE',
      headers: {
        'Authorization': `Bearer ${token}`
      }
    });
  },

  async purgeAllLocalData(force = true) {
    try {
      // 1. Clear encrypted MMKV instance (Moods, Metrics, etc.)
      try {
        const storage = await getEncryptedStorage();
        storage.clearAll();
      } catch (mmkvError) {
        console.warn('[backendService] Could not clear MMKV storage, may be using fallback:', mmkvError);
      }
      
      // 2. Clear AsyncStorage (Insights, Habits, Dashboard Cache, UI flags, and MMKV fallbacks)
      const keysToClear = [
        CACHED_INSIGHTS_KEY,
        LOCAL_HABITS_KEY,
        PENDING_HABIT_TOGGLES_KEY,
        HABIT_META_KEY,
        DASHBOARD_CACHE_KEY,
        HIDE_SYNC_CARD_KEY,
        `fallback_${LOCAL_MOOD_LOGS_KEY}`,
        `fallback_${PENDING_MOODS_KEY}`,
        `fallback_${PENDING_METRICS_KEY}`
      ];
      await AsyncStorage.multiRemove(keysToClear);
      
      // 3. Purge the encryption key from SecureStore to ensure a fresh start
      await SecureStore.deleteItemAsync('mmkv_encryption_key');
      encryptedStorage = null;
      
      console.log('[backendService] Local user data purged successfully');
    } catch (e) {
      console.error('[backendService] Failed to purge local data:', e);
    }
  }
};
