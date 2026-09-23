defmodule DoormanExample.Repo.Migrations.UpgradeLookup do
  use Ecto.Migration
  def up, do: Doorman.Migration.upgrade_lookup()
  def down, do: :ok
end
