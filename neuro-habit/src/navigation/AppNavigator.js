import React from "react";
import { View } from "react-native";
import { createBottomTabNavigator } from "@react-navigation/bottom-tabs";
import { Ionicons } from "@expo/vector-icons";
import DashboardScreen from "../screens/DashboardScreen";
import InsightsScreen from "../screens/InsightsScreen";
import SettingsScreen from "../screens/SettingsScreen";
import HabitScreen from "../screens/HabitScreen";
import MoodScreen from "../screens/MoodScreen";
import { useTheme } from "../context/ThemeContext";
import OfflineStatusBar from "../components/OfflineStatusBar";

const Tab = createBottomTabNavigator();

export default function AppNavigator() {
  const { theme: colors } = useTheme();

  return (
    <View style={{ flex: 1 }}>
      {/* Global offline/online status banner — visible on all tabs */}
      <OfflineStatusBar />

      <Tab.Navigator
        screenOptions={({ route }) => ({
          headerShown: false,
          animation: "none",
          tabBarIcon: ({ focused, color, size }) => {
            let iconName;
            if (route.name === "Dashboard") {
              iconName = focused ? "home" : "home-outline";
            } else if (route.name === "Insights") {
              iconName = focused ? "bulb" : "bulb-outline";
            } else if (route.name === "Habits") {
              iconName = focused ? "checkbox" : "checkbox-outline";
            } else if (route.name === "Mood") {
              iconName = focused ? "happy" : "happy-outline";
            } else if (route.name === "Settings") {
              iconName = focused ? "settings" : "settings-outline";
            }
            return <Ionicons name={iconName} size={size} color={color} />;
          },
          tabBarActiveTintColor: colors.primary,
          tabBarInactiveTintColor: colors.subtext,
          tabBarStyle: {
            backgroundColor: colors.card,
            borderTopWidth: 1,
            borderTopColor: colors.border,
            paddingBottom: 5,
            paddingTop: 5,
            height: 65,
          },
          tabBarLabelStyle: {
            fontSize: 10,
            fontWeight: "600",
          },
        })}
      >
        <Tab.Screen name="Dashboard" component={DashboardScreen} />
        <Tab.Screen name="Habits" component={HabitScreen} />
        <Tab.Screen name="Mood" component={MoodScreen} />
        <Tab.Screen name="Insights" component={InsightsScreen} />
        <Tab.Screen name="Settings" component={SettingsScreen} />
      </Tab.Navigator>
    </View>
  );
}
