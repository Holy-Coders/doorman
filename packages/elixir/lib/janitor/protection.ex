defmodule Janitor.Protection do
  @moduledoc "Database-backed measurement limits and evaluator admission. Never an account authorization policy."
  alias Janitor.Storage, as: S

  def configure(nil), do: nil

  def configure(opts) do
    Janitor.Identity.validate_options!(opts)
    allowed!(opts, [:secret, :namespace, :requests, :evaluator, :on_event])

    requests =
      Keyword.merge(
        [global: 600, account: 60, session: 30, shards: 1, window_ms: 60_000],
        Keyword.get(opts, :requests, [])
      )

    evaluator =
      Keyword.merge(
        [
          max_calls: 120,
          window_ms: 60_000,
          max_concurrent: 4,
          failure_threshold: 3,
          cooldown_ms: 30_000
        ],
        Keyword.get(opts, :evaluator, [])
      )

    allowed!(requests, [:global, :account, :session, :shards, :window_ms])

    allowed!(evaluator, [
      :max_calls,
      :window_ms,
      :max_concurrent,
      :failure_threshold,
      :cooldown_ms
    ])

    for {k, v} <- requests ++ evaluator do
      {min, max} =
        cond do
          k in [:window_ms, :cooldown_ms] -> {1000, 3_600_000}
          k == :max_concurrent -> {1, 32}
          k == :shards -> {1, 128}
          k == :failure_threshold -> {1, 100}
          true -> {1, 1_000_000}
        end

      unless is_integer(v) and v >= min and v <= max,
        do: raise(ArgumentError, "invalid protection limit")
    end

    if opts[:on_event] && not is_function(opts[:on_event], 1),
      do: raise(ArgumentError, "invalid protection callback")

    opts
    |> Keyword.put(:requests, Map.new(requests))
    |> Keyword.put(:evaluator, Map.new(evaluator))
  end

  def admit(%{protection: nil}, _), do: :ok

  def admit(c, context) do
    context = context || %{}

    unless is_map(context) and
             Enum.all?(context, fn {k, v} ->
               k in [:account, :session] and is_binary(v) and byte_size(v) in 1..512
             end),
           do: raise(ArgumentError, "invalid admission context")

    limits = c.protection[:requests]
    now = Janitor.now()
    shards = min(limits.shards, limits.global)
    shard = :rand.uniform(shards) - 1

    global =
      if shards == 1 do
        {"global", limits.global, now}
      else
        {Jason.encode!(["global-shard-v1", shards, shard]),
         div(limits.global, shards) + if(shard < rem(limits.global, shards), do: 1, else: 0),
         div(now, limits.window_ms) * limits.window_ms}
      end

    checks =
      [global] ++
        for(
          k <- [:account, :session],
          context[k],
          do: {Jason.encode!([to_string(k), context[k]]), limits[k], now}
        )

    if Enum.all?(checks, fn {value, limit, window_time} ->
         S.query(
           c,
           "INSERT INTO #{S.table(c, "protection_quotas")} AS q (id,used,reset_at) VALUES ($1,1,$2) ON CONFLICT (id) DO UPDATE SET used = CASE WHEN q.reset_at <= $3 THEN 1 ELSE q.used + 1 END, reset_at = CASE WHEN q.reset_at <= $3 THEN $2 ELSE q.reset_at END WHERE q.reset_at <= $3 OR q.used < $4 RETURNING id",
           [key(c, value), window_time + limits.window_ms, window_time, limit]
         ) != []
       end),
       do: :ok,
       else:
         (
           emit(c, :request, :request_limit)
           {:error, {:rate_limited, ceil(limits.window_ms / 1000)}}
         )
  end

  def evaluate(%{protection: nil} = c, fun), do: Janitor.Bounded.run(fun, c.evaluator_timeout_ms)

  def evaluate(c, fun) do
    limits = c.protection[:evaluator]

    reservation =
      change(c, fn s, now ->
        s = Map.update!(s, "leases", &Enum.filter(&1, fn l -> l["expiresAt"] > now end))

        s =
          if now - s["windowStart"] >= limits.window_ms,
            do: %{s | "windowStart" => now, "used" => 0},
            else: s

        probe = s["openUntil"] != 0

        cond do
          s["openUntil"] > now ->
            {:return, {:denied, :circuit_open}}

          s["used"] >= limits.max_calls ->
            {:return, {:denied, :budget}}

          length(s["leases"]) >= limits.max_concurrent or
              (probe and Enum.any?(s["leases"], & &1["probe"])) ->
            {:return, {:denied, :concurrency}}

          true ->
            lease = %{
              "id" => Janitor.random_id("lease_"),
              "expiresAt" => now + c.evaluator_timeout_ms + 5000,
              "epoch" => s["epoch"],
              "probe" => probe
            }

            {:save, %{s | "leases" => s["leases"] ++ [lease], "used" => s["used"] + 1},
             {:lease, lease}}
        end
      end)

    case reservation do
      {:denied, reason} ->
        emit(c, :evaluator, reason)
        :unavailable

      {:lease, lease} ->
        result = Janitor.Bounded.run(fun, c.evaluator_timeout_ms, true)

        reason =
          case result do
            {:ok, value} -> if Janitor.Engine.valid_evaluation?(value), do: nil, else: :malformed
            :timeout -> :timeout
            _ -> :provider
          end

        if reason, do: emit(c, :evaluator, reason)
        finish(c, lease, reason)
        if reason, do: :unavailable, else: result
    end
  rescue
    _ ->
      emit(c, :evaluator, :storage)
      :unavailable
  catch
    _, _ ->
      emit(c, :evaluator, :storage)
      :unavailable
  end

  defp finish(c, lease, failure) do
    change(c, fn s, now ->
      if not Enum.any?(s["leases"], &(&1["id"] == lease["id"])) do
        {:return, :ok}
      else
        s =
          if failure == :timeout,
            do: s,
            else: Map.update!(s, "leases", &Enum.reject(&1, fn l -> l["id"] == lease["id"] end))

        s =
          cond do
            lease["epoch"] != s["epoch"] ->
              s

            is_nil(failure) ->
              s
              |> Map.put("failures", 0)
              |> then(fn s ->
                if lease["probe"], do: %{s | "openUntil" => 0, "epoch" => s["epoch"] + 1}, else: s
              end)

            lease["probe"] or s["failures"] + 1 >= c.protection[:evaluator].failure_threshold ->
              %{
                s
                | "openUntil" => now + c.protection[:evaluator].cooldown_ms,
                  "epoch" => s["epoch"] + 1
              }

            true ->
              Map.update!(s, "failures", &(&1 + 1))
          end

        {:save, s, :ok}
      end
    end)
  rescue
    _ -> emit(c, :evaluator, :storage)
  end

  defp change(c, fun, retries \\ 8)
  defp change(_, _, 0), do: raise("protection contention")

  defp change(c, fun, retries) do
    now = Janitor.now()
    id = key(c, "evaluator")

    row =
      List.first(
        S.query(c, "SELECT record FROM #{S.table(c, "evaluation_controls")} WHERE id = $1", [id])
      )

    state =
      if row,
        do: row["record"],
        else: %{
          "version" => 0,
          "windowStart" => now,
          "used" => 0,
          "failures" => 0,
          "openUntil" => 0,
          "epoch" => 0,
          "leases" => []
        }

    case fun.(state, now) do
      {:return, result} ->
        result

      {:save, next, result} ->
        next = Map.put(next, "version", state["version"] + 1)
        limits = c.protection[:evaluator]

        expiry =
          now +
            Enum.max([limits.window_ms, limits.cooldown_ms, c.evaluator_timeout_ms + 5000]) * 2

        rows =
          if state["version"] == 0 do
            S.query(
              c,
              "INSERT INTO #{S.table(c, "evaluation_controls")} (id,version,expires_at,record) VALUES ($1,$2,$3,$4) ON CONFLICT (id) DO NOTHING RETURNING id",
              [id, next["version"], expiry, next]
            )
          else
            S.query(
              c,
              "UPDATE #{S.table(c, "evaluation_controls")} SET version=$2,expires_at=$3,record=$4 WHERE id=$1 AND version=$5 RETURNING id",
              [id, next["version"], expiry, next, state["version"]]
            )
          end

        if rows == [], do: change(c, fun, retries - 1), else: result
    end
  end

  def cleanup(c) do
    for {table, field} <- [
          {"protection_quotas", "reset_at"},
          {"evaluation_controls", "expires_at"}
        ] do
      S.query(
        c,
        "DELETE FROM #{S.table(c, table)} WHERE id IN (SELECT id FROM #{S.table(c, table)} WHERE #{field} <= $1 ORDER BY #{field} LIMIT 100) AND #{field} <= $1",
        [Janitor.now()]
      )
    end
  end

  defp key(c, value),
    do: Janitor.Identity.label(c.protection, Jason.encode!(["protection-v1", value]))

  defp allowed!(opts, keys),
    do:
      if(not Keyword.keyword?(opts) or Enum.any?(Keyword.keys(opts), &(&1 not in keys)),
        do: raise(ArgumentError, "unknown protection option")
      )

  defp emit(c, kind, reason) do
    if fun = c.protection[:on_event], do: fun.(%{kind: kind, reason: reason})
  rescue
    _ -> :ok
  catch
    _, _ -> :ok
  end
end
