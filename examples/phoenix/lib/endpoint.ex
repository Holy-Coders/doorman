defmodule JanitorExample.Endpoint do
  use Phoenix.Endpoint, otp_app: :janitor_example
  plug(Plug.Static, at: "/janitor", from: {:janitor, "priv/static"}, only: ~w(janitor.js))

  plug(Plug.Session,
    store: :cookie,
    key: "_janitor_example",
    signing_salt: "local-demo",
    same_site: "Lax",
    http_only: true
  )

  # No globally unbounded parser: Janitor reads and bounds this JSON body itself.
  plug(JanitorExample.Router)
end

defmodule JanitorExample.ErrorHTML do
  def render(template, _assigns), do: Phoenix.Controller.status_message_from_template(template)
end

defmodule JanitorExample.ErrorJSON do
  def render(template, _assigns),
    do: %{error: Phoenix.Controller.status_message_from_template(template)}
end
