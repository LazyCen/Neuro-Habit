import os
import logging
from dotenv import load_dotenv
from supabase import create_client, Client
from supabase.lib.client_options import ClientOptions
import httpx

load_dotenv()

logging.basicConfig(
    level=logging.INFO,
    format="%(asctime)s [%(levelname)s] %(name)s: %(message)s",
)

logger = logging.getLogger(__name__)

SUPABASE_URL = os.environ.get("SUPABASE_URL")
SUPABASE_KEY = os.environ.get("SUPABASE_KEY")
SUPABASE_SERVICE_ROLE_KEY = os.environ.get("SUPABASE_SERVICE_ROLE_KEY")

if not SUPABASE_URL or not SUPABASE_KEY:
    raise RuntimeError("SUPABASE_URL and SUPABASE_KEY must be set in environment")
if not SUPABASE_SERVICE_ROLE_KEY:
    raise RuntimeError("SUPABASE_SERVICE_ROLE_KEY must be set in environment.")

CRON_SECRET = os.environ.get("CRON_SECRET", "")
ENVIRONMENT = os.environ.get("ENVIRONMENT", "development")
SENTRY_DSN = os.environ.get("SENTRY_DSN", "")
OPENAI_API_KEY = os.environ.get("OPENAI_API_KEY")
REDIS_URL = os.environ.get("REDIS_URL", "redis://localhost:6379/0")

if ENVIRONMENT == "production" and not OPENAI_API_KEY:
    logger.error("OPENAI_API_KEY environment variable is missing. AI insights will fallback to rule-based logic.")

_raw_origins = os.environ.get("ALLOWED_ORIGINS", "")
if _raw_origins:
    ALLOWED_ORIGINS = [o.strip() for o in _raw_origins.split(",") if o.strip()]
elif ENVIRONMENT == "production":
    raise RuntimeError("ALLOWED_ORIGINS environment variable is mandatory in production")
else:
    # Restrictive defaults for development/testing
    ALLOWED_ORIGINS = ["https://snack.expo.dev"]

_raw_proxies = os.environ.get("TRUSTED_PROXIES", "127.0.0.1")
TRUSTED_PROXIES = [p.strip() for p in _raw_proxies.split(",") if p.strip()]
if ENVIRONMENT == "production" and "127.0.0.1" in TRUSTED_PROXIES and len(TRUSTED_PROXIES) == 1:
    # We warn or require it? The recommendation says replace "*" with specific IPs.
    # If they are in production, they likely have a proxy.
    pass 


supabase: Client = create_client(
    SUPABASE_URL, 
    SUPABASE_KEY
)

admin_supabase: Client = create_client(
    SUPABASE_URL, 
    SUPABASE_SERVICE_ROLE_KEY
)
