import { useEffect, useRef, useState, useCallback } from "react";
import { fetchUserData } from "../services/api";
import { generateInsights } from "../services/aiEngine";
import { backendService } from "../services/backendService";
import AsyncStorage from "@react-native-async-storage/async-storage";

const DASHBOARD_CACHE_KEY = "dashboard_data_cache_v1";
const FAST_LOAD_TIMEOUT_MS = 1800;
const DEFAULT_DASHBOARD_DATA = {
  steps: 0,
  screenTime: 0,
  mood: null,
  habitsCompleted: 0,
  habitsTotal: 0,
  streak: 0,
};

export default function useDashboard() {
  const [data, setData] = useState(null);
  const [insights, setInsights] = useState([]);
  const [loading, setLoading] = useState(true);
  const [isRefreshingData, setIsRefreshingData] = useState(false);
  const [isOfflineMode, setIsOfflineMode] = useState(false);

  // Guard: prevents state updates after unmount
  const mountedRef = useRef(true);
  // Tracks the AbortController for the most recent load call
  const loadControllerRef = useRef(null);

  const load = useCallback(async () => {
    // Cancel any previously running load
    if (loadControllerRef.current) {
      loadControllerRef.current.abort();
    }
    const controller = new AbortController();
    loadControllerRef.current = controller;

    const safeSet = (setter) => (...args) => {
      if (!mountedRef.current || controller.signal.aborted) return;
      setter(...args);
    };

    safeSet(setLoading)(true);
    safeSet(setIsRefreshingData)(true);
    safeSet(setIsOfflineMode)(false);

    let fastLoadTimer;
    try {
      const cachedRaw = await AsyncStorage.getItem(DASHBOARD_CACHE_KEY);
      if (controller.signal.aborted) return;

      const cachedData = cachedRaw ? JSON.parse(cachedRaw) : null;
      if (cachedData) {
        safeSet(setData)(cachedData);
        safeSet(setLoading)(false);
      }

      // Fallback timer: show defaults if real data is slow
      fastLoadTimer = setTimeout(() => {
        if (!mountedRef.current || controller.signal.aborted) return;
        setData((prev) => prev || DEFAULT_DASHBOARD_DATA);
        setLoading(false);
      }, FAST_LOAD_TIMEOUT_MS);

      const userData = await fetchUserData();
      if (controller.signal.aborted) return;

      safeSet(setData)(userData);
      AsyncStorage.setItem(DASHBOARD_CACHE_KEY, JSON.stringify(userData)).catch(() => {});
      backendService.syncPendingData().catch(() => {});

      clearTimeout(fastLoadTimer);
      safeSet(setLoading)(false);
      safeSet(setIsRefreshingData)(false);

      // Fetch insights in the background — guarded by mountedRef
      (async () => {
        try {
          const cachedInsights = await backendService.getCachedInsights();
          if (controller.signal.aborted) return;
          if (cachedInsights.length > 0) safeSet(setInsights)(cachedInsights);

          const isOnline = await backendService.isOnline();
          if (controller.signal.aborted) return;

          let aiInsights = cachedInsights;
          if (isOnline) {
            try {
              const freshInsights = await backendService.getInsights();
              if (controller.signal.aborted) return;
              aiInsights = freshInsights;
            } catch (_err) {
              safeSet(setIsOfflineMode)(true);
            }
          } else {
            safeSet(setIsOfflineMode)(true);
          }

          if (!aiInsights || aiInsights.length === 0) {
            aiInsights = await generateInsights(userData);
            if (controller.signal.aborted) return;
          }

          safeSet(setInsights)(aiInsights);
        } catch (err) {
          if (!controller.signal.aborted) {
            console.error("Failed to fetch insights", err);
            safeSet(setIsOfflineMode)(true);
          }
        }
      })();

      // Sync current metrics to backend in background
      backendService.syncMetrics(userData.steps, userData.screenTime).catch(() => {});
    } catch (error) {
      if (controller.signal.aborted) return;
      console.error("Failed to load user data", error);
      clearTimeout(fastLoadTimer);
      safeSet(setData)((prev) => prev || DEFAULT_DASHBOARD_DATA);
      safeSet(setLoading)(false);
      safeSet(setIsRefreshingData)(false);
      safeSet(setIsOfflineMode)(true);
    }
  }, []);

  useEffect(() => {
    mountedRef.current = true;
    load();

    return () => {
      // Mark as unmounted and abort any in-flight load
      mountedRef.current = false;
      if (loadControllerRef.current) {
        loadControllerRef.current.abort();
      }
    };
  }, [load]);

  return { data, insights, loading, isRefreshingData, isOfflineMode, refresh: load };
}
