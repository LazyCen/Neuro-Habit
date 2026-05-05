import AsyncStorage from '@react-native-async-storage/async-storage';
import { createClient } from '@supabase/supabase-js';

// TODO: Replace these with your actual Supabase project URL and anon key
// You should store these in environment variables (e.g., using react-native-dotenv)
const supabaseUrl = process.env.EXPO_PUBLIC_SUPABASE_URL || 'https://holcuhieutkmehccycgm.supabase.co';
const supabaseAnonKey = process.env.EXPO_PUBLIC_SUPABASE_ANON_KEY || 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6ImhvbGN1aGlldXRrbWVoY2N5Y2dtIiwicm9sZSI6ImFub24iLCJpYXQiOjE3NzcyNjY5MjcsImV4cCI6MjA5Mjg0MjkyN30.ZcZXHesf4q9NQu5zLTaBpGdfOQOuJvJ08NxgeEDCNDc';

export const supabase = createClient(supabaseUrl, supabaseAnonKey, {
  auth: {
    storage: AsyncStorage,
    autoRefreshToken: true,
    persistSession: true,
    detectSessionInUrl: false,
  },
});
