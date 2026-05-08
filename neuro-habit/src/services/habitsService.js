import { supabase } from './supabaseClient';

export const habitsService = {
  async getHabits() {
    const { data: { session } } = await supabase.auth.getSession();
    if (!session) throw new Error('No user logged in');

    const { data, error } = await supabase
      .from('habits')
      .select('*')
      .eq('user_id', session.user.id);
    
    if (error) throw error;
    return data;
  },

  async addHabit(name) {
    const { data: { session } } = await supabase.auth.getSession();
    if (!session) throw new Error('No user logged in');

    const { data, error } = await supabase
      .from('habits')
      .insert([
        { user_id: session.user.id, name }
      ])
      .select();

    if (error) throw error;
    return data[0];
  },

  async logHabit(habitId, status = 'completed') {
    const { data: { session } } = await supabase.auth.getSession();
    if (!session) throw new Error('No user logged in');

    const { data, error } = await supabase
      .from('habit_logs')
      .insert([
        { 
          user_id: session.user.id, 
          habit_id: habitId, 
          status 
        }
      ])
      .select();

    if (error) throw error;
    return data[0];
  },

  async getHabitLogs(habitId) {
    const { data: { session } } = await supabase.auth.getSession();
    if (!session) throw new Error('No user logged in');

    let query = supabase
      .from('habit_logs')
      .select('*')
      .eq('user_id', session.user.id);

    if (habitId) {
      query = query.eq('habit_id', habitId);
    }
    
    const { data, error } = await query;
    
    if (error) throw error;
    return data;
  }
};
