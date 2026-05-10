/**
 * NetworkContext.js
 *
 * Provides a singleton network-status context backed by NetInfo so every
 * screen and service can react to connectivity changes without duplicating
 * listeners. Integrates with backendService to trigger automatic sync on
 * reconnection via a single, centralized listener (replaces the 15-second
 * polling interval as the primary reconnection trigger).
 */

import React, { createContext, useContext, useEffect, useRef, useCallback } from 'react';
import { AppState } from 'react-native';
import NetInfo from '@react-native-community/netinfo';
import { backendService } from '../services/backendService';

const NetworkContext = createContext({
  isConnected: null,
  connectionType: 'unknown',
});

export const NetworkProvider = ({ children }) => {
  const [isConnected, setIsConnected] = React.useState(null);
  const [connectionType, setConnectionType] = React.useState('unknown');
  const wasOfflineRef = useRef(false);
  const appStateRef = useRef(AppState.currentState);
  const syncInProgressRef = useRef(false);

  /**
   * Triggers a background sync when we transition from offline → online.
   * Guards against concurrent invocations with syncInProgressRef.
   */
  const handleReconnection = useCallback(() => {
    if (syncInProgressRef.current) return;
    syncInProgressRef.current = true;
    backendService.syncPendingData({ reason: 'netinfo_reconnected' })
      .catch(() => {})
      .finally(() => {
        syncInProgressRef.current = false;
      });
  }, []);

  useEffect(() => {
    // Real-time NetInfo listener
    const unsubscribeNetInfo = NetInfo.addEventListener((state) => {
      const connected = Boolean(state.isConnected && state.isInternetReachable !== false);
      setIsConnected(connected);
      setConnectionType(state.type || 'unknown');

      // Offline → online transition: trigger sync immediately
      if (wasOfflineRef.current && connected) {
        handleReconnection();
      }
      wasOfflineRef.current = !connected;
    });

    // Seed the initial state without waiting for first change event
    NetInfo.fetch().then((state) => {
      const connected = Boolean(state.isConnected && state.isInternetReachable !== false);
      setIsConnected(connected);
      setConnectionType(state.type || 'unknown');
      wasOfflineRef.current = !connected;
    }).catch(() => {
      setIsConnected(null);
    });

    // AppState: when app comes to foreground after being in background,
    // trigger a sync pass to pick up changes made on other devices.
    const appStateSub = AppState.addEventListener('change', (nextState) => {
      const wasBackground = appStateRef.current.match(/inactive|background/);
      const isNowActive = nextState === 'active';

      if (wasBackground && isNowActive) {
        NetInfo.fetch().then((state) => {
          const connected = Boolean(state.isConnected && state.isInternetReachable !== false);
          setIsConnected(connected);
          if (connected) {
            // Coming to foreground while online — sync any pending changes
            handleReconnection();
          }
        }).catch(() => {});
      }
      appStateRef.current = nextState;
    });

    return () => {
      unsubscribeNetInfo();
      appStateSub.remove();
    };
  }, [handleReconnection]);

  const value = React.useMemo(
    () => ({ isConnected, connectionType }),
    [isConnected, connectionType]
  );

  return (
    <NetworkContext.Provider value={value}>
      {children}
    </NetworkContext.Provider>
  );
};

/**
 * Hook to access the current network connectivity state.
 * @returns {{ isConnected: boolean | null, connectionType: string }}
 */
export const useNetwork = () => useContext(NetworkContext);
