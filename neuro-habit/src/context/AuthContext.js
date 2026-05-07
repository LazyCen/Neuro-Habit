import React, { createContext, useState, useEffect, useContext } from 'react';
import { Alert } from 'react-native';
import { supabase } from '../services/supabaseClient';

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
          console.warn('AuthContext: Initial session detected as deleted. Clearing.');
          await supabase.auth.signOut();
          setSession(null);
        } else {
          console.log('AuthContext: Initial session:', session ? 'Found' : 'Not found');
          setSession(session);
        }
        setLoading(false);
      });

    }, 500);

    // Test connection
    supabase.from('habits').select('count', { count: 'exact', head: true })
      .then(({ error }) => {
        if (error) {
          console.error('AuthContext: Supabase connection test failed:', error.message);
          // Only alert if it's a network error, not an auth error
          if (error.message.includes('Fetch') || error.message.includes('network')) {
            Alert.alert('Connection Error', 'Cannot reach Supabase. Please check your internet and Supabase URL.');
          }
        } else {
          console.log('AuthContext: Supabase connection test successful');
        }
      });


    // Listen for auth changes
    const { data: { subscription } } = supabase.auth.onAuthStateChange(async (_event, session) => {
      console.log('AuthContext: Auth state changed event:', _event, 'Session user:', session?.user?.email);
      
      if (session?.user?.user_metadata?.account_delete_requested) {
        console.warn('AuthContext: Detected account in deletion state. Forcing sign out.');
        await supabase.auth.signOut();
        setSession(null);
        setLoading(false);
        return;
      }

      setSession(session);
      setLoading(false);

      
      // If user was updated, re-fetch to get latest metadata
      if (_event === 'USER_UPDATED' && session?.user?.id) {
        supabase.auth.getSession().then(({ data: { session: freshSession } }) => {
          if (freshSession) {
            console.log('AuthContext: Refreshed session after user update:', freshSession.user?.user_metadata);
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
    console.log('AuthContext: Attempting signIn for', email);
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
    console.log('AuthContext: Attempting signUp for', email);
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

  const signOut = async () => {
    await supabase.auth.signOut();
    setSession(null);
  };

  const bypassAuth = () => {
    setSession({
      user: { email: 'guest@example.com', id: 'guest-id' },
      access_token: 'dummy-token'
    });
  };

  return (
    <AuthContext.Provider value={{ session, loading, signIn, signUp, signOut, bypassAuth }}>
      {children}
    </AuthContext.Provider>
  );
};

export const useAuth = () => {
  return useContext(AuthContext);
};
