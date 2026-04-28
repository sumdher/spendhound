"""
SSRF protection for user-supplied LLM base URLs.

Users can configure a custom LLM base URL in settings. Without validation, a
malicious user could point it at internal infrastructure (db, backend, AWS
metadata service) and make the backend issue requests on their behalf.

This module validates that a URL resolves to a public IP before it is stored
or used. DNS resolution runs in a thread-pool executor so it doesn't block the
async event loop.
"""

from __future__ import annotations

import asyncio
import ipaddress
import socket
from urllib.parse import urlparse

from fastapi import HTTPException

_PRIVATE_NETWORKS: list[ipaddress.IPv4Network | ipaddress.IPv6Network] = [
    ipaddress.ip_network("10.0.0.0/8"),
    ipaddress.ip_network("172.16.0.0/12"),      # includes Docker bridge (172.17-31.x)
    ipaddress.ip_network("192.168.0.0/16"),
    ipaddress.ip_network("127.0.0.0/8"),         # loopback
    ipaddress.ip_network("169.254.0.0/16"),      # link-local / AWS metadata (169.254.169.254)
    ipaddress.ip_network("0.0.0.0/8"),
    ipaddress.ip_network("100.64.0.0/10"),       # carrier-grade NAT
    ipaddress.ip_network("::1/128"),             # IPv6 loopback
    ipaddress.ip_network("fe80::/10"),           # IPv6 link-local
    ipaddress.ip_network("fc00::/7"),            # IPv6 unique local
]

# Docker Compose service names and other known-internal hostnames that resolve
# inside the container network. Blocked by name before DNS, because by the time
# we try to resolve them from inside Docker they point to real (internal) IPs.
_BLOCKED_HOSTNAMES: frozenset[str] = frozenset({
    "localhost",
    "db", "postgres", "postgresql", "mysql", "mariadb", "mongo", "mongodb",
    "redis", "rabbitmq", "kafka", "zookeeper", "elasticsearch",
    "backend", "frontend", "cloudflared", "nginx", "traefik",
    "metadata", "metadata.google.internal",  # GCP metadata
})


def _is_private_ip(ip: str) -> bool:
    try:
        addr = ipaddress.ip_address(ip)
        return any(addr in net for net in _PRIVATE_NETWORKS)
    except ValueError:
        return False


def _sync_resolve_and_check(hostname: str, port: int) -> str | None:
    """Blocking DNS check. Returns an error string if the address is internal, else None."""
    try:
        results = socket.getaddrinfo(hostname, port, type=socket.SOCK_STREAM)
    except socket.gaierror as exc:
        return f"hostname '{hostname}' could not be resolved: {exc}"

    for result in results:
        ip = result[4][0]
        if _is_private_ip(ip):
            return f"resolves to a private/internal address ({ip})"
    return None


async def validate_llm_base_url(url: str | None) -> None:
    """
    Raise HTTP 400 if the URL targets internal infrastructure.

    Call this before storing or using any user-supplied LLM base URL.
    Allows None / empty string (means "use provider default").
    """
    if not url or not url.strip():
        return

    try:
        parsed = urlparse(url.strip())
    except Exception:
        raise HTTPException(status_code=400, detail="Invalid LLM base URL format.")

    if parsed.scheme not in ("http", "https"):
        raise HTTPException(status_code=400, detail="LLM base URL must use http or https.")

    hostname = (parsed.hostname or "").lower()
    if not hostname:
        raise HTTPException(status_code=400, detail="LLM base URL must include a hostname.")

    if hostname in _BLOCKED_HOSTNAMES:
        raise HTTPException(
            status_code=400,
            detail=f"LLM base URL cannot reference internal service '{hostname}'.",
        )

    # Fast path: if the hostname is already an IP, check it without DNS.
    try:
        if _is_private_ip(hostname):
            raise HTTPException(
                status_code=400,
                detail="LLM base URL cannot use a private or internal IP address.",
            )
        # It parsed as a valid public IP — no DNS needed.
        return
    except HTTPException:
        raise
    except ValueError:
        pass  # not an IP literal — fall through to DNS resolution

    port = parsed.port or (443 if parsed.scheme == "https" else 80)
    loop = asyncio.get_running_loop()
    error = await loop.run_in_executor(None, _sync_resolve_and_check, hostname, port)
    if error:
        raise HTTPException(status_code=400, detail=f"LLM base URL rejected: {error}.")
