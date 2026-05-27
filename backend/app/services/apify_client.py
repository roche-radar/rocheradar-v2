"""Apify social-media scraping service.

TinyFish handles the open web; Apify handles social platforms (Instagram, X,
TikTok, Facebook) where TinyFish can't reach. Each platform has a purpose-built
Apify Actor whose output we normalize into one common post shape with real
engagement counts (likes / comments / views / shares).

Actor output schemas differ per platform and change over time, so every
normalizer reads each field through a tolerant multi-key lookup and never
raises on a missing key — a malformed item is skipped, not fatal.
"""
from __future__ import annotations

import re
from datetime import datetime, timedelta, timezone
from typing import Any

import structlog
from apify_client import ApifyClient

from app.config import get_settings

logger = structlog.get_logger(__name__)

# Default Actors per platform.
# Twitter: quacker/twitter-scraper — reliable keyword/hashtag search (6M+ runs).
# Facebook: apify/facebook-posts-scraper requires startUrls (known page URLs), not keyword
#   search. Page URLs are curated in app_settings.facebook_page_urls and seeded with major
#   pharma/oncology pages. The scan task passes them via the page_urls parameter.
ACTORS = {
    "instagram": "apify/instagram-hashtag-scraper",
    "twitter":   "quacker/twitter-scraper",
    "tiktok":    "clockworks/tiktok-scraper",
    "facebook":  "apify/facebook-posts-scraper",
}

_HASHTAG_RE = re.compile(r"#(\w+)")


# ── value coercion helpers ────────────────────────────────

def _first(item: dict, *keys: str) -> Any:
    """Return the first present, non-None value among keys (supports a.b nesting)."""
    for key in keys:
        if "." in key:
            cur: Any = item
            for part in key.split("."):
                if isinstance(cur, dict):
                    cur = cur.get(part)
                else:
                    cur = None
                    break
            if cur is not None:
                return cur
        elif item.get(key) is not None:
            return item[key]
    return None


def _int(val: Any) -> int:
    if val is None:
        return 0
    if isinstance(val, (int, float)):
        return int(val)
    try:
        return int(re.sub(r"[^\d]", "", str(val)) or 0)
    except (ValueError, TypeError):
        return 0


def _parse_dt(val: Any) -> datetime | None:
    """Parse ISO-8601 strings or epoch seconds into a tz-aware UTC datetime."""
    if val is None:
        return None
    if isinstance(val, (int, float)):
        try:
            return datetime.fromtimestamp(val, tz=timezone.utc)
        except (ValueError, OSError):
            return None
    s = str(val).strip()
    if not s:
        return None
    if s.isdigit():
        return _parse_dt(int(s))
    try:
        dt = datetime.fromisoformat(s.replace("Z", "+00:00"))
        return dt if dt.tzinfo else dt.replace(tzinfo=timezone.utc)
    except ValueError:
        return None


def _hashtags(item: dict, text: str | None) -> list[str]:
    tags = _first(item, "hashtags")
    if isinstance(tags, list) and tags:
        out = []
        for t in tags:
            if isinstance(t, str):
                out.append(t.lstrip("#"))
            elif isinstance(t, dict):
                name = t.get("name") or t.get("text")
                if name:
                    out.append(str(name).lstrip("#"))
        if out:
            return out
    return _HASHTAG_RE.findall(text or "")


# ── per-platform normalizers ──────────────────────────────

def _norm_instagram(item: dict) -> dict | None:
    url = _first(item, "url", "postUrl", "inputUrl")
    if not url:
        return None
    text = _first(item, "caption", "text")
    return {
        "platform": "instagram",
        "post_url": url,
        "author": _first(item, "ownerUsername", "ownerFullName", "owner.username"),
        "text": text,
        "thumbnail_url": _first(item, "displayUrl", "thumbnailUrl", "imageUrl"),
        "likes": _int(_first(item, "likesCount", "likes")),
        "comments": _int(_first(item, "commentsCount", "comments")),
        "views": _int(_first(item, "videoViewCount", "videoPlayCount", "viewsCount")),
        "shares": 0,
        "hashtags": _hashtags(item, text),
        "posted_at": _parse_dt(_first(item, "timestamp", "takenAtTimestamp")),
    }


def _norm_twitter(item: dict) -> dict | None:
    url = _first(item, "url", "twitterUrl", "tweetUrl")
    if not url:
        return None
    text = _first(item, "text", "fullText", "full_text")
    return {
        "platform": "twitter",
        "post_url": url,
        "author": _first(item, "author.userName", "author.username", "username", "userName"),
        "text": text,
        "thumbnail_url": _first(item, "author.profilePicture", "media.0.media_url_https"),
        "likes": _int(_first(item, "likeCount", "favoriteCount", "likes")),
        "comments": _int(_first(item, "replyCount", "replies")),
        "views": _int(_first(item, "viewCount", "views")),
        "shares": _int(_first(item, "retweetCount", "retweets")),
        "hashtags": _hashtags(item, text),
        "posted_at": _parse_dt(_first(item, "createdAt", "created_at", "date")),
    }


def _norm_tiktok(item: dict) -> dict | None:
    url = _first(item, "webVideoUrl", "url", "postPage")
    if not url:
        return None
    text = _first(item, "text", "description", "desc")
    return {
        "platform": "tiktok",
        "post_url": url,
        "author": _first(item, "authorMeta.name", "authorMeta.nickName", "author.uniqueId"),
        "text": text,
        "thumbnail_url": _first(item, "videoMeta.coverUrl", "covers.0", "videoMeta.originalCoverUrl"),
        "likes": _int(_first(item, "diggCount", "likes")),
        "comments": _int(_first(item, "commentCount", "comments")),
        "views": _int(_first(item, "playCount", "views")),
        "shares": _int(_first(item, "shareCount", "shares")),
        "hashtags": _hashtags(item, text),
        "posted_at": _parse_dt(_first(item, "createTimeISO", "createTime")),
    }


def _norm_facebook(item: dict) -> dict | None:
    # Handles both apify/facebook-search-scraper and apify/facebook-posts-scraper
    # output schemas (field names differ between the two actors).
    url = _first(item, "postUrl", "url", "link", "topLevelUrl")
    if not url:
        return None
    text = _first(item, "text", "message", "postText", "body")
    return {
        "platform": "facebook",
        "post_url": url,
        "author": _first(item, "pageName", "authorName", "user.name", "groupName"),
        "text": text,
        "thumbnail_url": _first(item, "thumbnailUrl", "image", "media.0.thumbnail", "previewImage"),
        "likes": _int(_first(item, "likesCount", "likes", "reactionsCount")),
        "comments": _int(_first(item, "commentsCount", "comments")),
        "views": _int(_first(item, "viewsCount", "videoViewCount")),
        "shares": _int(_first(item, "sharesCount", "shares")),
        "hashtags": _hashtags(item, text),
        "posted_at": _parse_dt(_first(item, "date", "time", "publishedTime", "createdTime")),
    }


_NORMALIZERS = {
    "instagram": _norm_instagram,
    "twitter":   _norm_twitter,
    "tiktok":    _norm_tiktok,
    "facebook":  _norm_facebook,
}


# ── actor input builders ──────────────────────────────────

def _build_input(platform: str, term: str, max_results: int, since: str | None) -> dict:
    """Map a search term to the Actor's expected input shape.

    `term` is a hashtag/keyword (field scan) or a handle (KOL scan). For
    hashtag-based actors we strip a leading '#'; for keyword/search actors we
    pass the term as-is.
    """
    # Hashtag-based actors can't take spaces — collapse "lung cancer" → "lungcancer"
    tag = re.sub(r"\s+", "", term.lstrip("#@"))
    if platform == "instagram":
        return {"hashtags": [tag], "resultsType": "posts", "resultsLimit": max_results}
    if platform == "twitter":
        # quacker/twitter-scraper input schema
        inp: dict = {"searchTerms": [term], "tweetsDesiredCount": max_results, "sort": "Top"}
        if since:
            inp["startDate"] = since
        return inp
    if platform == "tiktok":
        return {"hashtags": [tag], "resultsPerPage": max_results,
                "shouldDownloadVideos": False, "shouldDownloadCovers": False}
    if platform == "facebook":
        # apify/facebook-posts-scraper requires known page URLs, not keyword search.
        # page_urls is injected at call time from app_settings.facebook_page_urls.
        # If no URLs provided the caller skips this platform.
        return {}  # populated by fetch_platform when page_urls is passed
    return {}


# ── public API ────────────────────────────────────────────

def is_configured() -> bool:
    return bool(get_settings().apify_api_token)


def fetch_platform(platform: str, term: str, max_results: int = 30,
                   window_days: int = 180, timeout_secs: int = 180,
                   page_urls: list[str] | None = None) -> list[dict]:
    """Run one platform Actor. For IG/TikTok/Twitter uses keyword `term`;
    for Facebook uses curated `page_urls` (keyword search not supported on FB).
    Returns normalized posts filtered to the last `window_days`. Never raises."""
    token = get_settings().apify_api_token
    if not token:
        logger.warning("apify.no_token")
        return []
    actor_id = ACTORS.get(platform)
    normalizer = _NORMALIZERS.get(platform)
    if not actor_id or not normalizer:
        logger.warning("apify.unknown_platform", platform=platform)
        return []

    # Facebook uses page URLs, not keyword search
    if platform == "facebook":
        if not page_urls:
            logger.info("apify.facebook_skipped_no_urls")
            return []
        run_input = {
            "startUrls": [{"url": u} for u in page_urls],
            "resultsLimit": max_results,
            "scrapeAbout": False,
            "scrapeReviews": False,
            "scrapeServices": False,
        }
    else:
        run_input = _build_input(platform, term, max_results,
                                 (datetime.now(timezone.utc) - timedelta(days=window_days)).date().isoformat())

    cutoff = datetime.now(timezone.utc) - timedelta(days=window_days)

    try:
        client = ApifyClient(token)
        run = client.actor(actor_id).call(
            run_input=run_input,
            run_timeout=timedelta(seconds=timeout_secs),
            max_items=max_results,
        )
        dataset_id = getattr(run, "default_dataset_id", None) if run else None
        if not dataset_id:
            logger.warning("apify.no_dataset", platform=platform, term=term)
            return []
        raw_items = client.dataset(dataset_id).list_items(limit=max_results).items
    except Exception as exc:
        logger.warning("apify.run_failed", platform=platform, term=term, exc=str(exc)[:200])
        return []

    posts: list[dict] = []
    for raw in raw_items:
        if not isinstance(raw, dict):
            continue
        try:
            post = normalizer(raw)
        except Exception:
            continue
        if not post:
            continue
        # Window filter (skip only when we actually know the date)
        if post["posted_at"] and post["posted_at"] < cutoff:
            continue
        posts.append(post)

    logger.info("apify.fetched", platform=platform, term=term, count=len(posts))
    return posts
