"""Two-stage deduplication: SHA256 (exact) + cosine similarity via ChromaDB (semantic)."""
import hashlib
import re
from typing import Optional

import structlog

from app.config import get_settings

logger = structlog.get_logger(__name__)
settings = get_settings()


def _normalise(text: str) -> str:
    return re.sub(r"\s+", " ", text).strip().lower()


def sha256_hash(content: str) -> str:
    return hashlib.sha256(_normalise(content).encode()).hexdigest()


class DeduplicatorService:
    def __init__(self) -> None:
        self._threshold = settings.dedup_cosine_threshold

    def is_semantic_duplicate(self, content: str, target_id: int) -> tuple[bool, Optional[str]]:
        """Return (is_dup, existing_chroma_id) using cosine similarity query against ChromaDB."""
        try:
            from app.services.embedder import EmbedService
            return EmbedService().query_similar(content=content, target_id=target_id, threshold=self._threshold)
        except Exception as exc:
            # Semantic dedup failure is non-fatal; fall through to allow the post
            logger.warning("semantic_dedup.failed", exc=str(exc))
            return False, None
