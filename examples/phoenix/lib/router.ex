defmodule JanitorExample.Router do
  use Phoenix.Router

  pipeline :browser do
    plug(:fetch_session)
    plug(:protect_from_forgery)
    plug(:put_secure_browser_headers)
  end

  pipeline :activity do
    plug(:activity_session)

    plug(Janitor.ActivityPlug,
      config: &JanitorExample.Controller.config/0,
      context: &JanitorExample.Controller.activity_context/1
    )
  end

  defp activity_session(conn, _opts) do
    if System.get_env("JANITOR_API_ACTIVITY") == "1" do
      id = Plug.Conn.get_session(conn, :api_activity_id) || Janitor.random_id("session_")
      Plug.Conn.put_session(conn, :api_activity_id, id)
    else
      conn
    end
  end

  scope "/api/example" do
    pipe_through([:browser, :activity])
    get("/orders/:id", JanitorExample.Controller, :order)
  end

  scope "/" do
    pipe_through(:browser)
    get("/", JanitorExample.Controller, :index)
    post("/api/visitor", JanitorExample.Controller, :identify)
  end
end

defmodule JanitorExample.Controller do
  use Phoenix.Controller, formats: [:html, :json]
  import Plug.Conn

  def config do
    Janitor.new(
      repo: JanitorExample.Repo,
      environment: :development,
      secure_cookie: false,
      evaluator: if(key = System.get_env("JEV_API_KEY"), do: [api_key: key]),
      identity: [
        secret:
          System.get_env("JANITOR_IDENTITY_SECRET", String.duplicate("local-example-only", 4)),
        namespace: "phoenix-example"
      ],
      learning: [enabled: true, collection_policy: :application],
      activity:
        if(System.get_env("JANITOR_API_ACTIVITY") == "1",
          do: [routes: [%{route: "GET /api/example/orders/:id"}]]
        )
    )
  end

  def activity_context(conn) do
    if id = get_session(conn, :api_activity_id),
      do: %{route: "GET /api/example/orders/:id", key: %{kind: "session", id: id}}
  end

  def order(conn, %{"id" => id}), do: json(conn, %{orderId: id, status: "example"})

  def identify(conn, _params) do
    # Add context from your authentication plug, never the incoming JSON:
    # person = Janitor.Identity.identify_user(config(), conn.assigns.current_user.id)
    # context = %{verified: %{subject_id: person["id"], actor_id: person["id"]}}
    Janitor.handle(conn, config())
  end

  def index(conn, _params) do
    token = Plug.CSRFProtection.get_csrf_token()

    html = """
    <!doctype html><html lang="en"><meta charset="utf-8"><meta name="viewport" content="width=device-width">
    <meta name="csrf-token" content="#{token}"><title>Janitor · Phoenix</title>
    <style>body{background:#090d19;color:#e4e9ff;font:17px monospace;max-width:800px;margin:10vh auto;padding:24px}button{padding:14px 22px;background:#b6a3ff;border:0;border-radius:8px;font:inherit}pre{white-space:pre-wrap;overflow-wrap:anywhere;color:#b6a3ff}p{line-height:1.7}</style>
    <h1>Janitor × Phoenix</h1><p>Native Elixir. Your Ecto repo. Optional Jev. Same browser contract.</p>
    <button id="identify">Identify this browser</button><pre id="result" aria-live="polite">Ready.</pre>
    <script type="module">
    import { createVisitorClient } from '/janitor/janitor.js';
    const visitor = createVisitorClient({ headers: () => ({'x-csrf-token': document.querySelector('meta[name=csrf-token]').content}) });
    document.querySelector('#identify').onclick = async () => {
      try { document.querySelector('#result').textContent = JSON.stringify(await visitor.identify(), null, 2); }
      catch (error) { document.querySelector('#result').textContent = error.message; }
    };
    window.addEventListener('pagehide', () => visitor.destroy(), {once:true});
    </script></html>
    """

    conn |> put_resp_content_type("text/html") |> send_resp(200, html)
  end
end
