import React from "react";
import { ScrollView, Text, View, StyleSheet, SafeAreaView, ActivityIndicator, Platform } from "react-native";
import Animated, { FadeInDown, FadeInUp } from "react-native-reanimated";
import { Ionicons } from "@expo/vector-icons";
import InsightItem from "../components/InsightItem";
import useDashboard from "../hooks/useDashboard";
import { useTheme } from "../context/ThemeContext";
import Card from "../components/Card";
import PremiumBackground from "../components/PremiumBackground";
import { fetchWeeklyStepTrend } from "../services/api";

export default function InsightsScreen() {
  const { theme: colors } = useTheme();
  const { insights, data, loading } = useDashboard();
  const [trend, setTrend] = React.useState([]);
  const themedStyles = styles(colors);

  React.useEffect(() => {
    let isActive = true;
    const loadTrend = async () => {
      const result = await fetchWeeklyStepTrend(data?.steps || 0);
      if (isActive) {
        setTrend(Array.isArray(result) ? result : []);
      }
    };
    loadTrend();
    return () => {
      isActive = false;
    };
  }, [data?.steps]);

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
                <View style={themedStyles.chartContainer}>
                  {(trend.length > 0 ? trend : [{ day: "Today", steps: data?.steps || 0 }]).map((item, index, array) => {
                    const maxSteps = Math.max(...array.map((d) => d.steps || 0), 1000);
                    const heightPercent = Math.max(10, Math.min(100, (item.steps / maxSteps) * 100));
                    return (
                      <View key={index} style={themedStyles.barWrapper}>
                        <View style={themedStyles.barBackground}>
                          <Animated.View 
                            entering={FadeInUp.delay(500 + (index * 100)).duration(800)}
                            style={[
                              themedStyles.barFill, 
                              { height: `${heightPercent}%`, backgroundColor: colors.primary }
                            ]} 
                          />
                        </View>
                        <Text style={themedStyles.barLabel}>{item.day}</Text>
                      </View>
                    );
                  })}
                </View>
              </Card>
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
    marginBottom: 32,
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
});
