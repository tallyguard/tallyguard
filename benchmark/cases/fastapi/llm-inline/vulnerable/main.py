from fastapi import APIRouter
from openai import OpenAI

router = APIRouter()
client = OpenAI()


@router.post("/chat")
async def chat(body):
    return client.chat.completions.create(model="gpt-4o", messages=body.messages)
