"""ChromaDB embedding service using Vertex AI text-embedding."""
from __future__ import annotations

import structlog
import chromadb
from chromadb.utils import embedding_functions

from app.config import get_settings

logger = structlog.get_logger(__name__)
settings = get_settings()


def _get_client() -> chromadb.HttpClient:
    return chromadb.HttpClient(host=settings.chroma_host, port=settings.chroma_port)


def _get_collection(client: chromadb.HttpClient) -> chromadb.Collection:
    # Use Google embedding function when creds are present; fall back to default
    try:
        ef = embedding_functions.GoogleVertexEmbeddingFunction(
            project_id=settings.google_cloud_project,
            location=settings.google_cloud_location,
            model_name="text-multilingual-embedding-002",
        )
    except Exception:
        ef = embedding_functions.DefaultEmbeddingFunction()

    return client.get_or_create_collection(
        name=settings.chroma_collection,
        embedding_function=ef,
        metadata={"hnsw:space": "cosine"},
    )


class EmbedService:
    def embed(self, post_id: int) -> dict:
        """Fetch post content from DB, embed, upsert into ChromaDB, return chroma_id."""
        import asyncio
        from app.database import AsyncSessionLocal
        from app.models import ScrapedPost
        from sqlalchemy import select

        async def _load() -> ScrapedPost | None:
            async with AsyncSessionLocal() as sess:
                row = await sess.execute(select(ScrapedPost).where(ScrapedPost.id == post_id))
                return row.scalar_one_or_none()

        post = asyncio.get_event_loop().run_until_complete(_load())
        if post is None:
            return {"error": "post_not_found"}

        content = post.raw_content or ""
        if not content.strip():
            return {"error": "empty_content"}

        chroma_id = f"post_{post.id}"
        client = _get_client()
        col = _get_collection(client)
        col.upsert(
            ids=[chroma_id],
            documents=[content],
            metadatas=[{"target_id": post.target_id, "post_id": post.id}],
        )

        # Persist chroma_id back to DB
        async def _update() -> None:
            async with AsyncSessionLocal() as sess:
                p = await sess.get(ScrapedPost, post_id)
                if p:
                    p.chroma_id = chroma_id
                    await sess.commit()

        asyncio.get_event_loop().run_until_complete(_update())
        return {"chroma_id": chroma_id}

    def query_similar(self, content: str, target_id: int, threshold: float) -> tuple[bool, str | None]:
        """Return (is_dup, existing_chroma_id) if any stored doc exceeds the cosine threshold."""
        client = _get_client()
        col = _get_collection(client)
        results = col.query(
            query_texts=[content],
            n_results=1,
            where={"target_id": target_id},
            include=["distances"],
        )
        distances = results.get("distances", [[]])[0]
        ids = results.get("ids", [[]])[0]
        if distances and ids:
            # ChromaDB cosine distance: 0 = identical, 1 = orthogonal
            similarity = 1.0 - distances[0]
            if similarity >= threshold:
                logger.debug("semantic_dup_found", similarity=similarity, chroma_id=ids[0])
                return True, ids[0]
        return False, None
