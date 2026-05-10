import React from "react";
import { Modal, View, Text, TouchableOpacity, StyleSheet, ScrollView, Linking } from "react-native";
import { Ionicons } from "@expo/vector-icons";
import { useTheme } from "../context/ThemeContext";

const HC_PLAY_STORE_URL =
  "https://play.google.com/store/apps/details?id=com.google.android.apps.healthdata";

// hcSdkStatus: null=unknown, 0=module missing, 1=not installed, 2=needs update, 3=available
export default function HealthPermissionModal({
  visible,
  onConfirm,
  onCancel,
  loading = false,
  hcSdkStatus = null,
}) {
  const { theme: colors } = useTheme();
  const styles = createStyles(colors);

  const hcNotInstalled = hcSdkStatus === 0 || hcSdkStatus === 1;
  const hcNeedsUpdate  = hcSdkStatus === 2;
  const hcAvailable    = hcSdkStatus === 3;

  const hcStatusLabel = hcNotInstalled
    ? "Not installed"
    : hcNeedsUpdate
    ? "Update required"
    : hcAvailable
    ? "Installed ✓"
    : "Checking...";

  const hcStatusColor = hcAvailable
    ? colors.green
    : hcNeedsUpdate
    ? colors.primary
    : colors.red ?? "#ef4444";

  return (
    <Modal visible={visible} transparent animationType="slide" onRequestClose={onCancel}>
      <View style={styles.overlay}>
        <View style={styles.card}>
          <View style={styles.header}>
            <Ionicons name="shield-checkmark" size={32} color={colors.primary} />
            <Text style={styles.title}>Health Data Access</Text>
          </View>

          <ScrollView style={styles.scrollView} showsVerticalScrollIndicator={false}>
            <Text style={styles.intro}>
              NeuroHabit requires access to your device&apos;s health and usage data to function
              correctly.
            </Text>

            {/* Health Connect status banner */}
            <View style={[styles.hcBanner, { borderColor: hcStatusColor + "55", backgroundColor: hcStatusColor + "12" }]}>
              <Ionicons
                name={hcAvailable ? "checkmark-circle" : hcNeedsUpdate ? "refresh-circle" : "alert-circle"}
                size={20}
                color={hcStatusColor}
              />
              <View style={{ flex: 1, marginLeft: 10 }}>
                <Text style={[styles.hcBannerTitle, { color: hcStatusColor }]}>
                  Health Connect — {hcStatusLabel}
                </Text>
                {(hcNotInstalled || hcNeedsUpdate) && (
                  <Text style={styles.hcBannerBody}>
                    {hcNotInstalled
                      ? "Health Connect is needed to read your step count. Tap below to install it from the Play Store."
                      : "Your installed version of Health Connect needs to be updated before it can be used."}
                  </Text>
                )}
              </View>
            </View>

            {/* Install / Update button — shown only when HC isn't ready */}
            {(hcNotInstalled || hcNeedsUpdate) && (
              <TouchableOpacity
                style={[styles.installButton, { backgroundColor: colors.primary }]}
                onPress={() => Linking.openURL(HC_PLAY_STORE_URL).catch(() => {})}
              >
                <Ionicons name="download-outline" size={18} color={colors.white} style={{ marginRight: 8 }} />
                <Text style={styles.installButtonText}>
                  {hcNeedsUpdate ? "Update Health Connect" : "Install Health Connect"}
                </Text>
              </TouchableOpacity>
            )}

            <View style={styles.section}>
              <Text style={styles.sectionTitle}>What data we request:</Text>
              <View style={styles.listItem}>
                <Ionicons name="footsteps" size={20} color={colors.secondary} style={styles.icon} />
                <Text style={styles.listText}>
                  Step count and daily activity (via Health Connect / Google Fit / Apple Health)
                </Text>
              </View>
              <View style={styles.listItem}>
                <Ionicons name="phone-portrait" size={20} color={colors.secondary} style={styles.icon} />
                <Text style={styles.listText}>Screen time and app usage statistics</Text>
              </View>
            </View>

            <View style={styles.section}>
              <Text style={styles.sectionTitle}>Why it is needed:</Text>
              <View style={styles.listItem}>
                <Ionicons name="analytics" size={20} color={colors.secondary} style={styles.icon} />
                <Text style={styles.listText}>
                  To automatically track and complete your physical activity habits
                </Text>
              </View>
              <View style={styles.listItem}>
                <Ionicons name="bulb" size={20} color={colors.secondary} style={styles.icon} />
                <Text style={styles.listText}>
                  To provide AI-powered insights linking your lifestyle, activity, and mood
                </Text>
              </View>
            </View>

            <View style={styles.section}>
              <Text style={styles.sectionTitle}>How it is protected:</Text>
              <View style={styles.listItem}>
                <Ionicons name="lock-closed" size={20} color={colors.green} style={styles.icon} />
                <Text style={styles.listText}>
                  Your data is securely stored and associated only with your private account. We
                  NEVER sell or share your health data with third parties.
                </Text>
              </View>
            </View>
          </ScrollView>

          <View style={styles.actions}>
            <TouchableOpacity style={styles.cancelButton} onPress={onCancel} disabled={loading}>
              <Text style={styles.cancelText}>Cancel</Text>
            </TouchableOpacity>
            <TouchableOpacity
              style={[
                styles.confirmButton,
                // Dim the confirm button when HC isn't available yet
                (hcNotInstalled) && { opacity: 0.5 },
              ]}
              onPress={onConfirm}
              disabled={loading || hcNotInstalled}
            >
              <Text style={styles.confirmText}>
                {hcNotInstalled ? "Install HC First" : "Continue to Permissions"}
              </Text>
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
      backgroundColor: "rgba(0,0,0,0.6)",
      justifyContent: "flex-end",
    },
    card: {
      backgroundColor: colors.card,
      borderTopLeftRadius: 24,
      borderTopRightRadius: 24,
      padding: 24,
      maxHeight: "90%",
    },
    header: {
      flexDirection: "row",
      alignItems: "center",
      marginBottom: 16,
    },
    title: {
      color: colors.text,
      fontSize: 22,
      fontWeight: "bold",
      marginLeft: 12,
    },
    scrollView: {
      marginBottom: 24,
    },
    intro: {
      color: colors.text,
      fontSize: 15,
      lineHeight: 22,
      marginBottom: 16,
    },
    hcBanner: {
      flexDirection: "row",
      alignItems: "flex-start",
      borderWidth: 1,
      borderRadius: 12,
      padding: 12,
      marginBottom: 12,
    },
    hcBannerTitle: {
      fontWeight: "700",
      fontSize: 14,
    },
    hcBannerBody: {
      color: colors.subtext,
      fontSize: 13,
      lineHeight: 18,
      marginTop: 4,
    },
    installButton: {
      flexDirection: "row",
      alignItems: "center",
      justifyContent: "center",
      paddingVertical: 12,
      borderRadius: 12,
      marginBottom: 20,
    },
    installButtonText: {
      color: colors.white,
      fontWeight: "bold",
      fontSize: 15,
    },
    section: {
      marginBottom: 20,
    },
    sectionTitle: {
      color: colors.text,
      fontSize: 16,
      fontWeight: "bold",
      marginBottom: 10,
    },
    listItem: {
      flexDirection: "row",
      marginBottom: 12,
      alignItems: "flex-start",
    },
    icon: {
      marginRight: 12,
      marginTop: 2,
    },
    listText: {
      color: colors.subtext,
      fontSize: 14,
      lineHeight: 20,
      flex: 1,
    },
    actions: {
      flexDirection: "row",
      justifyContent: "space-between",
      gap: 12,
    },
    cancelButton: {
      flex: 1,
      paddingVertical: 14,
      alignItems: "center",
      borderRadius: 12,
      backgroundColor: colors.cardHighlight,
    },
    cancelText: {
      color: colors.text,
      fontWeight: "bold",
      fontSize: 16,
    },
    confirmButton: {
      flex: 2,
      paddingVertical: 14,
      alignItems: "center",
      borderRadius: 12,
      backgroundColor: colors.primary,
    },
    confirmText: {
      color: colors.white,
      fontWeight: "bold",
      fontSize: 16,
    },
  });
