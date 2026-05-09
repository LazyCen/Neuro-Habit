import React, { createContext, useState, useContext, useCallback, useMemo, useEffect } from 'react';
import AsyncStorage from '@react-native-async-storage/async-storage';
import { darkColors, lightColors } from '../theme/colors';

const THEME_STORAGE_KEY = 'user_theme_preference';
const ThemeContext = createContext();

export const ThemeProvider = ({ children }) => {
  const [isDark, setIsDark] = useState(false);
  const [isLoaded, setIsLoaded] = useState(false);

  // Load theme preference on mount
  useEffect(() => {
    const loadTheme = async () => {
      try {
        const savedTheme = await AsyncStorage.getItem(THEME_STORAGE_KEY);
        if (savedTheme !== null) {
          setIsDark(savedTheme === 'dark');
        }
      } catch (error) {
        console.error('Failed to load theme preference:', error);
      } finally {
        setIsLoaded(true);
      }
    };
    loadTheme();
  }, []);

  // Save theme preference when it changes
  const toggleTheme = useCallback(async () => {
    setIsDark((prev) => {
      const newVal = !prev;
      AsyncStorage.setItem(THEME_STORAGE_KEY, newVal ? 'dark' : 'light').catch(err => 
        console.error('Failed to save theme preference:', err)
      );
      return newVal;
    });
  }, []);

  const value = useMemo(
    () => ({
      isDark,
      toggleTheme,
      theme: isDark ? darkColors : lightColors,
      isLoaded,
    }),
    [isDark, toggleTheme, isLoaded]
  );

  return (
    <ThemeContext.Provider value={value}>
      {children}
    </ThemeContext.Provider>
  );
};

export const useTheme = () => {
  const context = useContext(ThemeContext);
  if (!context) {
    throw new Error('useTheme must be used within a ThemeProvider');
  }
  return context;
};

