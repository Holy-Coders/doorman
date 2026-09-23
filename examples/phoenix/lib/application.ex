defmodule DoormanExample.Application do
  use Application

  def start(_type, _args),
    do:
      Supervisor.start_link([DoormanExample.Repo, DoormanExample.Endpoint],
        strategy: :one_for_one,
        name: DoormanExample.Supervisor
      )
end

defmodule DoormanExample.Repo do
  use Ecto.Repo, otp_app: :doorman_example, adapter: Ecto.Adapters.Postgres
end
