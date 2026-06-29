from fastapi import APIRouter
from slowapi import Limiter
from openai import OpenAI

router = APIRouter()
limiter = Limiter(key_func=None)
client = OpenAI()


@router.post("/chat")
@limiter.limit("10/minute")
async def chat(request, body):
    return client.chat.completions.create(model="gpt-4o", messages=body.messages)
