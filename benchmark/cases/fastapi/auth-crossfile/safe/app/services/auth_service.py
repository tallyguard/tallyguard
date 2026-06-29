from app.core.security import verify_password


class AuthService:
    async def login(self, email, password):
        return verify_password(password, "hash")
