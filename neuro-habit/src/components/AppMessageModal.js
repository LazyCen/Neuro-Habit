import React from "react";
import { Modal, View, Text, TouchableOpacity, StyleSheet } from "react-native";
import { useTheme } from "../context/ThemeContext";

export default function AppMessageModal({
  visible,
  title,
  message,
  confirmText = "OK",
  cancelText,
  onConfirm,
  onCancel,
  destructive = false,
  loading = false,
}) {
  const { theme: colors } = useTheme();
  const styles = createStyles(colors);

  return (
    <Modal visible={visible} transparent animationType="fade" onRequestClose={onCancel || onConfirm}>
      <View style={styles.overlay}>
        <View style={styles.card}>
          <Text style={styles.title}>{title}</Text>
          <Text style={styles.message}>{message}</Text>
          <View style={styles.actions}>
            {cancelText ? (
              <TouchableOpacity style={styles.cancelButton} onPress={onCancel} disabled={loading}>
                <Text style={styles.cancelText}>{cancelText}</Text>
              </TouchableOpacity>
            ) : null}
            <TouchableOpacity
              style={[styles.confirmButton, destructive && styles.destructiveButton]}
              onPress={onConfirm}
              disabled={loading}
            >
              <Text style={styles.confirmText}>{confirmText}</Text>
            </TouchableOpacity>
          </View>
        </View>
      </View>
    </Modal>
  );
}

const createStyles = (colors) =>
  StyleSheet.create({
    overlay: {
      flex: 1,
      backgroundColor: "rgba(0, 0, 0, 0.75)", // Darker backdrop for better focus and theme balance
      justifyContent: "center",
      padding: 24,
    },
    card: {
      backgroundColor: colors.card,
      borderRadius: 24, // Smoother corners for premium feel
      padding: 24,
      borderWidth: 1,
      borderColor: colors.border,
      // Add subtle shadow for depth
      shadowColor: "#000",
      shadowOffset: { width: 0, height: 10 },
      shadowOpacity: 0.3,
      shadowRadius: 20,
      elevation: 10,
    },
    title: {
      color: colors.text,
      fontSize: 22, // Slightly larger title
      fontWeight: "800",
      marginBottom: 12,
      letterSpacing: 0.5,
    },
    message: {
      color: colors.subtext,
      fontSize: 16, // Better readability
      lineHeight: 24,
      marginBottom: 24,
    },
    actions: {
      flexDirection: "row",
      justifyContent: "flex-end",
      gap: 12,
    },
    cancelButton: {
      borderWidth: 1,
      borderColor: colors.border,
      borderRadius: 12,
      paddingHorizontal: 20,
      paddingVertical: 12,
      backgroundColor: "rgba(255, 255, 255, 0.05)",
    },
    cancelText: {
      color: colors.subtext, // Use subtext color for secondary action
      fontWeight: "600",
      fontSize: 15,
    },
    confirmButton: {
      borderRadius: 12,
      paddingHorizontal: 24,
      paddingVertical: 12,
      backgroundColor: colors.primary,
      minWidth: 100,
      alignItems: "center",
      justifyContent: "center",
    },
    destructiveButton: {
      backgroundColor: colors.danger,
    },
    confirmText: {
      color: colors.white,
      fontWeight: "700",
      fontSize: 15,
    },
  });
