from fastapi import FastAPI, Depends, HTTPException, Security
from fastapi.middleware.cors import CORSMiddleware
from fastapi.security import HTTPBearer, HTTPAuthorizationCredentials
from pydantic import BaseModel, Field
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

# --- CORS (P0-4) ---
# In development the Expo bundler runs on the same machine; list explicit origins.
# Set ALLOWED_ORIGINS in .env for production (comma-separated list).
_raw_origins = os.environ.get("ALLOWED_ORIGINS", "")
ALLOWED_ORIGINS: list[str] = (
    [o.strip() for o in _raw_origins.split(",") if o.strip()]
    if _raw_origins
    else [
        "http://localhost:8081",
        "http://localhost:19006",
        "http://127.0.0.1:8081",
    ]
)

app.add_middleware(
    CORSMiddleware,
    allow_origins=ALLOWED_ORIGINS,
    allow_credentials=True,
    allow_methods=["GET", "POST", "PUT", "DELETE"],
    allow_headers=["Authorization", "Content-Type"],
)

# --- JWT Auth (P0-4) ---
_bearer_scheme = HTTPBearer(auto_error=False)


async def get_current_user(
    credentials: HTTPAuthorizationCredentials = Security(_bearer_scheme),
):
    """Validate the Supabase JWT and return the authenticated user object."""
    if not credentials:
        raise HTTPException(status_code=401, detail="Not authenticated")
    try:
        response = supabase.auth.get_user(credentials.credentials)
        if not response or not response.user:
            raise HTTPException(status_code=401, detail="Invalid or expired token")
        return response.user
    except HTTPException:
        raise
    except Exception:
        raise HTTPException(status_code=401, detail="Invalid or expired token")


# --- Models ---

class Habit(BaseModel):
    id: Optional[str] = None
    name: str
    completed: bool = False
    streak: int = 0


class MoodLog(BaseModel):
    mood: int  # 1-10
    note: Optional[str] = None
    # P0-5: use default_factory so each request gets the current time, not boot time
    timestamp: datetime.datetime = Field(default_factory=datetime.datetime.now)


class DailyMetrics(BaseModel):
    steps: int
    screen_time: float  # hours
    # P0-5: use default_factory
    date: datetime.date = Field(default_factory=datetime.date.today)


class Insight(BaseModel):
    text: str
    type: str  # 'positive', 'neutral', 'warning'
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
async def get_insights(user=Depends(get_current_user)):
    # P0-4: user_id comes from validated JWT, not query string
    user_id = user.id

    response = check_supabase_response(
        supabase.table("ai_insights")
        .select("*")
        .eq("user_id", user_id)
        .order("created_at", desc=True)
        .limit(5)
        .execute()
    )

    if response.data:
        return [Insight(**d) for d in response.data]

    history_res = check_supabase_response(
        supabase.table("daily_metrics")
        .select("*")
        .eq("user_id", user_id)
        .order("date", desc=True)
        .limit(10)
        .execute()
    )

    if history_res.data:
        corrs = utils.calculate_correlations(history_res.data)
        insights = utils.generate_natural_language_insight(corrs)
        return insights

    return [
        {
            "text": "Start logging your habits and mood to see personalized insights!",
            "type": "neutral",
            "icon": "sparkles",
        }
    ]


@app.post("/habits")
async def create_habit(habit: Habit, user=Depends(get_current_user)):
    data = {
        "user_id": user.id,
        "name": habit.name,
        "completed": habit.completed,
        "streak": habit.streak,
    }
    response = check_supabase_response(supabase.table("habits").insert(data).execute())
    return response.data[0] if response.data else {"status": "error"}


@app.post("/mood")
async def log_mood(log: MoodLog, user=Depends(get_current_user)):
    data = {
        "user_id": user.id,
        "mood_score": log.mood,
        "note": log.note,
        "timestamp": log.timestamp.isoformat(),
    }
    response = check_supabase_response(supabase.table("mood_logs").insert(data).execute())
    return response.data[0] if response.data else {"status": "error"}


@app.post("/metrics")
async def update_metrics(metrics: DailyMetrics, user=Depends(get_current_user)):
    data = {
        "user_id": user.id,
        "steps": metrics.steps,
        "screen_time": metrics.screen_time,
        "date": metrics.date.isoformat(),
    }
    # P0-6: on_conflict must be a comma-separated string, not a list
    response = check_supabase_response(
        supabase.table("daily_metrics")
        .upsert(data, on_conflict="user_id,date")
        .execute()
    )
    return response.data[0] if response.data else {"status": "error"}


if __name__ == "__main__":
    import uvicorn
    uvicorn.run(app, host="0.0.0.0", port=8000)
