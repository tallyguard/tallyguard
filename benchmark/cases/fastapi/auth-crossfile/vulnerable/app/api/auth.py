from fastapi import APIRouter
from app.services.auth_service import AuthService

router = APIRouter()


@router.post("/login")
async def login(body):
    service = AuthService()
    return await service.login(body.email, body.password)
