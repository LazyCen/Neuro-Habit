import os
from slowapi import Limiter
from slowapi.util import get_remote_address
from fastapi import Request

def _rate_limit_key(request: Request) -> str:
    user = getattr(request.state, "user_id", None)
    return user if user else get_remote_address(request)

limiter = Limiter(
    key_func=_rate_limit_key,
    default_limits=[os.environ.get("RATE_LIMIT_GLOBAL", "200/minute")],
)

LIMIT_AI = os.environ.get("RATE_LIMIT_AI", "10/minute")
LIMIT_WRITE = os.environ.get("RATE_LIMIT_WRITE", "30/minute")
LIMIT_READ = os.environ.get("RATE_LIMIT_READ", "120/minute")
