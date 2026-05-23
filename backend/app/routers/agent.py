"""Hermes AI chat endpoint — RAG over extracted insights."""
import asyncio
from functools import partial

from fastapi import APIRouter, Depends, HTTPException
from pydantic import BaseModel
from sqlalchemy import select, desc
from sqlalchemy.ext.asyncio import AsyncSession

from app.database import get_db
from app.models import AgentMessage, ExtractedInsight, Target

router = APIRouter(prefix="/api/agent", tags=["agent"])

_MAX_CONTEXT_INSIGHTS = 30


class ChatRequest(BaseModel):
    message: str


@router.post("/chat")
async def chat(body: ChatRequest, db: AsyncSession = Depends(get_db)):
    from pathlib import Path
    from app.services.llm_router import call_pro

    # Load agent system prompt
    prompt_path = Path(__file__).parent.parent / "prompts" / "agent.txt"
    system_prompt = prompt_path.read_text(encoding="utf-8")

    # Retrieve recent insights as RAG context
    rows = await db.execute(
        select(ExtractedInsight, Target)
        .join(Target, ExtractedInsight.target_id == Target.id)
        .order_by(desc(ExtractedInsight.extracted_at))
        .limit(_MAX_CONTEXT_INSIGHTS)
    )
    context_chunks = [
        f"[{target.name}] {ins.topic}: {ins.what_they_said}"
        for ins, target in rows.all()
    ]
    context_text = "\n".join(context_chunks)

    # Load conversation history
    history_rows = await db.execute(
        select(AgentMessage).order_by(AgentMessage.created_at).limit(20)
    )
    history = history_rows.scalars().all()
    messages = [{"role": "system", "content": system_prompt}]
    if context_text:
        messages.append({"role": "system", "content": f"RECENT INTELLIGENCE CONTEXT:\n{context_text}"})
    for h in history:
        messages.append({"role": h.role, "content": h.content})
    messages.append({"role": "user", "content": body.message})

    # call_pro is synchronous and uses asyncio.run() internally;
    # run it in a thread pool to avoid "event loop already running" from this async context
    loop = asyncio.get_event_loop()
    try:
        reply = await loop.run_in_executor(None, partial(call_pro, messages, max_tokens=4096))
    except Exception as exc:
        raise HTTPException(status_code=502, detail=f"LLM call failed: {str(exc)[:200]}")

    # Persist exchange
    db.add(AgentMessage(role="user", content=body.message))
    db.add(AgentMessage(role="assistant", content=reply))
    await db.commit()

    return {"reply": reply}


@router.get("/history")
async def get_history(db: AsyncSession = Depends(get_db)):
    rows = await db.execute(select(AgentMessage).order_by(AgentMessage.created_at).limit(100))
    return [{"role": m.role, "content": m.content, "created_at": m.created_at.isoformat()}
            for m in rows.scalars().all()]


@router.delete("/history", status_code=204)
async def clear_history(db: AsyncSession = Depends(get_db)):
    from sqlalchemy import delete
    await db.execute(delete(AgentMessage))
    await db.commit()
