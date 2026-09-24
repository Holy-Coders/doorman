defmodule DoormanExample.Repo.Migrations.AddBrowserContext do
  use Ecto.Migration
  def up, do: Doorman.Migration.upgrade_context()
  def down, do: raise("Erase retained associations before removing this table")
end
