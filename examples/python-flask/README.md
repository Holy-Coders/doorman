# Run the Python example

This example serves a Flask route in front of your existing Janitor engine. It does not require a new database or Jev key in Python.

From the repository root:

```sh
python3 -m venv .venv
.venv/bin/pip install ./packages/python 'flask>=3,<4'
JANITOR_ENDPOINT=https://identity.your-app.example/api/visitor \
  .venv/bin/flask --app examples/python-flask/app run --port 3001
```

For a no-key local upstream, start the Cloudflare example on port 8787 first and use `JANITOR_ENDPOINT=http://127.0.0.1:8787/api/visitor`. Configure its allowed origins for the browser origin where Flask is served. A transport smoke check is:

```sh
curl -i http://localhost:3001/api/visitor -H 'Content-Type: application/json' -d '{"signals":{}}'
```

Empty signals check transport only. In your app, the shared browser client calls `/api/visitor` with real measurements. Keep the response's separate Set-Cookie headers intact. Use the production WSGI server, authentication/CSRF and request limits you already run. `JANITOR_GATEWAY_TOKEN` is optional and is meaningful only when your own upstream gateway verifies it.
