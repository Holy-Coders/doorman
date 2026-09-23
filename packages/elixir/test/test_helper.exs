ExUnit.start()
Logger.configure(level: :warning)

defmodule Janitor.TestRepo do
  use Ecto.Repo, otp_app: :janitor, adapter: Ecto.Adapters.Postgres
end

Application.put_env(:janitor, Janitor.TestRepo,
  url: System.get_env("DATABASE_URL", "postgres://visitor:visitor@localhost:55433/visitors"),
  pool_size: 5,
  log: false
)

{:ok, _} = Janitor.TestRepo.start_link()

defmodule Janitor.TestMigration do
  use Ecto.Migration
  def up, do: Janitor.Migration.up(prefix: "janitor_test")
  def down, do: Janitor.Migration.down(prefix: "janitor_test")
end

Ecto.Migrator.up(Janitor.TestRepo, 2_026_092_301, Janitor.TestMigration, log: false)

defmodule Janitor.TestLookupMigration do
  use Ecto.Migration
  def up, do: Janitor.Migration.upgrade_lookup(prefix: "janitor_test")
end

Ecto.Migrator.up(Janitor.TestRepo, 2_026_092_302, Janitor.TestLookupMigration, log: false)

defmodule Janitor.TestSecurityMigration do
  use Ecto.Migration
  def up, do: Janitor.Migration.upgrade_security(prefix: "janitor_test")
end

Ecto.Migrator.up(Janitor.TestRepo, 2_026_092_303, Janitor.TestSecurityMigration, log: false)
