import React from "react";
import { View, Text, StyleSheet } from "react-native";
import Animated, { FadeInRight } from "react-native-reanimated";
import { Ionicons } from "@expo/vector-icons";
import { useTheme } from "../context/ThemeContext";

export default function InsightItem({ text, icon = "flash", index = 0 }) {
  const { theme: colors } = useTheme();
  const themedStyles = styles(colors);

  return (
    <Animated.View 
      entering={FadeInRight.delay(index * 100).duration(500)}
      style={themedStyles.container}
    >
      <View style={themedStyles.iconContainer}>
        <Ionicons name={icon} size={22} color={colors.primary} />
      </View>
      <Text style={themedStyles.text}>{text}</Text>
    </Animated.View>
  );
}

const styles = (colors) => StyleSheet.create({
  container: {
    flexDirection: "row",
    alignItems: "center",
    backgroundColor: colors.card,
    padding: 18,
    borderRadius: 20,
    marginBottom: 16,
    borderWidth: 1,
    borderColor: colors.border,
    shadowColor: colors.black,
    shadowOffset: { width: 0, height: 4 },
    shadowOpacity: 0.1,
    shadowRadius: 8,
    elevation: 3,
  },
  iconContainer: {
    backgroundColor: colors.primary + '20',
    padding: 10,
    borderRadius: 14,
    marginRight: 16,
  },
  text: {
    color: colors.text,
    fontSize: 16,
    flex: 1,
    lineHeight: 24,
    fontWeight: "600",
  },
});
