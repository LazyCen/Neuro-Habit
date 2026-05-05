from fastapi import FastAPI, Depends, HTTPException
from fastapi.middleware.cors import CORSMiddleware
from pydantic import BaseModel
from typing import List, Optional
import datetime
import os
from dotenv import load_dotenv
from supabase import create_client, Client

load_dotenv()

app = FastAPI(title="Neuro Habit API")

# Supabase setup
url: str = os.environ.get("SUPABASE_URL")
key: str = os.environ.get("SUPABASE_KEY")
if not url or not key:
    raise RuntimeError("SUPABASE_URL and SUPABASE_KEY must be set in environment")
supabase: Client = create_client(url, key)

# Enable CORS for the React Native app
app.add_middleware(
    CORSMiddleware,
    allow_origins=["*"],
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)

# --- Models ---

class Habit(BaseModel):
    id: Optional[str] = None
    name: str
    completed: bool = False
    streak: int = 0

class MoodLog(BaseModel):
    mood: int  # 1-10
    note: Optional[str] = None
    timestamp: datetime.datetime = datetime.datetime.now()

class DailyMetrics(BaseModel):
    steps: int
    screen_time: float # hours
    date: datetime.date = datetime.date.today()

class Insight(BaseModel):
    text: str
    type: str # 'positive', 'neutral', 'warning'
    icon: str

import utils


def check_supabase_response(response):
    if response is None:
        raise HTTPException(status_code=500, detail="Supabase returned no response")

    error = getattr(response, "error", None)
    if error:
        raise HTTPException(status_code=500, detail=str(error))

    return response


# --- Routes ---

@app.get("/")
async def root():
    return {"message": "Welcome to Neuro Habit API"}

@app.get("/insights", response_model=List[Insight])
async def get_insights(user_id: str = "default-user"):
    # Try to fetch cached insights from Supabase
    response = check_supabase_response(supabase.table("ai_insights").select("*").eq("user_id", user_id).order("created_at", desc=True).limit(5).execute())
    
    if response.data:
        return [Insight(**d) for d in response.data]
    
    # Fallback: Generate insights from historical data
    # Fetch historical metrics for correlation
    history_res = check_supabase_response(supabase.table("daily_metrics").select("*").eq("user_id", user_id).order("date", desc=True).limit(10).execute())
    
    if history_res.data:
        corrs = utils.calculate_correlations(history_res.data)
        insights = utils.generate_natural_language_insight(corrs)
        return insights

    return [
        {
            "text": "Start logging your habits and mood to see personalized insights!",
            "type": "neutral",
            "icon": "sparkles"
        }
    ]

@app.post("/habits")
async def create_habit(habit: Habit, user_id: str = "default-user"):
    data = {
        "user_id": user_id,
        "name": habit.name,
        "completed": habit.completed,
        "streak": habit.streak
    }
    response = check_supabase_response(supabase.table("habits").insert(data).execute())
    return response.data[0] if response.data else {"status": "error"}

@app.post("/mood")
async def log_mood(log: MoodLog, user_id: str = "default-user"):
    data = {
        "user_id": user_id,
        "mood_score": log.mood,
        "note": log.note,
        "timestamp": log.timestamp.isoformat()
    }
    response = check_supabase_response(supabase.table("mood_logs").insert(data).execute())
    return response.data[0] if response.data else {"status": "error"}

@app.post("/metrics")
async def update_metrics(metrics: DailyMetrics, user_id: str = "default-user"):
    data = {
        "user_id": user_id,
        "steps": metrics.steps,
        "screen_time": metrics.screen_time,
        "date": metrics.date.isoformat()
    }
    # Upsert based on date and user_id - use list for on_conflict parameter
    response = check_supabase_response(supabase.table("daily_metrics").upsert(data, on_conflict=["user_id", "date"]).execute())
    return response.data[0] if response.data else {"status": "error"}

if __name__ == "__main__":
    import uvicorn
    uvicorn.run(app, host="0.0.0.0", port=8000)
