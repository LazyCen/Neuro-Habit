import React, { useState } from 'react';
import { 
  StyleSheet, 
  View, 
  Text, 
  TextInput, 
  TouchableOpacity, 
  ActivityIndicator, 
  Platform,
  Dimensions
} from 'react-native';
import { KeyboardAwareScrollView } from 'react-native-keyboard-aware-scroll-view';
import { Ionicons } from '@expo/vector-icons';
import Animated, { FadeInDown, FadeInUp, FadeOutUp } from 'react-native-reanimated';
import { supabase } from '../services/supabaseClient';
import { useAuth } from '../context/AuthContext';
import { useTheme } from '../context/ThemeContext';
import PremiumBackground from '../components/PremiumBackground';
import AppMessageModal from '../components/AppMessageModal';

const { width } = Dimensions.get('window');

export default function UsernameScreen() {
  const { theme: colors, isDark } = useTheme();
  const [username, setUsername] = useState('');
  const [loading, setLoading] = useState(false);
  const [successMessage, setSuccessMessage] = useState('');
  const [modalConfig, setModalConfig] = useState({ visible: false, title: "", message: "" });
  const { session } = useAuth();
  const themedStyles = styles(colors, isDark);

  const showSuccess = (message) => {
    setSuccessMessage(message);
    setTimeout(() => {
      setSuccessMessage('');
    }, 2200);
  };

  const handleSetUsername = async () => {
    if (username.length < 3) {
      setModalConfig({
        visible: true,
        title: "Invalid Username",
        message: "Username must be at least 3 characters long.",
      });
      return;
    }

    setLoading(true);
    try {
      const { error } = await supabase.auth.updateUser({
        data: { username: username.trim() }
      });

      if (error) throw error;

      showSuccess('Username set successfully');
    } catch (error) {
      console.error('Error setting username:', error.message);
      setModalConfig({
        visible: true,
        title: "Update Failed",
        message: error.message || "Unable to update username.",
      });
    } finally {
      setLoading(false);
    }
  };

  const handleSkip = async () => {
    setLoading(true);
    try {
      // We'll set a flag that they've seen this prompt
      const { error } = await supabase.auth.updateUser({
        data: { username_skipped: true }
      });
      if (error) throw error;
    } catch (error) {
      console.error('Error skipping username:', error.message);
    } finally {
      setLoading(false);
    }
  };

  return (
    <View style={themedStyles.container}>
      <PremiumBackground />
      <AppMessageModal
        visible={modalConfig.visible}
        title={modalConfig.title}
        message={modalConfig.message}
        onConfirm={() => setModalConfig({ visible: false, title: "", message: "" })}
      />
      <KeyboardAwareScrollView 
        contentContainerStyle={themedStyles.keyboardView}
        enableOnAndroid={true}
        bounces={false}
      >
        <Animated.View 
          entering={FadeInDown.duration(800).springify()}
          style={themedStyles.content}
        >
          {successMessage ? (
            <Animated.View
              entering={FadeInUp.duration(220)}
              exiting={FadeOutUp.duration(220)}
              style={themedStyles.successBanner}
            >
              <Ionicons name="checkmark-circle" size={16} color={colors.primary} />
              <Text style={themedStyles.successText}>{successMessage}</Text>
            </Animated.View>
          ) : null}

          <View style={themedStyles.iconContainer}>
            <Ionicons name="at-circle" size={80} color={colors.primary} />
          </View>
          
          <Text style={themedStyles.title}>Choose your username</Text>
          <Text style={themedStyles.subtitle}>
            This is how you&apos;ll be known in the Neuro Habit community.
          </Text>

          <View style={themedStyles.inputContainer}>
            <Ionicons name="person-outline" size={20} color={colors.subtext} style={themedStyles.inputIcon} />
            <TextInput
              style={themedStyles.input}
              placeholder="e.g. neuro_explorer"
              placeholderTextColor={colors.subtext}
              value={username}
              onChangeText={setUsername}
              autoCapitalize="none"
              autoCorrect={false}
              maxLength={20}
            />
          </View>

          <TouchableOpacity 
            style={[themedStyles.button, loading && themedStyles.buttonDisabled]}
            onPress={handleSetUsername}
            disabled={loading}
          >
            {loading ? (
              <ActivityIndicator color={colors.white} />
            ) : (
              <Text style={themedStyles.buttonText}>Get Started</Text>
            )}
          </TouchableOpacity>

          <TouchableOpacity 
            style={themedStyles.skipButton}
            onPress={handleSkip}
            disabled={loading}
          >
            <Text style={themedStyles.skipText}>Set later</Text>
          </TouchableOpacity>
        </Animated.View>
      </KeyboardAwareScrollView>
    </View>
  );
}

const styles = (colors, isDark) => StyleSheet.create({
  container: {
    flex: 1,
    backgroundColor: colors.background,
  },
  keyboardView: {
    flex: 1,
    justifyContent: 'center',
    alignItems: 'center',
    padding: 24,
  },
  content: {
    width: '100%',
    maxWidth: 400,
    backgroundColor: colors.card,
    borderRadius: 30,
    padding: 32,
    alignItems: 'center',
    borderWidth: !isDark ? 1 : 0,
    borderColor: colors.border,
    shadowColor: colors.black,
    shadowOffset: { width: 0, height: 10 },
    shadowOpacity: 0.2,
    shadowRadius: 20,
    elevation: 10,
    position: 'relative',
  },
  successBanner: {
    position: 'absolute',
    top: 12,
    left: 12,
    right: 12,
    backgroundColor: colors.primary + '14',
    borderColor: colors.primary + '40',
    borderWidth: 1,
    borderRadius: 12,
    paddingVertical: 9,
    paddingHorizontal: 12,
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
  },
  successText: {
    color: colors.text,
    fontSize: 13,
    fontWeight: '600',
  },
  iconContainer: {
    width: 120,
    height: 120,
    borderRadius: 60,
    backgroundColor: colors.primary + '15',
    justifyContent: 'center',
    alignItems: 'center',
    marginBottom: 24,
  },
  title: {
    fontSize: 28,
    fontWeight: 'bold',
    color: colors.text,
    textAlign: 'center',
    marginBottom: 12,
  },
  subtitle: {
    fontSize: 16,
    color: colors.subtext,
    textAlign: 'center',
    marginBottom: 32,
    lineHeight: 22,
  },
  inputContainer: {
    flexDirection: 'row',
    alignItems: 'center',
    backgroundColor: !isDark ? colors.transparent : colors.cardHighlight,
    borderRadius: 16,
    paddingHorizontal: 16,
    height: 60,
    marginBottom: 24,
    borderWidth: 1,
    borderColor: !isDark ? colors.border : colors.transparent,
    width: '100%',
  },
  inputIcon: {
    marginRight: 12,
  },
  input: {
    flex: 1,
    color: colors.text,
    fontSize: 16,
    fontWeight: '500',
    outlineStyle: 'none',
  },
  button: {
    backgroundColor: colors.primary,
    height: 60,
    borderRadius: 16,
    width: '100%',
    justifyContent: 'center',
    alignItems: 'center',
    shadowColor: colors.primary,
    shadowOffset: { width: 0, height: 4 },
    shadowOpacity: 0.3,
    shadowRadius: 8,
    elevation: 4,
  },
  buttonDisabled: {
    opacity: 0.7,
  },
  buttonText: {
    color: colors.white,
    fontSize: 18,
    fontWeight: 'bold',
  },
  skipButton: {
    marginTop: 16,
    padding: 8,
  },
  skipText: {
    color: colors.subtext,
    fontSize: 14,
    textDecorationLine: 'underline',
  },
});
