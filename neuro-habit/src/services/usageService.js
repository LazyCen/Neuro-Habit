import { Platform, Linking } from 'react-native';
import { Pedometer, Accelerometer } from 'expo-sensors';

let UsageStats = null;
let HealthConnect = null;
let GoogleFit = null;
try {
  UsageStats = Platform.OS === 'android' ? require('@antardev/react-native-usage-stats').default : null;
} catch (_e) {
  console.warn('UsageStats native module not available.');
}

const ANDROID_VERSION_PIE = 28; // Android 9.0
const ANDROID_VERSION_UPSIDE_DOWN_CAKE = 34; // Android 14

try {
  if (Platform.OS === 'android' && Platform.Version >= ANDROID_VERSION_PIE) {
    HealthConnect = require('react-native-health-connect');
  }
} catch (_e) {
  console.warn('Health Connect module not available.');
}

try {
  if (Platform.OS === 'android') {
    GoogleFit = require('react-native-google-fit').default || require('react-native-google-fit');
  }
} catch (_e) {
  console.warn('Google Fit module not available.');
}

// Health Connect SDK availability status codes
// SDK_AVAILABLE = 3, SDK_UNAVAILABLE = 1, SDK_UNAVAILABLE_PROVIDER_UPDATE_REQUIRED = 2
const HC_SDK_AVAILABLE = 3;

const INTERVAL_DAILY = 0;
const ACCELEROMETER_UPDATE_INTERVAL_MS = 100;
const STEP_THRESHOLD = 1.2;
const MIN_STEP_INTERVAL_MS = 300;
const GRAVITY_EARTH = 9.81;

async function isGoogleFitInstalled() {
    if (Platform.OS !== 'android') return false;
    try {
      return await Linking.canOpenURL('googlefit://');
    } catch (_e) {
      return false;
    }
  }

export const usageService = {
  async getStepProviderStatus() {
    const isAndroid = Platform.OS === 'android';
    const sdkVersion = isAndroid ? Platform.Version : 0;
    
    const status = {
      isHealthConnectSupported: isAndroid && sdkVersion >= ANDROID_VERSION_PIE,
      hasHealthConnect: false,
      hasGoogleFit: false,
      hasAnyProvider: false,
      recommendedInstall: 'Health Connect',
    };

    if (!isAndroid) {
      status.hasAnyProvider = true;
      return status;
    }

    if (status.isHealthConnectSupported && HealthConnect) {
      try {
        if (typeof HealthConnect.getSdkStatus === 'function') {
          const sdkStatus = await HealthConnect.getSdkStatus();
          // SDK_AVAILABLE = 3
          status.hasHealthConnect = sdkStatus === HC_SDK_AVAILABLE;
        } else if (typeof HealthConnect.initialize === 'function') {
          // Some builds expose initialize() directly without getSdkStatus
          const initialized = await HealthConnect.initialize();
          status.hasHealthConnect = initialized === true;
        }
      } catch (_e) {
        console.warn('Health Connect status check failed:', _e?.message);
        status.hasHealthConnect = false;
      }
    }

    status.hasGoogleFit = Boolean(GoogleFit) || await isGoogleFitInstalled();
    status.hasAnyProvider = status.hasHealthConnect || status.hasGoogleFit;
    status.recommendedInstall = status.isHealthConnectSupported ? 'Health Connect' : 'Google Fit';
    
    // Check if already authorized (silently)
    status.isAuthorized = await this.hasStepPermission();
    
    return status;
  },

  async hasStepPermission() {
    if (Platform.OS !== 'android') {
      return await this.hasPedometerPermission();
    }

    // Android: check Health Connect then Google Fit
    if (HealthConnect && Platform.Version >= ANDROID_VERSION_PIE) {
      try {
        const granted = typeof HealthConnect.getGrantedPermissions === 'function'
          ? await HealthConnect.getGrantedPermissions()
          : [];
        if (Array.isArray(granted) && granted.some(p => (p.recordType === 'Steps' || p.recordType === 'steps'))) {
          return true;
        }
      } catch (_e) {}
    }

    if (GoogleFit) {
      try {
        if (typeof GoogleFit.checkIsAuthorized === 'function') {
          await GoogleFit.checkIsAuthorized();
          return GoogleFit.isAuthorized === true;
        }
      } catch (_e) {}
    }

    return false;
  },

  async requestStepPermissions() {
    const status = await this.getStepProviderStatus();
    let healthConnectGranted = false;
    let googleFitGranted = false;

    if (status.isHealthConnectSupported && status.hasHealthConnect && HealthConnect?.initialize && HealthConnect?.requestPermission) {
      try {
        const initialized = await HealthConnect.initialize();
        if (initialized) {
          const granted = await HealthConnect.requestPermission([
            { accessType: 'read', recordType: 'Steps' },
          ]);
          healthConnectGranted = Array.isArray(granted)
            && granted.some((item) => item?.recordType === 'Steps' && item?.accessType === 'read');
        }
      } catch (_e) {
        healthConnectGranted = false;
      }
    }

    if (status.hasGoogleFit && GoogleFit?.authorize) {
      try {
        const authResult = await GoogleFit.authorize({
          scopes: ['activity'],
        });
        googleFitGranted = authResult?.success === true || authResult === true;
      } catch (_e) {
        googleFitGranted = false;
      }
    }

    return {
      ...status,
      healthConnectGranted,
      googleFitGranted,
      granted: healthConnectGranted || googleFitGranted,
    };
  },

  async hasPedometerPermission() {
    if (!Pedometer?.isAvailableAsync) return false;
    try {
      const isAvailable = await Pedometer.isAvailableAsync();
      if (!isAvailable) return false;

      if (typeof Pedometer.getPermissionsAsync === 'function') {
        const permission = await Pedometer.getPermissionsAsync();
        return permission?.granted === true;
      }

      return true;
    } catch (_e) {
      return false;
    }
  },

  async requestPedometerPermission() {
    if (!Pedometer?.isAvailableAsync) return false;
    try {
      const isAvailable = await Pedometer.isAvailableAsync();
      if (!isAvailable) return false;

      if (typeof Pedometer.requestPermissionsAsync === 'function') {
        const permission = await Pedometer.requestPermissionsAsync();
        return permission?.granted === true;
      }

      return true;
    } catch (e) {
      console.error('Pedometer permission error:', e);
      return false;
    }
  },

  async hasPermission() {
    if (Platform.OS !== 'android' || !UsageStats) return false;
    try {
      return UsageStats.isPermissionGranted();
    } catch (_e) {
      return false;
    }
  },

  async requestPermission() {
    if (Platform.OS !== 'android' || !UsageStats) return;
    try {
      UsageStats.requestPermission();
    } catch (e) {
      console.error('Usage Stats permission error:', e);
    }
  },

  async getDailyScreenTime() {
    if (Platform.OS !== 'android' || !UsageStats) return 0;

    try {
      const hasPerm = await this.hasPermission();
      if (!hasPerm) {
        return 0;
      }

      const now = new Date();
      const startOfDay = new Date(now.getFullYear(), now.getMonth(), now.getDate());
      
      // Get usage for the day
      let stats = await UsageStats.queryUsageStats({
        startTime: startOfDay.getTime(),
        endTime: now.getTime(),
        interval: INTERVAL_DAILY,
      });

      // Some devices return empty arrays for this query; use aggregate API as fallback.
      if (!Array.isArray(stats) || stats.length === 0) {
        const aggregateMap = await UsageStats.queryAndAggregateUsageStats({
          startTime: startOfDay.getTime(),
          endTime: now.getTime(),
        });
        stats = aggregateMap ? Object.values(aggregateMap) : [];
      }

      // Sum up total time in foreground (in milliseconds)
      let totalMs = 0;
      if (stats && Array.isArray(stats)) {
        stats.forEach(app => {
          totalMs += (app.totalTimeInForeground || 0);
        });
      }

      // Convert to hours
      return parseFloat((totalMs / (1000 * 60 * 60)).toFixed(2));
    } catch (e) {
      console.error('Error fetching usage stats:', e);
      return 0;
    }
  },

  async getDailyStepCount() {
    // Android: use Health Connect as the primary step provider.
    if (Platform.OS === 'android') {
      const now = new Date();
      const startOfDay = new Date(now.getFullYear(), now.getMonth(), now.getDate());

      // Only attempt Health Connect if OS supports it and module loaded
      if (HealthConnect && Platform.Version >= ANDROID_VERSION_PIE) {
        try {
          // FIX: Decouple data retrieval from permission requests.
          // First, check if we already have permission without triggering any initialization side-effects.
          const isAuthorized = await this.hasStepPermission();
          
          if (isAuthorized && typeof HealthConnect.initialize === 'function') {
            const initialized = await HealthConnect.initialize();
            if (initialized && typeof HealthConnect.readRecords === 'function') {
              const result = await HealthConnect.readRecords('Steps', {
                  timeRangeFilter: {
                    operator: 'between',
                    startTime: startOfDay.toISOString(),
                    endTime: now.toISOString(),
                  },
                });

                const records = Array.isArray(result?.records) ? result.records : [];
                const total = records.reduce((sum, record) => {
                  // Health Connect returns 'count' on some versions, 'steps' on others
                  const stepVal = record?.count ?? record?.steps ?? 0;
                  return sum + (Number.isFinite(stepVal) ? stepVal : 0);
                }, 0);
                if (Number.isFinite(total) && total >= 0) {
                  console.log('[Steps] Health Connect returned:', total);
                  return total;
                }
              }
            }
          }
        } catch (_e) {
          console.warn('[Steps] Health Connect fetch failed:', _e?.message);
          // Fall through to Google Fit
        }
      }

      if (GoogleFit) {
        try {
          if (typeof GoogleFit.getDailyStepCountSamples === 'function') {
            const samples = await GoogleFit.getDailyStepCountSamples({
              startDate: startOfDay.toISOString(),
              endDate: now.toISOString(),
            });
            if (Array.isArray(samples)) {
              const total = samples.reduce((sum, sample) => {
                const sampleSteps = Number(sample?.steps || sample?.value || 0);
                return sum + sampleSteps;
              }, 0);
              if (Number.isFinite(total) && total >= 0) {
                return total;
              }
            }
          }

          if (typeof GoogleFit.getSteps === 'function') {
            const steps = await GoogleFit.getSteps(startOfDay.toISOString(), now.toISOString());
            if (Array.isArray(steps)) {
              const total = steps.reduce((sum, item) => sum + Number(item?.value || item?.steps || 0), 0);
              if (Number.isFinite(total) && total >= 0) {
                return total;
              }
            }
          }
        } catch (_e) {
          console.warn('Google Fit daily step fetch failed:', _e);
        }
      }

      // No step data available on Android without Health Connect or Google Fit.
      return 0;
    }

    // iOS: use Pedometer for daily step count
    if (!Pedometer?.isAvailableAsync) return 0;

    try {
      const isAvailable = await Pedometer.isAvailableAsync();
      if (!isAvailable) {
        return 0;
      }

      const hasPerm = await this.hasPedometerPermission();
      if (!hasPerm) {
        return 0;
      }

      const now = new Date();
      const startOfDay = new Date(now.getFullYear(), now.getMonth(), now.getDate());
      const result = await Pedometer.getStepCountAsync(startOfDay, now);
      return Number.isFinite(result?.steps) ? result.steps : 0;
    } catch (e) {
      console.error('Error fetching daily step count:', e);
      return 0;
    }
  },

  // Live step tracking using Pedometer.watchStepCount for real-time updates
  watchLiveSteps(callback) {
    if (Platform.OS !== 'android') {
      console.warn('Live step tracking is only supported on Android.');
      return null;
    }

    if (Pedometer?.watchStepCount) {
      try {
        const subscription = Pedometer.watchStepCount((result) => {
          if (result && Number.isFinite(result.steps)) {
            callback(result.steps);
          }
        });

        return subscription;
      } catch (e) {
        console.warn('Pedometer.watchStepCount unavailable or chip missing, using accelerometer fallback.', e);
      }
    }

    if (!Accelerometer?.addListener || typeof Accelerometer.setUpdateInterval !== 'function') {
      console.warn('Accelerometer fallback is not available for live step tracking.');
      return null;
    }

    Accelerometer.setUpdateInterval(ACCELEROMETER_UPDATE_INTERVAL_MS);
    let lastMagnitude = 0;
    let lastStepTime = 0;
    let stepCount = 0;

    const subscription = Accelerometer.addListener(({ x, y, z }) => {
      const magnitude = Math.sqrt(x * x + y * y + z * z);
      const linearAcceleration = Math.abs(magnitude - GRAVITY_EARTH);
      const now = Date.now();

      const isRisingEdge = linearAcceleration > STEP_THRESHOLD && lastMagnitude <= STEP_THRESHOLD;
      const enoughTimePassed = now - lastStepTime > MIN_STEP_INTERVAL_MS;

      if (isRisingEdge && enoughTimePassed) {
        stepCount += 1;
        lastStepTime = now;
        callback(stepCount);
      }

      lastMagnitude = linearAcceleration;
    });

    return subscription;
  },

  // Stop watching live steps
  stopWatchingLiveSteps(subscription) {
    if (subscription && typeof subscription.remove === 'function') {
      subscription.remove();
    }
  }
};
