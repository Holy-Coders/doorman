defmodule DoormanExample.Repo.Migrations.AddApiActivity do
  use Ecto.Migration
  def up, do: Doorman.Migration.upgrade_activity()
  def down, do: raise("Erase activity through application-owned retention before removing tables")
end
