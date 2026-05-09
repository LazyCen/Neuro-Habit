import React from 'react';
import { View, StyleSheet, Text, ActivityIndicator } from 'react-native';
import { useAuth } from '../context/AuthContext';
import AppNavigator from './AppNavigator';
import AuthScreen from '../screens/AuthScreen';
import UsernameScreen from '../screens/UsernameScreen';
import TutorialScreen from '../screens/TutorialScreen';
import { useTheme } from '../context/ThemeContext';
import Preloader from '../components/Preloader';

import Animated, { FadeOut, FadeIn } from 'react-native-reanimated';

export default function RootNavigator() {
  const { session, loading } = useAuth();
  const { theme } = useTheme();
  const [isReady, setIsReady] = React.useState(false);
  const [showPreloader, setShowPreloader] = React.useState(true);

  React.useEffect(() => {
    const timer = setTimeout(() => {
      setIsReady(true);
    }, 2500); // 2.5s minimum preloader time
    return () => clearTimeout(timer);
  }, []);

  // When loading is finished and minimum time reached, start fade out
  React.useEffect(() => {
    if (!loading && isReady) {
      setTimeout(() => setShowPreloader(false), 500);
    }
  }, [loading, isReady]);

  if (showPreloader) {
    return (
      <View style={{ flex: 1 }}>
        <Preloader />
      </View>
    );
  }

  // Check if user has a username
  const hasUsername = session?.user?.user_metadata?.username;
  const hasSkippedUsername = session?.user?.user_metadata?.username_skipped;
  const isGuest = session?.user?.email === 'guest@example.com';
  const hasSeenTutorial = session?.user?.user_metadata?.tutorial_completed;

  return (
    <View style={{ flex: 1, backgroundColor: theme.background }}>
      {!session ? (
        <AuthScreen />
      ) : (!hasUsername && !hasSkippedUsername && !isGuest) ? (
        <UsernameScreen />
      ) : (!hasSeenTutorial && !isGuest) ? (
        <TutorialScreen />
      ) : (
        <AppNavigator />
      )}
    </View>
  );
}

const styles = StyleSheet.create({
});

