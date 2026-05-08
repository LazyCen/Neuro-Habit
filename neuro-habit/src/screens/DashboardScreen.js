import React from "react";
import { ScrollView, Text, View, StyleSheet, ActivityIndicator, TouchableOpacity, Linking } from "react-native";
import { SafeAreaView } from "react-native-safe-area-context";
import { useFocusEffect, useNavigation } from "@react-navigation/native";
import { Ionicons } from "@expo/vector-icons";
import Animated, { FadeInDown, FadeInUp, FadeOut, useSharedValue, useAnimatedStyle, withTiming, withDelay } from "react-native-reanimated";
import Card from "../components/Card";
import HealthPermissionModal from "../components/HealthPermissionModal";
import useDashboard from "../hooks/useDashboard";
import { usageService } from "../services/usageService";
import { useAuth } from "../context/AuthContext";
import { useTheme } from "../context/ThemeContext";
import { supabase } from "../services/supabaseClient";
import PremiumBackground from "../components/PremiumBackground";
import AsyncStorage from '@react-native-async-storage/async-storage';

export default function DashboardScreen() {
  const { theme: colors } = useTheme();
  const themedStyles = styles(colors);
  const { data, loading, isRefreshingData, refresh } = useDashboard();
  const { session } = useAuth();
  const navigation = useNavigation();
  const [hasUsagePerm, setHasUsagePerm] = React.useState(true);
  const [hasPedometerPerm, setHasPedometerPerm] = React.useState(true);
  const [stepProviderStatus, setStepProviderStatus] = React.useState({
    hasHealthConnect: true,
    hasAnyProvider: true,
  });
  const [dismissedSync, setDismissedSync] = React.useState(false);
  const badgeOpacity = useSharedValue(0);
  const badgeTranslateY = useSharedValue(-4);
  const [permissionLoading, setPermissionLoading] = React.useState(false);
  const [usernameLoading, setUsernameLoading] = React.useState(false);
  const [showHealthModal, setShowHealthModal] = React.useState(false);
  const [permissionTypeToRequest, setPermissionTypeToRequest] = React.useState(null);

  React.useEffect(() => {
    if (isRefreshingData) {
      badgeOpacity.value = withTiming(1, { duration: 200 });
      badgeTranslateY.value = withTiming(0, { duration: 200 });
    } else {
      // Keep it visible for a bit longer to prevent flicker on fast loads
      badgeOpacity.value = withDelay(800, withTiming(0, { duration: 400 }));
      badgeTranslateY.value = withDelay(800, withTiming(-4, { duration: 400 }));
    }
  }, [isRefreshingData]);

  const animatedBadgeStyle = useAnimatedStyle(() => {
    return {
      opacity: badgeOpacity.value,
      height: badgeOpacity.value * 24, // Smoothly expand/collapse
      marginTop: badgeOpacity.value * 8,
      overflow: 'hidden',
      transform: [{ translateY: badgeTranslateY.value }],
    };
  });

  React.useEffect(() => {
    console.log('DashboardScreen: Mounted successfully');
    AsyncStorage.getItem('hideSyncCard_v2').then(value => {
      if (value === 'true') setDismissedSync(true);
    }).catch(() => {});
  }, []);

  useFocusEffect(
    React.useCallback(() => {
      checkPermissions();
      refresh();
    }, [])
  );

  const checkPermissions = async () => {
    const usage = await usageService.hasPermission();
    const stepProviders = await usageService.getStepProviderStatus();
    const pedometer = stepProviders.hasAnyProvider || await usageService.hasPedometerPermission();
    setHasUsagePerm(usage);
    setHasPedometerPerm(pedometer);
    setStepProviderStatus(stepProviders);
  };

  const handleConnect = async (type) => {
    setPermissionLoading(true);
    try {
      if (type === 'usage') {
        await usageService.requestPermission();
      } else if (type === 'health') {
        const stepPermission = await usageService.requestStepPermissions();
        if (!stepPermission.granted && !stepPermission.hasAnyProvider) {
          await Linking.openURL(
            "https://play.google.com/store/search?q=Health%20Connect%20Google%20Fit&c=apps"
          ).catch(() => {});
          await usageService.requestPedometerPermission();
        }
      }
      
      // Re-check permissions after requesting
      setTimeout(() => {
        checkPermissions();
        refresh();
      }, 500);
    } catch (error) {
      console.error('Error handling permission request:', error);
      refresh();
    } finally {
      setPermissionLoading(false);
    }
  };

  const handleSetUsername = async () => {
    setUsernameLoading(true);
    try {
      // Update user metadata to trigger navigation to UsernameScreen
      const { data: { user }, error: updateError } = await supabase.auth.updateUser({
        data: { username_skipped: false }
      });
      
      if (updateError) throw updateError;
      
      // Force a session refresh to trigger RootNavigator re-evaluation
      const { data: { session: updatedSession }, error: sessionError } = await supabase.auth.getSession();
      if (sessionError) throw sessionError;
      
      console.log('Username setup triggered, new metadata:', updatedSession?.user?.user_metadata);
      
      // Small delay to allow RootNavigator to re-evaluate
      await new Promise(resolve => setTimeout(resolve, 300));
    } catch (error) {
      console.error('Error triggering username setup:', error.message);
    } finally {
      setUsernameLoading(false);
    }
  };

  if (loading) {
    return (
      <View style={themedStyles.loadingContainer}>
        <PremiumBackground />
        <ActivityIndicator size="large" color={colors.primary} />
        <Text style={themedStyles.loadingText}>Analyzing your data...</Text>
      </View>
    );
  }

  if (!data) {
    return (
      <View style={themedStyles.loadingContainer}>
        <PremiumBackground />
        <Text style={themedStyles.loadingText}>Failed to load data.</Text>
        <TouchableOpacity style={[themedStyles.syncButton, { marginTop: 16 }]} onPress={refresh}>
          <Text style={themedStyles.syncButtonText}>Retry</Text>
        </TouchableOpacity>
      </View>
    );
  }

  const progress = data.habitsTotal > 0 ? data.habitsCompleted / data.habitsTotal : 0;
  const metadata = session?.user?.user_metadata || {};
  const userName = metadata.username || 
                   metadata.first_name || 
                   (session?.user?.email ? session.user.email.split('@')[0] : "Friend");
  const capitalizedName = userName.charAt(0).toUpperCase() + userName.slice(1);
  const hasUsername = !!metadata.username;
  const isGuest = session?.user?.email === 'guest@example.com';
  const avatarEmoji = metadata.avatar_emoji || "🐶";

  const getGreeting = () => {
    const hour = new Date().getHours();
    if (hour < 12) return "Good morning";
    if (hour < 18) return "Good afternoon";
    return "Good evening";
  };

  return (
    <SafeAreaView style={themedStyles.safeArea}>
      <PremiumBackground />
      <ScrollView style={themedStyles.container} contentContainerStyle={themedStyles.content}>
        <Animated.View entering={FadeInDown.duration(800)} style={themedStyles.header}>
          <View>
            <Text style={themedStyles.greeting}>{getGreeting()},</Text>
            <Text style={themedStyles.title}>{capitalizedName} 👋</Text>
            {!loading && (
              <Animated.View
                style={[themedStyles.updatingBadge, animatedBadgeStyle]}
              >
                <Ionicons name="sync-outline" size={12} color={colors.primary} />
                <Text style={themedStyles.updatingText}>Updating...</Text>
              </Animated.View>
            )}
          </View>
          <View style={themedStyles.avatarPlaceholder}>
            <Text style={themedStyles.avatarEmoji}>{avatarEmoji}</Text>
          </View>
        </Animated.View>

        {!hasUsername && !isGuest && (
          <Animated.View entering={FadeInUp.delay(100)}>
            <Card style={[themedStyles.syncCard, { borderColor: colors.secondary, backgroundColor: colors.secondary + '15' }]}>
              <View style={[themedStyles.syncIconContainer, { backgroundColor: colors.secondary + '25' }]}>
                <Ionicons name="at-circle-outline" size={24} color={colors.secondary} />
              </View>
              <View style={themedStyles.syncContent}>
                <Text style={themedStyles.syncTitle}>Set your username</Text>
                <Text style={themedStyles.syncText}>
                  Complete your profile by choosing a unique username.
                </Text>
                <TouchableOpacity 
                  style={[themedStyles.syncButton, { backgroundColor: colors.secondary }, usernameLoading && { opacity: 0.6 }]} 
                  onPress={handleSetUsername}
                  disabled={usernameLoading}
                >
                  {usernameLoading ? (
                    <ActivityIndicator size="small" color="white" />
                  ) : (
                    <Text style={themedStyles.syncButtonText}>Set Username</Text>
                  )}
                </TouchableOpacity>
              </View>
            </Card>
          </Animated.View>
        )}

        {(!hasUsagePerm || !hasPedometerPerm) && !dismissedSync && (
          <Animated.View entering={FadeInUp.delay(200)}>
            <Card style={themedStyles.syncCard}>
              <View style={themedStyles.syncIconContainer}>
                <Ionicons name="sync-outline" size={24} color={colors.primary} />
              </View>
              <View style={themedStyles.syncContent}>
                <View style={{ flexDirection: 'row', justifyContent: 'space-between', alignItems: 'flex-start' }}>
                  <Text style={themedStyles.syncTitle}>Connect Real Data</Text>
                  <TouchableOpacity 
                    onPress={() => {
                      setDismissedSync(true);
                      AsyncStorage.setItem('hideSyncCard_v2', 'true').catch(() => {});
                    }}
                    style={{ padding: 4, marginRight: -8, marginTop: -8 }}
                  >
                    <Ionicons name="close" size={20} color={colors.subtext} />
                  </TouchableOpacity>
                </View>
                <Text style={themedStyles.syncText}>
                  Grant permissions to sync real steps and screen time.
                </Text>
                {!hasPedometerPerm && (
                  <Text style={themedStyles.syncSubtext}>
                    Steps are unavailable until Motion/Fitness permission is granted.
                  </Text>
                )}
                {!stepProviderStatus.hasAnyProvider && (
                  <Text style={themedStyles.syncSubtext}>
                    {stepProviderStatus.isHealthConnectSupported 
                      ? "Install Health Connect to enable real step counting."
                      : "Health Connect is unsupported on this Android version. Try Google Fit instead."}
                  </Text>
                )}
                <View style={themedStyles.syncButtons}>
                  {!hasUsagePerm && (
                    <TouchableOpacity 
                      style={[themedStyles.syncButton, permissionLoading && { opacity: 0.6 }, { marginRight: 8 }]} 
                      onPress={() => { setPermissionTypeToRequest('usage'); setShowHealthModal(true); }}
                      disabled={permissionLoading}
                    >
                      {permissionLoading ? (
                        <ActivityIndicator size="small" color="white" />
                      ) : (
                        <Text style={themedStyles.syncButtonText}>Usage Stats</Text>
                      )}
                    </TouchableOpacity>
                  )}
                  {!hasPedometerPerm && (
                    <TouchableOpacity 
                      style={[themedStyles.syncButton, permissionLoading && { opacity: 0.6 }, { marginRight: 8 }]} 
                      onPress={() => { setPermissionTypeToRequest('health'); setShowHealthModal(true); }}
                      disabled={permissionLoading}
                    >
                      {permissionLoading ? (
                        <ActivityIndicator size="small" color="white" />
                      ) : (
                        <Text style={themedStyles.syncButtonText}>Step Counter</Text>
                      )}
                    </TouchableOpacity>
                  )}
                  {!stepProviderStatus.hasAnyProvider && (
                    <TouchableOpacity 
                      style={[themedStyles.syncButton, permissionLoading && { opacity: 0.6 }, { marginRight: 8 }]} 
                      onPress={() => { setPermissionTypeToRequest('health'); setShowHealthModal(true); }}
                      disabled={permissionLoading}
                    >
                      {permissionLoading ? (
                        <ActivityIndicator size="small" color="white" />
                      ) : (
                        <Text style={themedStyles.syncButtonText}>Check Step Apps</Text>
                      )}
                    </TouchableOpacity>
                  )}
                </View>
              </View>
            </Card>
          </Animated.View>
        )}

        <Animated.View entering={FadeInUp.delay(400)}>
          <Card style={themedStyles.heroCard}>
            <View style={themedStyles.heroHeader}>
              <Text style={themedStyles.heroTitle}>Daily Activity</Text>
              <Ionicons name="fitness" size={24} color={colors.green} />
            </View>
            <View style={themedStyles.heroBody}>
              <Text style={themedStyles.heroValue}>{data.steps.toLocaleString()}</Text>
              <Text style={themedStyles.heroLabel}>Steps today</Text>
            </View>
          </Card>
        </Animated.View>

        <Animated.Text entering={FadeInUp.delay(500)} style={themedStyles.sectionTitle}>Overview</Animated.Text>

        <View style={themedStyles.row}>
          <Animated.View entering={FadeInUp.delay(600)} style={themedStyles.halfCardWrapper}>
            <Card style={themedStyles.halfCard}>
              <Ionicons name="phone-portrait-outline" size={28} color={colors.primary} style={themedStyles.icon} />
              <Text style={themedStyles.statValue}>{data.screenTime}h</Text>
              <Text style={themedStyles.statLabel}>Screen Time</Text>
            </Card>
          </Animated.View>
          <Animated.View entering={FadeInUp.delay(700)} style={themedStyles.halfCardWrapper}>
            <Card style={themedStyles.halfCard}>
              <Ionicons name="happy-outline" size={28} color={colors.secondary} style={themedStyles.icon} />
              <Text style={themedStyles.statValue}>{data.mood != null ? `${data.mood}/10` : '--'}</Text>
              <Text style={themedStyles.statLabel}>Mood Score</Text>
            </Card>
          </Animated.View>
        </View>

        <Animated.View entering={FadeInUp.delay(800)}>
          <Card style={themedStyles.habitCard}>
            <View style={themedStyles.habitHeader}>
              <Text style={themedStyles.habitTitle}>Habits Completed</Text>
              <Text style={themedStyles.habitCount}>{data.habitsCompleted} / {data.habitsTotal}</Text>
            </View>
            <View style={themedStyles.progressBarBg}>
              <View style={[themedStyles.progressBarFill, { width: `${progress * 100}%` }]} />
            </View>
          </Card>
        </Animated.View>

      </ScrollView>
      <HealthPermissionModal 
        visible={showHealthModal} 
        onConfirm={() => {
          setShowHealthModal(false);
          handleConnect(permissionTypeToRequest);
        }} 
        onCancel={() => setShowHealthModal(false)}
        loading={permissionLoading}
      />
    </SafeAreaView>
  );
}

const styles = (colors) => StyleSheet.create({
  safeArea: {
    flex: 1,
    backgroundColor: colors.background,
  },
  container: {
    flex: 1,
  },
  content: {
    padding: 20,
    paddingTop: 40,
  },
  loadingContainer: {
    flex: 1,
    backgroundColor: colors.background,
    justifyContent: "center",
    alignItems: "center",
  },
  loadingText: {
    color: colors.subtext,
    marginTop: 16,
    fontSize: 16,
  },
  header: {
    flexDirection: "row",
    justifyContent: "space-between",
    alignItems: "center",
    marginBottom: 30,
  },
  greeting: {
    color: colors.subtext,
    fontSize: 16,
    marginBottom: 4,
  },
  title: {
    color: colors.text,
    fontSize: 32,
    fontWeight: "bold",
  },
  updatingBadge: {
    marginTop: 8,
    alignSelf: "flex-start",
    flexDirection: "row",
    alignItems: "center",
    backgroundColor: colors.primary + "18",
    borderColor: colors.primary + "40",
    borderWidth: 1,
    paddingHorizontal: 8,
    paddingVertical: 3,
    borderRadius: 999,
  },
  updatingText: {
    color: colors.primary,
    fontSize: 11,
    marginLeft: 4,
    fontWeight: "600",
  },
  avatarPlaceholder: {
    width: 48,
    height: 48,
    borderRadius: 24,
    backgroundColor: colors.primary,
    justifyContent: "center",
    alignItems: "center",
  },
  avatarEmoji: {
    fontSize: 24,
  },
  heroCard: {
    backgroundColor: colors.card,
    borderColor: colors.primaryDark,
    borderWidth: 1,
  },
  heroHeader: {
    flexDirection: "row",
    justifyContent: "space-between",
    alignItems: "center",
    marginBottom: 16,
  },
  heroTitle: {
    color: colors.subtext,
    fontSize: 16,
    fontWeight: "600",
  },
  heroBody: {
    alignItems: "flex-start",
  },
  heroValue: {
    color: colors.text,
    fontSize: 42,
    fontWeight: "bold",
    marginBottom: 4,
  },
  heroLabel: {
    color: colors.greenLight,
    fontSize: 14,
    fontWeight: "500",
  },
  sectionTitle: {
    color: colors.text,
    fontSize: 20,
    fontWeight: "bold",
    marginBottom: 16,
    marginTop: 8,
  },
  row: {
    flexDirection: "row",
    justifyContent: "space-between",
  },
  halfCardWrapper: {
    width: "48%",
  },
  halfCard: {
    width: "100%",
    alignItems: "center",
    padding: 24,
  },
  icon: {
    marginBottom: 12,
  },
  statValue: {
    color: colors.text,
    fontSize: 28,
    fontWeight: "bold",
    marginBottom: 4,
  },
  statLabel: {
    color: colors.subtext,
    fontSize: 14,
  },
  habitCard: {
    marginTop: 4,
  },
  habitHeader: {
    flexDirection: "row",
    justifyContent: "space-between",
    alignItems: "center",
    marginBottom: 16,
  },
  habitTitle: {
    color: colors.text,
    fontSize: 18,
    fontWeight: "600",
  },
  habitCount: {
    color: colors.primary,
    fontSize: 16,
    fontWeight: "bold",
  },
  progressBarBg: {
    height: 12,
    backgroundColor: colors.cardHighlight,
    borderRadius: 6,
    overflow: "hidden",
  },
  progressBarFill: {
    height: "100%",
    backgroundColor: colors.primary,
    borderRadius: 6,
  },
  syncCard: {
    flexDirection: "row",
    backgroundColor: colors.primary + "15", // Subtle primary background
    borderColor: colors.primary,
    borderWidth: 1,
    padding: 16,
    marginBottom: 20,
    alignItems: "center",
  },
  syncIconContainer: {
    width: 44,
    height: 44,
    borderRadius: 22,
    backgroundColor: colors.primary + "25",
    justifyContent: "center",
    alignItems: "center",
    marginRight: 16,
  },
  syncContent: {
    flex: 1,
  },
  syncTitle: {
    color: colors.text,
    fontSize: 16,
    fontWeight: "bold",
    marginBottom: 4,
  },
  syncText: {
    color: colors.subtext,
    fontSize: 13,
    marginBottom: 8,
  },
  syncSubtext: {
    color: colors.subtext,
    fontSize: 12,
    marginBottom: 12,
  },
  syncButtons: {
    flexDirection: "row",
  },
  syncButton: {
    backgroundColor: colors.primary,
    paddingHorizontal: 12,
    paddingVertical: 6,
    borderRadius: 6,
  },
  syncButtonText: {
    color: colors.white,
    fontSize: 12,
    fontWeight: "600",
  },
});
