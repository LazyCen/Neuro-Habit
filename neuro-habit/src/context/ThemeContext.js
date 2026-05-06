import React, { createContext, useState, useContext, useCallback, useMemo } from 'react';
import { darkColors, lightColors } from '../theme/colors';

const ThemeContext = createContext();

export const ThemeProvider = ({ children }) => {
  const [isDark, setIsDark] = useState(false); // Default to light theme

  // Stable reference — does not change between renders
  const toggleTheme = useCallback(() => {
    setIsDark((prev) => !prev);
  }, []);

  // Memoized value — new object reference only when isDark changes
  const value = useMemo(
    () => ({
      isDark,
      toggleTheme,
      theme: isDark ? darkColors : lightColors,
    }),
    [isDark, toggleTheme]
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
