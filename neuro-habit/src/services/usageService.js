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
let _hcInitPromise = null;

/** Consecutive binding-error counter — HC is only disabled after HC_MAX_BINDING_ERRORS failures */
let _hcBindingErrorCount = 0;
const HC_MAX_BINDING_ERRORS = 3;

/**
 * One-shot background retry flag. After startup binding errors disable HC,
 * we schedule a single silent retry after 10 s to let the OS fully bind the
 * HC service. If the retry ALSO fails, we give up permanently for this session
 * to avoid an infinite retry → bind-fail → retry loop on fragile devices.
 */
let _hcRetryScheduled = false;
let _hcSilentRetryDone = false; // permanent session-level gate — retry at most once

function scheduleHcRetry() {
  // Only schedule one silent retry per app session.
  // On devices where HC consistently fails (e.g. Infinix with aggressive
  // battery optimization) the binder will never stabilize, so retrying
  // indefinitely just wastes CPU and creates noisy warning logs.
  if (_hcRetryScheduled || _hcSilentRetryDone) return;
  _hcRetryScheduled = true;
  _hcSilentRetryDone = true; // prevent any further retries this session
  console.log('[usageService] HC disabled at startup — scheduling silent retry in 10 s.');
  setTimeout(() => {
    _hcRetryScheduled = false; // flag cleared but _hcSilentRetryDone remains true
    isHealthConnectEnabled = true;
    _hcInitPromise = null;
    _hcBindingErrorCount = 0;
    _hcInitSettleMs = 4000; // maximum settle time for the one silent retry
    console.log('[usageService] HC silent retry: re-enabled for background attempt.');
  }, 10000);
}

/** Accumulated live-step delta since the watcher started this session */
let _liveStepAccumulator = 0;
let _liveStepSubscription = null;
let _watcherStarting = false;  // Synchronous guard to prevent double-start during async init

// Base step count loaded from AsyncStorage at session start (from last HC sync)
let _baseStepCount = 0;

const STORAGE_KEY_BASE_DATE  = '@NeuroHabit:BaseStepDate';
const STORAGE_KEY_BASE_STEPS = '@NeuroHabit:BaseStepCount';

/** Tracks the last date we processed to detect midnight rollover during a session */
let _lastProcessedDate = '';

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
const HC_SDK_UNAVAILABLE         = 1; // Health Connect not installed
const HC_SDK_NEEDS_UPDATE        = 2; // Installed but update required
const HC_SDK_AVAILABLE           = 3; // Ready to use
const INTERVAL_DAILY             = 0;
const HC_PLAY_STORE_URL = 'https://play.google.com/store/apps/details?id=com.google.android.apps.healthdata';

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
  _hcBindingErrorCount = 0; // clear consecutive failure count so HC gets a fresh start
  console.log('[usageService] Health Connect status reset (in-memory).');
}

// ---------------------------------------------------------------------------
// HC client init — singleton promise with re-init support
// ---------------------------------------------------------------------------
/** Delay (ms) to wait after HC initialize() before making API calls */
let _hcInitSettleMs = 2500; // raised: gives slow-binding OEM devices more time

// ---------------------------------------------------------------------------
// HC API serialization lock
// Concurrent Android IPC calls on the same binder kill the connection
// ("binding died" / "binding to service failed"). This mutex ensures only
// ONE HC API call is in-flight at any moment.
// ---------------------------------------------------------------------------
let _hcApiLockTail = Promise.resolve();

/**
 * Runs `fn` exclusively after all previous HC API calls have resolved.
 * @template T
 * @param {() => Promise<T>} fn
 * @returns {Promise<T>}
 */
async function withHcLock(fn) {
  let release;
  const myTurn = new Promise(resolve => { release = resolve; });
  const prevTail = _hcApiLockTail;
  _hcApiLockTail = myTurn;
  try {
    await prevTail;
    return await fn();
  } finally {
    release();
  }
}

/**
 * Safely starts local step counting mechanisms (Pedometer/Accelerometer)
 * when Health Connect is completely unavailable due to API version constraints.
 */
function startLocalStepFallback() {
  console.log('[usageService] Activating local step fallback routine.');
  ensureLiveWatcher();
}

async function getHealthConnectClient() {
  if (!HealthConnect || !isHealthConnectEnabled) return null;

  // Strictly gate Health Connect for Android 8.0+ (API 26+)
  // Executing HC APIs on API 24/25 causes fatal runtime crashes.
  if (Platform.OS === 'android' && Platform.Version < 26) {
    console.log('[usageService] Device API level is below 26. Silently bypassing Health Connect to ensure backward compatibility.');
    startLocalStepFallback();
    return null;
  }

  if (_hcInitPromise) return _hcInitPromise;

  _hcInitPromise = (async () => {
    try {
      // Staggered Lifecycle Lock: Delay initial HC binding by 3.5s
      // Ensures Supabase Auth context, time sync, and Dashboard mount
      // fully settle before spinning up the heavy IPC native connection.
      // Prevents "binding died" on aggressive OEM skins (e.g. Infinix).
      if (!global._hcAppStartupBufferDone) {
        console.log('[usageService] Staggering HC init: waiting 3500ms for UI/Auth to settle...');
        await new Promise(resolve => setTimeout(resolve, 3500));
        global._hcAppStartupBufferDone = true;
      }

      const status = await HealthConnect.getSdkStatus();
      if (status !== HC_SDK_AVAILABLE) {
        console.warn(`[usageService] HC SDK not available. Status: ${status}`);
        return null;
      }
      console.log('[usageService] Calling HealthConnect.initialize()...');
      const initialized = await HealthConnect.initialize();
      console.log('[usageService] HealthConnect.initialize() result:', initialized);
      if (initialized) {
        // Give the service time to fully bind — some OEM devices are slow
        await new Promise(resolve => setTimeout(resolve, _hcInitSettleMs));
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
      err.originalMessage = msg;
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
      const aggregate = await withHcLock(() => safeNativeCall(() => client.aggregateRecord({
        recordType: 'Steps',
        timeRangeFilter: {
          operator: 'between',
          startTime: startOfDay.toISOString(),
          endTime:   now.toISOString(),
        },
      })));
      
      console.log('[Steps] HC aggregate raw:', JSON.stringify(aggregate));
      
      // COUNT_TOTAL must come FIRST — on some devices/versions the aggregate
      // object also contains a `count` field that equals the number of record
      // sources (e.g. 1), NOT the step total. Checking COUNT_TOTAL first
      // prevents that field from being mistakenly used as the step count.
      const count = aggregate?.COUNT_TOTAL ??
                    aggregate?.steps ??
                    aggregate?.['steps.count'] ??
                    aggregate?.totalSteps ??
                    aggregate?.count ??
                    0;

      if (Number.isFinite(count) && count > 0) {
        return { value: count, method: 'aggregate' };
      }
      
      // If aggregate returned 0, it might be an empty bucket or a sync delay.
      // We'll proceed to Attempt B just in case.
    } catch (e) {
      if (e.isBindingError) throw e;
      console.warn(`[Steps] HC aggregateRecord failed (${e.message}). Falling back to readRecords...`);
    }
  }

  // Attempt B: readRecords (fallback if aggregate is 0 or had non-binding error)
  if (typeof client.readRecords === 'function') {
    try {
      const result = await withHcLock(() => safeNativeCall(() => client.readRecords('Steps', {
        timeRangeFilter: {
          operator: 'between',
          startTime: startOfDay.toISOString(),
          endTime:   now.toISOString(),
        },
      })));
      const records = Array.isArray(result?.records) ? result.records : [];
      const total = records.reduce((sum, r) => {
        const v = r?.count ?? r?.steps ?? 0;
        return sum + (Number.isFinite(v) ? v : 0);
      }, 0);
      
      if (total > 0) {
        return { value: total, method: 'readRecords' };
      }
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
    const currentDay = todayString();

    if (savedDate === currentDay && savedCount !== null) {
      _baseStepCount   = parseInt(savedCount, 10) || 0;
      console.log(`[usageService] Loaded persisted base steps: ${_baseStepCount}`);
    } else {
      _baseStepCount = 0;
    }
    _lastProcessedDate = savedDate || currentDay;
  } catch (_e) {
    _baseStepCount = 0;
    _lastProcessedDate = todayString();
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
  } catch (_e) { /* non-fatal */ }
}

/** 
 * Checks if the day has changed since the last step read.
 * If so, resets all in-memory and persisted step counters to zero.
 */
async function checkDateRollover() {
  const currentDay = todayString();

  if (!_lastProcessedDate) {
    _lastProcessedDate = currentDay;
    return;
  }

  if (_lastProcessedDate !== currentDay) {
    console.log(`[usageService] Day rollover detected: ${_lastProcessedDate} -> ${currentDay}. Resetting step counters.`);
    
    // 1. Update session date tracking
    _lastProcessedDate = currentDay;

    // 2. Reset in-memory accumulators
    _baseStepCount = 0;
    _liveStepAccumulator = 0;
    
    // 3. Reset persisted state for the new day
    try {
      await AsyncStorage.multiSet([
        [STORAGE_KEY_BASE_STEPS, '0'],
        [STORAGE_KEY_BASE_DATE,  currentDay],
      ]);
    } catch (_e) { /* ignore */ }

    // 4. Force restart the live watcher to reset its internal delta
    if (_liveStepSubscription) {
      console.log('[usageService] Restarting live watcher for new day.');
      try {
        if (typeof _liveStepSubscription.remove === 'function') {
          _liveStepSubscription.remove();
        } else if (typeof _liveStepSubscription === 'function') {
          _liveStepSubscription();
        }
      } catch (_e) { /* ignore */ }
      _liveStepSubscription = null;
    }
    ensureLiveWatcher();
  }
}

/** Start the live pedometer watcher once and accumulate steps */
function ensureLiveWatcher() {
  // Double-guard: synchronous flag prevents a second start during async gaps
  if (_liveStepSubscription || _watcherStarting) return;
  _watcherStarting = true;

  if (Pedometer?.watchStepCount) {
    try {
      console.log('[usageService] Starting persistent live step watcher.');
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



// Re-start the watcher if it was somehow stopped (e.g. native crash) when
// the app returns to foreground. We do NOT stop it on background — the
// pedometer sensor is cheap and we'd lose the accumulated count.
//
// Also kick off an immediate HC re-poll on foreground so steps synced
// by Google Fit / wearables while the app was in the background are
// picked up instantly instead of waiting for the next 30-second interval.
let _lastForegroundHcPoll = 0;
const FOREGROUND_HC_POLL_THROTTLE_MS = 15_000; // at most once per 15 s

// Module load timestamp — used to enforce an 8-second startup quiesce window.
// During the 3.5s HC init stagger, devices can briefly emit 'inactive' then
// 'active' (screen-on, notification, etc.) which sets _hasBeenBackgrounded=true
// prematurely, allowing the foreground poll to race with getDailyStepCount().
// The quiesce window is a hard wall: no foreground HC poll fires in the first 8s
// regardless of AppState transitions.
const _moduleLoadTime = Date.now();
const HC_STARTUP_QUIESCE_MS = 8_000;

let _hasBeenBackgrounded = false;

AppState.addEventListener('change', (state) => {
  if (state === 'background' || state === 'inactive') {
    _hasBeenBackgrounded = true;
  }

  if (state === 'active') {
    ensureLiveWatcher();

    // Guard 1: hard startup quiesce — never fire within the first 8 seconds
    if (Date.now() - _moduleLoadTime < HC_STARTUP_QUIESCE_MS) return;

    // Guard 2: must have actually been backgrounded (not just permission dialogs)
    if (!_hasBeenBackgrounded) return;

    // Guard 3: skip if HC is currently disabled for this session
    if (!isHealthConnectEnabled) return;

    // Throttled HC re-poll on foreground
    const now = Date.now();
    if (now - _lastForegroundHcPoll > FOREGROUND_HC_POLL_THROTTLE_MS) {
      _lastForegroundHcPoll = now;
      (async () => {
        try {
          const client = await getHealthConnectClient();
          if (!client) return;
          const nowDate    = new Date();
          const startOfDay = new Date(nowDate.getFullYear(), nowDate.getMonth(), nowDate.getDate());
          const { value }  = await readHCStepsOnce(client, startOfDay, nowDate);
          if (Number.isFinite(value) && value > 0) {
            const currentTotal = _baseStepCount + _liveStepAccumulator;
            if (value > currentTotal) {
              const newBase = value - _liveStepAccumulator;
              await saveBaseStepCount(newBase);
              console.log(`[usageService] Foreground HC poll updated base: ${_baseStepCount} (HC=${value})`);
            }
          }
        } catch (_e) { /* silent — foreground poll errors must not surface to UI */ }
      })();
    }
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

      const granted = await withHcLock(() => safeNativeCall(() => client.getGrantedPermissions()));
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

    const client = await getHealthConnectClient();
    let healthConnectGranted = false;

    if (client && typeof client.requestPermission === 'function') {
      try {
        console.log('[usageService] Requesting Health Connect permissions...');
        const granted = await withHcLock(() => safeNativeCall(() => client.requestPermission([
          { accessType: 'read', recordType: 'Steps' },
          { accessType: 'read', recordType: 'Distance' },
          { accessType: 'read', recordType: 'TotalCaloriesBurned' },
        ])));
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

      let totalMs = 0;
      let usedEvents = false;
      
      const SYSTEM_PREFIXES = [
        'com.android.',
        'android',
        'com.google.android.apps.nexuslauncher',
        'com.sec.android.app.launcher',
        'com.miui.home',
        'com.huawei.android.launcher',
        'com.oppo.launcher',
        'com.vivo.launcher',
        'com.oneplus.setupwizard',
        'com.google.android.gms'
      ];

      try {
        const events = await UsageStats.queryEvents({
          startTime: startOfDay.getTime(),
          endTime: now.getTime()
        });

        // The API call succeeded. Even if events is null/undefined (0 events),
        // we must NOT fall back to the inaccurate daily buckets.
        usedEvents = true;

        if (Array.isArray(events) && events.length > 0) {
          const ACTIVITY_RESUMED = 1;
          const ACTIVITY_PAUSED = 2;
          let resumedMap = new Map();

          events.sort((a, b) => a.timeStamp - b.timeStamp);

          for (const event of events) {
            const pkg = (event.packageName || '').toLowerCase();
            const isSystem = SYSTEM_PREFIXES.some(prefix => pkg.startsWith(prefix));
            
            // Only track non-system apps for exact user screen time
            if (!isSystem) {
              if (event.eventType === ACTIVITY_RESUMED) {
                resumedMap.set(pkg, event.timeStamp);
              } else if (event.eventType === ACTIVITY_PAUSED) {
                if (resumedMap.has(pkg)) {
                  totalMs += (event.timeStamp - resumedMap.get(pkg));
                  resumedMap.delete(pkg);
                } else {
                  // App was already active before midnight; cap it to the start of the day
                  totalMs += (event.timeStamp - startOfDay.getTime());
                }
              }
            }
          }

          // Add ongoing time for any apps still active right now
          for (const [pkg, timeStamp] of resumedMap.entries()) {
            totalMs += (now.getTime() - timeStamp);
          }
        }
      } catch (err) {
        // Silently catch on Android < 12 (API 31) where react-native-usage-stats crashes 
        // attempting to read UsageEvents$Event.getExtras(). The fallback logic below will handle it.
      }

      if (!usedEvents) {
        // Fallback: This is less accurate across midnight boundaries due to Android's daily buckets.
        const aggregateMap = await UsageStats.queryAndAggregateUsageStats({
          startTime: startOfDay.getTime(),
          endTime: now.getTime(),
        });
        const stats = aggregateMap ? Object.values(aggregateMap) : [];

        if (Array.isArray(stats)) {
          stats.forEach(app => {
            const pkg = (app.packageName || '').toLowerCase();
            const isSystem = SYSTEM_PREFIXES.some(prefix => pkg.startsWith(prefix));
            if (!isSystem && app.totalTimeInForeground > 0) {
              totalMs += app.totalTimeInForeground;
            }
          });
        }
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
  //   2. base (last successful read) + live accumulator — last resort delta
  //   3. Live accumulator alone — first run with no prior data of any kind
  //
  // Concurrent callers (dashboard, background fetch, 30 s watcher) share the
  // same in-flight promise so only ONE HC IPC read ever runs at a time.
  // -------------------------------------------------------------------------
  async getDailyStepCount() {
    if (Platform.OS !== 'android') {
      return this._getDailyStepCountIOS();
    }
    // Deduplicate: return the existing promise if a read is already in-flight
    if (this._pendingStepRead) {
      console.log('[Steps] Deduplicating concurrent getDailyStepCount call.');
      return this._pendingStepRead;
    }
    this._pendingStepRead = this._doGetDailyStepCount().finally(() => {
      this._pendingStepRead = null;
    });
    return this._pendingStepRead;
  },

  async _doGetDailyStepCount() {
    if (Platform.OS !== 'android') return this._getDailyStepCountIOS();

    // Ensure we aren't returning yesterday's steps if the app stayed open across midnight
    await checkDateRollover();

    const now        = new Date();
    const startOfDay = new Date(now.getFullYear(), now.getMonth(), now.getDate());

    // --- Attempt 1: Health Connect ---
    if (isHealthConnectEnabled) {
      for (let attempt = 1; attempt <= HC_MAX_BINDING_ERRORS; attempt++) {
        const client = await getHealthConnectClient();
        if (!client) break; // If init failed completely, stop trying

        const isAuthorized = await this.hasStepPermission();
        if (!isAuthorized) {
          console.log('[Steps] HC not authorized — skipping HC read.');
          break; // Stop retrying if not authorized
        }

        try {
          const { value, method } = await readHCStepsOnce(client, startOfDay, now);
          if (Number.isFinite(value)) {
            console.log(`[Steps] HC ${method} result: ${value}`);
            
            if (value > 0) {
              const currentTotal = _baseStepCount + _liveStepAccumulator;
              if (value > currentTotal) {
                // HC has steps we missed (e.g. synced from Google Fit). 
                // Shift the base so currentTotal perfectly matches HC's new value,
                // without destroying the live accumulator or double counting.
                const newBase = value - _liveStepAccumulator;
                await saveBaseStepCount(newBase);
              }
              _hcBindingErrorCount = 0; // successfully read, clear error count
              
              // Always return the highest known truth to the API, preventing
              // downgrades when Health Connect is lagging behind our pedometer.
              return Math.max(value, currentTotal);
            } else {
              console.log('[Steps] HC returned 0. Verifying native permissions...');
              // If we get 0, double check if it's because permissions were revoked
              const stillAuthorized = await this.hasStepPermission(true);
              if (!stillAuthorized) {
                console.warn('[Steps] HC permissions revoked! Disabling for this session.');
                isHealthConnectEnabled = false;
              }
              break; // Valid read of 0, don't retry
            }
          }
        } catch (e) {
          if (e.isBindingError) {
            _hcBindingErrorCount++;
            _hcInitPromise = null; // force re-init on the next attempt
            
            // Robust Exponential Backoff: give aggressive OS skins significantly
            // more time to recover the binder interface between retries.
            if (_hcBindingErrorCount < HC_MAX_BINDING_ERRORS) {
              const backoffMs = _hcBindingErrorCount * 1500; // Increased from 800ms
              console.log(`[Steps] HC binding error x${_hcBindingErrorCount} — waiting ${backoffMs}ms before retry...`);
              await new Promise(resolve => setTimeout(resolve, backoffMs));
              
              // Exponentially increase settle time for next init attempt
              _hcInitSettleMs = Math.min(_hcInitSettleMs + 1000, 4000);
            } else {
              console.log(`[Steps] HC binding error x${_hcBindingErrorCount} (${e.originalMessage}) — disabling HC for this session and falling back.`);
              isHealthConnectEnabled = false;
              scheduleHcRetry(); // give HC a silent second chance after the OS settles
              break;
            }
          } else {
            console.log('[Steps] HC read error (non-binding):', e.message);
            break; // Non-binding error, stop trying
          }
        }
      }
    }

    // --- Attempt 2: base + live accumulator ---
    // _baseStepCount = last successful read (HC or Pedometer historical)
    // _liveStepAccumulator = steps detected by watcher since app opened
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
  //
  // A second, slower interval (HC_POLL_INTERVAL_MS) periodically re-queries
  // Health Connect so that steps synced from Google Fit, wearables, or other
  // sources are automatically reflected without a manual refresh.
  // -------------------------------------------------------------------------
  watchLiveSteps(callback) {
    // Ensure the persistent watcher is running
    ensureLiveWatcher();

    const HC_POLL_INTERVAL_MS = 30_000; // re-query HC every 30 s

    // ---------------------------------------------------------------------------
    // pollHC — isolated binding-error counter (MUST NOT touch _hcBindingErrorCount)
    //
    // _hcBindingErrorCount is exclusively owned by _doGetDailyStepCount's retry
    // loop. Sharing it caused a race: pollHC fired at ~12 s while the main retry
    // was at attempt 3 (~14 s), prematurely incrementing the shared counter from
    // x2 → x3, so the main loop logged "x4" instead of "x3" and called
    // scheduleHcRetry twice. Using a scoped counter keeps the two code paths
    // completely independent.
    // ---------------------------------------------------------------------------
    let _pollHcBindingErrors = 0;
    const POLL_HC_MAX_ERRORS = 3; // independent threshold for background poll

    /** Silent background re-poll of Health Connect.
     *  If HC returns a value higher than the current base+live total, we
     *  shift the base up so the UI reflects the freshly-synced reading.
     *  Uses its own binding-error counter so it cannot race with the main
     *  getDailyStepCount retry loop. */
    const pollHC = async () => {
      if (!isHealthConnectEnabled) return;
      try {
        const client = await getHealthConnectClient();
        // Re-check after async gap — a parallel failure may have disabled HC
        if (!client || !isHealthConnectEnabled) return;
        const isAuthorized = await this.hasStepPermission();
        if (!isAuthorized) return;

        const now        = new Date();
        const startOfDay = new Date(now.getFullYear(), now.getMonth(), now.getDate());
        const { value } = await readHCStepsOnce(client, startOfDay, now);

        if (Number.isFinite(value) && value > 0) {
          const currentTotal = _baseStepCount + _liveStepAccumulator;
          if (value > currentTotal) {
            // HC has newer/higher data — shift base up without disturbing live delta
            const newBase = value - _liveStepAccumulator;
            await saveBaseStepCount(newBase);
            console.log(`[watchLiveSteps] HC poll updated base: ${_baseStepCount} (HC=${value})`);
          }
          // Successful poll — reset this poll's own error counter
          _pollHcBindingErrors = 0;
        }
      } catch (e) {
        if (e?.isBindingError) {
          // Use the scoped counter — never touch _hcBindingErrorCount
          _pollHcBindingErrors++;
          _hcInitPromise = null; // force re-init next attempt
          if (_pollHcBindingErrors >= POLL_HC_MAX_ERRORS) {
            console.log('[watchLiveSteps] HC background poll binder error — will continue trying silently.');
            // Reset counter to prevent spamming logs every 30s
            _pollHcBindingErrors = 0;
          }
        }
        // All other errors are swallowed — polling must never crash the watcher
      }
    };

    // Return a synthetic subscription that polls _liveStepAccumulator
    // and fires the callback whenever the value changes.
    // Seed with the same expression used inside the interval so the very first
    // poll does not always fire a spurious "change" event.
    let lastReported = _baseStepCount + _liveStepAccumulator;
    const uiInterval = setInterval(async () => {
      await checkDateRollover();
      const current = _baseStepCount + _liveStepAccumulator;
      if (current !== lastReported) {
        lastReported = current;
        callback(current);
      }
    }, 500); // poll every 500 ms for near-instant UI updates

    // HC background poll — initial delay of 25 s.
    //
    // Timeline on slow/broken-binder devices:
    //   t=0       — dashboard mounts, watchLiveSteps called
    //   t=3.5 s   — HC startup stagger ends, attempt 1 fires
    //   t=5.0 s   — attempt 1 fails, 1.5 s backoff
    //   t=10.0 s  — attempt 2 fails (with 2.5 s settle), 3.0 s backoff
    //   t=16.5 s  — attempt 3 fails (with 3.5 s settle), HC disabled
    //   t=26.5 s  — silent retry re-enables HC (10 s after disable)
    //
    // 25 s was the old "12 s" — too short, it fired during attempt 3's settle
    // window and raced on the binder. 25 s still fires before the silent retry
    // completes on fast devices but is safely past the main retry sequence.
    // On truly broken devices the initial poll check sees isHealthConnectEnabled=false
    // and returns immediately (no binder hit at all).
    const hcPollTimeout = setTimeout(() => pollHC(), 25_000);
    const hcPollInterval = setInterval(() => pollHC(), HC_POLL_INTERVAL_MS);

    // Fire immediately with current value
    callback(_baseStepCount + _liveStepAccumulator);

    return {
      remove: () => {
        clearInterval(uiInterval);
        clearTimeout(hcPollTimeout);
        clearInterval(hcPollInterval);
      },
    };
  },

  stopWatchingLiveSteps(subscription) {
    if (subscription && typeof subscription.remove === 'function') {
      subscription.remove();
    }
  },

  isHealthConnectBroken() {
    return !isHealthConnectEnabled;
  },

  // Returns raw HC SDK status: 1=not installed, 2=needs update, 3=available, 0=unknown
  async getHcSdkStatus() {
    if (Platform.OS !== 'android' || !HealthConnect) return 0;
    try {
      return await HealthConnect.getSdkStatus();
    } catch (_e) {
      return 0;
    }
  },

  async openHealthConnect() {
    if (Platform.OS !== 'android') return;
    
    // Reset the internal crash state so the SDK is allowed to initialize
    // and attempt to open the settings screen.
    await resetHealthConnectStatus();

    // Check SDK status FIRST — redirect to Play Store if HC isn't installed
    if (HealthConnect) {
      try {
        const status = await HealthConnect.getSdkStatus();
        if (status === HC_SDK_UNAVAILABLE || status === HC_SDK_NEEDS_UPDATE) {
          console.log(`[usageService] HC SDK status ${status} — redirecting to Play Store.`);
          await Linking.openURL(HC_PLAY_STORE_URL).catch(() => {});
          return;
        }
      } catch (e) {
        console.warn('[usageService] Could not read HC SDK status:', e.message);
      }
    } else {
      // Module not loaded (Android < 28 or missing) — send to Play Store
      await Linking.openURL(HC_PLAY_STORE_URL).catch(() => {});
      return;
    }

    // HC is installed — try to open its settings
    const client = await getHealthConnectClient();
    if (client && typeof client.openHealthConnectSettings === 'function') {
      try {
        await client.openHealthConnectSettings();
        return;
      } catch (e) {
        console.warn('[usageService] Failed to open HC settings via SDK:', e.message);
      }
    }

    // Fallback: system intent
    try {
      await Linking.sendIntent('androidx.health.ACTION_HEALTH_CONNECT_SETTINGS');
    } catch (_e) {
      Linking.openSettings();
    }
  },
};
