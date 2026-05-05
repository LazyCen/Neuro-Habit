import React, { useState, useRef } from 'react';
import { 
  StyleSheet, 
  View, 
  Text, 
  TouchableOpacity, 
  Dimensions,
  FlatList,
  Platform
} from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import Animated, { FadeInDown, FadeInRight, FadeOutLeft } from 'react-native-reanimated';
import { supabase } from '../services/supabaseClient';
import { useAuth } from '../context/AuthContext';
import { useTheme } from '../context/ThemeContext';
import PremiumBackground from '../components/PremiumBackground';

const { width } = Dimensions.get('window');

const SLIDES = [
  {
    id: '1',
    title: 'Welcome to Neuro Habit',
    description: 'Track your digital habits and improve your lifestyle with intelligent insights.',
    icon: 'analytics'
  },
  {
    id: '2',
    title: 'Gain Insights',
    description: 'Understand how you spend your time with detailed analytics and tracking.',
    icon: 'pie-chart'
  },
  {
    id: '3',
    title: 'Stay Mindful',
    description: 'Get personalized suggestions and build better, healthier habits over time.',
    icon: 'leaf'
  }
];

export default function TutorialScreen() {
  const { theme: colors, isDark } = useTheme();
  const [currentIndex, setCurrentIndex] = useState(0);
  const [loading, setLoading] = useState(false);
  const flatListRef = useRef(null);
  const themedStyles = styles(colors, isDark);

  const handleNext = () => {
    if (currentIndex < SLIDES.length - 1) {
      flatListRef.current?.scrollToIndex({
        index: currentIndex + 1,
        animated: true,
      });
      setCurrentIndex(currentIndex + 1);
    } else {
      completeTutorial();
    }
  };

  const completeTutorial = async () => {
    setLoading(true);
    try {
      const { error } = await supabase.auth.updateUser({
        data: { tutorial_completed: true }
      });
      if (error) throw error;
    } catch (error) {
      console.error('Error completing tutorial:', error.message);
    } finally {
      setLoading(false);
    }
  };

  const renderItem = ({ item }) => {
    return (
      <View style={[themedStyles.slide, { width }]}>
        <Animated.View 
          entering={FadeInDown.duration(800).springify()}
          style={themedStyles.content}
        >
          <View style={themedStyles.iconContainer}>
            <Ionicons name={item.icon} size={80} color={colors.primary} />
          </View>
          
          <Text style={themedStyles.title}>{item.title}</Text>
          <Text style={themedStyles.subtitle}>
            {item.description}
          </Text>
        </Animated.View>
      </View>
    );
  };

  return (
    <View style={themedStyles.container}>
      <PremiumBackground />
      
      <View style={themedStyles.header}>
        <TouchableOpacity 
          style={themedStyles.skipButton}
          onPress={completeTutorial}
          disabled={loading}
        >
          <Text style={themedStyles.skipText}>Skip</Text>
        </TouchableOpacity>
      </View>

      <FlatList
        ref={flatListRef}
        data={SLIDES}
        renderItem={renderItem}
        horizontal
        showsHorizontalScrollIndicator={false}
        pagingEnabled
        bounces={false}
        onMomentumScrollEnd={(event) => {
          const index = Math.round(event.nativeEvent.contentOffset.x / width);
          setCurrentIndex(index);
        }}
        keyExtractor={(item) => item.id}
      />

      <View style={themedStyles.footer}>
        <View style={themedStyles.pagination}>
          {SLIDES.map((_, index) => (
            <View 
              key={index} 
              style={[
                themedStyles.dot, 
                currentIndex === index && themedStyles.dotActive
              ]} 
            />
          ))}
        </View>

        <TouchableOpacity 
          style={[themedStyles.button, loading && themedStyles.buttonDisabled]}
          onPress={handleNext}
          disabled={loading}
        >
          <Text style={themedStyles.buttonText}>
            {currentIndex === SLIDES.length - 1 ? 'Get Started' : 'Next'}
          </Text>
        </TouchableOpacity>
      </View>
    </View>
  );
}

const styles = (colors, isDark) => StyleSheet.create({
  container: {
    flex: 1,
    backgroundColor: colors.background,
  },
  header: {
    paddingTop: Platform.OS === 'ios' ? 60 : 40,
    paddingHorizontal: 24,
    flexDirection: 'row',
    justifyContent: 'flex-end',
    zIndex: 10,
  },
  skipButton: {
    padding: 8,
  },
  skipText: {
    color: colors.subtext,
    fontSize: 16,
    fontWeight: '600',
  },
  slide: {
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
    shadowColor: '#000',
    shadowOffset: { width: 0, height: 10 },
    shadowOpacity: 0.2,
    shadowRadius: 20,
    elevation: 10,
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
    marginBottom: 16,
  },
  subtitle: {
    fontSize: 16,
    color: colors.subtext,
    textAlign: 'center',
    lineHeight: 24,
  },
  footer: {
    padding: 24,
    paddingBottom: Platform.OS === 'ios' ? 40 : 24,
  },
  pagination: {
    flexDirection: 'row',
    justifyContent: 'center',
    marginBottom: 24,
  },
  dot: {
    width: 8,
    height: 8,
    borderRadius: 4,
    backgroundColor: colors.border,
    marginHorizontal: 4,
  },
  dotActive: {
    width: 24,
    backgroundColor: colors.primary,
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
    color: 'white',
    fontSize: 18,
    fontWeight: 'bold',
  },
});
