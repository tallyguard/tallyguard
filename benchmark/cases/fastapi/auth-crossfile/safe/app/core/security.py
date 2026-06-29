from passlib.context import CryptContext

pwd_context = CryptContext(schemes=["bcrypt"])


def verify_password(plain, hashed):
    return pwd_context.verify(plain, hashed)
