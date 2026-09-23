defmodule JanitorExample.Repo.Migrations.AddJanitor do
  use Ecto.Migration
  def up, do: Janitor.Migration.up()
  def down, do: Janitor.Migration.down()
end
