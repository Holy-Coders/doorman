defmodule DoormanExample.Repo.Migrations.AddDoorman do
  use Ecto.Migration
  def up, do: Doorman.Migration.up()
  def down, do: Doorman.Migration.down()
end
