defmodule DoormanExample.Router do
  use Phoenix.Router

  pipeline :browser do
    plug(:fetch_session)
    plug(:protect_from_forgery)
    plug(:put_secure_browser_headers)
  end

  pipeline :activity do
    plug(:activity_session)

    plug(Doorman.ActivityPlug,
      config: &DoormanExample.Controller.config/0,
      context: &DoormanExample.Controller.activity_context/1
    )
  end

  defp activity_session(conn, _opts) do
    if System.get_env("DOORMAN_API_ACTIVITY") == "1" do
      id = Plug.Conn.get_session(conn, :api_activity_id) || Doorman.random_id("session_")
      Plug.Conn.put_session(conn, :api_activity_id, id)
    else
      conn
    end
  end

  scope "/api/example" do
    pipe_through([:browser, :activity])
    get("/orders/:id", DoormanExample.Controller, :order)
  end

  scope "/" do
    pipe_through(:browser)
    get("/", DoormanExample.Controller, :index)
    post("/api/visitor", DoormanExample.Controller, :identify)
  end
end

defmodule DoormanExample.Controller do
  use Phoenix.Controller, formats: [:html, :json]
  import Plug.Conn

  def config do
    Doorman.new(
      repo: DoormanExample.Repo,
      environment: :development,
      secure_cookie: false,
      evaluator: if(key = System.get_env("JEV_API_KEY"), do: [api_key: key]),
      secret:
        System.get_env("DOORMAN_IDENTITY_SECRET", String.duplicate("local-example-only", 4)),
      namespace: "phoenix-example",
      cross_device: true,
      activity:
        if(System.get_env("DOORMAN_API_ACTIVITY") == "1",
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
    # context = %{auth: %{user_id: conn.assigns.current_user.id, account_id: account.id}}
    # Doorman.handle(conn, config(), context)
    Doorman.handle(conn, config())
  end

  def index(conn, _params) do
    token = Plug.CSRFProtection.get_csrf_token()

    html = """
    <!doctype html><html lang="en"><meta charset="utf-8"><meta name="viewport" content="width=device-width">
    <meta name="csrf-token" content="#{token}"><title>Doorman · Phoenix</title>
    <style>body{background:#090d19;color:#e4e9ff;font:17px monospace;max-width:800px;margin:10vh auto;padding:24px}button{padding:14px 22px;background:#b6a3ff;border:0;border-radius:8px;font:inherit}pre{white-space:pre-wrap;overflow-wrap:anywhere;color:#b6a3ff}p{line-height:1.7}</style>
    <h1>Doorman × Phoenix</h1><p>Native Elixir. Your Ecto repo. Optional Jev. Same browser contract.</p>
    <button id="identify">Identify this browser</button><pre id="result" aria-live="polite">Ready.</pre>
    <script type="module">
    import { createDoormanClient } from '/doorman/doorman.js';
    const visitor = createDoormanClient({ collection: "extended", headers: () => ({'x-csrf-token': document.querySelector('meta[name=csrf-token]').content}) });
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
