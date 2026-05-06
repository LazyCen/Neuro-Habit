import * as Notifications from 'expo-notifications';
import { Platform } from 'react-native';
import { darkColors } from '../theme/colors';

const STREAK_RISK_TYPE = 'streak-risk-reminder';

Notifications.setNotificationHandler({
  handleNotification: async () => ({
    shouldShowAlert: true,
    shouldPlaySound: true,
    shouldSetBadge: false,
  }),
});

export const notificationService = {
  async registerForPushNotificationsAsync() {
    let token;
    if (Platform.OS === 'android') {
      await Notifications.setNotificationChannelAsync('default', {
        name: 'default',
        importance: Notifications.AndroidImportance.MAX,
        vibrationPattern: [0, 250, 250, 250],
        lightColor: darkColors.primary,
      });
    }

    const { status: existingStatus } = await Notifications.getPermissionsAsync();
    let finalStatus = existingStatus;
    if (existingStatus !== 'granted') {
      const { status } = await Notifications.requestPermissionsAsync();
      finalStatus = status;
    }
    if (finalStatus !== 'granted') {
      return;
    }
    
    // Get token for push notifications (if using Expo push service)
    // token = (await Notifications.getExpoPushTokenAsync()).data;
    // return token;
  },

  async scheduleReminder(title, body, triggerTime = { hour: 20, minute: 0, repeats: true }) {
    await Notifications.scheduleNotificationAsync({
      content: {
        title: title || "Time to log your day! 📝",
        body: body || "Reflect on your habits and mood to stay on track.",
      },
      trigger: triggerTime,
    });
  },

  async scheduleSmartReminder(userData) {
    // Smart logic: if habits are low, send a motivational reminder
    if (userData.habitsCompleted < userData.habitsTotal) {
      await this.scheduleReminder(
        "You're so close! ✨",
        `Only ${userData.habitsTotal - userData.habitsCompleted} habits left to hit your goal today.`
      );
    } else if (userData.steps < 5000) {
      await this.scheduleReminder(
        "A little push? 🚶",
        "You're currently at " + userData.steps + " steps. A quick walk would feel great!"
      );
    }
  },

  async cancelStreakRiskReminder() {
    const scheduled = await Notifications.getAllScheduledNotificationsAsync();
    const target = scheduled.filter(
      (item) => item?.content?.data?.type === STREAK_RISK_TYPE
    );
    await Promise.all(
      target.map((item) => Notifications.cancelScheduledNotificationAsync(item.identifier))
    );
  },

  async scheduleStreakRiskReminder(habitsCompleted, habitsTotal) {
    if (Platform.OS === 'web') return;

    const hasRisk = habitsTotal > 0 && habitsCompleted < habitsTotal;
    if (!hasRisk) {
      await this.cancelStreakRiskReminder();
      return;
    }

    await this.cancelStreakRiskReminder();

    const now = new Date();
    const triggerDate = new Date();
    triggerDate.setHours(20, 0, 0, 0);
    if (triggerDate <= now) {
      triggerDate.setDate(triggerDate.getDate() + 1);
    }

    const remaining = Math.max(0, habitsTotal - habitsCompleted);
    await Notifications.scheduleNotificationAsync({
      content: {
        title: 'Streak at risk! 🔥',
        body:
          remaining > 0
            ? `Complete ${remaining} more habit${remaining === 1 ? '' : 's'} to protect your streak.`
            : 'Log your habits today to protect your streak.',
        data: { type: STREAK_RISK_TYPE },
      },
      trigger: triggerDate,
    });
  }
};
