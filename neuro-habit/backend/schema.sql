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
  first_name TEXT CHECK (char_length(first_name) <= 255),
  middle_name TEXT CHECK (char_length(middle_name) <= 255),
  last_name TEXT CHECK (char_length(last_name) <= 255),
  avatar_url TEXT CHECK (char_length(avatar_url) <= 1024),
  goals JSONB,
  updated_at TIMESTAMP WITH TIME ZONE DEFAULT NOW()
);

-- Habits Table
CREATE TABLE IF NOT EXISTS habits (
  id UUID DEFAULT uuid_generate_v4() PRIMARY KEY,
  user_id UUID REFERENCES auth.users ON DELETE CASCADE,
  title TEXT NOT NULL CHECK (char_length(title) <= 100),
  streak INTEGER DEFAULT 0,
  last_completed_at TIMESTAMP WITH TIME ZONE,
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
  note TEXT CHECK (char_length(note) <= 1000),
  timestamp TIMESTAMP WITH TIME ZONE DEFAULT NOW()
);

-- Daily Metrics Table
CREATE TABLE IF NOT EXISTS daily_metrics (
  id UUID DEFAULT uuid_generate_v4() PRIMARY KEY,
  user_id UUID REFERENCES auth.users ON DELETE CASCADE,
  steps INTEGER DEFAULT 0 CHECK (steps >= 0),
  screen_time FLOAT DEFAULT 0.0 CHECK (screen_time >= 0.0),
  date DATE DEFAULT CURRENT_DATE,
  UNIQUE(user_id, date)
);

-- AI Insights Table
CREATE TABLE IF NOT EXISTS ai_insights (
  id UUID DEFAULT uuid_generate_v4() PRIMARY KEY,
  user_id UUID REFERENCES auth.users ON DELETE CASCADE,
  text TEXT NOT NULL CHECK (char_length(text) <= 5000),
  type TEXT CHECK (type IN ('positive', 'neutral', 'warning')), -- 'positive', 'neutral', 'warning'
  icon TEXT CHECK (char_length(icon) <= 50),
  created_at TIMESTAMP WITH TIME ZONE DEFAULT NOW()
);

-- Indexes for Performance
CREATE INDEX IF NOT EXISTS idx_mood_logs_user_timestamp ON mood_logs (user_id, timestamp DESC);
CREATE INDEX IF NOT EXISTS idx_habit_logs_user_created ON habit_logs (user_id, created_at DESC);
CREATE INDEX IF NOT EXISTS idx_habit_logs_user_id_created_at ON habit_logs (user_id, created_at);
CREATE INDEX IF NOT EXISTS idx_habits_user_id ON habits (user_id);
CREATE INDEX IF NOT EXISTS idx_ai_insights_user_created ON ai_insights (user_id, created_at DESC);

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
CREATE POLICY "Users can delete their own metrics" ON daily_metrics FOR DELETE USING (auth.uid() = user_id);

CREATE POLICY "Users can view their own insights" ON ai_insights FOR SELECT USING (auth.uid() = user_id);
CREATE POLICY "Users can delete their own insights" ON ai_insights FOR DELETE USING (auth.uid() = user_id);

-- Trigger to create a profile after signup
CREATE OR REPLACE FUNCTION public.handle_new_user()
RETURNS TRIGGER AS $$
BEGIN
  INSERT INTO public.profiles (id, first_name, middle_name, last_name)
  VALUES (
    NEW.id,
    COALESCE(NEW.raw_user_meta_data->>'first_name', ''),
    COALESCE(NEW.raw_user_meta_data->>'middle_name', ''),
    COALESCE(NEW.raw_user_meta_data->>'last_name', '')
  )
  ON CONFLICT (id) DO UPDATE SET
    first_name = EXCLUDED.first_name,
    middle_name = EXCLUDED.middle_name,
    last_name = EXCLUDED.last_name,
    updated_at = NOW();
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
  SELECT COUNT(DISTINCT habit_id) INTO v_habits_completed FROM habit_logs WHERE user_id = auth.uid() AND created_at >= CURRENT_DATE AND created_at < CURRENT_DATE + INTERVAL '1 day';

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
SET search_path = public, pg_temp
AS $$
DECLARE
  insight RECORD;
BEGIN
  IF (auth.uid() IS NULL OR auth.uid() != p_user_id) AND (auth.role() <> 'service_role') THEN
    RAISE EXCEPTION 'Unauthorized';
  END IF;

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
SET search_path = public, pg_temp
AS $$
BEGIN
  IF (auth.uid() IS NULL OR auth.uid() != p_user_id) AND (auth.role() <> 'service_role') THEN
    RAISE EXCEPTION 'Unauthorized';
  END IF;

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
SET search_path = public, pg_temp
AS $$
BEGIN
  IF auth.role() <> 'service_role' THEN
    RAISE EXCEPTION 'Unauthorized: Service role only';
  END IF;

  RETURN QUERY
  WITH target_users AS (
    SELECT DISTINCT dm.user_id FROM daily_metrics dm
  ),
  recent_metrics AS (
    SELECT u.user_id, dm.date, dm.steps, dm.screen_time
    FROM target_users u
    CROSS JOIN LATERAL (
      SELECT dm2.date, dm2.steps, dm2.screen_time
      FROM daily_metrics dm2
      WHERE dm2.user_id = u.user_id
      ORDER BY dm2.date DESC
      LIMIT 10
    ) dm
  )
  SELECT 
    rm.user_id,
    TO_CHAR(rm.date, 'YYYY-MM-DD') as date,
    rm.steps,
    rm.screen_time,
    COALESCE((
      SELECT MAX(ml.mood_score)
      FROM mood_logs ml
      WHERE ml.user_id = rm.user_id 
        AND ml.timestamp >= rm.date::timestamp 
        AND ml.timestamp < (rm.date + 1)::timestamp
    ), 0)::INTEGER as mood,
    COALESCE((
      SELECT COUNT(*)::INTEGER
      FROM habit_logs hl
      WHERE hl.user_id = rm.user_id 
        AND hl.created_at >= rm.date::timestamp 
        AND hl.created_at < (rm.date + 1)::timestamp
    ), 0)::INTEGER as habits_completed
  FROM recent_metrics rm;
END;
$$;

-- Single-User Insights Data RPC (Optimized version of the above)
CREATE OR REPLACE FUNCTION get_user_insights_data(p_user_id UUID)
RETURNS TABLE (
  date TEXT,
  steps INTEGER,
  screen_time FLOAT,
  mood INTEGER,
  habits_completed INTEGER
)
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
BEGIN
  IF (auth.uid() IS NULL OR auth.uid() != p_user_id) AND (auth.role() <> 'service_role') THEN
    RAISE EXCEPTION 'Unauthorized';
  END IF;

  RETURN QUERY
  WITH recent_metrics AS (
    SELECT dm.date, dm.steps, dm.screen_time
    FROM daily_metrics dm
    WHERE dm.user_id = p_user_id
    ORDER BY dm.date DESC
    LIMIT 10
  ),
  daily_mood AS (
    SELECT DATE(ml.timestamp) as date, MAX(ml.mood_score) as mood_score
    FROM mood_logs ml
    WHERE ml.user_id = p_user_id
    GROUP BY DATE(ml.timestamp)
  ),
  daily_habits AS (
    SELECT DATE(hl.created_at) as date, COUNT(*)::INTEGER as habits_completed
    FROM habit_logs hl
    WHERE hl.user_id = p_user_id
    GROUP BY DATE(hl.created_at)
  )
  SELECT 
    TO_CHAR(rm.date, 'YYYY-MM-DD') as date,
    rm.steps,
    rm.screen_time,
    COALESCE(dm.mood_score, 0)::INTEGER as mood,
    COALESCE(dh.habits_completed, 0)::INTEGER as habits_completed
  FROM recent_metrics rm
  LEFT JOIN daily_mood dm ON rm.date = dm.date
  LEFT JOIN daily_habits dh ON rm.date = dh.date
  ORDER BY rm.date DESC;
END;
$$;


-- RPC for optimized dashboard metrics fetch
CREATE OR REPLACE FUNCTION get_dashboard_metrics()
RETURNS JSON AS $$
DECLARE
    result JSON;
    v_user_id UUID;
BEGIN
    v_user_id := auth.uid();
    
    WITH mood_val AS (
        SELECT mood_score 
        FROM mood_logs 
        WHERE user_id = v_user_id 
        ORDER BY timestamp DESC 
        LIMIT 1
    ),
    habit_counts AS (
        SELECT 
            COUNT(*)::INTEGER as habits_total
        FROM habits 
        WHERE user_id = v_user_id
    ),
    habit_completions AS (
        SELECT 
            COUNT(DISTINCT habit_id)::INTEGER as habits_completed
        FROM habit_logs 
        WHERE user_id = v_user_id 
        AND status = 'completed'
        AND created_at >= (CURRENT_DATE AT TIME ZONE 'UTC')
    )
    SELECT json_build_object(
        'mood', (SELECT mood_score FROM mood_val),
        'habits_total', (SELECT habits_total FROM habit_counts),
        'habits_completed', (SELECT habits_completed FROM habit_completions)
    ) INTO result;
    
    RETURN result;
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;
