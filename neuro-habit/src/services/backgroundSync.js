import * as BackgroundFetch from 'expo-background-fetch';
import * as TaskManager from 'expo-task-manager';
import { usageService } from './usageService';
import { backendService } from './backendService';
import { syncHistoricalStepsToSupabase } from './api';

const HEALTH_SYNC_TASK = 'HEALTH_SYNC_TASK';

TaskManager.defineTask(HEALTH_SYNC_TASK, async () => {
  try {
    console.log('[BackgroundSync] Running health sync task...');
    const steps = await usageService.getDailyStepCount();
    const screenTime = await usageService.getDailyScreenTime();
    
    if (steps > 0 || screenTime > 0) {
      await backendService.syncMetrics(steps, screenTime);
      await backendService.syncPendingData({ reason: 'background_fetch' });
      await syncHistoricalStepsToSupabase();
      console.log('[BackgroundSync] Successfully synced metrics');
      return BackgroundFetch.BackgroundFetchResult.NewData;
    }
    
    return BackgroundFetch.BackgroundFetchResult.NoData;
  } catch (error) {
    console.error('[BackgroundSync] Background health sync failed:', error);
    return BackgroundFetch.BackgroundFetchResult.Failed;
  }
});

export const registerBackgroundHealthSync = async () => {
  try {
    const isRegistered = await TaskManager.isTaskRegisteredAsync(HEALTH_SYNC_TASK);
    if (!isRegistered) {
      await BackgroundFetch.registerTaskAsync(HEALTH_SYNC_TASK, {
        minimumInterval: 15 * 60, // 15 minutes
        stopOnTerminate: false, // android only
        startOnBoot: true, // android only
      });
      console.log('[BackgroundSync] Background health sync registered');
    } else {
      console.log('[BackgroundSync] Background health sync already registered');
    }
  } catch (err) {
    console.error('[BackgroundSync] Failed to register background task:', err);
  }
};
