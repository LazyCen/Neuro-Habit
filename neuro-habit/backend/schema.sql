-- SQL Script to set up Neuro Habit tables in Supabase

-- ---------------------------------------------------------------------------
-- Extensions
-- uuid_generate_v4() requires uuid-ossp. Declare it first so the script is
-- self-contained and portable across fresh PostgreSQL / Supabase instances.
-- ---------------------------------------------------------------------------
CREATE EXTENSION IF NOT EXISTS "uuid-ossp";

-- Profiles Table
CREATE TABLE IF NOT EXISTS profiles (
  id UUID REFERENCES auth.users ON DELETE CASCADE PRIMARY KEY,
  first_name TEXT,
  middle_name TEXT,
  last_name TEXT,
  avatar_url TEXT,
  goals JSONB,
  updated_at TIMESTAMP WITH TIME ZONE DEFAULT NOW()
);

-- Habits Table
CREATE TABLE IF NOT EXISTS habits (
  id UUID DEFAULT uuid_generate_v4() PRIMARY KEY,
  user_id UUID REFERENCES auth.users ON DELETE CASCADE,
  name TEXT NOT NULL,
  streak INTEGER DEFAULT 0,
  created_at TIMESTAMP WITH TIME ZONE DEFAULT NOW()
);

-- Habit Logs Table
CREATE TABLE IF NOT EXISTS habit_logs (
  id UUID DEFAULT uuid_generate_v4() PRIMARY KEY,
  user_id UUID REFERENCES auth.users ON DELETE CASCADE,
  habit_id UUID REFERENCES habits(id) ON DELETE CASCADE,
  status TEXT,
  created_at TIMESTAMP WITH TIME ZONE DEFAULT NOW()
);

-- Mood Logs Table
CREATE TABLE IF NOT EXISTS mood_logs (
  id UUID DEFAULT uuid_generate_v4() PRIMARY KEY,
  user_id UUID REFERENCES auth.users ON DELETE CASCADE,
  mood_score INTEGER CHECK (mood_score >= 1 AND mood_score <= 10),
  note TEXT,
  timestamp TIMESTAMP WITH TIME ZONE DEFAULT NOW()
);

-- Daily Metrics Table
CREATE TABLE IF NOT EXISTS daily_metrics (
  id UUID DEFAULT uuid_generate_v4() PRIMARY KEY,
  user_id UUID REFERENCES auth.users ON DELETE CASCADE,
  steps INTEGER DEFAULT 0,
  screen_time FLOAT DEFAULT 0.0,
  date DATE DEFAULT CURRENT_DATE,
  UNIQUE(user_id, date)
);

-- AI Insights Table
CREATE TABLE IF NOT EXISTS ai_insights (
  id UUID DEFAULT uuid_generate_v4() PRIMARY KEY,
  user_id UUID REFERENCES auth.users ON DELETE CASCADE,
  text TEXT NOT NULL,
  type TEXT, -- 'positive', 'neutral', 'warning'
  icon TEXT,
  created_at TIMESTAMP WITH TIME ZONE DEFAULT NOW()
);

-- Enable RLS
ALTER TABLE profiles ENABLE ROW LEVEL SECURITY;
ALTER TABLE habits ENABLE ROW LEVEL SECURITY;
ALTER TABLE habit_logs ENABLE ROW LEVEL SECURITY;
ALTER TABLE mood_logs ENABLE ROW LEVEL SECURITY;
ALTER TABLE daily_metrics ENABLE ROW LEVEL SECURITY;
ALTER TABLE ai_insights ENABLE ROW LEVEL SECURITY;

-- Basic Policies (Allow users to see only their own data)
CREATE POLICY "Users can view their own profile" ON profiles FOR SELECT USING (auth.uid() = id);
CREATE POLICY "Users can update their own profile" ON profiles FOR UPDATE USING (auth.uid() = id) WITH CHECK (auth.uid() = id);

CREATE POLICY "Users can view their own habits" ON habits FOR SELECT USING (auth.uid() = user_id);
CREATE POLICY "Users can insert their own habits" ON habits FOR INSERT WITH CHECK (auth.uid() = user_id);
CREATE POLICY "Users can update their own habits" ON habits FOR UPDATE USING (auth.uid() = user_id) WITH CHECK (auth.uid() = user_id);
CREATE POLICY "Users can delete their own habits" ON habits FOR DELETE USING (auth.uid() = user_id);

CREATE POLICY "Users can view their own habit logs" ON habit_logs FOR SELECT USING (auth.uid() = user_id);
CREATE POLICY "Users can insert their own habit logs" ON habit_logs FOR INSERT WITH CHECK (auth.uid() = user_id);
CREATE POLICY "Users can delete their own habit logs" ON habit_logs FOR DELETE USING (auth.uid() = user_id);

CREATE POLICY "Users can view their own mood logs" ON mood_logs FOR SELECT USING (auth.uid() = user_id);
CREATE POLICY "Users can insert their own mood logs" ON mood_logs FOR INSERT WITH CHECK (auth.uid() = user_id);
CREATE POLICY "Users can update their own mood logs" ON mood_logs FOR UPDATE USING (auth.uid() = user_id) WITH CHECK (auth.uid() = user_id);
CREATE POLICY "Users can delete their own mood logs" ON mood_logs FOR DELETE USING (auth.uid() = user_id);

CREATE POLICY "Users can view their own metrics" ON daily_metrics FOR SELECT USING (auth.uid() = user_id);
CREATE POLICY "Users can insert their own metrics" ON daily_metrics FOR INSERT WITH CHECK (auth.uid() = user_id);
CREATE POLICY "Users can update their own metrics" ON daily_metrics FOR UPDATE USING (auth.uid() = user_id) WITH CHECK (auth.uid() = user_id);

CREATE POLICY "Users can view their own insights" ON ai_insights FOR SELECT USING (auth.uid() = user_id);

-- Trigger to create a profile after signup
CREATE OR REPLACE FUNCTION public.handle_new_user()
RETURNS TRIGGER AS $$
BEGIN
  INSERT INTO public.profiles (id, first_name, middle_name, last_name)
  VALUES (
    NEW.id,
    NEW.raw_user_meta_data->>'first_name',
    NEW.raw_user_meta_data->>'middle_name',
    NEW.raw_user_meta_data->>'last_name'
  );
  RETURN NEW;
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;

CREATE OR REPLACE TRIGGER on_auth_user_created
  AFTER INSERT ON auth.users
  FOR EACH ROW EXECUTE FUNCTION public.handle_new_user();

-- Dashboard Metrics RPC (Aggregates data in a single payload)
CREATE OR REPLACE FUNCTION get_dashboard_metrics()
RETURNS JSONB
LANGUAGE plpgsql
SECURITY INVOKER
AS $$
DECLARE
  v_mood INTEGER;
  v_habits_total INTEGER;
  v_habits_completed INTEGER;
  v_result JSONB;
BEGIN
  -- Get latest mood
  SELECT mood_score INTO v_mood
  FROM mood_logs
  WHERE user_id = auth.uid()
  ORDER BY timestamp DESC
  LIMIT 1;

  -- Get habits stats
  SELECT COUNT(*) INTO v_habits_total FROM habits WHERE user_id = auth.uid();
  SELECT COUNT(DISTINCT habit_id) INTO v_habits_completed FROM habit_logs WHERE user_id = auth.uid() AND DATE(created_at) = CURRENT_DATE;

  v_result := jsonb_build_object(
    'mood', v_mood,
    'habits_total', COALESCE(v_habits_total, 0),
    'habits_completed', COALESCE(v_habits_completed, 0)
  );

  RETURN v_result;
END;
$$;

-- Transactional replace for AI insights
CREATE OR REPLACE FUNCTION replace_user_insights(p_user_id UUID, p_insights JSONB)
RETURNS VOID
LANGUAGE plpgsql
SECURITY DEFINER
AS $$
DECLARE
  insight RECORD;
BEGIN
  -- Delete old insights
  DELETE FROM ai_insights WHERE user_id = p_user_id;

  -- Insert new insights
  FOR insight IN SELECT * FROM jsonb_array_elements(p_insights)
  LOOP
    INSERT INTO ai_insights (user_id, text, type, icon, created_at)
    VALUES (
      p_user_id,
      insight.value->>'text',
      insight.value->>'type',
      insight.value->>'icon',
      COALESCE((insight.value->>'created_at')::TIMESTAMP WITH TIME ZONE, NOW())
    );
  END LOOP;
END;
$$;

-- Atomic account deletion RPC
CREATE OR REPLACE FUNCTION delete_user_account(p_user_id UUID)
RETURNS VOID
LANGUAGE plpgsql
SECURITY DEFINER
AS $$
BEGIN
  -- Delete from all associated tables in a single transaction
  DELETE FROM public.habit_logs WHERE user_id = p_user_id;
  DELETE FROM public.mood_logs WHERE user_id = p_user_id;
  DELETE FROM public.daily_metrics WHERE user_id = p_user_id;
  DELETE FROM public.ai_insights WHERE user_id = p_user_id;
  DELETE FROM public.habits WHERE user_id = p_user_id;
  DELETE FROM public.profiles WHERE id = p_user_id;
END;
$$;

-- Bulk Insights Data RPC
CREATE OR REPLACE FUNCTION get_all_users_insights_data()
RETURNS TABLE (
  user_id UUID,
  date TEXT,
  steps INTEGER,
  screen_time FLOAT,
  mood INTEGER,
  habits_completed INTEGER
)
LANGUAGE plpgsql
SECURITY DEFINER
AS $$
BEGIN
  RETURN QUERY
  WITH recent_metrics AS (
    SELECT dm.user_id, dm.date, dm.steps, dm.screen_time,
           ROW_NUMBER() OVER (PARTITION BY dm.user_id ORDER BY dm.date DESC) as rn
    FROM daily_metrics dm
  ),
  daily_mood AS (
    SELECT ml.user_id, DATE(ml.timestamp) as date, MAX(ml.mood_score) as mood_score
    FROM mood_logs ml
    GROUP BY ml.user_id, DATE(ml.timestamp)
  ),
  daily_habits AS (
    SELECT hl.user_id, DATE(hl.created_at) as date, COUNT(*)::INTEGER as habits_completed
    FROM habit_logs hl
    GROUP BY hl.user_id, DATE(hl.created_at)
  )
  SELECT 
    rm.user_id,
    TO_CHAR(rm.date, 'YYYY-MM-DD') as date,
    rm.steps,
    rm.screen_time,
    COALESCE(dm.mood_score, 0)::INTEGER as mood,
    COALESCE(dh.habits_completed, 0)::INTEGER as habits_completed
  FROM recent_metrics rm
  LEFT JOIN daily_mood dm ON rm.user_id = dm.user_id AND rm.date = dm.date
  LEFT JOIN daily_habits dh ON rm.user_id = dh.user_id AND rm.date = dh.date
  WHERE rm.rn <= 10;
END;
$$;
