"""LiteLLM router over Vertex AI Gemini 2.5 Pro + Flash.

Pro   → complex extraction / summaries
Flash → fast/cheap first-pass filtering
"""
from __future__ import annotations

import structlog
from litellm import completion, RateLimitError
from tenacity import retry, stop_after_attempt, wait_exponential, retry_if_exception_type

from app.config import get_settings

logger = structlog.get_logger(__name__)
settings = get_settings()

_PRO_MODEL = f"vertex_ai/{settings.vertex_ai_pro_model}"
_FLASH_MODEL = f"vertex_ai/{settings.vertex_ai_flash_model}"


def _vertex_kwargs() -> dict:
    return {
        "vertex_project": settings.google_cloud_project,
        "vertex_location": settings.google_cloud_location,
    }


@retry(
    reraise=True,
    stop=stop_after_attempt(4),
    wait=wait_exponential(multiplier=2, min=15, max=120),
    retry=retry_if_exception_type(RateLimitError),
)
def call_pro(messages: list[dict], temperature: float = 0.2, max_tokens: int = 4096) -> str:
    """Call Gemini 2.5 Pro and return the text response."""
    logger.debug("llm.call_pro", messages_count=len(messages))
    response = completion(
        model=_PRO_MODEL,
        messages=messages,
        temperature=temperature,
        max_tokens=max_tokens,
        **_vertex_kwargs(),
    )
    return response.choices[0].message.content or ""


@retry(
    reraise=True,
    stop=stop_after_attempt(4),
    wait=wait_exponential(multiplier=2, min=10, max=60),
    retry=retry_if_exception_type(RateLimitError),
)
def call_flash(messages: list[dict], temperature: float = 0.1, max_tokens: int = 2048) -> str:
    """Call Gemini 2.5 Flash and return the text response."""
    logger.debug("llm.call_flash", messages_count=len(messages))
    response = completion(
        model=_FLASH_MODEL,
        messages=messages,
        temperature=temperature,
        max_tokens=max_tokens,
        **_vertex_kwargs(),
    )
    return response.choices[0].message.content or ""
