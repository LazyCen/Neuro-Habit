import React, { useEffect } from 'react';
import { StyleSheet, View, Dimensions, Text } from 'react-native';
import Animated, { 
  useSharedValue, 
  useAnimatedStyle, 
  withRepeat, 
  withTiming, 
  withSequence,
  Easing,
  interpolate
} from 'react-native-reanimated';

import { useTheme } from '../context/ThemeContext';
import Svg, { Circle, Defs, LinearGradient, Stop } from 'react-native-svg';

const { width, height } = Dimensions.get('window');

export default function Preloader() {
  const { theme, isDark } = useTheme();
  const pulse = useSharedValue(1);
  const rotation = useSharedValue(0);
  const opacity = useSharedValue(0);
  const glowPulse = useSharedValue(1);

  useEffect(() => {
    // Fade in
    opacity.value = withTiming(1, { duration: 800 });

    // Pulse animation for logo
    pulse.value = withRepeat(
      withSequence(
        withTiming(1.05, { duration: 1500, easing: Easing.bezier(0.4, 0, 0.2, 1) }),
        withTiming(1, { duration: 1500, easing: Easing.bezier(0.4, 0, 0.2, 1) })
      ),
      -1,
      true
    );

    // Faster breathing animation for glow
    glowPulse.value = withRepeat(
      withSequence(
        withTiming(1.6, { duration: 1200, easing: Easing.inOut(Easing.sin) }),
        withTiming(0.9, { duration: 1200, easing: Easing.inOut(Easing.sin) })
      ),
      -1,
      true
    );

    // Continuous rotation
    rotation.value = withRepeat(
      withTiming(360, { duration: 3000, easing: Easing.linear }),
      -1,
      false
    );
  }, [glowPulse, opacity, pulse, rotation]);

  const animatedLogoStyle = useAnimatedStyle(() => ({
    transform: [{ scale: pulse.value }],
    opacity: opacity.value,
  }));

  const animatedGlowStyle = useAnimatedStyle(() => ({
    transform: [{ scale: glowPulse.value }],
    opacity: interpolate(glowPulse.value, [0.9, 1.6], [0.1, 0.4]),
  }));

  const animatedGlowSecondaryStyle = useAnimatedStyle(() => ({
    transform: [{ scale: glowPulse.value * 1.3 }],
    opacity: interpolate(glowPulse.value, [0.9, 1.6], [0.05, 0.15]),
  }));

  const animatedBackgroundStyle = useAnimatedStyle(() => ({
    opacity: opacity.value,
  }));

  return (
    <View style={[styles.container, { backgroundColor: theme.background }]}>
      {/* Premium Background */}
      <Animated.View style={[StyleSheet.absoluteFill, animatedBackgroundStyle]}>
        <Svg height={height} width={width}>
          <Defs>
            <LinearGradient id="bgGrad" x1="0%" y1="0%" x2="100%" y2="100%">
              <Stop offset="0%" stopColor={theme.background} stopOpacity="1" />
              <Stop offset="100%" stopColor={isDark ? theme.black : theme.white} stopOpacity="1" />
            </LinearGradient>
            <LinearGradient id="accentGrad" x1="0%" y1="0%" x2="100%" y2="100%">
              <Stop offset="0%" stopColor={theme.primary} stopOpacity={isDark ? "0.15" : "0.08"} />
              <Stop offset="100%" stopColor={theme.secondary} stopOpacity={isDark ? "0.05" : "0.03"} />
            </LinearGradient>
          </Defs>
          <Circle cx={width / 2} cy={height / 2} r={width * 0.8} fill="url(#bgGrad)" />
          <Circle cx={width * 0.8} cy={height * 0.2} r={width * 0.4} fill="url(#accentGrad)" />
          <Circle cx={width * 0.2} cy={height * 0.8} r={width * 0.3} fill="url(#accentGrad)" opacity="0.5" />
        </Svg>
      </Animated.View>

      <View style={styles.content}>
        {/* Logo Section */}
        <Animated.View style={[styles.logoContainer, animatedLogoStyle]}>
          <Animated.View style={[styles.glow, animatedGlowSecondaryStyle, { backgroundColor: theme.secondary }]} />
          <Animated.View style={[styles.glow, animatedGlowStyle, { backgroundColor: theme.primary }]} />
          <View style={[styles.iconCircle, { 
            backgroundColor: isDark ? theme.background : theme.white,
            borderColor: isDark ? theme.primary + '4D' : 'transparent',
            shadowColor: theme.primary,
            shadowOpacity: isDark ? 0.5 : 0,
            elevation: isDark ? 10 : 0,
          }]}>
            <Animated.Image 
              source={
                isDark
                  ? require('../../assets/images/icon.png')
                  : require('../../assets/images/icon-light.png')
              }
              style={{ width: '100%', height: '100%' }}
              resizeMode="contain"
            />
          </View>
        </Animated.View>


      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  container: {
    flex: 1,
    justifyContent: 'center',
    alignItems: 'center',
  },
  content: {
    alignItems: 'center',
    zIndex: 10,
  },
  logoContainer: {
    width: 150,
    height: 150,
    justifyContent: 'center',
    alignItems: 'center',
  },
  iconCircle: {
    width: 130,
    height: 130,
    borderRadius: 65,
    justifyContent: 'center',
    alignItems: 'center',
    borderWidth: 0,
    overflow: 'hidden',
    shadowOffset: { width: 0, height: 0 },
    shadowOpacity: 0,
    shadowRadius: 20,
    elevation: 0,
  },
  glow: {
    position: 'absolute',
    width: 170,
    height: 170,
    borderRadius: 85,
    opacity: 0.1,
  },
  title: {
    fontSize: 28,
    fontWeight: '900',
    letterSpacing: 4,
    marginBottom: 8,
    textShadowOffset: { width: 0, height: 0 },
    textShadowRadius: 10,
  },
  subtitle: {
    fontSize: 14,
    letterSpacing: 1.5,
    fontWeight: '500',
  },
});

