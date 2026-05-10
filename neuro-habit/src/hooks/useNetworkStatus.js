/**
 * useNetworkStatus.js
 *
 * A React hook that provides real-time network connectivity state across the
 * entire application. Uses @react-native-community/netinfo for instant
 * detection (no polling required) combined with AppState listeners so sync
 * is triggered immediately when the app comes back to the foreground.
 *
 * Usage:
 *   const { isConnected, connectionType } = useNetworkStatus();
 */

import { useState, useEffect, useRef } from 'react';
import { AppState } from 'react-native';
import NetInfo from '@react-native-community/netinfo';

/**
 * @returns {{ isConnected: boolean | null, connectionType: string }}
 *   isConnected — null = not yet determined, true = online, false = offline
 *   connectionType — 'wifi' | 'cellular' | 'none' | 'unknown' etc.
 */
export default function useNetworkStatus() {
  const [isConnected, setIsConnected] = useState(null);
  const [connectionType, setConnectionType] = useState('unknown');
  const appStateRef = useRef(AppState.currentState);

  useEffect(() => {
    // Subscribe to NetInfo for real-time network changes
    const unsubscribeNetInfo = NetInfo.addEventListener((state) => {
      const connected = state.isConnected && state.isInternetReachable !== false;
      setIsConnected(connected);
      setConnectionType(state.type || 'unknown');
    });

    // Initial fetch to avoid null state on mount
    NetInfo.fetch().then((state) => {
      const connected = state.isConnected && state.isInternetReachable !== false;
      setIsConnected(connected ?? null);
      setConnectionType(state.type || 'unknown');
    }).catch(() => {
      setIsConnected(null);
    });

    // AppState listener: re-check connectivity when app becomes active
    const appStateSub = AppState.addEventListener('change', (nextAppState) => {
      if (
        appStateRef.current.match(/inactive|background/) &&
        nextAppState === 'active'
      ) {
        NetInfo.fetch().then((state) => {
          const connected = state.isConnected && state.isInternetReachable !== false;
          setIsConnected(connected ?? null);
          setConnectionType(state.type || 'unknown');
        }).catch(() => {});
      }
      appStateRef.current = nextAppState;
    });

    return () => {
      unsubscribeNetInfo();
      appStateSub.remove();
    };
  }, []);

  return { isConnected, connectionType };
}
