from fastapi import FastAPI
from fastapi.middleware.cors import CORSMiddleware
from fastapi.responses import JSONResponse
from slowapi.errors import RateLimitExceeded
from core.config import ALLOWED_ORIGINS, SENTRY_DSN, TRUSTED_PROXIES
from core.rate_limit import limiter
import sentry_sdk
import os

if SENTRY_DSN:
    sentry_sdk.init(
        dsn=SENTRY_DSN,
        traces_sample_rate=1.0,
        profiles_sample_rate=1.0,
    )
from routes.api import router
from uvicorn.middleware.proxy_headers import ProxyHeadersMiddleware

app = FastAPI(title="Neuro Habit API")
app.state.limiter = limiter

# Trust X-Forwarded-For headers from reverse proxies (ALB, Nginx, etc.)
app.add_middleware(ProxyHeadersMiddleware, trusted_hosts=TRUSTED_PROXIES)


app.add_exception_handler(
    RateLimitExceeded,
    lambda req, exc: JSONResponse(
        status_code=429,
        content={
            "detail": "Too many requests. Please slow down and try again shortly.",
            "retry_after": str(exc.retry_after) if hasattr(exc, 'retry_after') else None,
        },
    ),
)

app.add_middleware(
    CORSMiddleware,
    allow_origins=ALLOWED_ORIGINS,
    allow_credentials=True,
    allow_methods=["GET", "POST", "PUT", "DELETE"],
    allow_headers=["Authorization", "Content-Type", "X-Cron-Secret"],
)

app.include_router(router)

if __name__ == "__main__":
    import uvicorn
    port = int(os.environ.get("PORT", 8000))
    uvicorn.run(app, host="0.0.0.0", port=port)
