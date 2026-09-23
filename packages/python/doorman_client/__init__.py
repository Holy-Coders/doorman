"""Call your application's Doorman endpoint. This is not a native matching engine."""
from dataclasses import dataclass
import http.client
import json
import math
from urllib.parse import urlsplit

MAX_BODY_BYTES = 32_768
MAX_RESPONSE_BYTES = 65_536


class DoormanError(Exception):
    """Controlled transport/protocol failure; no request or response content is logged."""


@dataclass(frozen=True)
class Result:
    visitor_id: str
    is_returning: bool
    set_cookies: tuple[str, ...]

    def public_json(self) -> dict:
        # Deliberately project the public contract; never relay private scores/debug.
        return {"visitorId": self.visitor_id, "isReturning": self.is_returning}


class Client:
    """Thread-safe configuration. Every call owns its connection and cookie context."""
    def __init__(self, endpoint: str, *, timeout: float = 3, bearer_token: str | None = None):
        url = urlsplit(endpoint)
        if (url.scheme not in ("http", "https") or not url.hostname or url.username
                or url.password or url.query or url.fragment):
            raise ValueError("Expected an absolute Doorman endpoint without credentials or query")
        if url.scheme == "http" and url.hostname not in ("localhost", "127.0.0.1", "::1"):
            raise ValueError("Use HTTPS except for loopback development")
        if not math.isfinite(timeout) or not 0 < timeout <= 30:
            raise ValueError("Timeout must be between 0 and 30 seconds")
        self._url = url
        self._timeout = timeout
        self._token = _header(bearer_token or "", 8192)

    def identify(self, signals: dict, *, behavior: dict | None = None,
                 cookie: str = "", origin: str = "", csrf_token: str = "") -> Result:
        if not isinstance(signals, dict) or behavior is not None and not isinstance(behavior, dict):
            raise ValueError("Signals and behavior must be objects")
        payload = {"signals": signals}
        if behavior is not None:
            payload["behavior"] = behavior
        try:
            data = json.dumps(payload, allow_nan=False, separators=(",", ":")).encode()
        except (ValueError, TypeError, RecursionError) as error:
            raise ValueError("Invalid measurement payload") from error
        if len(data) > MAX_BODY_BYTES:
            raise ValueError("Measurement payload too large")
        headers = {"Content-Type": "application/json", "Accept": "application/json"}
        for name, value, limit in (("Cookie", cookie, 8192), ("Origin", origin, 2048),
                                   ("X-CSRF-Token", csrf_token, 4096)):
            if value:
                headers[name] = _header(value, limit)
        if self._token:
            headers["Authorization"] = "Bearer " + self._token
        connection_type = http.client.HTTPSConnection if self._url.scheme == "https" else http.client.HTTPConnection
        connection = connection_type(self._url.hostname, self._url.port, timeout=self._timeout)
        try:
            connection.request("POST", self._url.path or "/", data, headers)
            response = connection.getresponse()
            # No redirects, retries, or shared cookie jar.
            raw = response.read(MAX_RESPONSE_BYTES + 1)
            if response.status != 200 or len(raw) > MAX_RESPONSE_BYTES:
                raise DoormanError("Doorman endpoint unavailable")
            if response.getheader("Content-Type", "").split(";")[0].strip() != "application/json":
                raise DoormanError("Invalid Doorman response")
            value = json.loads(raw)
            if (not isinstance(value, dict) or not isinstance(value.get("visitorId"), str)
                    or not _visitor_id(value["visitorId"]) or type(value.get("isReturning")) is not bool):
                raise DoormanError("Invalid Doorman response")
            cookies = tuple(_header(v, 4096) for k, v in response.getheaders() if k.lower() == "set-cookie")
            if len(cookies) > 8:
                raise DoormanError("Invalid Doorman cookies")
            return Result(value["visitorId"], value["isReturning"], cookies)
        except DoormanError:
            raise
        except (OSError, http.client.HTTPException, ValueError, RecursionError) as error:
            raise DoormanError("Doorman endpoint unavailable") from error
        finally:
            connection.close()


def _visitor_id(value: str) -> bool:
    return value.startswith("vis_") and len(value) == 52 and all(c in "0123456789abcdef" for c in value[4:])


def _header(value: str, limit: int) -> str:
    if not isinstance(value, str) or len(value) > limit or any(ord(c) < 32 or ord(c) > 126 for c in value):
        raise ValueError("Invalid forwarding header")
    return value
