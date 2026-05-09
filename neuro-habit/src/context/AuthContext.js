import React, { createContext, useState, useEffect, useContext } from 'react';
import { Alert } from 'react-native';
import { supabase } from '../services/supabaseClient';
import { backendService } from '../services/backendService';

const AuthContext = createContext();

export const AuthProvider = ({ children }) => {
  const [session, setSession] = useState(null);
  const [loading, setLoading] = useState(true);

  console.log('AuthProvider: Rendering with session:', session ? 'Active' : 'None');

  useEffect(() => {
    console.log('AuthProvider: Initializing auth state');
    
    // Small delay to ensure storage is ready
    setTimeout(() => {

      supabase.auth.getSession().then(async ({ data: { session }, error }) => {
        if (error) console.error('AuthContext: Error getting session:', error);
        
        if (session?.user?.user_metadata?.account_delete_requested) {
          console.warn('AuthContext: Initial session detected as deleted. Purging local data.');
          await signOut(true);
        } else {
          console.log('AuthContext: Initial session:', session ? 'Found' : 'Not found');
          setSession(session);
        }
        setLoading(false);
      });

    }, 500);

    // Test connection with deep diagnostics
    const testConnection = async (retries = 3, delay = 2000) => {
      const supabaseUrl = process.env.EXPO_PUBLIC_SUPABASE_URL;
      const supabaseKey = process.env.EXPO_PUBLIC_SUPABASE_ANON_KEY;
      
      console.log('AuthContext: [Diagnostic] System Time:', new Date().toISOString());
      console.log('AuthContext: [Diagnostic] Config:', { 
        url: supabaseUrl ? 'Set' : 'Missing',
        key: supabaseKey ? 'Set' : 'Missing' 
      });

      // 1. Check general internet connectivity first
      try {
        const netCheck = await fetch('https://8.8.8.8', { method: 'HEAD' }).catch(() => null);
        if (!netCheck) {
          console.warn('AuthContext: [Diagnostic] General internet check failed (8.8.8.8). Device may be offline or network is restricted.');
        } else {
          console.log('AuthContext: [Diagnostic] General internet check successful.');
        }
      } catch (e) {
        console.warn('AuthContext: [Diagnostic] General internet check threw error:', e.message);
      }

      if (!supabaseUrl || !supabaseKey) {
        console.error('AuthContext: Supabase environment variables are missing!');
        return;
      }

      try {
        const { error } = await supabase.from('habits').select('count', { count: 'exact', head: true });
        
        if (error) {
          console.error('AuthContext: Supabase connection test failed:', error.message);
          
          if (retries > 0 && (error.message.includes('Fetch') || error.message.includes('network') || error.message.includes('Network'))) {
            console.log(`AuthContext: Retrying connection test in ${delay}ms... (${retries} attempts left)`);
            setTimeout(() => testConnection(retries - 1, delay * 2), delay);
          } else if (error.message.includes('Fetch') || error.message.includes('network') || error.message.includes('Network')) {
            Alert.alert('Connection Error', 'Cannot reach Supabase. Please check your internet connection or if your network blocks Supabase.');
          }
        } else {
          console.log('AuthContext: Supabase connection test successful');
        }
      } catch (err) {
        console.error('AuthContext: Unexpected error during connection test:', err);
        if (retries > 0) {
          setTimeout(() => testConnection(retries - 1, delay * 2), delay);
        }
      }
    };

    testConnection();




    // Listen for auth changes
    const { data: { subscription } } = supabase.auth.onAuthStateChange(async (_event, session) => {
      console.log('AuthContext: Auth state changed event:', _event);
      
      if (session?.user?.user_metadata?.account_delete_requested) {
        console.warn('AuthContext: Detected account in deletion state. Purging local data.');
        await signOut(true);
        setLoading(false);
        return;
      }

      setSession(session);
      setLoading(false);

      
      // If user was updated, re-fetch to get latest metadata
      if (_event === 'USER_UPDATED' && session?.user?.id) {
        supabase.auth.getSession().then(({ data: { session: freshSession } }) => {
          if (freshSession) {
            console.log('AuthContext: Refreshed session after user update');
            setSession(freshSession);
          }
        });
      }
    });

    return () => {
      subscription.unsubscribe();
    };
  }, []);

  const signIn = async (email, password) => {
    console.log('AuthContext: Attempting signIn');
    try {
      // Add a timeout to avoid hanging indefinitely
      const timeoutPromise = new Promise((_, reject) => 
        setTimeout(() => reject(new Error('Sign-in timed out. Please check your connection.')), 10000)
      );

      const signInPromise = supabase.auth.signInWithPassword({
        email: email.trim(),
        password,
      });

      const { data, error } = await Promise.race([signInPromise, timeoutPromise]);
      
      if (error) throw error;
      
      if (data.session) {
        console.log('AuthContext: Session received, updating state');
        setSession(data.session);
      } else {
        console.log('AuthContext: No session returned (likely email not confirmed)');
      }
      
      return { data, error: null };
    } catch (error) {
      console.error('AuthContext: SignIn error:', error.message);
      return { data: null, error };
    }
  };

  const signUp = async (email, password, metadata = {}) => {
    console.log('AuthContext: Attempting signUp');
    try {
      const { data, error } = await supabase.auth.signUp({
        email: email.trim(),
        password,
        options: {
          data: metadata
        }
      });
      if (error) throw error;
      if (data.session) setSession(data.session);
      return { data, error: null };
    } catch (error) {
      console.error('AuthContext: SignUp error:', error.message);
      return { data: null, error };
    }
  };

  const signOut = async (shouldPurge = false) => {
    if (shouldPurge) {
      await backendService.purgeAllLocalData(true);
    }
    await supabase.auth.signOut();
    setSession(null);
  };

  return (
    <AuthContext.Provider value={{ session, loading, signIn, signUp, signOut }}>
      {children}
    </AuthContext.Provider>
  );
};

export const useAuth = () => {
  return useContext(AuthContext);
};
