/**
 * secureStorage.js
 *
 * A unified storage adapter for the Supabase auth client and app-level
 * token/session data. Sensitive keys (auth tokens, session state) are
 * persisted to expo-secure-store, which is backed by Android Keystore
 * and iOS Keychain. Non-sensitive UI preference keys fall through to
 * AsyncStorage so they remain unaffected.
 *
 * This resolves the "Insecure Token Storage in AsyncStorage" vulnerability
 * where Supabase JWT session tokens were stored in plain text and could be
 * extracted from rooted/jailbroken devices.
 */

import * as SecureStore from 'expo-secure-store';
import AsyncStorage from '@react-native-async-storage/async-storage';

// expo-secure-store key length is capped at 255 chars and must be
// alphanumeric + '-' + '_'. Supabase uses keys like
// "sb-<project-ref>-auth-token" which is safe, but we sanitise just in case.
function sanitiseKey(key) {
  return key.replace(/[^a-zA-Z0-9_\-]/g, '_');
}

// Keys that contain auth material and MUST go through SecureStore.
// Supabase internally uses the pattern "sb-<ref>-auth-token" for the
// session, so we match any key that looks like an auth token as well as
// explicit application-level sensitive keys.
const SECURE_KEY_PATTERNS = [
  /^sb-.+-auth-token/,   // Supabase session token
  /^supabase\.auth\./,   // Any supabase auth namespace key
  /^auth[_-]/i,          // Explicit auth-prefixed app keys
  /[_-]token$/i,         // Any key ending in -token / _token
  /[_-]session$/i,       // Any key ending in -session / _session
  /[_-]credential/i,     // Any credential key
];

function isSensitiveKey(key) {
  return SECURE_KEY_PATTERNS.some((pattern) => pattern.test(key));
}

/**
 * A storage object that implements the AsyncStorage interface expected by
 * @supabase/supabase-js and can be used as a drop-in replacement anywhere
 * AsyncStorage is used for auth/token data.
 */
const secureStorage = {
  async getItem(key) {
    try {
      if (isSensitiveKey(key)) {
        return await SecureStore.getItemAsync(sanitiseKey(key));
      }
      return await AsyncStorage.getItem(key);
    } catch (error) {
      console.warn(`[secureStorage] getItem failed for key "${key}":`, error);
      return null;
    }
  },

  async setItem(key, value) {
    try {
      if (isSensitiveKey(key)) {
        await SecureStore.setItemAsync(sanitiseKey(key), value);
      } else {
        await AsyncStorage.setItem(key, value);
      }
    } catch (error) {
      console.warn(`[secureStorage] setItem failed for key "${key}":`, error);
    }
  },

  async removeItem(key) {
    try {
      if (isSensitiveKey(key)) {
        await SecureStore.deleteItemAsync(sanitiseKey(key));
      } else {
        await AsyncStorage.removeItem(key);
      }
    } catch (error) {
      console.warn(`[secureStorage] removeItem failed for key "${key}":`, error);
    }
  },
};

export default secureStorage;
