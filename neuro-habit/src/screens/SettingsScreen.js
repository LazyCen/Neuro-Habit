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
  const [messageModal, setMessageModal] = React.useState({ 
    visible: false, 
    title: "", 
    message: "",
    confirmText: "OK",
    cancelText: null,
    onConfirm: () => {},
    onCancel: () => {},
    destructive: false
  });
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
      setMessageModal({ visible: true, title: "Guest Mode", message: "Sign in with an account to edit your profile.", confirmText: "OK", onConfirm: () => setMessageModal(prev => ({ ...prev, visible: false })) });
      return;
    }

    setSavingProfile(true);
    try {
      const trimmedFirst = firstName.trim();
      const trimmedLast = lastName.trim();
      const trimmedUsername = username.trim();

      if (!trimmedUsername && !trimmedFirst) {
        setMessageModal({ visible: true, title: "Missing Info", message: "Add at least a username or first name.", confirmText: "OK", onConfirm: () => setMessageModal(prev => ({ ...prev, visible: false })) });
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
      setMessageModal({ visible: true, title: "Profile Updated", message: "Your account profile was saved.", confirmText: "OK", onConfirm: () => setMessageModal(prev => ({ ...prev, visible: false })) });
      setShowProfileScreen(false);
    } catch (error) {
      setMessageModal({ visible: true, title: "Update Failed", message: error?.message || "Unable to save profile.", confirmText: "OK", onConfirm: () => setMessageModal(prev => ({ ...prev, visible: false })) });
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
        confirmText: "OK",
        onConfirm: () => setMessageModal(prev => ({ ...prev, visible: false }))
      });
    } catch (error) {
      setMessageModal({
        visible: true,
        title: "Clear Failed",
        message: error?.message || "Unable to clear local cache at this time.",
        confirmText: "OK",
        onConfirm: () => setMessageModal(prev => ({ ...prev, visible: false }))
      });
    } finally {
      setClearingCache(false);
    }
  };

  const confirmDeleteAccount = async () => {
    setDeletingAccount(true);
    try {
      const userId = session?.user?.id;
      if (!userId) throw new Error("No authenticated user.");

      await backendService.deleteAccount();

      setMessageModal(prev => ({ ...prev, visible: false }));
      await signOut(true);
      setMessageModal({ 
        visible: true, 
        title: "Account Deleted", 
        message: "Your app data was removed and you have been signed out.",
        confirmText: "OK",
        onConfirm: () => setMessageModal(prev => ({ ...prev, visible: false }))
      });
    } catch (error) {
      setMessageModal({ 
        visible: true, 
        title: "Delete Failed", 
        message: error?.message || "Unable to delete account right now.",
        confirmText: "OK",
        onConfirm: () => setMessageModal(prev => ({ ...prev, visible: false }))
      });
    } finally {
      setDeletingAccount(false);
    }
  };

  const handleDeleteAccount = async () => {
    if (isGuest) {
      setMessageModal({ 
        visible: true, 
        title: "Guest Mode", 
        message: "There is no registered account to delete.",
        confirmText: "OK",
        onConfirm: () => setMessageModal(prev => ({ ...prev, visible: false }))
      });
      return;
    }
    
    setMessageModal({
      visible: true,
      title: "Delete Account Permanently?",
      message: "If you continue, your habits, moods, metrics, and insights will be deleted and cannot be recovered.",
      confirmText: "Yes, Delete",
      cancelText: "Cancel",
      destructive: true,
      onCancel: () => setMessageModal(prev => ({ ...prev, visible: false })),
      onConfirm: confirmDeleteAccount
    });
  };

  const renderModals = () => (
    <>
      <AppMessageModal
        visible={messageModal.visible}
        title={messageModal.title}
        message={messageModal.message}
        confirmText={messageModal.confirmText}
        cancelText={messageModal.cancelText}
        destructive={messageModal.destructive}
        onConfirm={messageModal.onConfirm}
        onCancel={messageModal.onCancel}
      />
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
            
            <View style={themedStyles.inputRow}>
              <View style={themedStyles.inputHalf}>
                <Text style={themedStyles.inputLabel}>First Name</Text>
                <TextInput
                  style={themedStyles.input}
                  value={firstName}
                  onChangeText={setFirstName}
                  placeholder="First"
                  placeholderTextColor={colors.subtext}
                />
              </View>
              <View style={themedStyles.inputHalf}>
                <Text style={themedStyles.inputLabel}>Last Name</Text>
                <TextInput
                  style={themedStyles.input}
                  value={lastName}
                  onChangeText={setLastName}
                  placeholder="Last"
                  placeholderTextColor={colors.subtext}
                />
              </View>
            </View>

            <Text style={themedStyles.inputLabel}>Username</Text>
            <TextInput
              style={themedStyles.input}
              value={username}
              onChangeText={setUsername}
              placeholder="Username"
              placeholderTextColor={colors.subtext}
              autoCapitalize="none"
            />

            <View style={themedStyles.divider} />

            <Text style={themedStyles.inputLabel}>Avatar</Text>
            <Text style={themedStyles.avatarPickerSubtitle}>Pick an emoji that represents you</Text>
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
              {savingProfile ? <ActivityIndicator color={colors.white} /> : <Text style={themedStyles.saveButtonText}>Save Profile Changes</Text>}
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
            >
              <Ionicons name="trash" size={16} color={colors.white} />
              <Text style={themedStyles.deleteButtonText}>Delete Account and Data</Text>
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

          <TouchableOpacity style={themedStyles.settingRow} onPress={() => signOut(true)}>
             <View style={themedStyles.settingLeft}>
              <View style={[themedStyles.iconBox, { backgroundColor: colors.subtext + '33' }]}>
                <Ionicons name="log-out" size={20} color={colors.subtext} />
              </View>
              <Text style={[themedStyles.settingText, { color: colors.subtext }]}>Log Out</Text>
            </View>
          </TouchableOpacity>
        </View>

        <View style={themedStyles.section}>
          <Text style={themedStyles.sectionTitle}>Legal</Text>
          <TouchableOpacity 
            style={themedStyles.settingRow} 
            onPress={() => Linking.openURL('https://gistcdn.githack.com/LazyCen/599170fb011c4d75857edf30e3ec16d2/raw/020bcaad985fbcbd590a19290d92e69af1a483fe/.md')}
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
  inputRow: {
    flexDirection: "row",
    justifyContent: "space-between",
    gap: 10,
  },
  inputHalf: {
    flex: 1,
  },
  inputLabel: {
    color: colors.text,
    fontSize: 13,
    fontWeight: "600",
    marginBottom: 6,
    marginLeft: 4,
  },
  input: {
    borderWidth: 1,
    borderColor: colors.border,
    backgroundColor: colors.background,
    color: colors.text,
    borderRadius: 12,
    paddingHorizontal: 12,
    paddingVertical: 10,
    marginBottom: 14,
    outlineStyle: "none",
  },
  avatarPickerSubtitle: {
    color: colors.subtext,
    fontSize: 13,
    marginTop: -4,
    marginBottom: 12,
    marginLeft: 4,
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
