import { Platform } from 'react-native';
import * as SecureStore from 'expo-secure-store';
import AsyncStorage from '@react-native-async-storage/async-storage';
import Constants from 'expo-constants';
import { MMKV } from 'react-native-mmkv';
import * as Crypto from 'expo-crypto';
import { supabase } from './supabaseClient';

const LOCAL_MOOD_LOGS_KEY = 'local_mood_logs_v1';
const PENDING_MOODS_KEY = 'pending_moods_v1';
const PENDING_METRICS_KEY = 'pending_metrics_v1';
const CACHED_INSIGHTS_KEY = 'cached_insights_v1';

let timeOffsetMs = 0;

function trimTrailingSlash(url) {
  return url.replace(/\/+$/, '');
}

function getDevHostFromExpo() {
  const hostUri =
    Constants?.expoConfig?.hostUri ||
    Constants?.manifest2?.extra?.expoClient?.hostUri ||
    Constants?.manifest?.debuggerHost;

  if (!hostUri || typeof hostUri !== 'string') return null;
  return hostUri.split(':')[0];
}

function getApiBaseUrls() {
  const urls = [];
  const configuredUrl = process.env.EXPO_PUBLIC_API_URL;

  if (configuredUrl) urls.push(trimTrailingSlash(configuredUrl));

  if (__DEV__) {
    const devHost = getDevHostFromExpo();
    if (devHost) urls.push(`http://${devHost}:8000`);
    if (Platform.OS === 'android') urls.push('http://10.0.2.2:8000');
    urls.push('http://localhost:8000');
  }

  return [...new Set(urls)];
}

let activeBackendUrl = null;

async function getActiveBackendUrl() {
  if (activeBackendUrl) return activeBackendUrl;
  
  const baseUrls = getApiBaseUrls();
  if (baseUrls.length === 0) throw new Error("No API URLs configured");
  if (baseUrls.length === 1) {
    activeBackendUrl = baseUrls[0];
    return activeBackendUrl;
  }
  
  try {
    // Health-check ping all URLs concurrently
    activeBackendUrl = await Promise.any(
      baseUrls.map(async (url) => {
        const res = await fetchWithTimeout(`${url}/`, {}, 2000);
        if (res.ok) return url;
        throw new Error('Ping failed');
      })
    );
    return activeBackendUrl;
  } catch (e) {
    return baseUrls[0]; // Fallback to first if all pings fail
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
      // Generate a cryptographically secure 256-bit (32-byte) random key.
      // expo-crypto uses the platform CSPRNG (SecRandomCopyBytes on iOS,
      // /dev/urandom on Android) — never Math.random().
      const randomBytes = await Crypto.getRandomBytesAsync(32);
      key = Array.from(randomBytes)
        .map((b) => b.toString(16).padStart(2, '0'))
        .join('');
      await SecureStore.setItemAsync('mmkv_encryption_key', key);
    }
    encryptedStorage = new MMKV({
      id: 'secure-offline-data',
      encryptionKey: key,
    });
    return encryptedStorage;
  } catch (e) {
    console.error('Failed to initialize encrypted MMKV storage', e);
    encryptedStorage = new MMKV({ id: 'secure-offline-data' });
    return encryptedStorage;
  }
}

async function getSecureArray(key) {
  try {
    const storage = await getEncryptedStorage();
    const raw = storage.getString(key);
    const parsed = raw ? JSON.parse(raw) : [];
    return Array.isArray(parsed) ? parsed : [];
  } catch (e) {
    console.error(`[MMKV] Error reading ${key}:`, e);
    return [];
  }
}

async function setSecureArray(key, value) {
  try {
    const storage = await getEncryptedStorage();
    storage.set(key, JSON.stringify(value));
  } catch (e) {
    console.error(`[MMKV] Error writing ${key}:`, e);
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

async function createHabitViaSupabase(name) {
  const trimmedValue = typeof name === 'string' ? name.trim() : '';
  if (!trimmedValue) {
    throw new Error('Habit name is required');
  }

  const { data: { session } } = await supabase.auth.getSession();
  const userId = session?.user?.id;
  if (!userId) {
    throw new Error('No authenticated user for habit creation');
  }

  const payloadVariants = [
    { user_id: userId, name: trimmedValue },
    { user_id: userId, title: trimmedValue },
  ];

  let lastError = null;

  for (const payload of payloadVariants) {
    const { data, error } = await supabase
      .from('habits')
      .insert([payload])
      .select()
      .single();

    if (!error) {
      return { success: true, via: 'supabase', data };
    }

    lastError = error;
  }

  throw lastError || new Error('Unable to insert habit');
}

export const backendService = {
  async fetchTrustedTime() {
    try {
      const response = await fetchFromBackend('/time');
      if (response && response.utc_time) {
        const serverTime = new Date(response.utc_time).getTime();
        const localTime = Date.now();
        timeOffsetMs = serverTime - localTime;
      }
    } catch (e) {
      console.warn('Failed to fetch trusted time, using local clock', e);
    }
  },

  getTrustedTime() {
    return Date.now() + timeOffsetMs;
  },

  async isOnline() {
    const baseUrls = getApiBaseUrls();
    try {
      await Promise.any(
        baseUrls.map(async (baseUrl) => {
          const response = await fetchWithTimeout(`${baseUrl}/`, {}, 3000);
          if (response.ok) return true;
          throw new Error('Ping failed');
        })
      );
      return true;
    } catch (e) {
      return false;
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

    const MAX_RETRIES = 8;

    const shouldRetry = (item) => {
      const retryCount = item.retryCount || 0;
      if (retryCount >= MAX_RETRIES) return false;
      const nextRetryAt = item.nextRetryAt ? new Date(item.nextRetryAt).getTime() : 0;
      return Date.now() >= nextRetryAt;
    };

    const markFailure = (item, error, type) => {
      // 4xx errors are permanent client rejections (bad payload, auth, etc.).
      // Retrying them is futile and blocks other items — drop immediately.
      if (error?.isPermanent) {
        console.error(`[Telemetry] Permanent rejection (HTTP ${error.status}) for ${type} — dropping:`, error);
        return null;
      }
      const retryCount = (item.retryCount || 0) + 1;
      if (retryCount >= MAX_RETRIES) {
        // Log to telemetry (mock Sentry)
        console.error(`[Telemetry] Permanent sync failure for ${type}:`, error);
        return null; // Drop from queue
      }
      // Exponential backoff: 2^retryCount minutes (only for transient 5xx / network errors)
      const backoffMinutes = Math.pow(2, retryCount);
      const nextRetryAt = new Date(Date.now() + backoffMinutes * 60 * 1000).toISOString();
      return { ...item, retryCount, nextRetryAt };
    };

    const pendingMoods = await getArrayStorage(PENDING_MOODS_KEY);
    if (pendingMoods.length > 0) {
      const remainingMoods = [];
      for (const item of pendingMoods) {
        if (!shouldRetry(item)) {
          if ((item.retryCount || 0) < MAX_RETRIES) remainingMoods.push(item);
          continue;
        }
        try {
          await postMoodOnline(item.mood, item.note);
        } catch (e) {
          const updatedItem = markFailure(item, e, 'mood');
          if (updatedItem) remainingMoods.push(updatedItem);
        }
      }
      await setArrayStorage(PENDING_MOODS_KEY, remainingMoods);
    }

    const pendingMetrics = await getArrayStorage(PENDING_METRICS_KEY);
    if (pendingMetrics.length > 0) {
      const remainingMetrics = [];
      for (const item of pendingMetrics) {
        if (!shouldRetry(item)) {
          if ((item.retryCount || 0) < MAX_RETRIES) remainingMetrics.push(item);
          continue;
        }
        try {
          await postMetricsOnline(item.steps, item.screenTime);
        } catch (e) {
          const updatedItem = markFailure(item, e, 'metrics');
          if (updatedItem) remainingMetrics.push(updatedItem);
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

  async createHabit(name) {
    try {
      const { data: { session } } = await supabase.auth.getSession();
      const userId = session?.user?.id;
      
      return await fetchFromBackend(`/habits${userId ? `?user_id=${userId}` : ''}`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ name }),
      });
    } catch (backendError) {
      try {
        return await createHabitViaSupabase(name);
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
  }
};
