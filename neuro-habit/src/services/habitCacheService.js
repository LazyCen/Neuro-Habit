/**
 * habitCacheService.js
 *
 * Manages a persistent cache of the user's last-known remote habits list.
 * This allows HabitScreen to render complete habit data immediately on mount
 * (even offline) without waiting for a Supabase round-trip.
 *
 * Cache invalidation:
 *  - Written every time a successful remote fetch completes in HabitScreen.
 *  - Automatically cleared on signOut via backendService.purgeAllLocalData().
 *  - Stale after 7 days (treated as empty; remote fetch is required).
 */

import AsyncStorage from '@react-native-async-storage/async-storage';

const HABIT_CACHE_KEY = 'habit_remote_cache_v1';
const CACHE_TTL_MS = 7 * 24 * 60 * 60 * 1000; // 7 days

/**
 * Persist the latest successfully fetched remote habits.
 * @param {Array} habits - Array of normalised habit objects.
 */
export async function saveHabitCache(habits) {
  if (!Array.isArray(habits)) return;
  try {
    const payload = { habits, savedAt: new Date().toISOString() };
    await AsyncStorage.setItem(HABIT_CACHE_KEY, JSON.stringify(payload));
  } catch (_e) {
    // Non-fatal; worst case the user sees an empty list while offline
  }
}

/**
 * Return the cached remote habits, or an empty array if the cache is absent,
 * corrupt, or older than CACHE_TTL_MS.
 * @returns {Promise<Array>}
 */
export async function getHabitCache() {
  try {
    const raw = await AsyncStorage.getItem(HABIT_CACHE_KEY);
    if (!raw) return [];
    const { habits, savedAt } = JSON.parse(raw);
    if (!Array.isArray(habits)) return [];
    if (savedAt && Date.now() - new Date(savedAt).getTime() > CACHE_TTL_MS) {
      return []; // Cache too old — force a fresh fetch
    }
    return habits;
  } catch (_e) {
    return [];
  }
}

/**
 * Clear the habit cache (called on sign-out / account deletion).
 */
export async function clearHabitCache() {
  try {
    await AsyncStorage.removeItem(HABIT_CACHE_KEY);
  } catch (_e) {}
}
