import React from "react";
import { ScrollView, Text, View, StyleSheet, ActivityIndicator, Platform, TouchableOpacity } from "react-native";
import DateTimePicker from '@react-native-community/datetimepicker';
import { SafeAreaView } from "react-native-safe-area-context";
import Animated, { FadeInDown, FadeInUp } from "react-native-reanimated";
import { Ionicons } from "@expo/vector-icons";
import InsightItem from "../components/InsightItem";
import useDashboard from "../hooks/useDashboard";
import { useTheme } from "../context/ThemeContext";
import Card from "../components/Card";
import PremiumBackground from "../components/PremiumBackground";
import { fetchWeeklyStepTrend } from "../services/api";
import { usageService } from "../services/usageService";
import AsyncStorage from '@react-native-async-storage/async-storage';

// Lazy load heavy chart library to optimize initial bundle size
const AdvancedChart = React.lazy(() => import("../components/AdvancedChart"));

const ChartFallback = () => (
  <View style={{ height: 220, justifyContent: 'center', alignItems: 'center' }}>
    <ActivityIndicator size="small" color="#999" />
  </View>
);

export default function InsightsScreen() {
  const { theme: colors } = useTheme();
  const { insights, data, loading, isOfflineMode } = useDashboard();
  const [trend, setTrend] = React.useState([]);
  const [endDate, setEndDate] = React.useState(new Date());
  const [showDatePicker, setShowDatePicker] = React.useState(false);
  const [liveSteps, setLiveSteps] = React.useState(0);
  const liveStepSubscriptionRef = React.useRef(null);
  const themedStyles = styles(colors);

  React.useEffect(() => {
    const startLiveSteps = async () => {
      try {
        let baseline = 0;
        try {
          const raw = await AsyncStorage.getItem('@NeuroHabit:DailyStepsCache');
          if (raw) {
            const { date, steps } = JSON.parse(raw);
            const todayKey = new Date().toISOString().slice(0, 10);
            if (date === todayKey && Number.isFinite(steps)) baseline = steps;
          }
        } catch (_e) {}

        const sub = usageService.watchLiveSteps((stepsDelta) => {
          const total = baseline + stepsDelta;
          setLiveSteps(total >= 5 ? total : 0);
        });
        liveStepSubscriptionRef.current = sub;
      } catch (e) {
        console.warn('Could not start live step tracking:', e?.message);
      }
    };
    startLiveSteps();

    return () => {
      if (liveStepSubscriptionRef.current) {
        usageService.stopWatchingLiveSteps(liveStepSubscriptionRef.current);
        liveStepSubscriptionRef.current = null;
      }
    };
  }, []);

  const currentDashboardSteps = data?.steps > 0 ? data.steps : liveSteps;

  // Compute a human-readable date range label for the last 7 days ending at endDate
  const formatDateRange = React.useCallback(() => {
    const start = new Date(endDate);
    start.setDate(endDate.getDate() - 6);
    const opts = { month: 'short', day: 'numeric' };
    const startStr = start.toLocaleDateString('en-US', opts);
    const endStr = endDate.toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' });
    return `${startStr} – ${endStr}`;
  }, [endDate]);

  React.useEffect(() => {
    let isActive = true;
    const loadTrend = async () => {
      // Fetch 7 days of trend data ending at the selected endDate
      const result = await fetchWeeklyStepTrend(currentDashboardSteps, 7, endDate.toISOString().slice(0, 10));
      if (isActive) {
        setTrend(Array.isArray(result) ? result : []);
      }
    };
    loadTrend();
    return () => {
      isActive = false;
    };
  }, [endDate, currentDashboardSteps]);

  // Guarantee real-time sync by deriving the display array during render
  // This completely eliminates stale closures or useEffect race conditions
  const displayTrend = React.useMemo(() => {
    if (!trend || trend.length === 0) return [];
    const isToday = endDate.toISOString().slice(0, 10) === new Date().toISOString().slice(0, 10);
    if (!isToday) return trend;
    
    const updated = [...trend];
    updated[updated.length - 1] = {
      ...updated[updated.length - 1],
      steps: currentDashboardSteps
    };
    return updated;
  }, [trend, currentDashboardSteps, endDate]);

  const onDateChange = (event, selectedDate) => {
    if (Platform.OS === 'android') {
      setShowDatePicker(false);
    }
    if (event.type === 'dismissed') {
      setShowDatePicker(false);
      return;
    }
    if (selectedDate) {
      setEndDate(selectedDate);
      if (Platform.OS === 'ios') {
         // for ios we typically rely on a 'done' button or similar, but since we use 'default' display,
         // we might need to handle it or keep it open. We'll close it here for simplicity.
         setShowDatePicker(false);
      }
    }
  };

  return (
    <SafeAreaView style={themedStyles.safeArea}>
      <PremiumBackground />
      <ScrollView style={themedStyles.container} contentContainerStyle={themedStyles.content}>
        <Animated.View entering={FadeInDown.duration(800)} style={themedStyles.header}>
          <Text style={themedStyles.title}>AI Insights</Text>
          <View style={themedStyles.badge}>
             <Ionicons name="sparkles" size={16} color={colors.primary} />
             <Text style={themedStyles.badgeText}>Powered by AI</Text>
          </View>
        </Animated.View>

        <Animated.Text entering={FadeInDown.delay(200)} style={themedStyles.subtitle}>
          Based on your recent activity, here are some personalized observations.
        </Animated.Text>

        {isOfflineMode && (
          <Animated.View entering={FadeInDown.delay(300)} style={themedStyles.offlineBanner}>
            <Ionicons name="cloud-offline" size={20} color={colors.warning} />
            <Text style={themedStyles.offlineText}>Offline Mode: Showing cached insights</Text>
          </Animated.View>
        )}

        {loading ? (
          <View style={themedStyles.loadingContainer}>
            <ActivityIndicator size="large" color={colors.primary} />
            <Text style={themedStyles.loadingText}>Generating insights...</Text>
          </View>
        ) : (
          <>
            <Animated.View entering={FadeInUp.delay(400)}>
              <Text style={themedStyles.sectionTitle}>Activity Trend (Steps)</Text>
              <Card style={themedStyles.chartCard}>
                <React.Suspense fallback={<ChartFallback />}>
                  <AdvancedChart 
                    data={displayTrend.length > 0 ? displayTrend : [{ day: "Today", steps: currentDashboardSteps || 0 }]} 
                    colors={colors}
                  />
                </React.Suspense>
              </Card>
              {/* Date range label below the chart */}
              <TouchableOpacity style={themedStyles.dateContainer} onPress={() => setShowDatePicker(true)} activeOpacity={0.7}>
                <Ionicons name="calendar-outline" size={13} color={colors.subtext} />
                <Text style={themedStyles.dateText}>{formatDateRange()} ▾</Text>
              </TouchableOpacity>
              
              {showDatePicker && (
                <DateTimePicker
                  value={endDate}
                  mode="date"
                  display="default"
                  maximumDate={new Date()}
                  onChange={onDateChange}
                />
              )}
            </Animated.View>

            <Animated.Text entering={FadeInUp.delay(600)} style={themedStyles.sectionTitle}>Recent Insights</Animated.Text>
            <View style={themedStyles.insightsList}>
              {insights.map((item, index) => (
                <InsightItem key={index} index={index} text={item.text} icon={item.icon} />
              ))}
            </View>
          </>
        )}
      </ScrollView>
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
  header: {
    flexDirection: "row",
    justifyContent: "space-between",
    alignItems: "flex-end",
    marginBottom: 16,
  },
  title: {
    color: colors.text,
    fontSize: 32,
    fontWeight: "bold",
  },
  badge: {
    flexDirection: "row",
    alignItems: "center",
    backgroundColor: colors.primary + '25',
    paddingHorizontal: 12,
    paddingVertical: 6,
    borderRadius: 20,
    borderWidth: 1,
    borderColor: colors.primary + '40',
  },
  badgeText: {
    color: colors.primary,
    fontSize: 12,
    fontWeight: "bold",
    marginLeft: 6,
  },
  subtitle: {
    color: colors.subtext,
    fontSize: 16,
    lineHeight: 24,
    marginBottom: 20, // Reduced from 32 to fit the banner
  },
  offlineBanner: {
    flexDirection: 'row',
    alignItems: 'center',
    backgroundColor: colors.cardHighlight,
    borderColor: colors.warning,
    borderWidth: 1,
    paddingHorizontal: 16,
    paddingVertical: 12,
    borderRadius: 12,
    marginBottom: 24,
    shadowColor: colors.warning,
    shadowOffset: { width: 0, height: 2 },
    shadowOpacity: 0.1,
    shadowRadius: 4,
    elevation: 2,
  },
  offlineText: {
    color: colors.warning,
    fontWeight: '700',
    fontSize: 14,
    marginLeft: 10,
  },
  loadingContainer: {
    paddingVertical: 60,
    alignItems: "center",
  },
  loadingText: {
    color: colors.subtext,
    marginTop: 16,
    fontSize: 16,
  },
  insightsList: {
    marginTop: 8,
  },
  sectionTitle: {
    color: colors.text,
    fontSize: 20,
    fontWeight: "bold",
    marginBottom: 16,
    marginTop: 8,
  },
  chartCard: {
    padding: 10,
    marginBottom: 24,
    backgroundColor: colors.card,
    borderRadius: 16,
    overflow: 'hidden',
  },
  chartContainer: {
    flexDirection: 'row',
    height: 200,
    justifyContent: 'space-between',
    alignItems: 'flex-end',
    paddingTop: 20,
    paddingHorizontal: 10,
    paddingBottom: 10,
  },
  barWrapper: {
    alignItems: 'center',
    width: 30,
  },
  barBackground: {
    height: 140,
    width: 12,
    backgroundColor: colors.border,
    borderRadius: 6,
    justifyContent: 'flex-end',
    overflow: 'hidden',
  },
  barFill: {
    width: '100%',
    borderRadius: 6,
  },
  barLabel: {
    color: colors.subtext,
    fontSize: 10,
    marginTop: 12,
    fontWeight: '500',
  },
  dateContainer: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: 5,
    marginTop: 6,
    marginBottom: 8,
  },
  dateText: {
    color: colors.subtext,
    fontSize: 12,
    fontWeight: '500',
  },
});
