"""Run behind your normal session/CSRF and admission controls."""
import os
from flask import Flask, jsonify, request
from janitor_client import Client, JanitorError

app = Flask(__name__)
app.config["MAX_CONTENT_LENGTH"] = 32_768
client = Client(os.environ["JANITOR_ENDPOINT"], bearer_token=os.getenv("JANITOR_GATEWAY_TOKEN"))

@app.post("/api/visitor")
def identify():
    if not request.is_json:
        return {"error": "JSON required"}, 415
    payload = request.get_json()
    if not isinstance(payload, dict) or set(payload) - {"signals", "behavior"} or "signals" not in payload:
        return {"error": "invalid payload"}, 400
    try:
        result = client.identify(payload["signals"], behavior=payload.get("behavior"),
            cookie=request.headers.get("Cookie", ""), origin=request.headers.get("Origin", ""),
            csrf_token=request.headers.get("X-CSRF-Token", ""))
    except ValueError:
        return {"error": "invalid payload"}, 400
    except JanitorError:
        return {"error": "identity unavailable"}, 503
    response = jsonify(result.public_json())
    response.headers["Cache-Control"] = "no-store"
    for cookie in result.set_cookies:
        response.headers.add("Set-Cookie", cookie)
    return response
