"""Seeds the ZAP baseline with the public routes of the local API (F8, decision 6A).

ZAP only spiders the web, so this hook sends the public API routes through the proxy for the passive
rules to read. Every request goes to ZAP_SEED_API, which the script has checked is loopback. The
bodies are empty or invalid on purpose: nothing logs in, nothing is created.
"""
import os

API = os.environ["ZAP_SEED_API"].rstrip("/")
NIL = "00000000-0000-4000-8000-000000000000"
JSON_HEADERS = "Content-Type: application/json\r\nAccept: application/json\r\n"


def _post(zap, path, body):
    request = (
        f"POST {API}{path} HTTP/1.1\r\nHost: {API.split('://', 1)[1]}\r\n{JSON_HEADERS}"
        f"Content-Length: {len(body)}\r\n\r\n{body}"
    )
    zap.core.send_request(request)


def zap_started(zap, target):
    for path in ("/health/live", "/health/ready", "/api/v1/features", "/api/v1/auth/session"):
        zap.core.access_url(f"{API}{path}", "true")
    _post(zap, "/api/v1/auth/login", "{}")
    _post(zap, "/api/v1/auth/password-reset/request", "{}")
    _post(zap, f"/api/v1/hooks/{NIL}/not-a-token", "{}")
