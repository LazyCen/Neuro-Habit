/**
 * OfflineStatusBar.js
 *
 * A sleek, animated notification banner that pops up at the top of the screen whenever
 * the device connectivity changes (e.g. goes offline or online), then vanishes.
 * Designed to float over content without taking up layout space.
 */

import React, { useEffect, useRef, useState } from 'react';
import { Text, StyleSheet, Animated } from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import { useNetwork } from '../context/NetworkContext';
import { backendService } from '../services/backendService';
import { useTheme } from '../context/ThemeContext';

const BANNER_HEIGHT = 44;
const DISPLAY_MS = 2500;

export default function OfflineStatusBar() {
  const { isConnected } = useNetwork();
  const { theme: colors } = useTheme();
  const [syncStatus, setSyncStatus] = useState(backendService.getSyncStatus());
  
  const [visible, setVisible] = useState(false);

  const slideAnim = useRef(new Animated.Value(-100)).current;
  const fadeAnim = useRef(new Animated.Value(0)).current;
  const timerRef = useRef(null);
  const prevConnectedRef = useRef(isConnected);

  // Subscribe to sync-status for live pending count
  useEffect(() => {
    const unsubscribe = backendService.subscribeToSyncStatus(setSyncStatus);
    return unsubscribe;
  }, []);

  const showNotification = () => {
    setVisible(true);
    
    // Animate in
    Animated.parallel([
      Animated.spring(slideAnim, {
        toValue: 50, // slide down to 50px below the top of its parent container
        useNativeDriver: true,
        friction: 10,
        tension: 80,
      }),
      Animated.timing(fadeAnim, {
        toValue: 1,
        duration: 200,
        useNativeDriver: true,
      })
    ]).start();

    // Set timer to animate out
    clearTimeout(timerRef.current);
    timerRef.current = setTimeout(() => {
      Animated.parallel([
        Animated.timing(slideAnim, {
          toValue: -100, // slide back up
          duration: 300,
          useNativeDriver: true,
        }),
        Animated.timing(fadeAnim, {
          toValue: 0,
          duration: 300,
          useNativeDriver: true,
        })
      ]).start(() => setVisible(false));
    }, DISPLAY_MS);
  };

  useEffect(() => {
    const prevConnected = prevConnectedRef.current;
    prevConnectedRef.current = isConnected;

    const isOffline = isConnected === false;
    const justReconnected = prevConnected === false && isConnected === true;
    const justDisconnected = prevConnected === true && isConnected === false;
    const initialOffline = prevConnected === null && isOffline;

    if (justReconnected || justDisconnected || initialOffline) {
      showNotification();
    }
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [isConnected]);

  if (!visible) return null;

  const isOffline = isConnected === false;
  const pendingCount = syncStatus?.pendingCount || 0;

  const bannerBg = isOffline ? (colors.warning || '#f59e0b') : (colors.green || '#22c55e');
  const iconName = isOffline ? 'cloud-offline-outline' : 'cloud-done-outline';

  const message = isOffline
    ? pendingCount > 0
      ? `Offline · ${pendingCount} pending`
      : 'You are offline'
    : pendingCount > 0
      ? `Back online — syncing…`
      : 'Back online';

  return (
    <Animated.View
      style={[
        styles.container,
        { 
          backgroundColor: bannerBg, 
          transform: [{ translateY: slideAnim }],
          opacity: fadeAnim
        },
      ]}
      accessibilityLiveRegion="polite"
      accessibilityRole="alert"
    >
      <Ionicons name={iconName} size={16} color={colors.white || '#ffffff'} />
      <Text style={[styles.text, { color: colors.white || '#ffffff' }]} numberOfLines={1}>
        {message}
      </Text>
    </Animated.View>
  );
}

const styles = StyleSheet.create({
  container: {
    height: BANNER_HEIGHT,
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    paddingHorizontal: 20,
    gap: 8,
    position: 'absolute',
    top: 0,
    alignSelf: 'center',
    borderRadius: 22,
    shadowColor: '#000',
    shadowOffset: { width: 0, height: 4 },
    shadowOpacity: 0.3,
    shadowRadius: 4.65,
    elevation: 8,
    zIndex: 9999,
  },
  text: {
    fontSize: 14,
    fontWeight: '700',
  },
});
