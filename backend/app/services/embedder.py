"""ChromaDB embedding service using Vertex AI text-embedding."""
from __future__ import annotations

import asyncio

import structlog

from app.config import get_settings

logger = structlog.get_logger(__name__)
settings = get_settings()


def _get_collection():
    import chromadb
    from chromadb.utils import embedding_functions

    client = chromadb.HttpClient(host=settings.chroma_host, port=settings.chroma_port)
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
        async def _load():
            from app.database import AsyncSessionLocal
            from app.models import ScrapedPost
            async with AsyncSessionLocal() as sess:
                return await sess.get(ScrapedPost, post_id)

        post = asyncio.run(_load())
        if post is None:
            return {"error": "post_not_found"}

        content = post.raw_content or ""
        if not content.strip():
            return {"error": "empty_content"}

        try:
            col = _get_collection()
            chroma_id = f"post_{post.id}"
            col.upsert(
                ids=[chroma_id],
                documents=[content],
                metadatas=[{"target_id": post.target_id, "post_id": post.id}],
            )
        except Exception as exc:
            logger.warning("embed.chroma_failed", post_id=post_id, exc=str(exc))
            return {"error": str(exc)}

        async def _update():
            from app.database import AsyncSessionLocal
            from app.models import ScrapedPost
            async with AsyncSessionLocal() as sess:
                p = await sess.get(ScrapedPost, post_id)
                if p:
                    p.chroma_id = chroma_id
                    await sess.commit()

        asyncio.run(_update())
        return {"chroma_id": chroma_id}

    def query_similar(self, content: str, target_id: int, threshold: float) -> tuple[bool, str | None]:
        try:
            col = _get_collection()
            results = col.query(
                query_texts=[content],
                n_results=1,
                where={"target_id": target_id},
                include=["distances"],
            )
            distances = results.get("distances", [[]])[0]
            ids = results.get("ids", [[]])[0]
            if distances and ids:
                similarity = 1.0 - distances[0]
                if similarity >= threshold:
                    logger.debug("semantic_dup_found", similarity=similarity, chroma_id=ids[0])
                    return True, ids[0]
        except Exception as exc:
            logger.warning("query_similar.failed", exc=str(exc))
        return False, None
