import React, { useEffect, useState, useRef } from "react";
import { View, Text, StyleSheet, FlatList, TouchableOpacity, TextInput } from "react-native";
import { SafeAreaView } from "react-native-safe-area-context";
import AsyncStorage from "@react-native-async-storage/async-storage";
import { Ionicons } from "@expo/vector-icons";
import Card from "../components/Card";
import { backendService } from "../services/backendService";
import { notificationService } from "../services/notificationService";
import { useTheme } from "../context/ThemeContext";
import { useAuth } from "../context/AuthContext";
import Animated, { useSharedValue, useAnimatedStyle, withSpring, withSequence } from "react-native-reanimated";
import PremiumBackground from "../components/PremiumBackground";
import { supabase } from "../services/supabaseClient";
import AppMessageModal from "../components/AppMessageModal";
import * as Haptics from 'expo-haptics';
import { getFriendlyErrorMessage } from "../utils/errorMapper";

const LOCAL_HABITS_KEY = "local_habits_v1";
const HABIT_META_KEY = "habit_meta_v2";

export default function HabitScreen() {
  const { theme: colors } = useTheme();
  const { session } = useAuth();
  const [habits, setHabits] = useState([]);
  const [newHabit, setNewHabit] = useState("");
  const [modalConfig, setModalConfig] = useState({ visible: false, title: "", message: "" });
  const themedStyles = styles(colors);

  // Per-habit debounce timers and in-flight abort controllers to prevent race conditions
  const pendingTogglesRef = useRef({});
  const abortControllersRef = useRef({});

  useEffect(() => {
    loadHabits();
  }, []);

  const getHabitMeta = async () => {
    try {
      const raw = await AsyncStorage.getItem(HABIT_META_KEY);
      return raw ? JSON.parse(raw) : {};
    } catch {
      return {};
    }
  };

  const setHabitMeta = async (meta) => {
    try {
      await AsyncStorage.setItem(HABIT_META_KEY, JSON.stringify(meta));
    } catch {}
  };

  const getLocalHabits = async () => {
    try {
      const raw = await AsyncStorage.getItem(LOCAL_HABITS_KEY);
      const parsed = raw ? JSON.parse(raw) : [];
      return Array.isArray(parsed) ? parsed : [];
    } catch (error) {
      return [];
    }
  };

  const setLocalHabits = async (items) => {
    try {
      await AsyncStorage.setItem(LOCAL_HABITS_KEY, JSON.stringify(items));
    } catch (error) {
      // Ignore local persistence errors to avoid blocking UI.
    }
  };

  const syncStreakReminder = async (habitItems) => {
    const total = Array.isArray(habitItems) ? habitItems.length : 0;
    const completed = Array.isArray(habitItems)
      ? habitItems.filter((h) => Boolean(h?.completed)).length
      : 0;
    notificationService
      .scheduleStreakRiskReminder(completed, total)
      .catch(() => {});
  };

  const processHabitsWithMeta = (rawHabits, metaMap) => {
    const nowMs = backendService.getTrustedTime();
    let metaChanged = false;

    const processed = rawHabits.map((habit) => {
      let dbStreak = habit.streak || 0;
      let dbLastCompletedAt = habit.lastCompletedAt || null;

      const meta = metaMap[habit.id];
      let streak = dbStreak;
      let lastCompletedAt = dbLastCompletedAt;

      // If local meta exists and is newer than DB (for offline scenarios), we might use it,
      // but for simplicity we rely on the DB as truth if available, otherwise fallback to local meta.
      if (meta && (!dbLastCompletedAt || (meta.lastCompletedAt && new Date(meta.lastCompletedAt) > new Date(dbLastCompletedAt)))) {
        streak = meta.streak;
        lastCompletedAt = meta.lastCompletedAt;
      } else if (!meta && !dbLastCompletedAt) {
        streak = habit.streak || 0;
        lastCompletedAt = null;
      }

      let completed = habit.completed;

      if (lastCompletedAt) {
        const lastMs = new Date(lastCompletedAt).getTime();
        const hoursPassed = (nowMs - lastMs) / (1000 * 60 * 60);

        if (completed && hoursPassed >= 24) {
          completed = false;
          metaChanged = true;
        }
        if (!completed && hoursPassed >= 48 && streak > 0) {
          streak = 0;
          metaChanged = true;
        }
      }

      if (meta.streak !== streak || meta.lastCompletedAt !== lastCompletedAt) {
        metaMap[habit.id] = { ...meta, streak, lastCompletedAt };
        metaChanged = true;
      }

      return {
        ...habit,
        completed,
        streak,
      };
    });

    return { processed, metaChanged };
  };

  const loadHabits = async () => {
    const { data: { session } } = await supabase.auth.getSession();
    if (!session?.user?.id) return;

    const [remoteRes, localHabits, metaMap] = await Promise.all([
      supabase
        .from("habits")
        .select("*")
        .eq("user_id", session.user.id)
        .order("created_at", { ascending: true }),
      getLocalHabits(),
      getHabitMeta()
    ]);

    const { data, error } = remoteRes;
    let allHabits = [];
    const activeHabitIds = new Set();

    if (!error && Array.isArray(data)) {
      const remoteHabits = data.map((habit) => {
        activeHabitIds.add(habit.id);
        return {
          id: habit.id,
          name: habit.name ?? habit.title ?? "Untitled Habit",
          completed: Boolean(habit.completed ?? habit.is_completed ?? false),
          completedColumn: Object.prototype.hasOwnProperty.call(habit, "completed")
            ? "completed"
            : Object.prototype.hasOwnProperty.call(habit, "is_completed")
              ? "is_completed"
              : null,
          streak: habit.streak || 0,
          lastCompletedAt: habit.last_completed_at || null,
          localOnly: false,
        };
      });
      allHabits = [...remoteHabits, ...localHabits];
      localHabits.forEach(h => activeHabitIds.add(h.id));
    } else {
      allHabits = localHabits;
      localHabits.forEach(h => activeHabitIds.add(h.id));
    }

    // Data retention policy: Purge habit metadata (streaks/history) that's > 30 days old or orphaned
    const thirtyDaysAgo = Date.now() - 30 * 24 * 60 * 60 * 1000;
    let metaChanged = false;
    for (const [habitId, meta] of Object.entries(metaMap)) {
      const isOrphaned = !error && !activeHabitIds.has(habitId);
      const isStale = meta.lastCompletedAt && new Date(meta.lastCompletedAt).getTime() < thirtyDaysAgo;
      
      if (isOrphaned || isStale) {
        delete metaMap[habitId];
        metaChanged = true;
      }
    }

    const processResult = processHabitsWithMeta(allHabits, metaMap);
    
    if (metaChanged || processResult.metaChanged) {
      await setHabitMeta(metaMap);
    }

    setHabits(processResult.processed);
    await syncStreakReminder(processResult.processed);
  };

  const toggleHabit = (id) => {
    // --- Optimistic UI: apply state change immediately ---
    setHabits((prev) => {
      const target = prev.find((h) => h.id === id);
      if (!target) return prev;
      const isNowCompleted = !target.completed;
      const newStreak = isNowCompleted
        ? (target.streak || 0) + 1
        : Math.max(0, (target.streak || 0) - 1);
      return prev.map((h) =>
        h.id === id ? { ...h, completed: isNowCompleted, streak: newStreak } : h
      );
    });

    // --- Abort any in-flight Supabase request for this habit ---
    if (abortControllersRef.current[id]) {
      abortControllersRef.current[id].abort();
    }

    // --- Debounce: cancel previous pending timer for this habit ---
    if (pendingTogglesRef.current[id]) {
      clearTimeout(pendingTogglesRef.current[id]);
    }

    // --- Schedule the actual backend sync after debounce window ---
    pendingTogglesRef.current[id] = setTimeout(async () => {
      delete pendingTogglesRef.current[id];

      // Read the latest committed state for this habit
      setHabits((currentHabits) => {
        const latestHabit = currentHabits.find((h) => h.id === id);
        if (!latestHabit) return currentHabits;

        const controller = new AbortController();
        abortControllersRef.current[id] = controller;

        const now = new Date(backendService.getTrustedTime()).toISOString();

        // Persist meta locally
        (async () => {
          try {
            const metaMap = await getHabitMeta();
            const currentMeta = metaMap[id] || { streak: latestHabit.streak, lastCompletedAt: null };
            metaMap[id] = {
              streak: latestHabit.streak,
              lastCompletedAt: latestHabit.completed ? now : currentMeta.lastCompletedAt,
            };
            await setHabitMeta(metaMap);

            if (latestHabit.localOnly) {
              // Persist local-only habits to AsyncStorage
              setHabits((h) => {
                const localOnly = h.filter((x) => x.localOnly);
                setLocalHabits(localOnly).catch(() => {});
                return h;
              });
              return;
            }

            // Sync to Supabase (abortable)
            const updatePayload = {
              streak: latestHabit.streak,
              last_completed_at: latestHabit.completed ? now : currentMeta.lastCompletedAt,
            };
            if (latestHabit.completedColumn) {
              updatePayload[latestHabit.completedColumn] = latestHabit.completed;
            }

            if (controller.signal.aborted) return;

            const { error } = await supabase
              .from("habits")
              .update(updatePayload)
              .eq("id", id)
              .abortSignal(controller.signal);

            if (error && !controller.signal.aborted) {
              console.error('[HabitToggle] Supabase sync failed:', error.message);
            }
          } catch (err) {
            if (!controller.signal.aborted) {
              console.error('[HabitToggle] Unexpected error during sync:', err);
            }
          } finally {
            if (abortControllersRef.current[id] === controller) {
              delete abortControllersRef.current[id];
            }
          }
        })();

        return currentHabits; // no state mutation in this setHabits call
      });

      // Sync notification reminder with final state
      setHabits((h) => {
        syncStreakReminder(h).catch(() => {});
        return h;
      });
    }, 300);
  };

  const addHabit = async () => {
    if (!newHabit.trim()) return;

    const isGuest = session?.user?.email === "guest@example.com";
    if (isGuest) {
      setModalConfig({
        visible: true,
        title: "Guest Mode Limitation",
        message: "Sign in with an account to add habits.",
      });
      return;
    }

    const result = await backendService.createHabit(newHabit);
    if (result && !result.error) {
      await loadHabits();
      setNewHabit("");
    } else {
      const backendReason = result?.details?.backend;
      const supabaseReason = result?.details?.supabase;
      const rawErrorString = supabaseReason || backendReason || result?.message || "Unknown server error";
      const friendlyError = getFriendlyErrorMessage(rawErrorString, "We couldn't save your habit to the cloud right now.");

      const localHabit = {
        id: `local-${backendService.getTrustedTime()}`,
        name: newHabit.trim(),
        completed: false,
        completedColumn: null,
        streak: 0,
        localOnly: true,
      };
      const localHabits = await getLocalHabits();
      const nextLocalHabits = [...localHabits, localHabit];
      await setLocalHabits(nextLocalHabits);
      const updatedHabits = [...habits, localHabit];
      setHabits(updatedHabits);
      await syncStreakReminder(updatedHabits);
      setNewHabit("");
      setModalConfig({
        visible: true,
        title: "Saved Locally",
        message: `${friendlyError}\n\nHabit was added on this device. Sign in/sync later to back it up online.`,
      });
    }
  };

  return (
    <SafeAreaView style={themedStyles.safeArea}>
      <PremiumBackground />
      <AppMessageModal
        visible={modalConfig.visible}
        title={modalConfig.title}
        message={modalConfig.message}
        onConfirm={() => setModalConfig({ visible: false, title: "", message: "" })}
      />
      <View style={themedStyles.container}>
        <Text style={themedStyles.title}>Habit Tracking</Text>
        
        <View style={themedStyles.inputContainer}>
          <TextInput
            style={themedStyles.input}
            placeholder="Add a new habit..."
            placeholderTextColor={colors.subtext}
            value={newHabit}
            onChangeText={setNewHabit}
          />
          <TouchableOpacity style={themedStyles.addButton} onPress={addHabit}>
            <Ionicons name="add" size={24} color={colors.white} />
          </TouchableOpacity>
        </View>

        <FlatList
          data={habits}
          renderItem={({ item }) => <HabitItem item={item} onToggle={toggleHabit} colors={colors} />}
          keyExtractor={item => item.id}
          contentContainerStyle={themedStyles.list}
          ListEmptyComponent={
            <View style={themedStyles.emptyState}>
              <Ionicons name="list-outline" size={26} color={colors.subtext} />
              <Text style={themedStyles.emptyStateTitle}>No habits yet</Text>
              <Text style={themedStyles.emptyStateText}>Add your first habit above to get started.</Text>
            </View>
          }
        />
      </View>
    </SafeAreaView>
  );
}

function HabitItem({ item, onToggle, colors }) {
  const themedStyles = styles(colors);
  const scale = useSharedValue(1);

  const animatedStyle = useAnimatedStyle(() => ({
    transform: [{ scale: scale.value }],
  }));

  const handlePress = () => {
    Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light).catch(() => {});
    scale.value = withSequence(withSpring(1.05), withSpring(1));
    onToggle(item.id);
  };

  return (
    <TouchableOpacity onPress={handlePress}>
      <Animated.View style={animatedStyle}>
        <Card style={[themedStyles.habitItem, item.completed && themedStyles.habitCompleted]}>
          <View style={themedStyles.habitInfo}>
            <Ionicons 
              name={item.completed ? "checkmark-circle" : "ellipse-outline"} 
              size={28} 
              color={item.completed ? colors.green : colors.subtext} 
            />
            <View style={themedStyles.habitTextContainer}>
              <Text style={[themedStyles.habitName, item.completed && themedStyles.textCompleted]}>{item.name}</Text>
              <Text style={themedStyles.streakText}>🔥 {item.streak} day streak</Text>
            </View>
          </View>
          <Ionicons name="chevron-forward" size={20} color={colors.subtext} />
        </Card>
      </Animated.View>
    </TouchableOpacity>
  );
}

const styles = (colors) => StyleSheet.create({
  safeArea: {
    flex: 1,
    backgroundColor: colors.background,
  },
  container: {
    flex: 1,
    padding: 20,
  },
  title: {
    fontSize: 32,
    fontWeight: "bold",
    color: colors.text,
    marginBottom: 24,
    marginTop: 20,
  },
  inputContainer: {
    flexDirection: "row",
    marginBottom: 24,
  },
  input: {
    flex: 1,
    backgroundColor: colors.card,
    borderRadius: 12,
    padding: 16,
    color: colors.text,
    fontSize: 16,
    borderWidth: 1,
    borderColor: colors.border,
    outlineStyle: 'none',
  },
  addButton: {
    backgroundColor: colors.primary,
    width: 56,
    height: 56,
    borderRadius: 12,
    justifyContent: "center",
    alignItems: "center",
    marginLeft: 12,
  },
  list: {
    paddingBottom: 20,
  },
  emptyState: {
    alignItems: "center",
    justifyContent: "center",
    paddingVertical: 40,
  },
  emptyStateTitle: {
    color: colors.text,
    fontSize: 18,
    fontWeight: "700",
    marginTop: 10,
  },
  emptyStateText: {
    color: colors.subtext,
    fontSize: 14,
    marginTop: 6,
  },
  habitItem: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "space-between",
    padding: 16,
    marginBottom: 12,
  },
  habitCompleted: {
    borderColor: colors.green + "40",
    backgroundColor: colors.green + "08",
  },
  habitInfo: {
    flexDirection: "row",
    alignItems: "center",
  },
  habitTextContainer: {
    marginLeft: 16,
  },
  habitName: {
    fontSize: 18,
    fontWeight: "600",
    color: colors.text,
  },
  textCompleted: {
    textDecorationLine: "line-through",
    color: colors.subtext,
  },
  streakText: {
    fontSize: 12,
    color: colors.primary,
    marginTop: 2,
    fontWeight: "bold",
  },
});
