from fastapi import FastAPI, APIRouter
from passlib.context import CryptContext
from app.middleware import GlobalRateLimitMiddleware

app = FastAPI()
# A baseline rate limit applied to EVERY route via middleware (a common, good pattern).
app.add_middleware(GlobalRateLimitMiddleware)

router = APIRouter()
pwd = CryptContext(schemes=["bcrypt"])


@router.post("/login")
async def login(body):
    # Reaches an auth sink and carries no per-route limiter, but the global middleware covers it -
    # so this must NOT be flagged (the false-positive class fixed in D061).
    return pwd.verify(body.password, "h")


app.include_router(router)
