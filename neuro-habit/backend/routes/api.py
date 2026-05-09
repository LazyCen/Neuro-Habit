import asyncio
from tenacity import retry, stop_after_attempt, wait_exponential
from fastapi import APIRouter, Depends, Request, HTTPException, BackgroundTasks
from typing import List
from supabase import Client
import datetime
import utils
from models.schemas import Habit, MoodLog, DailyMetrics, Insight
from core.security import get_current_user, get_user_client, get_admin_client, verify_cron_secret
from core.rate_limit import limiter, LIMIT_READ, LIMIT_WRITE, LIMIT_AI
from services.db_service import check_supabase_response

router = APIRouter()
MAX_BULK_ITEMS = 100


import time

@router.get("/health")
async def health_check(client: Client = Depends(get_admin_client)):
    """
    Enhanced health check endpoint for production monitoring.
    Verifies connectivity and measures latency for Supabase and OpenAI.
    """
    metrics = {
        "supabase_latency_ms": None,
        "openai_latency_ms": None,
    }
    
    supabase_ok = False
    try:
        start_time = time.perf_counter()
        # Simple query to check Supabase connectivity
        client.table("profiles").select("id").limit(1).execute()
        metrics["supabase_latency_ms"] = round((time.perf_counter() - start_time) * 1000, 2)
        supabase_ok = True
    except Exception as e:
        print(f"Health Check: Supabase error: {str(e)}")

    openai_ok = False
    openai_client = utils.get_openai_client()
    if openai_client:
        try:
            start_time = time.perf_counter()
            # list models is a lightweight way to verify API key and connectivity
            await openai_client.models.list()
            metrics["openai_latency_ms"] = round((time.perf_counter() - start_time) * 1000, 2)
            openai_ok = True
        except Exception as e:
            print(f"Health Check: OpenAI error: {str(e)}")
    
    status = "ok" if supabase_ok and (openai_ok or not openai_client) else "degraded"
    if not supabase_ok:
        status = "error"
        
    return {
        "status": status,
        "supabase": "connected" if supabase_ok else "disconnected",
        "openai": "connected" if openai_ok else "disconnected" if openai_client else "not configured",
        "metrics": metrics,
        "timestamp": datetime.datetime.now(datetime.timezone.utc).isoformat()
    }


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
    data = {"user_id": user.id, "title": habit.title}
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
    if len(logs) > MAX_BULK_ITEMS:
        raise HTTPException(status_code=400, detail=f"Bulk request exceeds limit of {MAX_BULK_ITEMS} items.")

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
    if len(metrics_list) > MAX_BULK_ITEMS:
        raise HTTPException(status_code=400, detail=f"Bulk request exceeds limit of {MAX_BULK_ITEMS} items.")

    data = [{"user_id": user.id, "steps": metrics.steps, "screen_time": metrics.screen_time, "date": metrics.date.isoformat()} for metrics in metrics_list]
    response = check_supabase_response(client.table("daily_metrics").upsert(data, on_conflict="user_id,date").execute())
    return response.data if response.data else {"status": "error"}


@router.delete("/account")
@limiter.limit(LIMIT_WRITE)
async def delete_account(request: Request, user=Depends(get_current_user), admin: Client = Depends(get_admin_client)):
    """
    Permanently deletes a user account and all associated data.
    Uses a two-stage process:
    1. Database RPC to wipe all public schema data atomically.
    2. GoTrue Admin API to delete the authentication record.
    """
    user_id = str(user.id)

    @retry(
        stop=stop_after_attempt(3),
        wait=wait_exponential(multiplier=1, min=2, max=6),
        reraise=True
    )
    def _delete_auth_user_resiliently(uid: str):
        return admin.auth.admin.delete_user(uid)

    try:
        # Stage 1: Wipe all application data using the atomic RPC defined in schema.sql.
        # This ensures that even if auth deletion fails, the user's private data is gone.
        # It also bypasses potential issues with cross-schema CASCADE deletes.
        print(f"Initiating data wipe for user: {user_id}")
        rpc_res = admin.rpc("delete_user_account", {"p_user_id": user_id}).execute()
        
        # Check if RPC succeeded (it returns VOID, but we check for execution errors)
        if hasattr(rpc_res, 'error') and rpc_res.error:
             print(f"RPC Error during deletion: {rpc_res.error}")
             raise Exception(f"Database wipe failed: {rpc_res.error.message}")

        # Stage 2: Remove the user from Supabase Auth.
        print(f"Deleting auth record for user: {user_id}")
        _delete_auth_user_resiliently(user_id)
        
        return {"status": "success", "message": "Account and all associated data deleted successfully."}
    except Exception as exc:
        err_msg = str(exc)
        print(f"CRITICAL ERROR during account deletion for user {user_id}: {err_msg}")
        
        # Provide specific guidance for the common 'placeholder key' issue
        if "your-service-role-key-here" in err_msg or "invalid" in err_msg.lower():
            raise HTTPException(
                status_code=500,
                detail="Delete Failed: The server's SUPABASE_SERVICE_ROLE_KEY is not configured correctly. Please check the backend .env file."
            )
            
        raise HTTPException(
            status_code=500, 
            detail=f"Delete Failed: {err_msg if 'wipe failed' in err_msg else 'Internal server error during deletion. Please try again.'}"
        )


from core.celery_app import celery_app

@router.post("/admin/generate-insights", include_in_schema=False, status_code=202)
async def admin_generate_insights(request: Request, _: None = Depends(verify_cron_secret)):
    # Trigger Celery task
    task = celery_app.send_task("generate_all_user_insights")
    return {"status": "accepted", "message": "Insight generation started in background.", "task_id": task.id}
