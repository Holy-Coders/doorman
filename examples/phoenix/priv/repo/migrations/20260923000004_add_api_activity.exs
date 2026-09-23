defmodule JanitorExample.Repo.Migrations.AddApiActivity do
  use Ecto.Migration
  def up, do: Janitor.Migration.upgrade_activity()
  def down, do: raise("Erase activity through application-owned retention before removing tables")
end
