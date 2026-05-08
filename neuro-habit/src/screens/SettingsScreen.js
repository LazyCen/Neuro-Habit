import React from "react";
import { View, Text, StyleSheet, Switch, TouchableOpacity, TextInput, ScrollView, ActivityIndicator, Modal, Linking } from "react-native";
import { SafeAreaView } from "react-native-safe-area-context";
import { Ionicons } from "@expo/vector-icons";
import { useAuth } from "../context/AuthContext";
import { useTheme } from "../context/ThemeContext";
import PremiumBackground from "../components/PremiumBackground";
import { supabase } from "../services/supabaseClient";
import { backendService } from "../services/backendService";
import AppMessageModal from "../components/AppMessageModal";

const ANIMAL_AVATARS = ["🐶", "🐱", "🐻", "🐼", "🐨", "🦊", "🐸", "🐯", "🐰", "🦁"];

export default function SettingsScreen() {
  const { isDark, toggleTheme, theme: colors } = useTheme();
  const { signOut, session } = useAuth();
  const [savingProfile, setSavingProfile] = React.useState(false);
  const [deletingAccount, setDeletingAccount] = React.useState(false);
  const [showDeleteConfirm, setShowDeleteConfirm] = React.useState(false);
  const [messageModal, setMessageModal] = React.useState({ visible: false, title: "", message: "" });
  const [showProfileScreen, setShowProfileScreen] = React.useState(false);
  const [firstName, setFirstName] = React.useState("");
  const [lastName, setLastName] = React.useState("");
  const [username, setUsername] = React.useState("");
  const [selectedAvatar, setSelectedAvatar] = React.useState("🐶");
  const [clearingCache, setClearingCache] = React.useState(false);

  const themedStyles = styles(colors);
  const metadata = session?.user?.user_metadata || {};
  const isGuest = session?.user?.email === "guest@example.com";
  const displayName = metadata?.username
    || (metadata?.first_name
      ? `${metadata.first_name} ${metadata.last_name || ""}`.trim()
      : (session?.user?.email ? session.user.email.split("@")[0] : "Guest User"));
  const avatarEmoji = metadata?.avatar_emoji || selectedAvatar;

  React.useEffect(() => {
    setFirstName(metadata?.first_name || "");
    setLastName(metadata?.last_name || "");
    setUsername(metadata?.username || "");
    setSelectedAvatar(metadata?.avatar_emoji || "🐶");
  }, [session?.user?.id]);

  const handleSaveProfile = async () => {
    if (isGuest) {
      setMessageModal({ visible: true, title: "Guest Mode", message: "Sign in with an account to edit your profile." });
      return;
    }

    setSavingProfile(true);
    try {
      const trimmedFirst = firstName.trim();
      const trimmedLast = lastName.trim();
      const trimmedUsername = username.trim();

      if (!trimmedUsername && !trimmedFirst) {
        setMessageModal({ visible: true, title: "Missing Info", message: "Add at least a username or first name." });
        return;
      }

      const { error } = await supabase.auth.updateUser({
        data: {
          first_name: trimmedFirst || metadata?.first_name || "",
          last_name: trimmedLast || metadata?.last_name || "",
          username: trimmedUsername || metadata?.username || "",
          avatar_emoji: selectedAvatar,
        },
      });

      if (error) throw error;
      setMessageModal({ visible: true, title: "Profile Updated", message: "Your account profile was saved." });
      setShowProfileScreen(false);
    } catch (error) {
      setMessageModal({ visible: true, title: "Update Failed", message: error?.message || "Unable to save profile." });
    } finally {
      setSavingProfile(false);
    }
  };

  const handleClearCache = async () => {
    setClearingCache(true);
    try {
      await backendService.purgeAllLocalData(true);
      setMessageModal({
        visible: true,
        title: "Cache Cleared",
        message: "Your local data cache and offline sync queues have been purged successfully.",
      });
    } catch (error) {
      setMessageModal({
        visible: true,
        title: "Clear Failed",
        message: error?.message || "Unable to clear local cache at this time.",
      });
    } finally {
      setClearingCache(false);
    }
  };

  const handleDeleteAccount = async () => {
    if (isGuest) {
      setMessageModal({ visible: true, title: "Guest Mode", message: "There is no registered account to delete." });
      return;
    }
    setShowDeleteConfirm(true);
  };

  const confirmDeleteAccount = async () => {
    setDeletingAccount(true);
    try {
      const userId = session?.user?.id;
      if (!userId) throw new Error("No authenticated user.");

      await backendService.deleteAccount();

      setShowDeleteConfirm(false);
      await signOut(true);
      setMessageModal({ visible: true, title: "Account Deleted", message: "Your app data was removed and you have been signed out." });
    } catch (error) {
      setMessageModal({ visible: true, title: "Delete Failed", message: error?.message || "Unable to delete account right now." });
    } finally {
      setDeletingAccount(false);
    }
  };

  const renderModals = () => (
    <>
      <AppMessageModal
        visible={messageModal.visible}
        title={messageModal.title}
        message={messageModal.message}
        onConfirm={() => setMessageModal({ visible: false, title: "", message: "" })}
      />
      <Modal
        visible={showDeleteConfirm}
        transparent
        animationType="fade"
        onRequestClose={() => !deletingAccount && setShowDeleteConfirm(false)}
      >
        <View style={themedStyles.modalOverlay}>
          <View style={themedStyles.modalCard}>
            <Text style={themedStyles.modalTitle}>Delete Account Permanently?</Text>
            <Text style={themedStyles.modalText}>
              If you continue, your habits, moods, metrics, and insights will be deleted and cannot be recovered.
            </Text>
            <View style={themedStyles.modalActions}>
              <TouchableOpacity
                style={themedStyles.modalCancelButton}
                onPress={() => setShowDeleteConfirm(false)}
                disabled={deletingAccount}
              >
                <Text style={themedStyles.modalCancelText}>Cancel</Text>
              </TouchableOpacity>
              <TouchableOpacity
                style={themedStyles.modalDeleteButton}
                onPress={confirmDeleteAccount}
                disabled={deletingAccount}
              >
                {deletingAccount ? (
                  <ActivityIndicator color={colors.white} />
                ) : (
                  <Text style={themedStyles.modalDeleteText}>Yes, Delete</Text>
                )}
              </TouchableOpacity>
            </View>
          </View>
        </View>
      </Modal>
    </>
  );

  if (showProfileScreen) {
    return (
      <SafeAreaView style={themedStyles.safeArea}>
        <PremiumBackground />
        {renderModals()}
        <ScrollView style={themedStyles.container} contentContainerStyle={themedStyles.content}>
          <View style={themedStyles.profileHeaderRow}>
            <TouchableOpacity style={themedStyles.backButton} onPress={() => setShowProfileScreen(false)}>
              <Ionicons name="arrow-back" size={18} color={colors.text} />
              <Text style={themedStyles.backButtonText}>Back</Text>
            </TouchableOpacity>
            <Text style={themedStyles.profileScreenTitle}>Account Profile</Text>
          </View>

          <View style={themedStyles.section}>
            <Text style={themedStyles.sectionTitle}>Profile Details</Text>
            <TextInput
              style={themedStyles.input}
              value={firstName}
              onChangeText={setFirstName}
              placeholder="First name"
              placeholderTextColor={colors.subtext}
            />
            <TextInput
              style={themedStyles.input}
              value={lastName}
              onChangeText={setLastName}
              placeholder="Last name"
              placeholderTextColor={colors.subtext}
            />
            <TextInput
              style={themedStyles.input}
              value={username}
              onChangeText={setUsername}
              placeholder="Username"
              placeholderTextColor={colors.subtext}
              autoCapitalize="none"
            />
            <Text style={themedStyles.avatarPickerTitle}>Pick a cute avatar</Text>
            <View style={themedStyles.avatarGrid}>
              {ANIMAL_AVATARS.map((emoji) => (
                <TouchableOpacity
                  key={emoji}
                  style={[
                    themedStyles.avatarOption,
                    selectedAvatar === emoji && themedStyles.avatarOptionActive,
                  ]}
                  onPress={() => setSelectedAvatar(emoji)}
                >
                  <Text style={themedStyles.avatarOptionText}>{emoji}</Text>
                </TouchableOpacity>
              ))}
            </View>
            <TouchableOpacity style={themedStyles.saveButton} onPress={handleSaveProfile} disabled={savingProfile}>
              {savingProfile ? <ActivityIndicator color={colors.white} /> : <Text style={themedStyles.saveButtonText}>Save Profile</Text>}
            </TouchableOpacity>
          </View>

          <View style={themedStyles.dangerSection}>
            <Text style={themedStyles.dangerTitle}>Danger Zone</Text>
            <Text style={themedStyles.dangerText}>
              Deleting your account removes your app data and signs you out. This cannot be undone.
            </Text>
            <TouchableOpacity
              style={themedStyles.deleteButton}
              onPress={handleDeleteAccount}
              disabled={deletingAccount}
            >
              {deletingAccount ? (
                <ActivityIndicator color={colors.white} />
              ) : (
                <>
                  <Ionicons name="trash" size={16} color={colors.white} />
                  <Text style={themedStyles.deleteButtonText}>Delete Account</Text>
                </>
              )}
            </TouchableOpacity>
          </View>
        </ScrollView>
      </SafeAreaView>
    );
  }

  return (
    <SafeAreaView style={themedStyles.safeArea}>
      <PremiumBackground />
      {renderModals()}
      <ScrollView style={themedStyles.container} contentContainerStyle={themedStyles.content}>
        <Text style={themedStyles.title}>Settings</Text>
        
        <View style={themedStyles.profileSection}>
          <View style={themedStyles.avatarLarge}>
            <Text style={themedStyles.avatarEmoji}>{avatarEmoji}</Text>
          </View>
          <View>
            <Text style={themedStyles.userName}>{displayName}</Text>
            <Text style={themedStyles.userEmail}>{session?.user?.email || "guest@example.com"}</Text>
          </View>
        </View>

        <View style={themedStyles.section}>
          <Text style={themedStyles.sectionTitle}>Preferences</Text>



          <View style={themedStyles.settingRow}>
            <View style={themedStyles.settingLeft}>
              <View style={[themedStyles.iconBox, { backgroundColor: colors.accent + '33' }]}>
                <Ionicons name="moon" size={20} color={colors.secondary} />
              </View>
              <Text style={themedStyles.settingText}>Dark Theme</Text>
            </View>
            <Switch
              value={isDark}
              onValueChange={toggleTheme}
              trackColor={{ false: colors.cardHighlight, true: colors.secondary }}
              thumbColor={colors.text}
            />
          </View>
        </View>

        <View style={themedStyles.section}>
          <Text style={themedStyles.sectionTitle}>Account</Text>

          <TouchableOpacity style={themedStyles.settingRow} onPress={() => setShowProfileScreen(true)}>
            <View style={themedStyles.settingLeft}>
              <View style={[themedStyles.iconBox, { backgroundColor: colors.green + '33' }]}>
                <Ionicons name="person" size={20} color={colors.green} />
              </View>
              <Text style={themedStyles.settingText}>Account Profile</Text>
            </View>
            <Ionicons name="chevron-forward" size={20} color={colors.subtext} />
          </TouchableOpacity>

          <View style={themedStyles.divider} />

          <TouchableOpacity style={themedStyles.settingRow} onPress={handleClearCache} disabled={clearingCache}>
            <View style={themedStyles.settingLeft}>
              <View style={[themedStyles.iconBox, { backgroundColor: colors.warning + '33' }]}>
                <Ionicons name="refresh" size={20} color={colors.warning} />
              </View>
              <Text style={themedStyles.settingText}>Clear Local Cache</Text>
            </View>
            {clearingCache ? (
              <ActivityIndicator size="small" color={colors.subtext} />
            ) : (
              <Ionicons name="chevron-forward" size={20} color={colors.subtext} />
            )}
          </TouchableOpacity>

          <View style={themedStyles.divider} />

          <TouchableOpacity style={themedStyles.settingRow} onPress={() => signOut(true)}>
             <View style={themedStyles.settingLeft}>
              <View style={[themedStyles.iconBox, { backgroundColor: colors.subtext + '33' }]}>
                <Ionicons name="log-out" size={20} color={colors.subtext} />
              </View>
              <Text style={[themedStyles.settingText, { color: colors.subtext }]}>Log Out</Text>
            </View>
          </TouchableOpacity>

          <View style={themedStyles.divider} />

          <TouchableOpacity style={themedStyles.settingRow} onPress={handleDeleteAccount}>
             <View style={themedStyles.settingLeft}>
              <View style={[themedStyles.iconBox, { backgroundColor: colors.danger + '33' }]}>
                <Ionicons name="trash" size={20} color={colors.danger} />
              </View>
              <Text style={[themedStyles.settingText, { color: colors.danger }]}>Delete Account and Data</Text>
            </View>
          </TouchableOpacity>
        </View>

        <View style={themedStyles.section}>
          <Text style={themedStyles.sectionTitle}>Legal</Text>
          <TouchableOpacity 
            style={themedStyles.settingRow} 
            onPress={() => Linking.openURL('https://neurohabit.app/privacy')}
          >
            <View style={themedStyles.settingLeft}>
              <View style={[themedStyles.iconBox, { backgroundColor: colors.secondary + '33' }]}>
                <Ionicons name="shield-checkmark" size={20} color={colors.secondary} />
              </View>
              <Text style={themedStyles.settingText}>Privacy Policy</Text>
            </View>
            <Ionicons name="open-outline" size={18} color={colors.subtext} />
          </TouchableOpacity>
        </View>

        <View style={themedStyles.footer}>
          <Text style={themedStyles.versionText}>NeuroHabit v1.0.0</Text>
        </View>
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
    padding: 20,
  },
  content: {
    paddingTop: 40,
    paddingBottom: 40,
  },
  title: {
    color: colors.text,
    fontSize: 32,
    fontWeight: "bold",
    marginBottom: 32,
  },
  section: {
    backgroundColor: colors.card,
    borderRadius: 20,
    padding: 16,
    marginBottom: 24,
    borderWidth: 1,
    borderColor: colors.border,
  },
  profileSection: {
    flexDirection: 'row',
    alignItems: 'center',
    marginBottom: 32,
    backgroundColor: colors.cardHighlight,
    padding: 20,
    borderRadius: 24,
    borderWidth: 1,
    borderColor: colors.border,
  },
  avatarLarge: {
    width: 70,
    height: 70,
    borderRadius: 35,
    backgroundColor: colors.primary,
    justifyContent: 'center',
    alignItems: 'center',
    marginRight: 20,
    shadowColor: colors.primary,
    shadowOffset: { width: 0, height: 4 },
    shadowOpacity: 0.3,
    shadowRadius: 8,
  },
  avatarEmoji: {
    fontSize: 34,
  },
  userName: {
    color: colors.text,
    fontSize: 20,
    fontWeight: 'bold',
    marginBottom: 4,
  },
  userEmail: {
    color: colors.subtext,
    fontSize: 14,
  },
  sectionTitle: {
    color: colors.subtext,
    fontSize: 14,
    fontWeight: "600",
    textTransform: "uppercase",
    letterSpacing: 1,
    marginBottom: 16,
    marginLeft: 4,
  },
  settingRow: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "space-between",
    paddingVertical: 8,
  },
  settingLeft: {
    flexDirection: "row",
    alignItems: "center",
  },
  iconBox: {
    width: 36,
    height: 36,
    borderRadius: 10,
    justifyContent: "center",
    alignItems: "center",
    marginRight: 16,
  },
  settingText: {
    color: colors.text,
    fontSize: 16,
    fontWeight: "500",
  },
  divider: {
    height: 1,
    backgroundColor: colors.border,
    marginVertical: 12,
  },
  profileHeaderRow: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "space-between",
    marginBottom: 18,
  },
  backButton: {
    flexDirection: "row",
    alignItems: "center",
    paddingVertical: 4,
    paddingHorizontal: 8,
    borderRadius: 10,
    backgroundColor: colors.card,
    borderWidth: 1,
    borderColor: colors.border,
  },
  backButtonText: {
    color: colors.text,
    marginLeft: 6,
    fontWeight: "600",
    fontSize: 13,
  },
  profileScreenTitle: {
    color: colors.text,
    fontSize: 20,
    fontWeight: "800",
  },
  editBox: {
    marginTop: 8,
  },
  input: {
    borderWidth: 1,
    borderColor: colors.border,
    backgroundColor: colors.background,
    color: colors.text,
    borderRadius: 12,
    paddingHorizontal: 12,
    paddingVertical: 10,
    marginBottom: 10,
    outlineStyle: "none",
  },
  avatarPickerTitle: {
    color: colors.subtext,
    fontSize: 13,
    marginTop: 4,
    marginBottom: 8,
  },
  avatarGrid: {
    flexDirection: "row",
    flexWrap: "wrap",
    gap: 8,
    marginBottom: 12,
  },
  avatarOption: {
    width: 40,
    height: 40,
    borderRadius: 20,
    alignItems: "center",
    justifyContent: "center",
    borderWidth: 1,
    borderColor: colors.border,
    backgroundColor: colors.background,
  },
  avatarOptionActive: {
    borderColor: colors.primary,
    backgroundColor: colors.primary + "22",
  },
  avatarOptionText: {
    fontSize: 22,
  },
  saveButton: {
    backgroundColor: colors.primary,
    paddingVertical: 11,
    borderRadius: 12,
    alignItems: "center",
  },
  saveButtonText: {
    color: colors.white,
    fontWeight: "700",
    fontSize: 14,
  },
  dangerSection: {
    backgroundColor: colors.card,
    borderWidth: 1,
    borderColor: colors.danger + "55",
    borderRadius: 20,
    padding: 16,
    marginBottom: 24,
  },
  dangerTitle: {
    color: colors.danger,
    fontSize: 14,
    fontWeight: "700",
    textTransform: "uppercase",
    letterSpacing: 0.8,
    marginBottom: 8,
  },
  dangerText: {
    color: colors.subtext,
    fontSize: 13,
    lineHeight: 18,
    marginBottom: 12,
  },
  deleteButton: {
    backgroundColor: colors.danger,
    borderRadius: 12,
    paddingVertical: 11,
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "center",
    gap: 8,
  },
  deleteButtonText: {
    color: colors.white,
    fontWeight: "700",
    fontSize: 14,
  },
  modalOverlay: {
    flex: 1,
    backgroundColor: colors.cardHighlight,
    justifyContent: "center",
    padding: 24,
  },
  modalCard: {
    backgroundColor: colors.card,
    borderRadius: 16,
    padding: 18,
    borderWidth: 1,
    borderColor: colors.border,
  },
  modalTitle: {
    color: colors.text,
    fontSize: 18,
    fontWeight: "800",
    marginBottom: 8,
  },
  modalText: {
    color: colors.subtext,
    fontSize: 14,
    lineHeight: 20,
    marginBottom: 16,
  },
  modalActions: {
    flexDirection: "row",
    justifyContent: "flex-end",
    gap: 10,
  },
  modalCancelButton: {
    borderWidth: 1,
    borderColor: colors.border,
    borderRadius: 10,
    paddingHorizontal: 14,
    paddingVertical: 9,
    backgroundColor: colors.background,
  },
  modalCancelText: {
    color: colors.text,
    fontWeight: "600",
  },
  modalDeleteButton: {
    borderRadius: 10,
    paddingHorizontal: 14,
    paddingVertical: 9,
    backgroundColor: colors.danger,
    minWidth: 104,
    alignItems: "center",
    justifyContent: "center",
  },
  modalDeleteText: {
    color: colors.white,
    fontWeight: "700",
  },
  footer: {
    marginTop: 8,
    marginBottom: 20,
    alignItems: 'center',
  },
  versionText: {
    color: colors.subtext,
    fontSize: 12,
    opacity: 0.6,
  },
});
