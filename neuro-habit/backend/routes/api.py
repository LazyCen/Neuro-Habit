import asyncio
from tenacity import retry, stop_after_attempt, wait_exponential
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

    insights_res = check_supabase_response(
        client.rpc("get_user_insights_data", {"p_user_id": str(user_id)}).execute()
    )
    if insights_res.data:
        combined_data = insights_res.data
        corrs = utils.calculate_correlations(combined_data)
        insights = await utils.generate_natural_language_insight(corrs)
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

@router.post("/mood/bulk")
@limiter.limit(LIMIT_WRITE)
async def log_mood_bulk(request: Request, logs: List[MoodLog], user=Depends(get_current_user), client: Client = Depends(get_user_client)):
    if not logs:
        return []
    data = [{"user_id": user.id, "mood_score": log.mood, "note": log.note, "timestamp": log.timestamp.isoformat()} for log in logs]
    response = check_supabase_response(client.table("mood_logs").insert(data).execute())
    return response.data if response.data else {"status": "error"}

@router.post("/metrics")
@limiter.limit(LIMIT_WRITE)
async def update_metrics(request: Request, metrics: DailyMetrics, user=Depends(get_current_user), client: Client = Depends(get_user_client)):
    data = {"user_id": user.id, "steps": metrics.steps, "screen_time": metrics.screen_time, "date": metrics.date.isoformat()}
    response = check_supabase_response(client.table("daily_metrics").upsert(data, on_conflict="user_id,date").execute())
    return response.data[0] if response.data else {"status": "error"}

@router.post("/metrics/bulk")
@limiter.limit(LIMIT_WRITE)
async def update_metrics_bulk(request: Request, metrics_list: List[DailyMetrics], user=Depends(get_current_user), client: Client = Depends(get_user_client)):
    if not metrics_list:
        return []
    data = [{"user_id": user.id, "steps": metrics.steps, "screen_time": metrics.screen_time, "date": metrics.date.isoformat()} for metrics in metrics_list]
    response = check_supabase_response(client.table("daily_metrics").upsert(data, on_conflict="user_id,date").execute())
    return response.data if response.data else {"status": "error"}


@router.delete("/account")
@limiter.limit(LIMIT_WRITE)
async def delete_account(request: Request, user=Depends(get_current_user), admin: Client = Depends(get_admin_client)):
    user_id = user.id

    @retry(
        stop=stop_after_attempt(5),
        wait=wait_exponential(multiplier=1, min=2, max=10),
        reraise=True
    )
    def _delete_auth_user_resiliently():
        # Deleting the auth user will trigger ON DELETE CASCADE for all associated data 
        # in the public schema (profiles, habits, logs, etc.) defined in schema.sql.
        # This ensures the operation is atomic from the database's perspective.
        return admin.auth.admin.delete_user(user_id)

    try:
        # First, mark the user as 'deleting' in metadata. This signals intent and 
        # can be used to prevent certain operations if the deletion takes time.
        admin.auth.admin.update_user_by_id(
            user_id, 
            {"user_metadata": {"account_delete_requested": True}}
        )

        # Execute auth deletion with retry logic. 
        # We no longer call the manual 'delete_user_account' RPC because the 
        # database-level foreign key cascades handle it more reliably and atomically.
        _delete_auth_user_resiliently()
        
        return {"status": "success", "message": "Account and all associated data deleted successfully."}
    except Exception as exc:
        print(f"Error during resilient account deletion for user {user_id}: {str(exc)}")
        # If we reach here, the user still exists and their data is intact (because we didn't wipe it first).
        # This avoids the 'zombie user' state.
        raise HTTPException(
            status_code=500, 
            detail="A critical error occurred during account deletion. Your data is safe. Please try again later or contact support."
        )


@router.post("/admin/generate-insights", include_in_schema=False)
async def admin_generate_insights(request: Request, _: None = Depends(verify_cron_secret), admin: Client = Depends(get_admin_client)):
    res = admin.rpc("get_all_users_insights_data").execute()
    if not res.data:
        return {"status": "no_data", "users_processed": 0}

    from collections import defaultdict
    user_data = defaultdict(list)
    for row in res.data:
        user_data[row["user_id"]].append({
            "date": row["date"],
            "steps": row["steps"],
            "screen_time": row["screen_time"],
            "mood": row["mood"],
            "habits_completed": row["habits_completed"]
        })

    processed = 0
    errors = []

    async def process_user(user_id, combined_data):
        corrs = utils.calculate_correlations(combined_data)
        insights = await utils.generate_natural_language_insight(corrs)

        if not insights:
            return False, None

        rows = [{"text": ins["text"], "type": ins["type"], "icon": ins["icon"], "created_at": datetime.datetime.now(datetime.timezone.utc).isoformat()} for ins in insights]
        
        def _update_db():
            admin.rpc("replace_user_insights", {"p_user_id": str(user_id), "p_insights": rows}).execute()
        
        await asyncio.to_thread(_update_db)
        return True, None

    async def async_process_user(user_id, combined_data):
        try:
            success, err = await process_user(user_id, combined_data)
            return user_id, success, err
        except Exception as exc:
            return user_id, False, str(exc)

    user_ids = list(user_data.keys())
    # Process in batches of 10 to avoid overwhelming the connection pool
    batch_size = 10
    for i in range(0, len(user_ids), batch_size):
        batch = user_ids[i:i + batch_size]
        tasks = [async_process_user(uid, user_data[uid]) for uid in batch]
        results = await asyncio.gather(*tasks)
        for uid, success, err in results:
            if success:
                processed += 1
            if err:
                errors.append({"user_id": uid, "error": err})

    return {"status": "done", "users_processed": processed, "errors": errors}
