from fastapi import Security, HTTPException, Request
from fastapi.security import HTTPBearer, HTTPAuthorizationCredentials
from supabase import Client, create_client
from .config import supabase, admin_supabase, SUPABASE_URL, SUPABASE_KEY, CRON_SECRET

_bearer_scheme = HTTPBearer(auto_error=False)

async def get_current_user(credentials: HTTPAuthorizationCredentials = Security(_bearer_scheme)):
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

def get_user_client(credentials: HTTPAuthorizationCredentials = Security(_bearer_scheme)) -> Client:
    if not credentials:
        raise HTTPException(status_code=401, detail="Not authenticated")
    client = create_client(SUPABASE_URL, SUPABASE_KEY)
    client.postgrest.auth(credentials.credentials)
    return client

def verify_cron_secret(request: Request) -> None:
    provided = request.headers.get("X-Cron-Secret", "")
    if not CRON_SECRET:
        raise HTTPException(status_code=503, detail="Admin endpoints are disabled.")
    if provided != CRON_SECRET:
        raise HTTPException(status_code=403, detail="Forbidden: invalid cron secret.")

def get_admin_client() -> Client:
    return admin_supabase
