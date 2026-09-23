defmodule Janitor.Migration do
  @moduledoc "Call up/1 and down/1 inside an application-owned Ecto migration. Default schema: janitor."
  @tables ~w(visitors observations identity_subjects identity_keys identity_delegations learning_sessions)
  def up(opts \\ []) do
    prefix = prefix!(opts)
    Ecto.Migration.execute(~s(CREATE SCHEMA IF NOT EXISTS "#{prefix}"))

    for name <- ~w(0001_visitors 0002_identity 0003_learning) do
      sql = File.read!(Application.app_dir(:janitor, "priv/migrations/#{name}.sql"))

      sql =
        Enum.reduce(@tables, sql, fn table, sql ->
          Regex.replace(Regex.compile!("\\b#{table}\\b"), sql, ~s("#{prefix}"."#{table}"))
        end)

      for statement <- String.split(sql, ";", trim: true),
          String.trim(statement) != "",
          do: Ecto.Migration.execute(statement)
    end
  end

  def down(opts \\ []) do
    prefix = prefix!(opts)

    for table <- Enum.reverse(@tables),
        do: Ecto.Migration.execute(~s(DROP TABLE "#{prefix}"."#{table}"))

    # Leave the schema itself intact; it may contain application-owned objects.
  end

  defp prefix!(opts) do
    prefix = Keyword.get(opts, :prefix, "janitor")

    unless is_binary(prefix) and Regex.match?(~r/^[a-z_][a-z0-9_]{0,62}$/, prefix),
      do: raise(ArgumentError, "invalid schema prefix")

    prefix
  end
end
