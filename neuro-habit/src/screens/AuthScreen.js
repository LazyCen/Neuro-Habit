import React, { useState, useEffect } from 'react';
import { 
  StyleSheet, 
  View, 
  Text, 
  TextInput, 
  TouchableOpacity, 
  ActivityIndicator, 
  Dimensions,
  Platform,
  Modal
} from 'react-native';
import { KeyboardAwareScrollView } from 'react-native-keyboard-aware-scroll-view';
import { Ionicons } from '@expo/vector-icons';
import Svg, { Path, Circle, Defs, LinearGradient, Stop } from 'react-native-svg';
import Animated, { 
  FadeInUp, 
  FadeInDown, 
  Layout, 
  SlideInRight,
  useSharedValue,
  useAnimatedStyle,
  withSpring,
  interpolateColor
} from 'react-native-reanimated';
import { useAuth } from '../context/AuthContext';
import { useTheme } from '../context/ThemeContext';
import AppMessageModal from '../components/AppMessageModal';
import { supabase } from '../services/supabaseClient';

const { width, height } = Dimensions.get('window');

export default function AuthScreen() {
  const { theme: colors, isDark } = useTheme();
  const PRIMARY = colors.primary;
  const SECONDARY = colors.secondary;
  const ACCENT = colors.accent || '#8B5CF6';
  const BG_COLOR = colors.background;
  const CARD_BG = colors.card;
  const TEXT_LIGHT = colors.text;
  const TEXT_MUTED = colors.subtext;
  const BORDER = colors.border;

  const themedStyles = styles(colors, isDark, PRIMARY, SECONDARY, ACCENT, BG_COLOR, CARD_BG, TEXT_LIGHT, TEXT_MUTED, BORDER);

  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [firstName, setFirstName] = useState('');
  const [middleName, setMiddleName] = useState('');
  const [lastName, setLastName] = useState('');
  const [loading, setLoading] = useState(false);
  const [isLogin, setIsLogin] = useState(true);
  const [showPassword, setShowPassword] = useState(false);
  const [modalConfig, setModalConfig] = useState({ visible: false, title: "", message: "" });
  const [showForgotModal, setShowForgotModal] = useState(false);
  const [forgotEmail, setForgotEmail] = useState("");
  
  const { signIn, signUp } = useAuth();

  const buttonScale = useSharedValue(1);

  const animatedButtonStyle = useAnimatedStyle(() => ({
    transform: [{ scale: buttonScale.value }]
  }));

  const showMessage = (title, message) => {
    setModalConfig({ visible: true, title, message });
  };

  async function handleSignIn() {
    console.log('AuthScreen: handleSignIn called. isLogin:', isLogin);
    if (!email || !password) {
      showMessage('Missing Info', 'Please enter your credentials to proceed.');
      return;
    }
    
    setLoading(true);
    buttonScale.value = withSpring(0.95);
    setTimeout(() => { buttonScale.value = withSpring(1); }, 100);

    try {
      console.log('AuthScreen: Attempting login for:', email.trim(), 'Password length:', password.length);
      const { data, error } = await signIn(email, password);
      
      if (error) {
        console.error('AuthScreen: SignIn error:', error);
        // Specific handling for common Supabase errors
        if (error.message?.toLowerCase().includes('email not confirmed') || 
            error.message?.toLowerCase().includes('not confirmed')) {
          showMessage(
            'Email Not Confirmed',
            'Your account exists but your email is not yet confirmed.\n\n' +
            'Please check your inbox for a confirmation email from Supabase and click the link.\n\n' +
            'OR go to your Supabase Dashboard -> Authentication -> Users -> find your email -> click menu -> Confirm email.'
          );
        } else if (error.message?.toLowerCase().includes('invalid login credentials')) {
          showMessage('Wrong Credentials', 'The email or password is incorrect. Please try again.');
        } else {
          showMessage('Sign In Failed', error.message || 'Unknown error');
        }
      } else if (!data || !data.session) {
        // This also means email is not confirmed
        showMessage(
          'Email Confirmation Required',
          'Sign-in succeeded but no session was created.\n\n' +
          'This usually means your email address is not yet confirmed.\n\n' +
          'Fix options:\n' +
          '1. Check your inbox for a Supabase confirmation email\n' +
          '2. In Supabase Dashboard -> Authentication -> Users -> confirm manually\n' +
          '3. In Supabase Dashboard -> Authentication -> Settings -> disable Confirm email'
        );
      } else {
        console.log('AuthScreen: Sign in success, session user:', data.session.user.email);
        // Navigation happens automatically via AuthContext session state update
      }
    } catch (err) {
      console.error('AuthScreen: Unexpected error:', err);
      showMessage('Error', `An unexpected error occurred: ${err.message}`);
    } finally {
      setLoading(false);
    }
  }

  async function handleSignUp() {
    console.log('AuthScreen: handleSignUp called');
    if (!email || !password || !firstName || !lastName) {
      showMessage('Missing Info', 'First name, last name, email, and password are required.');
      return;
    }

    setLoading(true);
    const { data, error } = await signUp(email, password, {
      first_name: firstName,
      middle_name: middleName,
      last_name: lastName,
      full_name: `${firstName}${middleName ? ' ' + middleName : ''} ${lastName}`
    });
    if (error) {
      showMessage('Registration Failed', error.message);
    } else if (data?.session) {
      // Session exists immediately = email confirmation is disabled, user is logged in
      console.log('AuthScreen: Sign up successful with immediate session');
    } else {
      showMessage(
        'Account Created', 
        'Your account was created.\n\n' +
        'If you have email confirmation enabled in Supabase, check your inbox and click the confirmation link before signing in.\n\n' +
        'Otherwise, try signing in now.'
      );
      setIsLogin(true);
    }
    setLoading(false);
  }

  async function handleForgotPassword() {
    const normalizedEmail = forgotEmail.trim();
    if (!normalizedEmail) {
      showMessage('Email required', 'Please enter your email address to receive a reset link.');
      return;
    }

    try {
      const { error } = await supabase.auth.resetPasswordForEmail(normalizedEmail);
      if (error) throw error;
      setShowForgotModal(false);
      setForgotEmail("");
      showMessage(
        'Reset link sent',
        'If this email exists, we sent a reset link to your inbox. Open Gmail, set a new password, and confirm it there.'
      );
    } catch (error) {
      showMessage('Reset failed', error?.message || 'Unable to send reset email right now.');
    }
  }

  return (
    <KeyboardAwareScrollView 
      style={themedStyles.container}
      contentContainerStyle={themedStyles.scrollContent}
      bounces={false}
      enableOnAndroid={true}
      extraScrollHeight={Platform.OS === 'ios' ? 20 : 0}
    >
      <AppMessageModal
        visible={modalConfig.visible}
        title={modalConfig.title}
        message={modalConfig.message}
        onConfirm={() => setModalConfig({ visible: false, title: "", message: "" })}
      />
      <Modal
        visible={showForgotModal}
        transparent
        animationType="fade"
        onRequestClose={() => setShowForgotModal(false)}
      >
        <View style={themedStyles.forgotOverlay}>
          <View style={themedStyles.forgotCard}>
            <Text style={themedStyles.forgotTitle}>Reset Password</Text>
            <Text style={themedStyles.forgotBody}>
              Enter your email and we will send a reset link.
            </Text>
            <TextInput
              style={themedStyles.forgotInput}
              placeholder="name@example.com"
              placeholderTextColor={TEXT_MUTED}
              autoCapitalize="none"
              keyboardType="email-address"
              value={forgotEmail}
              onChangeText={setForgotEmail}
              selectionColor={PRIMARY}
              cursorColor={PRIMARY}
            />
            <View style={themedStyles.forgotActions}>
              <TouchableOpacity style={themedStyles.forgotCancel} onPress={() => setShowForgotModal(false)}>
                <Text style={themedStyles.forgotCancelText}>Cancel</Text>
              </TouchableOpacity>
              <TouchableOpacity style={themedStyles.forgotSend} onPress={handleForgotPassword}>
                <Text style={themedStyles.forgotSendText}>Send Link</Text>
              </TouchableOpacity>
            </View>
          </View>
        </View>
      </Modal>

      {/* Abstract Background Shapes */}
      <View style={themedStyles.bgDecor}>
        <Svg height={height} width={width} style={StyleSheet.absoluteFill}>
          <Defs>
            <LinearGradient id="grad" x1="0%" y1="0%" x2="100%" y2="100%">
              <Stop offset="0%" stopColor={PRIMARY} stopOpacity="0.2" />
              <Stop offset="100%" stopColor={SECONDARY} stopOpacity="0.1" />
            </LinearGradient>
            <LinearGradient id="gradAccent" x1="0%" y1="0%" x2="100%" y2="100%">
              <Stop offset="0%" stopColor={ACCENT} stopOpacity="0.15" />
              <Stop offset="100%" stopColor={PRIMARY} stopOpacity="0.05" />
            </LinearGradient>
          </Defs>
          <Circle cx={width * 0.9} cy={height * 0.1} r={width * 0.6} fill="url(#grad)" />
          <Circle cx={width * 0.1} cy={height * 0.8} r={width * 0.5} fill="url(#gradAccent)" />
          <Circle cx={width * 0.5} cy={height * 0.4} r={width * 0.4} fill={PRIMARY} opacity="0.03" />
        </Svg>
      </View>

      <View style={themedStyles.main}>
        {/* Header Section */}
        <Animated.View 
          entering={FadeInDown.duration(1000).springify()}
          style={themedStyles.header}
        >
          <View style={themedStyles.logoCircle}>
            <Ionicons name="pulse" size={40} color={colors.white} />
          </View>
          <Text style={themedStyles.welcomeText}>
            {isLogin ? 'Neuro Habit' : 'Join Us'}
          </Text>
          {isLogin && (
            <Text style={themedStyles.subText}>
              Sign in to access your dashboard
            </Text>
          )}
        </Animated.View>

        {/* Login Card */}
        <Animated.View 
          entering={FadeInUp.delay(300).duration(1000).springify()}
          style={themedStyles.card}
        >
          {!isLogin && (
            <>
              <View style={themedStyles.row}>
                <View style={[themedStyles.inputGroup, { flex: 1, marginRight: 10 }]}>
                  <Text style={themedStyles.label}>First Name</Text>
                  <View style={themedStyles.inputWrapperCompact}>
                    <TextInput
                      style={themedStyles.input}
                      placeholder="John"
                      placeholderTextColor={TEXT_MUTED}
                      value={firstName}
                      onChangeText={setFirstName}
                      selectionColor={PRIMARY}
                      cursorColor={PRIMARY}
                      underlineColorAndroid="transparent"
                    />
                  </View>
                </View>

                <View style={[themedStyles.inputGroup, { flex: 1 }]}>
                  <Text style={themedStyles.label}>Last Name</Text>
                  <View style={themedStyles.inputWrapperCompact}>
                    <TextInput
                      style={themedStyles.input}
                      placeholder="Doe"
                      placeholderTextColor={TEXT_MUTED}
                      value={lastName}
                      onChangeText={setLastName}
                      selectionColor={PRIMARY}
                      cursorColor={PRIMARY}
                      underlineColorAndroid="transparent"
                    />
                  </View>
                </View>
              </View>

              <View style={themedStyles.inputGroupCompact}>
                <Text style={themedStyles.label}>Middle Name (Optional)</Text>
                <View style={themedStyles.inputWrapperCompact}>
                  <TextInput
                    style={themedStyles.input}
                    placeholder="Quincy"
                    placeholderTextColor={TEXT_MUTED}
                    value={middleName}
                    onChangeText={setMiddleName}
                    selectionColor={PRIMARY}
                    cursorColor={PRIMARY}
                    underlineColorAndroid="transparent"
                  />
                </View>
              </View>
            </>
          )}

          <View style={isLogin ? themedStyles.inputGroup : themedStyles.inputGroupCompact}>
            <Text style={themedStyles.label}>Email Address</Text>
            <View style={isLogin ? themedStyles.inputWrapper : themedStyles.inputWrapperCompact}>
              <Ionicons name="mail-outline" size={18} color={TEXT_MUTED} style={themedStyles.icon} />
              <TextInput
                style={themedStyles.input}
                placeholder="name@example.com"
                placeholderTextColor={TEXT_MUTED}
                value={email}
                autoCapitalize="none"
                keyboardType="email-address"
                onChangeText={setEmail}
                selectionColor={PRIMARY}
                cursorColor={PRIMARY}
                underlineColorAndroid="transparent"
              />
            </View>
          </View>

          <View style={isLogin ? themedStyles.inputGroup : themedStyles.inputGroupCompact}>
            <Text style={themedStyles.label}>Password</Text>
            <View style={isLogin ? themedStyles.inputWrapper : themedStyles.inputWrapperCompact}>
              <Ionicons name="lock-closed-outline" size={18} color={TEXT_MUTED} style={themedStyles.icon} />
              <TextInput
                style={themedStyles.input}
                placeholder="••••••••"
                placeholderTextColor={TEXT_MUTED}
                value={password}
                secureTextEntry={!showPassword}
                autoCapitalize="none"
                onChangeText={setPassword}
                selectionColor={PRIMARY}
                cursorColor={PRIMARY}
                underlineColorAndroid="transparent"
              />
              <TouchableOpacity onPress={() => setShowPassword(!showPassword)}>
                <Ionicons 
                  name={showPassword ? "eye-off-outline" : "eye-outline"} 
                  size={18} 
                  color={TEXT_MUTED} 
                />
              </TouchableOpacity>
            </View>
          </View>

          {isLogin && (
            <TouchableOpacity
              style={themedStyles.forgotPass}
              onPress={() => {
                setForgotEmail(email.trim());
                setShowForgotModal(true);
              }}
            >
              <Text style={themedStyles.forgotText}>Forgot password?</Text>
            </TouchableOpacity>
          )}

          <Animated.View style={animatedButtonStyle}>
            <TouchableOpacity 
              style={themedStyles.primaryButton}
              onPress={isLogin ? handleSignIn : handleSignUp}
              disabled={loading}
            >
              {loading ? (
                <ActivityIndicator color={colors.white} />
              ) : (
                <Text style={themedStyles.buttonText}>{isLogin ? 'Sign In' : 'Create Account'}</Text>
              )}
            </TouchableOpacity>
          </Animated.View>

        </Animated.View>

        {/* Footer */}
        <Animated.View 
          entering={FadeInUp.delay(600)}
          style={[themedStyles.footer, !isLogin && { marginTop: 20 }]}
        >
          <Text style={themedStyles.footerText}>
            {isLogin ? "Don't have an account?" : "Already have an account?"}
          </Text>
          <TouchableOpacity onPress={() => setIsLogin(!isLogin)}>
            <Text style={themedStyles.footerLink}>
              {isLogin ? ' Register Now' : ' Sign In'}
            </Text>
          </TouchableOpacity>
        </Animated.View>
      </View>
    </KeyboardAwareScrollView>
  );
}

const styles = (colors, isDark, PRIMARY, SECONDARY, ACCENT, BG_COLOR, CARD_BG, TEXT_LIGHT, TEXT_MUTED, BORDER) => StyleSheet.create({
  container: {
    flex: 1,
    backgroundColor: BG_COLOR,
  },
  scrollContent: {
    flexGrow: 1,
    justifyContent: 'center',
  },
  bgDecor: {
    position: 'absolute',
    top: 0,
    left: 0,
    right: 0,
    height: height * 0.4,
  },
  main: {
    paddingHorizontal: 24,
    paddingBottom: 40,
    width: '100%',
  },
  header: {
    alignItems: 'center',
    marginBottom: 40,
  },
  headerCompact: {
    marginBottom: 20,
  },
  logoCircle: {
    width: 80,
    height: 80,
    borderRadius: 40,
    backgroundColor: colors.border,
    justifyContent: 'center',
    alignItems: 'center',
    borderWidth: 1,
    borderColor: colors.border,
    marginBottom: 20,
  },
  logoCircleSmall: {
    width: 50,
    height: 50,
    borderRadius: 25,
    marginBottom: 10,
  },
  welcomeText: {
    fontSize: 32,
    fontWeight: '800',
    color: !isDark ? colors.text : colors.white,
    textAlign: 'center',
    marginBottom: 8,
    textShadowColor: colors.border,
    textShadowOffset: { width: 0, height: 2 },
    textShadowRadius: 4,
  },
  welcomeTextSmall: {
    fontSize: 24,
    marginBottom: 4,
  },
  subText: {
    fontSize: 16,
    color: !isDark ? colors.subtext : colors.text,
    textAlign: 'center',
    paddingHorizontal: 20,
  },
  card: {
    backgroundColor: CARD_BG,
    borderRadius: 24,
    padding: 24,
    shadowColor: colors.black,
    shadowOffset: { width: 0, height: 10 },
    shadowOpacity: 0.1,
    shadowRadius: 20,
    elevation: 10,
    borderWidth: !isDark ? 1 : 0,
    borderColor: colors.border,
  },
  row: {
    flexDirection: 'row',
    alignItems: 'center',
  },
  inputGroup: {
    marginBottom: 20,
  },
  inputGroupCompact: {
    marginBottom: 12,
  },
  label: {
    fontSize: 13,
    fontWeight: '600',
    color: TEXT_LIGHT,
    marginBottom: 6,
    marginLeft: 4,
  },
  inputWrapper: {
    flexDirection: 'row',
    alignItems: 'center',
    backgroundColor: colors.cardHighlight,
    borderRadius: 16,
    paddingHorizontal: 16,
    height: 56,
    borderWidth: 1,
    borderColor: !isDark ? colors.border : colors.transparent,
  },
  inputWrapperCompact: {
    flexDirection: 'row',
    alignItems: 'center',
    backgroundColor: colors.cardHighlight,
    borderRadius: 12,
    paddingHorizontal: 12,
    height: 48,
    borderWidth: 1,
    borderColor: !isDark ? colors.border : colors.transparent,
  },
  icon: {
    marginRight: 12,
  },
  input: {
    flex: 1,
    color: TEXT_LIGHT,
    fontSize: 16,
    fontWeight: '500',
    paddingVertical: 10,
    outlineStyle: 'none', // Remove focus outline on web
  },
  forgotPass: {
    alignSelf: 'flex-end',
    marginBottom: 24,
  },
  forgotText: {
    color: PRIMARY,
    fontSize: 14,
    fontWeight: '600',
  },
  primaryButton: {
    backgroundColor: PRIMARY,
    height: 56,
    borderRadius: 16,
    justifyContent: 'center',
    alignItems: 'center',
    shadowColor: PRIMARY,
    shadowOffset: { width: 0, height: 4 },
    shadowOpacity: 0.3,
    shadowRadius: 8,
    elevation: 4,
  },
  buttonText: {
    color: colors.white,
    fontSize: 18,
    fontWeight: 'bold',
  },
  footer: {
    flexDirection: 'row',
    justifyContent: 'center',
    marginTop: 40,
  },
  footerText: {
    color: TEXT_MUTED,
    fontSize: 15,
  },
  footerLink: {
    color: PRIMARY,
    fontSize: 15,
    fontWeight: '700',
  },

  forgotOverlay: {
    flex: 1,
    backgroundColor: colors.cardHighlight,
    justifyContent: "center",
    padding: 24,
  },
  forgotCard: {
    backgroundColor: CARD_BG,
    borderRadius: 16,
    padding: 16,
    borderWidth: 1,
    borderColor: BORDER,
  },
  forgotTitle: {
    color: TEXT_LIGHT,
    fontSize: 18,
    fontWeight: "800",
    marginBottom: 6,
  },
  forgotBody: {
    color: TEXT_MUTED,
    fontSize: 14,
    marginBottom: 12,
    lineHeight: 20,
  },
  forgotInput: {
    borderWidth: 1,
    borderColor: BORDER,
    borderRadius: 12,
    paddingHorizontal: 12,
    height: 48,
    color: TEXT_LIGHT,
    marginBottom: 12,
    outlineStyle: "none",
  },
  forgotActions: {
    flexDirection: "row",
    justifyContent: "flex-end",
    gap: 10,
  },
  forgotCancel: {
    borderWidth: 1,
    borderColor: BORDER,
    borderRadius: 10,
    paddingHorizontal: 14,
    paddingVertical: 9,
  },
  forgotCancelText: {
    color: TEXT_LIGHT,
    fontWeight: "600",
  },
  forgotSend: {
    backgroundColor: PRIMARY,
    borderRadius: 10,
    paddingHorizontal: 14,
    paddingVertical: 9,
  },
  forgotSendText: {
    color: colors.white,
    fontWeight: "700",
  }
});
