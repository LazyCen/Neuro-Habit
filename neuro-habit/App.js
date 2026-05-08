import { Platform } from "react-native";
if (Platform.OS !== 'web') {
  require('react-native-url-polyfill/auto');
}
import React, { useEffect } from "react";
import { NavigationContainer, DarkTheme, DefaultTheme } from "@react-navigation/native";
import { StatusBar } from "expo-status-bar";
import { SafeAreaProvider } from 'react-native-safe-area-context';
import RootNavigator from "./src/navigation/RootNavigator";
import { AuthProvider } from "./src/context/AuthContext";
import { ThemeProvider, useTheme } from "./src/context/ThemeContext";
import { notificationService } from "./src/services/notificationService";
import { backendService } from "./src/services/backendService";
import { registerBackgroundHealthSync } from "./src/services/backgroundSync";
import * as Sentry from '@sentry/react-native';

Sentry.init({
  dsn: process.env.EXPO_PUBLIC_SENTRY_DSN || '', // Fallback to empty if not set
  tracesSampleRate: 1.0,
  _experiments: {
    // profilesSampleRate is relative to tracesSampleRate
    profilesSampleRate: 1.0,
  },
});

const NavigationWrapper = () => {
  const { theme: colors, isDark } = useTheme();
  
  const MyTheme = React.useMemo(() => ({
    ...(isDark ? DarkTheme : DefaultTheme),
    colors: {
      ...(isDark ? DarkTheme.colors : DefaultTheme.colors),
      background: colors.background,
      card: colors.card,
      text: colors.text,
      border: colors.border,
      primary: colors.primary,
    },
  }), [isDark, colors]);

  return (
    <>
      <StatusBar style={isDark ? "light" : "dark"} />
      <NavigationContainer theme={MyTheme}>
        <RootNavigator />
      </NavigationContainer>
    </>
  );
};

export default function App() {
  useEffect(() => {
    if (Platform.OS !== 'web') {
      notificationService.registerForPushNotificationsAsync();
      registerBackgroundHealthSync();
    }
    backendService.fetchTrustedTime();
  }, []);

  return (
    <SafeAreaProvider>
      <ThemeProvider>
        <AuthProvider>
          <NavigationWrapper />
        </AuthProvider>
      </ThemeProvider>
    </SafeAreaProvider>
  );
}
