import { useEffect, useRef, useCallback } from 'react';
import { AppState } from 'react-native';
import { supabase } from '../services/supabaseClient';

/**
 * A highly accurate screen time tracker that bypasses JS timers.
 * It calculates precise epoch deltas based on native AppState transitions
 * and streams atomic increments to the Supabase backend.
 */
export const useScreenTimeTracker = (userId) => {
  const appState = useRef(AppState.currentState);
  const sessionStartTime = useRef(Date.now());

  const syncScreenTimeToSupabase = useCallback(async (deltaMs) => {
    if (!userId || deltaMs <= 0) return;
    
    // Convert ms to seconds (or minutes depending on your DB schema)
    const deltaSeconds = Math.floor(deltaMs / 1000);
    if (deltaSeconds === 0) return;

    try {
      console.log(`[useScreenTimeTracker] Syncing ${deltaSeconds}s of screen time...`);
      // We use an RPC function for atomic increments to prevent background race conditions
      // from overwriting today's accumulated total when offline syncing occurs.
      const { error } = await supabase.rpc('increment_screen_time', {
        p_user_id: userId,
        p_increment_seconds: deltaSeconds,
      });

      if (error) {
        console.error('[useScreenTimeTracker] Supabase RPC error:', error.message);
      } else {
        console.log('[useScreenTimeTracker] Successfully synced screen time delta.');
      }
    } catch (err) {
      console.error('[useScreenTimeTracker] Network/Sync error:', err);
    }
  }, [userId]);

  useEffect(() => {
    // Reset session start when mounted
    sessionStartTime.current = Date.now();

    const subscription = AppState.addEventListener('change', (nextAppState) => {
      if (
        appState.current.match(/inactive|background/) &&
        nextAppState === 'active'
      ) {
        // App has come to the foreground
        sessionStartTime.current = Date.now();
      } else if (
        appState.current === 'active' &&
        nextAppState.match(/inactive|background/)
      ) {
        // App has gone to the background
        const deltaMs = Date.now() - sessionStartTime.current;
        syncScreenTimeToSupabase(deltaMs);
      }

      appState.current = nextAppState;
    });

    return () => {
      // Final flush if unmounted while active
      if (appState.current === 'active') {
        const deltaMs = Date.now() - sessionStartTime.current;
        syncScreenTimeToSupabase(deltaMs);
      }
      subscription.remove();
    };
  }, [syncScreenTimeToSupabase]);
};
