import asyncio
import datetime
from celery import shared_task
from core.celery_app import celery_app
from core.config import admin_supabase
import utils

@celery_app.task(name="generate_all_user_insights")
def generate_all_user_insights_task():
    """
    Celery task to trigger insight generation for all users.
    """
    # Celery tasks are synchronous by default, but we can run our async logic using asyncio.run
    return asyncio.run(run_insight_generation(admin_supabase))

async def run_insight_generation(admin):
    """
    Core logic to process all users and generate insights.
    """
    try:
        PAGE_SIZE = 100
        offset = 0
        total_processed = 0

        while True:
            users_res = admin.table("profiles").select("id").range(offset, offset + PAGE_SIZE - 1).execute()
            user_page = users_res.data if users_res.data else []
            
            if not user_page:
                break

            tasks = []
            for user in user_page:
                user_id = user["id"]
                tasks.append(async_process_single_user(admin, user_id))
            
            results = await asyncio.gather(*tasks)
            for uid, success, err in results:
                if success:
                    total_processed += 1
                if err:
                    print(f"Celery Insights: Error processing user {uid}: {err}")

            if len(user_page) < PAGE_SIZE:
                break
            offset += PAGE_SIZE
        
        return {"status": "success", "processed_users": total_processed}
    except Exception as e:
        print(f"Celery Insights: Critical error: {str(e)}")
        return {"status": "error", "message": str(e)}

async def async_process_single_user(admin, user_id: str):
    """
    Fetches data for a single user, generates insights, and saves them.
    """
    try:
        res = admin.rpc("get_user_insights_data", {"p_user_id": user_id}).execute()
        if not res.data:
            return user_id, False, None

        corrs = utils.calculate_correlations(res.data)
        insights = await utils.generate_natural_language_insight(corrs)

        if not insights:
            return user_id, False, None

        rows = [{
            "text": ins["text"], 
            "type": ins["type"], 
            "icon": ins["icon"], 
            "created_at": datetime.datetime.now(datetime.timezone.utc).isoformat()
        } for ins in insights]
        
        # We can't use await asyncio.to_thread with admin.rpc easily if it's not thread-safe 
        # or if we are already in an event loop. Since we are using asyncio.run, 
        # we can just execute it.
        admin.rpc("replace_user_insights", {"p_user_id": user_id, "p_insights": rows}).execute()
        
        return user_id, True, None
    except Exception as exc:
        return user_id, False, str(exc)
