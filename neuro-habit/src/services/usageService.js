import { Platform, AppState, Linking } from 'react-native';
import { Pedometer, Accelerometer } from 'expo-sensors';
import AsyncStorage from '@react-native-async-storage/async-storage';

// ---------------------------------------------------------------------------
// Module-level singletons
// ---------------------------------------------------------------------------
let UsageStats = null;
let HealthConnect = null;

/** Emergency kill-switch — set to false once HC proves persistently broken */
let isHealthConnectEnabled = true;
let _hcCrashChecked = false;
let _hcInitPromise = null;
let _hcLock = false;

/** Accumulated live-step delta since the watcher started this session */
let _liveStepAccumulator = 0;
let _liveStepSubscription = null;
let _liveStepStartedAt = null; // Date when we started watching
let _watcherStarting = false;  // Synchronous guard to prevent double-start during async init

// Base step count loaded from AsyncStorage at session start (from last HC sync)
let _baseStepCount = 0;
let _baseStepLoadedAt = null; // Date the base was fetched for
const STORAGE_KEY_BASE_STEPS = '@NeuroHabit:BaseStepCount';
const STORAGE_KEY_BASE_DATE  = '@NeuroHabit:BaseStepDate';

// NOTE: HC crash state is intentionally NOT persisted across sessions.
// isHealthConnectEnabled=false is in-memory only — HC always gets one
// clean attempt per fresh app start.

// ---------------------------------------------------------------------------
// Load native modules safely
// ---------------------------------------------------------------------------
try {
  UsageStats = Platform.OS === 'android'
    ? require('@antardev/react-native-usage-stats').default
    : null;
} catch (_e) {
  console.warn('UsageStats native module not available.');
}

try {
  if (Platform.OS === 'android' && Platform.Version >= 28) {
    HealthConnect = require('react-native-health-connect');
  }
} catch (_e) {
  console.warn('Health Connect module not available.');
}

// HC SDK status codes
const HC_SDK_AVAILABLE = 3;
const INTERVAL_DAILY   = 0;

// Accelerometer-based step detection params (fallback)
const ACCELEROMETER_UPDATE_INTERVAL_MS = 100;
const STEP_THRESHOLD     = 1.2;
const MIN_STEP_INTERVAL_MS = 300;
const GRAVITY_EARTH      = 9.81;

// ---------------------------------------------------------------------------
// Public: reset HC status (for explicit user retry from Settings)
// ---------------------------------------------------------------------------
export async function resetHealthConnectStatus() {
  isHealthConnectEnabled = true;
  _hcInitPromise  = null;
  console.log('[usageService] Health Connect status reset (in-memory).');
}

// ---------------------------------------------------------------------------
// HC client init — singleton promise with re-init support
// ---------------------------------------------------------------------------
async function getHealthConnectClient() {
  if (!HealthConnect || !isHealthConnectEnabled) return null;

  if (_hcInitPromise) return _hcInitPromise;

  _hcInitPromise = (async () => {
    try {
      const status = await HealthConnect.getSdkStatus();
      if (status !== HC_SDK_AVAILABLE) {
        console.warn(`[usageService] HC SDK not available. Status: ${status}`);
        return null;
      }
      console.log('[usageService] Calling HealthConnect.initialize()...');
      const initialized = await HealthConnect.initialize();
      console.log('[usageService] HealthConnect.initialize() result:', initialized);
      if (initialized) {
        // Give the service a moment to fully bind before we call into it
        await new Promise(resolve => setTimeout(resolve, 1500));
        return HealthConnect;
      }
      return null;
    } catch (e) {
      console.warn('[usageService] HC Init failed:', e.message);
      _hcInitPromise = null;
      return null;
    }
  })();

  return _hcInitPromise;
}

// ---------------------------------------------------------------------------
// safeNativeCall — single attempt with binding-error detection
// We no longer retry in a loop here; the caller decides whether to retry.
// ---------------------------------------------------------------------------
async function safeNativeCall(operation) {
  try {
    return await operation();
  } catch (e) {
    const msg = (e?.message || String(e)).toLowerCase();
    const isBindingError =
      msg.includes('binding') ||
      msg.includes('service') ||
      msg.includes('connection') ||
      msg.includes('dead') ||
      msg.includes('died') ||
      msg.includes('ipc');

    if (isBindingError) {
      // Attach a flag so callers can detect this specific failure mode
      const err = new Error(e.message || 'Binding error');
      err.isBindingError = true;
      throw err;
    }
    throw e;
  }
}

// ---------------------------------------------------------------------------
// HC Step read — single attempt, no retry loop (we fall back instead)
// ---------------------------------------------------------------------------
async function readHCStepsOnce(client, startOfDay, now) {
  // Attempt A: aggregateRecord (more reliable, one call)
  if (typeof client.aggregateRecord === 'function') {
    try {
      const aggregate = await safeNativeCall(() => client.aggregateRecord({
        recordType: 'Steps',
        timeRangeFilter: {
          operator: 'between',
          startTime: startOfDay.toISOString(),
          endTime:   now.toISOString(),
        },
      }));
      const count = aggregate?.count ?? aggregate?.steps ?? 0;
      if (Number.isFinite(count)) return { value: count, method: 'aggregate' };
    } catch (e) {
      if (e.isBindingError) throw e; // propagate to caller
      console.warn('[Steps] HC aggregateRecord non-binding error:', e.message);
    }
  }

  // Attempt B: readRecords
  if (typeof client.readRecords === 'function') {
    try {
      const result = await safeNativeCall(() => client.readRecords('Steps', {
        timeRangeFilter: {
          operator: 'between',
          startTime: startOfDay.toISOString(),
          endTime:   now.toISOString(),
        },
      }));
      const records = Array.isArray(result?.records) ? result.records : [];
      const total = records.reduce((sum, r) => {
        const v = r?.count ?? r?.steps ?? 0;
        return sum + (Number.isFinite(v) ? v : 0);
      }, 0);
      return { value: total, method: 'readRecords' };
    } catch (e) {
      if (e.isBindingError) throw e;
      console.warn('[Steps] HC readRecords non-binding error:', e.message);
    }
  }

  return { value: 0, method: 'none' };
}

// ---------------------------------------------------------------------------
// Live step accumulator management
// ---------------------------------------------------------------------------

/** Returns today's date string "YYYY-MM-DD" */
function todayString() {
  const d = new Date();
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
}

/** Load persisted base step count (from last successful HC read) */
async function loadBaseStepCount() {
  try {
    const savedDate  = await AsyncStorage.getItem(STORAGE_KEY_BASE_DATE);
    const savedCount = await AsyncStorage.getItem(STORAGE_KEY_BASE_STEPS);
    if (savedDate === todayString() && savedCount !== null) {
      _baseStepCount   = parseInt(savedCount, 10) || 0;
      _baseStepLoadedAt = new Date();
      console.log(`[usageService] Loaded persisted base steps: ${_baseStepCount}`);
    } else {
      _baseStepCount = 0;
    }
  } catch (_e) {
    _baseStepCount = 0;
  }
}

/** Save a successful HC reading as the day's base */
async function saveBaseStepCount(count) {
  try {
    await AsyncStorage.multiSet([
      [STORAGE_KEY_BASE_STEPS, String(count)],
      [STORAGE_KEY_BASE_DATE,  todayString()],
    ]);
    _baseStepCount    = count;
    _baseStepLoadedAt = new Date();
  } catch (_e) { /* non-fatal */ }
}

/** Start the live pedometer watcher once and accumulate steps */
function ensureLiveWatcher() {
  // Double-guard: synchronous flag prevents a second start during async gaps
  if (_liveStepSubscription || _watcherStarting) return;
  _watcherStarting = true;

  if (Pedometer?.watchStepCount) {
    try {
      console.log('[usageService] Starting persistent live step watcher.');
      _liveStepStartedAt = new Date();
      _liveStepSubscription = Pedometer.watchStepCount((result) => {
        if (result && Number.isFinite(result.steps)) {
          // result.steps is the cumulative delta since the watcher was created
          _liveStepAccumulator = result.steps;
        }
      });
      _watcherStarting = false;
      return;
    } catch (e) {
      console.warn('[usageService] Pedometer.watchStepCount failed:', e.message);
    }
  }

  // Accelerometer fallback — accumulates steps since watcher start
  if (Platform.OS === 'android') {
    console.log('[usageService] Falling back to accelerometer-based step counting.');
    Accelerometer.setUpdateInterval(ACCELEROMETER_UPDATE_INTERVAL_MS);
    let lastMag = 0;
    let lastStepTime = 0;

    _liveStepStartedAt = new Date();
    _liveStepSubscription = Accelerometer.addListener(({ x, y, z }) => {
      const mag  = Math.sqrt(x * x + y * y + z * z);
      const lin  = Math.abs(mag - GRAVITY_EARTH);
      const now  = Date.now();
      const isRising = lin > STEP_THRESHOLD && lastMag <= STEP_THRESHOLD;
      if (isRising && (now - lastStepTime) > MIN_STEP_INTERVAL_MS) {
        _liveStepAccumulator += 1;
        lastStepTime = now;
      }
      lastMag = lin;
    });
  }

  _watcherStarting = false;
}

/** Stop the live watcher (e.g., on app background or unmount) */
function stopLiveWatcher() {
  if (_liveStepSubscription) {
    if (typeof _liveStepSubscription.remove === 'function') {
      _liveStepSubscription.remove();
    }
    _liveStepSubscription = null;
  }
}

// Re-start the watcher if it was somehow stopped (e.g. native crash) when
// the app returns to foreground. We do NOT stop it on background — the
// pedometer sensor is cheap and we'd lose the accumulated count.
AppState.addEventListener('change', (state) => {
  if (state === 'active') {
    ensureLiveWatcher();
  }
});

// Boot: clear any stale crash flag so HC always gets one fresh attempt per
// app launch. isHealthConnectEnabled is in-memory — it resets to true here
// by default. The flag is only set to false within a session if HC binds
// successfully but then dies mid-read.
//
// Also set the synchronous guard immediately so the AppState 'active' event
// (which may fire on startup) cannot race and start a second watcher.
_watcherStarting = true;
(async () => {
  await loadBaseStepCount();
  _watcherStarting = false;
  ensureLiveWatcher();
})();

// ---------------------------------------------------------------------------
// Public service object
// ---------------------------------------------------------------------------
export const usageService = {

  // -------------------------------------------------------------------------
  async getStepProviderStatus() {
    const isAndroid  = Platform.OS === 'android';
    const sdkVersion = isAndroid ? Platform.Version : 0;

    const status = {
      isHealthConnectSupported: isAndroid && sdkVersion >= 28,
      hasHealthConnect: false,
      hasPedometer:     false,
      hasAnyProvider:   false,
      recommendedInstall: 'Health Connect',
    };

    if (!isAndroid) {
      status.hasAnyProvider = true;
      return status;
    }

    const client = await getHealthConnectClient();
    if (client) status.hasHealthConnect = true;

    try {
      if (Pedometer?.isAvailableAsync) {
        const ok = await Pedometer.isAvailableAsync();
        if (ok) status.hasPedometer = true;
      }
    } catch (_e) { }

    // Live watcher counts as a valid provider
    if (_liveStepSubscription) status.hasPedometer = true;

    status.hasAnyProvider = status.hasHealthConnect || status.hasPedometer;

    status.isAuthorized = status.hasHealthConnect
      ? await this.hasStepPermission()
      : status.hasPedometer
        ? await this.hasPedometerPermission()
        : false;

    return status;
  },

  // -------------------------------------------------------------------------
  async hasStepPermission(forceNative = false) {
    if (Platform.OS !== 'android') return this.hasPedometerPermission();

    const client = await getHealthConnectClient();
    if (!client) return false;

    try {
      const cachedAuth = await AsyncStorage.getItem('@NeuroHabit:HealthConnectAuthorized');

      // Fast-path: trust cache unless forced
      if (!forceNative) return cachedAuth === 'true';

      if (typeof client.getGrantedPermissions !== 'function') return false;

      const granted = await safeNativeCall(() => client.getGrantedPermissions());
      const isGranted = Array.isArray(granted) && (
        granted.some(p => p?.recordType === 'Steps' || p?.recordType === 'steps' || p === 'Steps' || p === 'steps')
      );

      if (isGranted) {
        await AsyncStorage.setItem('@NeuroHabit:HealthConnectAuthorized', 'true');
        return true;
      } else {
        await AsyncStorage.removeItem('@NeuroHabit:HealthConnectAuthorized');
        return false;
      }
    } catch (e) {
      console.warn('[usageService] Permission check failed:', e?.message);
      return false;
    }
  },

  // -------------------------------------------------------------------------
  async requestStepPermissions() {
    isHealthConnectEnabled = true;
    _hcInitPromise  = null;
    _hcCrashChecked = false;

    const client = await getHealthConnectClient();
    let healthConnectGranted = false;

    if (client && typeof client.requestPermission === 'function') {
      try {
        console.log('[usageService] Requesting Health Connect permissions...');
        const granted = await safeNativeCall(() => client.requestPermission([
          { accessType: 'read', recordType: 'Steps' },
          { accessType: 'read', recordType: 'Distance' },
          { accessType: 'read', recordType: 'TotalCaloriesBurned' },
        ]));
        healthConnectGranted = Array.isArray(granted) && (
          granted.some(item => item?.recordType === 'Steps' || item === 'Steps')
        );
        if (healthConnectGranted) {
          await AsyncStorage.setItem('@NeuroHabit:HealthConnectAuthorized', 'true');
        }
      } catch (e) {
        console.warn('[usageService] HC permission request failed:', e?.message);
      }
    }

    const status = await this.getStepProviderStatus();
    const pedometerGranted = await this.requestPedometerPermission();

    return { ...status, healthConnectGranted, granted: healthConnectGranted || pedometerGranted };
  },

  // -------------------------------------------------------------------------
  async hasPedometerPermission() {
    if (!Pedometer?.isAvailableAsync) return false;
    try {
      const ok = await Pedometer.isAvailableAsync();
      if (!ok) return false;
      if (typeof Pedometer.getPermissionsAsync === 'function') {
        const perm = await Pedometer.getPermissionsAsync();
        return perm?.granted === true;
      }
      return true;
    } catch (_e) { return false; }
  },

  async requestPedometerPermission() {
    if (!Pedometer?.isAvailableAsync) return false;
    try {
      const ok = await Pedometer.isAvailableAsync();
      if (!ok) return false;
      if (typeof Pedometer.requestPermissionsAsync === 'function') {
        const perm = await Pedometer.requestPermissionsAsync();
        return perm?.granted === true;
      }
      return true;
    } catch (e) {
      console.error('[usageService] Pedometer permission error:', e);
      return false;
    }
  },

  // -------------------------------------------------------------------------
  async hasPermission() {
    if (Platform.OS !== 'android' || !UsageStats) return false;
    try { return UsageStats.isPermissionGranted(); } catch (_e) { return false; }
  },

  async requestPermission() {
    if (Platform.OS !== 'android' || !UsageStats) return;
    try { UsageStats.requestPermission(); } catch (e) { console.error('Usage Stats permission error:', e); }
  },

  // -------------------------------------------------------------------------
  async getDailyScreenTime() {
    if (Platform.OS !== 'android' || !UsageStats) return 0;
    try {
      const hasPerm = await this.hasPermission();
      if (!hasPerm) return 0;

      const now        = new Date();
      const startOfDay = new Date(now.getFullYear(), now.getMonth(), now.getDate());

      let stats = await UsageStats.queryUsageStats({
        startTime: startOfDay.getTime(),
        endTime:   now.getTime(),
        interval:  INTERVAL_DAILY,
      });

      if (!Array.isArray(stats) || stats.length === 0) {
        const aggregateMap = await UsageStats.queryAndAggregateUsageStats({
          startTime: startOfDay.getTime(),
          endTime:   now.getTime(),
        });
        stats = aggregateMap ? Object.values(aggregateMap) : [];
      }

      let totalMs = 0;
      if (Array.isArray(stats)) {
        stats.forEach(app => { totalMs += (app.totalTimeInForeground || 0); });
      }
      return parseFloat((totalMs / (1000 * 60 * 60)).toFixed(2));
    } catch (e) {
      console.error('[usageService] getDailyScreenTime error:', e);
      return 0;
    }
  },

  // -------------------------------------------------------------------------
  // getDailyStepCount
  //
  // Priority:
  //   1. Health Connect (aggregate/readRecords) — most accurate historical data
  //   2. base (last HC success) + live accumulator — when HC is broken
  //   3. Live accumulator alone — first session with no prior HC data
  // -------------------------------------------------------------------------
  async getDailyStepCount() {
    if (Platform.OS !== 'android') {
      return this._getDailyStepCountIOS();
    }

    const now        = new Date();
    const startOfDay = new Date(now.getFullYear(), now.getMonth(), now.getDate());

    // --- Attempt 1: Health Connect ---
    if (isHealthConnectEnabled) {
      const client = await getHealthConnectClient();
      if (client) {
        const isAuthorized = await this.hasStepPermission();
        if (isAuthorized) {
          try {
            const { value, method } = await readHCStepsOnce(client, startOfDay, now);
            if (Number.isFinite(value)) {
              console.log(`[Steps] HC ${method} success: ${value}`);
              // Save as today's base so live delta stays meaningful
              await saveBaseStepCount(value);
              return value;
            }
          } catch (e) {
            if (e.isBindingError) {
              console.warn('[Steps] HC binding error — disabling HC for this session and falling back.');
              isHealthConnectEnabled = false;
              _hcInitPromise = null;
            } else {
              console.warn('[Steps] HC read error (non-binding):', e.message);
            }
          }
        } else {
          console.log('[Steps] HC not authorized — skipping HC read.');
        }
      }
    }

    // --- Attempt 2: base + live accumulator ---
    // _baseStepCount = last HC success for today
    // _liveStepAccumulator = steps counted by watcher since it started
    //
    // If HC managed to read this session before dying, use the HC value directly
    // (already returned above). If not, combine the last known base + live delta.
    const combined = _baseStepCount + _liveStepAccumulator;
    if (combined > 0) {
      console.log(`[Steps] Fallback (base ${_baseStepCount} + live ${_liveStepAccumulator}) = ${combined}`);
      return combined;
    }

    // --- Attempt 3: live accumulator alone (first run, no HC history) ---
    if (_liveStepAccumulator > 0) {
      console.log(`[Steps] Live-only fallback: ${_liveStepAccumulator}`);
      return _liveStepAccumulator;
    }

    const status = await this.getStepProviderStatus();
    if (!status.hasAnyProvider) {
      console.warn('[Steps] No health providers available on this device.');
    }
    return 0;
  },

  // iOS: historical pedometer
  async _getDailyStepCountIOS() {
    if (!Pedometer?.isAvailableAsync) return 0;
    try {
      const ok = await Pedometer.isAvailableAsync();
      if (!ok) return 0;
      const hasPerm = await this.hasPedometerPermission();
      if (!hasPerm) return 0;
      const now        = new Date();
      const startOfDay = new Date(now.getFullYear(), now.getMonth(), now.getDate());
      const result     = await Pedometer.getStepCountAsync(startOfDay, now);
      return Number.isFinite(result?.steps) ? result.steps : 0;
    } catch (e) {
      console.warn('[usageService] iOS Pedometer error:', e?.message);
      return 0;
    }
  },

  // -------------------------------------------------------------------------
  // watchLiveSteps — external subscribers (dashboard, widgets)
  // The internal watcher (_liveStepSubscription) already runs continuously;
  // this method gives callers a way to receive updates without starting
  // a second watcher.
  // -------------------------------------------------------------------------
  watchLiveSteps(callback) {
    // Ensure the persistent watcher is running
    ensureLiveWatcher();

    // Return a synthetic subscription that polls _liveStepAccumulator
    // and fires the callback whenever the value changes.
    let lastReported = _liveStepAccumulator;
    const interval = setInterval(() => {
      const current = _baseStepCount + _liveStepAccumulator;
      if (current !== lastReported) {
        lastReported = current;
        callback(current);
      }
    }, 2000); // poll every 2 s

    // Fire immediately with current value
    callback(_baseStepCount + _liveStepAccumulator);

    return {
      remove: () => clearInterval(interval),
    };
  },

  stopWatchingLiveSteps(subscription) {
    if (subscription && typeof subscription.remove === 'function') {
      subscription.remove();
    }
  },
};
