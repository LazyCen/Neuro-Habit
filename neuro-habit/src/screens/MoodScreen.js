import React, { useState } from "react";
import { View, Text, StyleSheet, TouchableOpacity, TextInput, Platform } from "react-native";
import { SafeAreaView } from "react-native-safe-area-context";
import Animated, { FadeInDown, FadeInUp, FadeOutUp, ZoomIn, BounceInDown } from "react-native-reanimated";
import { Ionicons } from "@expo/vector-icons";
import * as Haptics from 'expo-haptics';
import { createAudioPlayer } from 'expo-audio';
import { KeyboardAwareScrollView } from 'react-native-keyboard-aware-scroll-view';
import { backendService } from "../services/backendService";
import { useTheme } from "../context/ThemeContext";
import PremiumBackground from "../components/PremiumBackground";
import AppMessageModal from "../components/AppMessageModal";

const moods = [
  { level: 1, emoji: "😫", label: "Terrible" },
  { level: 3, emoji: "😕", label: "Bad" },
  { level: 5, emoji: "😐", label: "Neutral" },
  { level: 7, emoji: "🙂", label: "Good" },
  { level: 10, emoji: "🤩", label: "Amazing" },
];

const tags = ["Work", "Social", "Sleep", "Exercise", "Food", "Hobbies"];

export default function MoodScreen() {
  const { theme: colors } = useTheme();
  const [selectedMood, setSelectedMood] = useState(null);
  const [selectedTags, setSelectedTags] = useState([]);
  const [note, setNote] = useState("");
  const [successMessage, setSuccessMessage] = useState("");
  const [modalConfig, setModalConfig] = useState({ visible: false, title: "", message: "" });
  const themedStyles = styles(colors);

  const showSuccess = (message, moodLabel) => {
    // Haptic feedback - success pattern
    if (Platform.OS !== 'web') {
      try {
        Haptics.notificationAsync(Haptics.NotificationFeedbackType.Success);
      } catch (_e) {
        console.warn('Haptics not available');
      }
    }

    // Play success sound
    playSuccessSound();

    // Show message for longer duration
    setSuccessMessage(message);
    setTimeout(() => {
      setSuccessMessage("");
    }, 3500);
  };

  const playSuccessSound = () => {
    try {
      // Use createAudioPlayer for imperative playback which is safer to try-catch
      const player = createAudioPlayer('asset:/sounds/success.mp3');
      if (player) {
        player.play();
      }
    } catch (_error) {
      // Silently fail - occurs if native module is missing (Expo Go) or asset is not found
      console.log('[MoodScreen] Audio playback skipped: Native module or asset not available');
    }
  };

  const toggleTag = (tag) => {
    if (selectedTags.includes(tag)) {
      setSelectedTags(selectedTags.filter(t => t !== tag));
    } else {
      setSelectedTags([...selectedTags, tag]);
    }
  };

  const handleSave = async () => {
    const fullNote = `${note} ${selectedTags.length > 0 ? '\nTags: ' + selectedTags.join(', ') : ''}`;
    const moodLabel = moods.find(m => m.level === selectedMood)?.label || '';
    const result = await backendService.logMood(selectedMood, fullNote);
    if (result) {
      if (result.offline) {
        setModalConfig({
          visible: true,
          title: "Saved Offline",
          message: "Mood logged locally. It will sync when your connection returns.",
        });
      } else {
        showSuccess(`${moodLabel} mood logged! 🎉`, moodLabel);
      }
      // Reset form after brief delay
      setTimeout(() => {
        setSelectedMood(null);
        setSelectedTags([]);
        setNote("");
      }, 500);
    } else {
      setModalConfig({
        visible: true,
        title: "Error",
        message: "Failed to log mood. Backend might be offline.",
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
      <KeyboardAwareScrollView 
        style={themedStyles.container} 
        contentContainerStyle={themedStyles.content} 
        showsVerticalScrollIndicator={false}
        extraScrollHeight={100}
        enableOnAndroid={true}
      >
        {successMessage ? (
          <Animated.View
            pointerEvents="none"
            entering={BounceInDown.duration(500)}
            exiting={FadeOutUp.duration(300)}
            style={themedStyles.successBanner}
          >
            <View style={themedStyles.successIconContainer}>
              <Ionicons name="checkmark-circle" size={20} color={colors.white} />
            </View>
            <View style={themedStyles.successContent}>
              <Text style={themedStyles.successText}>{successMessage}</Text>
            </View>
          </Animated.View>
        ) : null}

        <Animated.Text entering={FadeInDown.duration(800)} style={themedStyles.title}>
          How are you feeling?
        </Animated.Text>

        <View style={themedStyles.moodGrid}>
          {moods.map((m, index) => (
            <Animated.View key={m.level} entering={ZoomIn.delay(index * 100).springify()}>
              <TouchableOpacity 
                style={[
                  themedStyles.moodItem, 
                  selectedMood === m.level && themedStyles.selectedMood,
                ]}
                onPress={() => setSelectedMood(selectedMood === m.level ? null : m.level)}
              >
                <Text style={[themedStyles.emoji, selectedMood === m.level && themedStyles.selectedEmoji]}>
                  {m.emoji}
                </Text>
                <Text style={[themedStyles.moodLabel, selectedMood === m.level && themedStyles.selectedMoodLabel]}>
                  {m.label}
                </Text>
              </TouchableOpacity>
            </Animated.View>
          ))}
        </View>

        <View style={themedStyles.indicatorContainer}>
          {selectedMood && (
            <Animated.View entering={FadeInDown} style={themedStyles.selectionIndicator}>
              <Text style={themedStyles.selectionText}>
                Feeling <Text style={{ color: colors.primary, fontWeight: 'bold' }}>{moods.find(m => m.level === selectedMood)?.label}</Text>
              </Text>
            </Animated.View>
          )}
        </View>

        <Animated.Text entering={FadeInUp.delay(600)} style={themedStyles.sectionTitle}>
          What&apos;s influencing your mood?
        </Animated.Text>
        <View style={themedStyles.tagContainer}>
          {tags.map((tag, index) => (
            <Animated.View key={tag} entering={FadeInUp.delay(700 + index * 50)}>
              <TouchableOpacity 
                style={[themedStyles.tag, selectedTags.includes(tag) && themedStyles.selectedTag]}
                onPress={() => toggleTag(tag)}
              >
                <Text style={[themedStyles.tagText, selectedTags.includes(tag) && themedStyles.selectedTagText]}>{tag}</Text>
              </TouchableOpacity>
            </Animated.View>
          ))}
        </View>

        <Animated.Text entering={FadeInUp.delay(1000)} style={themedStyles.sectionTitle}>
          Notes (Optional)
        </Animated.Text>
        <Animated.View entering={FadeInUp.delay(1100)}>
          <TextInput
            style={themedStyles.noteInput}
            placeholder="Write something about your day..."
            placeholderTextColor={colors.subtext}
            multiline
            numberOfLines={4}
            value={note}
            onChangeText={setNote}
          />
        </Animated.View>

        <Animated.View entering={FadeInUp.delay(1200)}>
          <TouchableOpacity 
            style={[themedStyles.saveButton, !selectedMood && themedStyles.disabledButton]} 
            onPress={handleSave}
            disabled={!selectedMood}
          >
            <Text style={themedStyles.saveButtonText}>Log Mood</Text>
          </TouchableOpacity>
        </Animated.View>
      </KeyboardAwareScrollView>
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
    padding: 24,
    paddingTop: 40,
    paddingBottom: 60,
    position: "relative",
  },
  title: {
    fontSize: 32,
    fontWeight: "900",
    color: colors.text,
    marginBottom: 40,
    textAlign: "center",
  },
  successBanner: {
    position: "absolute",
    top: 12,
    left: 20,
    right: 20,
    zIndex: 20,
    backgroundColor: colors.primary,
    borderRadius: 16,
    paddingVertical: 14,
    paddingHorizontal: 16,
    flexDirection: "row",
    alignItems: "center",
    gap: 12,
    shadowColor: colors.primary,
    shadowOffset: { width: 0, height: 4 },
    shadowOpacity: 0.3,
    shadowRadius: 8,
    elevation: 8,
  },
  successIconContainer: {
    width: 32,
    height: 32,
    borderRadius: 16,
    backgroundColor: colors.white + '4D', // 30% alpha white
    justifyContent: 'center',
    alignItems: 'center',
  },
  successContent: {
    flex: 1,
  },
  successText: {
    color: colors.white,
    fontSize: 14,
    fontWeight: "700",
    letterSpacing: 0.3,
  },
  moodGrid: {
    flexDirection: "row",
    justifyContent: "space-between",
    marginBottom: 10,
    width: '100%',
    paddingHorizontal: 4,
  },
  moodItem: {
    alignItems: "center",
    justifyContent: 'center',
    paddingVertical: 8,
    width: 60,
  },
  selectedMood: {
    transform: [{ scale: 1.15 }],
  },
  emoji: {
    fontSize: 32,
    marginBottom: 6,
    opacity: 0.6,
  },
  selectedEmoji: {
    opacity: 1,
    textShadowColor: colors.primary,
    textShadowOffset: { width: 0, height: 0 },
    textShadowRadius: 15,
  },
  moodLabel: {
    fontSize: 11,
    color: colors.subtext,
    fontWeight: "600",
    textAlign: 'center',
    opacity: 0.6,
  },
  selectedMoodLabel: {
    color: colors.text,
    fontWeight: "800",
    opacity: 1,
  },
  indicatorContainer: {
    height: 30,
    justifyContent: 'center',
    marginBottom: 20,
  },
  selectionIndicator: {
    alignItems: 'center',
  },
  selectionText: {
    color: colors.text,
    fontSize: 16,
    fontWeight: '500',
  },
  sectionTitle: {
    fontSize: 20,
    fontWeight: "800",
    color: colors.text,
    marginBottom: 20,
  },
  tagContainer: {
    flexDirection: "row",
    flexWrap: "wrap",
    marginBottom: 40,
    marginHorizontal: -4,
  },
  tag: {
    backgroundColor: colors.card,
    paddingHorizontal: 18,
    paddingVertical: 10,
    borderRadius: 14,
    margin: 4,
    borderWidth: 1,
    borderColor: colors.border,
  },
  selectedTag: {
    backgroundColor: colors.primary,
    borderColor: colors.primary,
  },
  tagText: {
    color: colors.subtext,
    fontSize: 14,
    fontWeight: '600',
  },
  selectedTagText: {
    color: colors.white,
    fontWeight: "bold",
  },
  noteInput: {
    backgroundColor: colors.card,
    borderRadius: 20,
    padding: 20,
    color: colors.text,
    fontSize: 16,
    borderWidth: 1,
    borderColor: colors.border,
    textAlignVertical: "top",
    marginBottom: 40,
    minHeight: 120,
    outlineStyle: 'none',
  },
  saveButton: {
    backgroundColor: colors.primary,
    paddingVertical: 20,
    borderRadius: 20,
    alignItems: "center",
    shadowColor: colors.primary,
    shadowOffset: { width: 0, height: 8 },
    shadowOpacity: 0.3,
    shadowRadius: 12,
    elevation: 8,
  },
  disabledButton: {
    opacity: 0.4,
    shadowOpacity: 0,
  },
  saveButtonText: {
    color: colors.white,
    fontSize: 18,
    fontWeight: "900",
    letterSpacing: 0.5,
  },
});
