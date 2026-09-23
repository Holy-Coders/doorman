defmodule JanitorExample.Repo.Migrations.AddSecurityEvidence do
  use Ecto.Migration
  def up, do: Janitor.Migration.upgrade_security()
  def down, do: raise("Keep security evidence until application-owned erasure is complete")
end
