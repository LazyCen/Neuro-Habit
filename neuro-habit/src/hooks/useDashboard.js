import { useEffect, useState } from "react";
import { fetchUserData } from "../services/api";
import { generateInsights } from "../services/aiEngine";
import { backendService } from "../services/backendService";
import AsyncStorage from "@react-native-async-storage/async-storage";

const DASHBOARD_CACHE_KEY = "dashboard_data_cache_v1";
const FAST_LOAD_TIMEOUT_MS = 1800;
const DEFAULT_DASHBOARD_DATA = {
  steps: 0,
  screenTime: 0,
  mood: 7,
  habitsCompleted: 0,
  habitsTotal: 0,
  streak: 0,
};

export default function useDashboard() {
  const [data, setData] = useState(null);
  const [insights, setInsights] = useState([]);
  const [loading, setLoading] = useState(true);
  const [isRefreshingData, setIsRefreshingData] = useState(false);

  const load = async () => {
    setLoading(true);
    setIsRefreshingData(true);
    let fastLoadTimer;
    try {
      const cachedRaw = await AsyncStorage.getItem(DASHBOARD_CACHE_KEY);
      const cachedData = cachedRaw ? JSON.parse(cachedRaw) : null;
      if (cachedData) {
        setData(cachedData);
        setLoading(false);
      }

      fastLoadTimer = setTimeout(() => {
        setData((prev) => prev || DEFAULT_DASHBOARD_DATA);
        setLoading(false);
      }, FAST_LOAD_TIMEOUT_MS);

      const userData = await fetchUserData();
      setData(userData);
      AsyncStorage.setItem(DASHBOARD_CACHE_KEY, JSON.stringify(userData)).catch(() => {});
      backendService.syncPendingData().catch(() => {});

      clearTimeout(fastLoadTimer);
      setLoading(false);
      setIsRefreshingData(false);
      
      // Fetch insights in the background
      (async () => {
        try {
          const cachedInsights = await backendService.getCachedInsights();
          if (cachedInsights.length > 0) {
            setInsights(cachedInsights);
          }

          const isOnline = await backendService.isOnline();
          let aiInsights = cachedInsights;

          if (isOnline) {
            aiInsights = await backendService.getInsights();
          }

          if (!aiInsights || aiInsights.length === 0) {
            aiInsights = await generateInsights(userData);
          }

          setInsights(aiInsights);
        } catch (err) {
          console.error("Failed to fetch insights", err);
        }
      })();
      
      // Sync current metrics to backend in background
      backendService.syncMetrics(userData.steps, userData.screenTime).catch(() => {});
      
    } catch (error) {
      console.error("Failed to load user data", error);
      clearTimeout(fastLoadTimer);
      setData((prev) => prev || DEFAULT_DASHBOARD_DATA);
      setLoading(false);
      setIsRefreshingData(false);
    }
  };

  useEffect(() => {
    load();
  }, []);

  return { data, insights, loading, isRefreshingData, refresh: load };
}
