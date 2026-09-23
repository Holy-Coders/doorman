import Config
config :doorman_example, ecto_repos: [DoormanExample.Repo]

config :doorman_example, DoormanExample.Repo,
  url: System.get_env("DATABASE_URL", "postgres://visitor:visitor@localhost:55433/visitors"),
  pool_size: 5,
  log: false

config :doorman_example, DoormanExample.Endpoint,
  adapter: Bandit.PhoenixAdapter,
  render_errors: [
    formats: [html: DoormanExample.ErrorHTML, json: DoormanExample.ErrorJSON],
    layout: false
  ],
  url: [host: "localhost"],
  http: [ip: {127, 0, 0, 1}, port: String.to_integer(System.get_env("PORT", "4000"))],
  secret_key_base: System.get_env("SECRET_KEY_BASE", String.duplicate("local-example-only-", 4)),
  server: config_env() != :test

config :phoenix, :json_library, Jason
# Avoid logging browser measurements or tokens through Phoenix controller parameters.
config :phoenix, :filter_parameters, ["signals", "behavior", "password", "token", "email"]
config :logger, level: :warning
