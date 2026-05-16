/**
 * useHealthConnect.js
 *
 * A component-facing hook that manages the Health Connect connection lifecycle
 * and exposes a typed, safe interface for step data reads.
 *
 * Architecture:
 *   ┌─────────────────────────┐
 *   │  Component / Screen     │  consumes this hook
 *   ├─────────────────────────┤
 *   │  useHealthConnect       │  manages connection state + retry
 *   ├─────────────────────────┤
 *   │  usageService           │  owns the singleton HC client,
 *   │  (getHealthConnectClient│  withHcLock mutex, safeNativeCall
 *   │   safeNativeCall, etc.) │  — we never call HC APIs directly
 *   └─────────────────────────┘
 *
 * Key design decisions:
 *  - We purposely do NOT call HealthConnect APIs directly here. All native
 *    IPC calls are proxied through usageService which already owns the
 *    serialization lock (withHcLock) and binding-error detection
 *    (safeNativeCall). Duplicating them here would break serialization.
 *  - Connection state is maintained locally so the UI can react to binder
 *    dropouts without crashing or freezing.
 *  - Retry backoff is limited to component-level decisions (how many times
 *    to retry after a "binding died" surface error) rather than replacing
 *    the service-layer retry.
 */

import { useState, useEffect, useCallback, useRef } from 'react';
import { Platform, AppState } from 'react-native';
import { usageService } from '../services/usageService';

// ─── Constants ───────────────────────────────────────────────────────────────

/**
 * Minimum Android API level required to execute Health Connect APIs.
 * Calling HC on API 24/25 causes fatal native crashes.
 */
const HC_MIN_API_LEVEL = 26;

/**
 * Delay (ms) before the first step read attempt.
 * Gives the Android Binder time to fully establish the IPC channel
 * after usageService has initialized the HC client in the background.
 */
const INITIAL_READ_DELAY_MS = 1000;

/**
 * Maximum number of automatic retries after a surface binding error.
 * Each retry waits RETRY_BACKOFF_BASE_MS * attempt before re-trying.
 */
const MAX_COMPONENT_RETRIES = 3;
const RETRY_BACKOFF_BASE_MS = 800;

// ─── Connection State Enum ────────────────────────────────────────────────────

export const HcConnectionStatus = {
  IDLE:           'idle',           // Not yet attempted
  CONNECTING:     'connecting',     // Waiting for IPC bind to stabilize
  CONNECTED:      'connected',      // Successfully read data
  BINDING_ERROR:  'binding_error',  // IPC binder dropped — retrying or fallback
  UNAVAILABLE:    'unavailable',    // HC SDK not installed / API level too low
  PERMISSION_DENIED: 'permission_denied', // Permissions not granted
};

// ─── Hook ─────────────────────────────────────────────────────────────────────

/**
 * Manages the Health Connect connection lifecycle for a component.
 *
 * @param {object}  options
 * @param {boolean} [options.autoFetch=true]  Fetch steps on mount automatically.
 * @param {boolean} [options.watchForeground=true]  Re-fetch when app comes to foreground.
 *
 * @returns {{
 *   steps: number,
 *   status: string,
 *   isLoading: boolean,
 *   error: string | null,
 *   retryCount: number,
 *   refresh: () => Promise<void>,
 *   requestPermissions: () => Promise<void>,
 * }}
 */
export function useHealthConnect({
  autoFetch = true,
  watchForeground = true,
} = {}) {
  const [steps, setSteps]         = useState(0);
  const [status, setStatus]       = useState(HcConnectionStatus.IDLE);
  const [isLoading, setIsLoading] = useState(false);
  const [error, setError]         = useState(null);
  const [retryCount, setRetryCount] = useState(0);

  // Track whether the component is still mounted to prevent setState after unmount
  const isMountedRef  = useRef(true);
  const retryCountRef = useRef(0);

  // ─── Guard: unsupported platform ───────────────────────────────────────────

  const isSupported = Platform.OS !== 'android' || Platform.Version >= HC_MIN_API_LEVEL;

  // ─── Core fetch routine ────────────────────────────────────────────────────

  const fetchSteps = useCallback(async () => {
    if (!isMountedRef.current) return;

    // API level check — never touch HC on API 24/25
    if (Platform.OS === 'android' && Platform.Version < HC_MIN_API_LEVEL) {
      setStatus(HcConnectionStatus.UNAVAILABLE);
      setError(`Health Connect requires Android 8.0+ (API 26). This device is API ${Platform.Version}.`);
      return;
    }

    setIsLoading(true);
    setError(null);
    setStatus(HcConnectionStatus.CONNECTING);

    try {
      // Check permissions first (fast-path via AsyncStorage cache in usageService)
      const hasPermission = await usageService.hasStepPermission();
      if (!hasPermission) {
        if (isMountedRef.current) {
          setStatus(HcConnectionStatus.PERMISSION_DENIED);
          setError('Health Connect permission not granted. Tap to authorise.');
        }
        return;
      }

      // Delegate the actual read to usageService which owns the IPC lock.
      // This call is automatically serialized via withHcLock in the service.
      const count = await usageService.getDailyStepCount();

      if (!isMountedRef.current) return;

      setSteps(count);
      setStatus(HcConnectionStatus.CONNECTED);
      setError(null);
      retryCountRef.current = 0;
      setRetryCount(0);

    } catch (e) {
      if (!isMountedRef.current) return;

      const isBinding = e?.isBindingError ||
        (e?.message?.toLowerCase?.().includes('binding') ?? false) ||
        (e?.message?.toLowerCase?.().includes('died') ?? false);

      if (isBinding) {
        console.warn(`[useHealthConnect] Binder dropout detected (attempt ${retryCountRef.current + 1}/${MAX_COMPONENT_RETRIES}):`, e.message);
        setStatus(HcConnectionStatus.BINDING_ERROR);

        if (retryCountRef.current < MAX_COMPONENT_RETRIES) {
          // Exponential backoff retry — waits 800ms, 1600ms, 2400ms between attempts
          const backoffMs = RETRY_BACKOFF_BASE_MS * (retryCountRef.current + 1);
          retryCountRef.current += 1;
          setRetryCount(retryCountRef.current);
          setError(`Service connection dropped. Retrying in ${backoffMs / 1000}s…`);

          setTimeout(() => {
            if (isMountedRef.current) fetchSteps();
          }, backoffMs);
        } else {
          // Exhausted retries — surface a clean error, do not crash
          setError('Health Connect unavailable. Steps shown from last sync.');
          console.warn('[useHealthConnect] Max retries exhausted. Showing cached data.');
        }
      } else {
        // Non-binding error (permissions, network, etc.)
        setStatus(HcConnectionStatus.UNAVAILABLE);
        setError(e?.message || 'Health Connect read failed.');
        console.warn('[useHealthConnect] Non-binding error:', e?.message);
      }
    } finally {
      if (isMountedRef.current) setIsLoading(false);
    }
  }, []); // stable — all deps are refs or external singletons

  // ─── Permission request ────────────────────────────────────────────────────

  const requestPermissions = useCallback(async () => {
    try {
      setIsLoading(true);
      const result = await usageService.requestStepPermissions();
      if (result?.granted && isMountedRef.current) {
        await fetchSteps();
      }
    } catch (e) {
      console.warn('[useHealthConnect] Permission request failed:', e?.message);
    } finally {
      if (isMountedRef.current) setIsLoading(false);
    }
  }, [fetchSteps]);

  // ─── Lifecycle ─────────────────────────────────────────────────────────────

  useEffect(() => {
    isMountedRef.current = true;

    if (autoFetch && isSupported) {
      // Small delay lets the Android Binder fully settle after the 3.5s
      // startup buffer in usageService's getHealthConnectClient completes.
      const timer = setTimeout(fetchSteps, INITIAL_READ_DELAY_MS);
      return () => clearTimeout(timer);
    }

    return () => {};
  }, [autoFetch, isSupported, fetchSteps]);

  // Foreground re-fetch: re-read steps when user switches back to the app
  useEffect(() => {
    if (!watchForeground || !isSupported) return;

    const subscription = AppState.addEventListener('change', (nextState) => {
      if (nextState === 'active' && isMountedRef.current) {
        // Re-fetch silently when coming to foreground
        fetchSteps();
      }
    });

    return () => subscription.remove();
  }, [watchForeground, isSupported, fetchSteps]);

  // Cleanup on unmount
  useEffect(() => {
    return () => {
      isMountedRef.current = false;
    };
  }, []);

  return {
    steps,
    status,
    isLoading,
    error,
    retryCount,
    refresh: fetchSteps,
    requestPermissions,
    isConnected:  status === HcConnectionStatus.CONNECTED,
    isUnavailable: status === HcConnectionStatus.UNAVAILABLE,
    needsPermission: status === HcConnectionStatus.PERMISSION_DENIED,
  };
}
