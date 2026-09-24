ExUnit.start()
Logger.configure(level: :warning)

defmodule Doorman.TestRepo do
  use Ecto.Repo, otp_app: :doorman_identity, adapter: Ecto.Adapters.Postgres
end

Application.put_env(:doorman_identity, Doorman.TestRepo,
  url: System.get_env("DATABASE_URL", "postgres://visitor:visitor@localhost:55433/visitors"),
  pool_size: 5,
  log: false
)

{:ok, _} = Doorman.TestRepo.start_link()

defmodule Doorman.TestMigration do
  use Ecto.Migration
  def up, do: Doorman.Migration.up(prefix: "doorman_test")
  def down, do: Doorman.Migration.down(prefix: "doorman_test")
end

Ecto.Migrator.up(Doorman.TestRepo, 2_026_092_301, Doorman.TestMigration, log: false)

defmodule Doorman.TestLookupMigration do
  use Ecto.Migration
  def up, do: Doorman.Migration.upgrade_lookup(prefix: "doorman_test")
end

Ecto.Migrator.up(Doorman.TestRepo, 2_026_092_302, Doorman.TestLookupMigration, log: false)

defmodule Doorman.TestSecurityMigration do
  use Ecto.Migration
  def up, do: Doorman.Migration.upgrade_security(prefix: "doorman_test")
end

Ecto.Migrator.up(Doorman.TestRepo, 2_026_092_303, Doorman.TestSecurityMigration, log: false)

defmodule Doorman.TestLearningMigration do
  use Ecto.Migration
  def up, do: Doorman.Migration.upgrade_learning(prefix: "doorman_test")
end

Ecto.Migrator.up(Doorman.TestRepo, 2_026_092_304, Doorman.TestLearningMigration, log: false)

defmodule Doorman.TestActivityMigration do
  use Ecto.Migration
  def up, do: Doorman.Migration.upgrade_activity(prefix: "doorman_test")
end

Ecto.Migrator.up(Doorman.TestRepo, 2_026_092_305, Doorman.TestActivityMigration, log: false)

defmodule Doorman.TestContextMigration do
  use Ecto.Migration
  def up, do: Doorman.Migration.upgrade_context(prefix: "doorman_test")
end

Ecto.Migrator.up(Doorman.TestRepo, 2_026_092_306, Doorman.TestContextMigration, log: false)
