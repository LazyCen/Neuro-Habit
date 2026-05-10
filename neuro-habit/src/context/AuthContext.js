import React, { createContext, useState, useEffect, useContext } from 'react';
import { supabase } from '../services/supabaseClient';
import { backendService } from '../services/backendService';

const AuthContext = createContext();

export const AuthProvider = ({ children }) => {
  const [session, setSession] = useState(null);
  const [loading, setLoading] = useState(true);

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

    // Silent diagnostic — does NOT alert the user if offline.
    // Auth works offline via persisted SecureStore tokens; errors here are
    // informational only for developers (visible in Sentry / Metro logs).
    const testConnection = async () => {
      const supabaseUrl = process.env.EXPO_PUBLIC_SUPABASE_URL;
      const supabaseKey = process.env.EXPO_PUBLIC_SUPABASE_ANON_KEY;
      if (!supabaseUrl || !supabaseKey) {
        console.error('AuthContext: Supabase environment variables are missing!');
        return;
      }
      try {
        const { error } = await supabase.from('habits').select('count', { count: 'exact', head: true });
        if (error) {
          // Log silently — do NOT alert; user may be offline intentionally
          console.warn('AuthContext: [Diagnostic] Supabase connection check failed:', error.message);
        }
      } catch (err) {
        // Network unavailable — completely expected in offline mode
        console.warn('AuthContext: [Diagnostic] Offline or network restricted:', err?.message);
      }
    };

    testConnection();




    // Listen for auth changes
    const { data: { subscription } } = supabase.auth.onAuthStateChange(async (_event, session) => {
      if (session?.user?.user_metadata?.account_delete_requested) {
        await signOut(true);
        setLoading(false);
        return;
      }

      setSession(session);
      setLoading(false);

      // If user was updated, re-fetch to get latest metadata
      if (_event === 'USER_UPDATED' && session?.user?.id) {
        supabase.auth.getSession().then(({ data: { session: freshSession } }) => {
          if (freshSession) setSession(freshSession);
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
      console.error('AuthContext: SignUp error:', error);
      if (error.message === 'Database error saving new user') {
        console.error('AuthContext: This typically means a trigger on auth.users failed. Check your Supabase logs or schema.sql trigger.');
      }
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
