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
      backgroundColor: "rgba(0,0,0,0.45)",
      justifyContent: "center",
      padding: 24,
    },
    card: {
      backgroundColor: colors.card,
      borderRadius: 16,
      padding: 18,
      borderWidth: 1,
      borderColor: colors.border,
    },
    title: {
      color: colors.text,
      fontSize: 18,
      fontWeight: "800",
      marginBottom: 8,
    },
    message: {
      color: colors.subtext,
      fontSize: 14,
      lineHeight: 20,
      marginBottom: 16,
    },
    actions: {
      flexDirection: "row",
      justifyContent: "flex-end",
      gap: 10,
    },
    cancelButton: {
      borderWidth: 1,
      borderColor: colors.border,
      borderRadius: 10,
      paddingHorizontal: 14,
      paddingVertical: 9,
      backgroundColor: colors.background,
    },
    cancelText: {
      color: colors.text,
      fontWeight: "600",
    },
    confirmButton: {
      borderRadius: 10,
      paddingHorizontal: 14,
      paddingVertical: 9,
      backgroundColor: colors.primary,
      minWidth: 88,
      alignItems: "center",
      justifyContent: "center",
    },
    destructiveButton: {
      backgroundColor: colors.danger,
    },
    confirmText: {
      color: "#fff",
      fontWeight: "700",
    },
  });
