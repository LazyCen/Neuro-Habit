import asyncio
from fastapi import APIRouter, Depends, Request, HTTPException
from typing import List
from supabase import Client
import datetime
import utils
from models.schemas import Habit, MoodLog, DailyMetrics, Insight
from core.security import get_current_user, get_user_client, get_admin_client, verify_cron_secret
from core.rate_limit import limiter, LIMIT_READ, LIMIT_WRITE, LIMIT_AI
from services.db_service import check_supabase_response

router = APIRouter()

@router.get("/")
@limiter.limit(LIMIT_READ)
async def root(request: Request):
    return {"message": "Welcome to Neuro Habit API"}

@router.get("/time")
@limiter.limit(LIMIT_READ)
async def get_time(request: Request):
    return {"utc_time": datetime.datetime.now(datetime.timezone.utc).isoformat()}

@router.get("/insights", response_model=List[Insight])
@limiter.limit(LIMIT_AI)
async def get_insights(request: Request, user=Depends(get_current_user), client: Client = Depends(get_user_client)):
    user_id = user.id
    response = check_supabase_response(
        client.table("ai_insights").select("*").eq("user_id", user_id).order("created_at", desc=True).limit(5).execute()
    )
    if response.data:
        return [Insight(**d) for d in response.data]

    metrics_res = check_supabase_response(
        client.table("daily_metrics").select("*").eq("user_id", user_id).order("date", desc=True).limit(10).execute()
    )
    if metrics_res.data:
        data_by_date = {d["date"]: d for d in metrics_res.data}
        mood_res = check_supabase_response(client.table("mood_logs").select("timestamp, mood_score").eq("user_id", user_id).execute())
        for m in mood_res.data or []:
            date = m["timestamp"].split("T")[0]
            if date in data_by_date:
                data_by_date[date]["mood"] = m["mood_score"]

        habits_res = check_supabase_response(client.table("habit_logs").select("created_at").eq("user_id", user_id).execute())
        for h in habits_res.data or []:
            date = h["created_at"].split("T")[0]
            if date in data_by_date:
                data_by_date[date]["habits_completed"] = data_by_date[date].get("habits_completed", 0) + 1

        combined_data = list(data_by_date.values())
        corrs = utils.calculate_correlations(combined_data)
        insights = utils.generate_natural_language_insight(corrs)
        if insights:
            return insights

    return [{"text": "Start logging your habits and mood to see personalized insights!", "type": "neutral", "icon": "sparkles"}]

@router.post("/habits")
@limiter.limit(LIMIT_WRITE)
async def create_habit(request: Request, habit: Habit, user=Depends(get_current_user), client: Client = Depends(get_user_client)):
    data = {"user_id": user.id, "name": habit.name}
    response = check_supabase_response(client.table("habits").insert(data).execute())
    return response.data[0] if response.data else {"status": "error"}

@router.post("/mood")
@limiter.limit(LIMIT_WRITE)
async def log_mood(request: Request, log: MoodLog, user=Depends(get_current_user), client: Client = Depends(get_user_client)):
    data = {"user_id": user.id, "mood_score": log.mood, "note": log.note, "timestamp": log.timestamp.isoformat()}
    response = check_supabase_response(client.table("mood_logs").insert(data).execute())
    return response.data[0] if response.data else {"status": "error"}

@router.post("/metrics")
@limiter.limit(LIMIT_WRITE)
async def update_metrics(request: Request, metrics: DailyMetrics, user=Depends(get_current_user), client: Client = Depends(get_user_client)):
    data = {"user_id": user.id, "steps": metrics.steps, "screen_time": metrics.screen_time, "date": metrics.date.isoformat()}
    response = check_supabase_response(client.table("daily_metrics").upsert(data, on_conflict="user_id,date").execute())
    return response.data[0] if response.data else {"status": "error"}


@router.delete("/account")
@limiter.limit(LIMIT_WRITE)
async def delete_account(request: Request, user=Depends(get_current_user), admin: Client = Depends(get_admin_client)):
    user_id = user.id
    try:
        # First, mark the user as 'deleting' in metadata to prevent concurrent operations
        # and signal that the account is in a terminal state.
        admin.auth.admin.update_user_by_id(
            user_id, 
            {"user_metadata": {"account_delete_requested": True}}
        )

        # Wipe user data atomically using the RPC
        rpc_res = admin.rpc("delete_user_account", {"p_user_id": user_id}).execute()
        
        # Finally, delete the auth user record itself
        # This is the point of no return for the session
        admin.auth.admin.delete_user(user_id)
        
        return {"status": "success", "message": "Account and all associated data deleted successfully."}
    except Exception as exc:
        print(f"Error during account deletion for user {user_id}: {str(exc)}")
        raise HTTPException(
            status_code=500, 
            detail="A critical error occurred during account deletion. Please contact support if your session persists."
        )


@router.post("/admin/generate-insights", include_in_schema=False)
async def admin_generate_insights(request: Request, _: None = Depends(verify_cron_secret), admin: Client = Depends(get_admin_client)):
    users_res = admin.table("daily_metrics").select("user_id").execute()
    if not users_res.data:
        return {"status": "no_data", "users_processed": 0}

    user_ids = list({row["user_id"] for row in users_res.data})
    processed = 0
    errors = []

    def process_user(user_id):
        metrics_res = admin.table("daily_metrics").select("*").eq("user_id", user_id).order("date", desc=True).limit(10).execute()
        if not metrics_res.data:
            return False, None

        data_by_date = {d["date"]: d for d in metrics_res.data}
        mood_res = admin.table("mood_logs").select("timestamp, mood_score").eq("user_id", user_id).execute()
        for m in mood_res.data or []:
            date = m["timestamp"].split("T")[0]
            if date in data_by_date:
                data_by_date[date]["mood"] = m["mood_score"]

        habits_res = admin.table("habit_logs").select("created_at").eq("user_id", user_id).execute()
        for h in habits_res.data or []:
            date = h["created_at"].split("T")[0]
            if date in data_by_date:
                data_by_date[date]["habits_completed"] = data_by_date[date].get("habits_completed", 0) + 1

        combined_data = list(data_by_date.values())
        corrs = utils.calculate_correlations(combined_data)
        insights = utils.generate_natural_language_insight(corrs)

        if not insights:
            return False, None

        rows = [{"text": ins["text"], "type": ins["type"], "icon": ins["icon"], "created_at": datetime.datetime.now(datetime.timezone.utc).isoformat()} for ins in insights]
        admin.rpc("replace_user_insights", {"p_user_id": str(user_id), "p_insights": rows}).execute()
        return True, None

    async def async_process_user(user_id):
        try:
            success, err = await asyncio.to_thread(process_user, user_id)
            return user_id, success, err
        except Exception as exc:
            return user_id, False, str(exc)

    # Process in batches of 10 to avoid overwhelming the connection pool
    batch_size = 10
    for i in range(0, len(user_ids), batch_size):
        batch = user_ids[i:i + batch_size]
        tasks = [async_process_user(uid) for uid in batch]
        results = await asyncio.gather(*tasks)
        for uid, success, err in results:
            if success:
                processed += 1
            if err:
                errors.append({"user_id": uid, "error": err})

    return {"status": "done", "users_processed": processed, "errors": errors}
