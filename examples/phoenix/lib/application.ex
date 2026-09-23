defmodule JanitorExample.Application do
  use Application

  def start(_type, _args),
    do:
      Supervisor.start_link([JanitorExample.Repo, JanitorExample.Endpoint],
        strategy: :one_for_one,
        name: JanitorExample.Supervisor
      )
end

defmodule JanitorExample.Repo do
  use Ecto.Repo, otp_app: :janitor_example, adapter: Ecto.Adapters.Postgres
end
