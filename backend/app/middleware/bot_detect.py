"""
Lightweight bot / automated-client detection for SpendHound.

This is a first-line filter against script-kiddies and naive scanners.
It will NOT stop a determined attacker who spoofs headers, but it significantly
raises the bar and eliminates the vast majority of automated traffic on auth
and upload endpoints before rate-limit counters are even consumed.

Apply with the `block_bots` dependency on any route that real browsers hit.
"""

from fastapi import HTTPException, Request, status

# UA substrings that identify non-browser HTTP clients.
# Kept lowercase for case-insensitive comparison.
_BOT_UA_FRAGMENTS: frozenset[str] = frozenset(
    [
        "python-requests",
        "python-httpx",
        "python-urllib",
        "curl/",
        "wget/",
        "go-http-client",
        "java/",
        "ruby",
        "scrapy",
        "mechanize",
        "node-fetch",
        "node-http",
        "axios/",
        "okhttp/",
        "libwww-perl",
        "pycurl",
        "headlesschrome",
        "phantomjs",
        "selenium",
        "playwright",
        "puppeteer",
        "apachebench",
        "ab/",
        "httpie",
        "insomnia",
        "postman",
    ]
)


def _ua_looks_like_bot(ua: str) -> bool:
    lower = ua.lower()
    return any(frag in lower for frag in _BOT_UA_FRAGMENTS)


def is_likely_bot(request: Request) -> bool:
    ua = request.headers.get("user-agent") or ""
    if not ua:
        return True
    return _ua_looks_like_bot(ua)


async def block_bots(request: Request) -> None:
    """FastAPI dependency — raises 403 for requests that look automated."""
    if is_likely_bot(request):
        raise HTTPException(
            status_code=status.HTTP_403_FORBIDDEN,
            detail="Automated requests are not permitted on this endpoint.",
        )
