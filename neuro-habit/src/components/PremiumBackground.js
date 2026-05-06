import React from 'react';
import { StyleSheet, View, Dimensions } from 'react-native';
import Svg, { Circle, Defs, LinearGradient, Stop } from 'react-native-svg';
import { useTheme } from '../context/ThemeContext';

const { width, height } = Dimensions.get('window');

export default function PremiumBackground() {
  const { theme: colors } = useTheme();
  const themedStyles = styles(colors);

  return (
    <View style={themedStyles.container}>
      <Svg height={height} width={width} style={StyleSheet.absoluteFill}>
        <Defs>
          <LinearGradient id="gradPrimary" x1="0%" y1="0%" x2="100%" y2="100%">
            <Stop offset="0%" stopColor={colors.primary} stopOpacity="0.15" />
            <Stop offset="100%" stopColor={colors.secondary} stopOpacity="0.05" />
          </LinearGradient>
          <LinearGradient id="gradSecondary" x1="0%" y1="0%" x2="100%" y2="100%">
            <Stop offset="0%" stopColor={colors.secondary} stopOpacity="0.1" />
            <Stop offset="100%" stopColor={colors.accent} stopOpacity="0.02" />
          </LinearGradient>
        </Defs>
        
        {/* Subtle background circles for depth */}
        <Circle 
          cx={width * 0.9} 
          cy={height * 0.1} 
          r={width * 0.5} 
          fill="url(#gradPrimary)" 
          opacity="0.5" 
        />
        <Circle 
          cx={width * 0.1} 
          cy={height * 0.8} 
          r={width * 0.4} 
          fill="url(#gradSecondary)" 
          opacity="0.3" 
        />
        
        {/* Extra glow effects */}
        <Circle 
          cx={width * 0.5} 
          cy={height * 0.4} 
          r={width * 0.6} 
          fill={colors.primary} 
          opacity="0.03" 
        />
      </Svg>
    </View>
  );
}

const styles = (colors) => StyleSheet.create({
  container: {
    ...StyleSheet.absoluteFillObject,
    backgroundColor: colors.background,
    zIndex: -1,
  },
});
