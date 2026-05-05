import React from "react";
import { View, StyleSheet } from "react-native";
import { useTheme } from "../context/ThemeContext";

export default function Card({ children, style, ...props }) {
  const { theme: colors } = useTheme();
  const themedStyles = styles(colors);
  
  return (
    <View style={[themedStyles.card, style]} {...props}>
      {children}
    </View>
  );
}

const styles = (colors) => StyleSheet.create({
  card: {
    backgroundColor: colors.card,
    padding: 24,
    borderRadius: 24,
    marginBottom: 20,
    shadowColor: "#000",
    shadowOffset: { width: 0, height: 12 },
    shadowOpacity: 0.2,
    shadowRadius: 16,
    elevation: 8,
    borderColor: colors.border,
    borderWidth: 1,
  },
});
