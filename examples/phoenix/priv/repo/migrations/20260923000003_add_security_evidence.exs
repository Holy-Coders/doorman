defmodule DoormanExample.Repo.Migrations.AddSecurityEvidence do
  use Ecto.Migration
  def up, do: Doorman.Migration.upgrade_security()
  def down, do: raise("Keep security evidence until application-owned erasure is complete")
end
