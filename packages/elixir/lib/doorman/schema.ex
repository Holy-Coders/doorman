defmodule Doorman.Schema do
  @moduledoc false
  @version 10
  @tables ~w(visitors observations identity_subjects identity_keys identity_delegations learning_sessions protection_quotas evaluation_controls application_events device_links api_activity_buckets api_activity_assessments browser_associations)
  @names ~w(0001_visitors 0002_identity 0003_learning 0004_candidate_lookup 0005_protection 0006_evidence 0007_learning_lookup 0008_api_activity 0010_browser_associations)
  @statements Enum.flat_map(@names, fn name ->
                path = Path.expand("../../priv/migrations/#{name}.sql", __DIR__)
                @external_resource path
                path
                |> File.read!()
                |> then(&Regex.replace(~r/--[^\n]*/, &1, ""))
                |> String.split(";", trim: true)
                |> Enum.map(&String.trim/1)
                |> Enum.reject(&(&1 == ""))
                |> Enum.map(
                  &Regex.replace(
                    ~r/^CREATE (TABLE|INDEX) (?!IF NOT EXISTS)/,
                    &1,
                    "CREATE \\1 IF NOT EXISTS "
                  )
                )
              end)

  def ensure!(%{auto_migrate: false}), do: :ok

  def ensure!(c) do
    repo = c.repo.get_dynamic_repo()
    pid = if is_pid(repo), do: repo, else: Process.whereis(repo)
    key = {__MODULE__, repo, c.prefix, @version}

    # A restarted Repo must recheck its database. Never cache a failed setup.
    unless pid && :persistent_term.get(key, nil) == pid do
      install!(c)
      if pid && not c.repo.in_transaction?(), do: :persistent_term.put(key, pid)
    end

    :ok
  end

  defp install!(c) do
    ledger = ~s("#{c.prefix}"."_doorman_schema")
    %{rows: [[exists]]} = query!(c, "SELECT to_regclass($1)", [ledger])

    [[current]] =
      if exists,
        do: query!(c, "SELECT COALESCE(max(version), 0) FROM #{ledger}").rows,
        else: [[0]]

    if current < @version do
      sql =
        Enum.map_join(@statements, ";\n", fn statement ->
          Enum.reduce(@tables, statement, fn table, sql ->
            Regex.replace(Regex.compile!("\\b#{table}\\b"), sql, ~s("#{c.prefix}"."#{table}"))
          end)
        end)

      # Separate statements after acquiring the transaction lock see committed catalogs.
      {:ok, :ok} =
        c.repo.transaction(fn ->
          query!(c, "SET LOCAL lock_timeout = '3s'")

          query!(c, "SELECT pg_advisory_xact_lock(1146049618, 1)")

          %{rows: [[present]]} =
            query!(c, "SELECT EXISTS (SELECT 1 FROM pg_namespace WHERE nspname = $1)", [c.prefix])

          unless present, do: query!(c, ~s(CREATE SCHEMA "#{c.prefix}"))
          query!(c, "CREATE TABLE IF NOT EXISTS #{ledger} (version INTEGER PRIMARY KEY)")
          %{rows: [[version]]} = query!(c, "SELECT COALESCE(max(version), 0) FROM #{ledger}")

          if version < @version do
            for statement <- String.split(sql, ";", trim: true), do: query!(c, statement)

            query!(c, "INSERT INTO #{ledger} (version) VALUES ($1) ON CONFLICT DO NOTHING", [
              @version
            ])
          end

          :ok
        end)
    end
  end

  defp query!(c, sql, params \\ []), do: Ecto.Adapters.SQL.query!(c.repo, sql, params, log: false)
end
