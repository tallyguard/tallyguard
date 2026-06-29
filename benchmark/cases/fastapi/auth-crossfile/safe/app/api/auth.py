from fastapi import APIRouter
from slowapi import Limiter
from app.services.auth_service import AuthService

router = APIRouter()
limiter = Limiter(key_func=None)


@router.post("/login")
@limiter.limit("5/minute")
async def login(request, body):
    service = AuthService()
    return await service.login(body.email, body.password)
