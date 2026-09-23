defmodule DoormanExample.Endpoint do
  use Phoenix.Endpoint, otp_app: :doorman_example
  plug(Plug.Static, at: "/doorman", from: {:doorman_identity, "priv/static"}, only: ~w(doorman.js))

  plug(Plug.Session,
    store: :cookie,
    key: "_doorman_example",
    signing_salt: "local-demo",
    same_site: "Lax",
    http_only: true
  )

  # No globally unbounded parser: Doorman reads and bounds this JSON body itself.
  plug(DoormanExample.Router)
end

defmodule DoormanExample.ErrorHTML do
  def render(template, _assigns), do: Phoenix.Controller.status_message_from_template(template)
end

defmodule DoormanExample.ErrorJSON do
  def render(template, _assigns),
    do: %{error: Phoenix.Controller.status_message_from_template(template)}
end
