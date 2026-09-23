defmodule JanitorExample.Repo.Migrations.UpgradeLookup do
  use Ecto.Migration
  def up, do: Janitor.Migration.upgrade_lookup()
  def down, do: :ok
end
