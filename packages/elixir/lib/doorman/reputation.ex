defmodule Doorman.Reputation do
  @moduledoc "Optional AbuseIPDB check. Short-lived database cache and quota; no IP persistence or reporting."
  alias Doorman.Storage, as: S
  def configure(nil, _), do: nil

  def configure(opts, identity) do
    unless identity && Keyword.keyword?(opts) &&
             Enum.all?(
               Keyword.keys(opts),
               &(&1 in [
                   :api_key,
                   :timeout_ms,
                   :cache_ttl_ms,
                   :max_requests_per_hour,
                   :req_options
                 ])
             ),
           do: raise(ArgumentError, "invalid reputation configuration")

    unless is_binary(opts[:api_key]) && String.trim(opts[:api_key]) != "",
      do: raise(ArgumentError, "reputation API key is required")

    opts =
      Keyword.merge([timeout_ms: 500, cache_ttl_ms: 300_000, max_requests_per_hour: 100], opts)

    for {key, min, max} <- [
          {:timeout_ms, 50, 3000},
          {:cache_ttl_ms, 1000, 3_600_000},
          {:max_requests_per_hour, 1, 10_000}
        ] do
      unless is_integer(opts[key]) && opts[key] >= min && opts[key] <= max,
        do: raise(ArgumentError, "invalid reputation limit")
    end

    # Req.Test hooks only; never accept a configurable request destination.
    unless Enum.all?(Keyword.keys(opts[:req_options] || []), &(&1 in [:plug])),
      do: raise(ArgumentError, "invalid reputation transport options")

    opts
  end

  def check(%{reputation: nil}, _), do: nil

  def check(c, raw) do
    case public_ip(raw) do
      nil ->
        empty("not-requested")

      ip ->
        key = label(c, ["reputation-cache-v1", ip])
        now = Doorman.now()

        case S.query(
               c,
               "SELECT record FROM #{S.table(c, "evaluation_controls")} WHERE id=$1 AND expires_at > $2",
               [key, now]
             ) do
          [%{"record" => value}] -> Map.put(value, "cached", true)
          [] -> lookup(c, ip, key, now)
        end
    end
  rescue
    _ -> empty("unavailable")
  catch
    _, _ -> empty("unavailable")
  end

  defp lookup(c, ip, key, now) do
    opts = c.reputation

    lease =
      S.query(
        c,
        "INSERT INTO #{S.table(c, "evaluation_controls")} AS e (id,version,expires_at,record) VALUES ($1,$2,$3,$4) ON CONFLICT (id) DO UPDATE SET version=EXCLUDED.version,expires_at=EXCLUDED.expires_at,record=EXCLUDED.record WHERE e.expires_at <= $2 RETURNING id",
        [key, now, now + opts[:timeout_ms] + 1000, empty("unavailable")]
      )

    if lease == [] do
      empty("unavailable")
    else
      quota =
        S.query(
          c,
          "INSERT INTO #{S.table(c, "protection_quotas")} AS q (id,used,reset_at) VALUES ($1,1,$2) ON CONFLICT (id) DO UPDATE SET used=CASE WHEN q.reset_at <= $3 THEN 1 ELSE q.used+1 END,reset_at=CASE WHEN q.reset_at <= $3 THEN $2 ELSE q.reset_at END WHERE q.reset_at <= $3 OR q.used < $4 RETURNING id",
          [label(c, ["reputation-budget-v1"]), now + 3_600_000, now, opts[:max_requests_per_hour]]
        )

      value =
        if quota == [] do
          empty("limited")
        else
          case Doorman.Bounded.run(fn -> fetch(ip, opts) end, opts[:timeout_ms]) do
            {:ok, value} -> value
            _ -> empty("unavailable")
          end
        end

      ttl = if value["status"] == "available", do: opts[:cache_ttl_ms], else: 30_000

      S.query(
        c,
        "UPDATE #{S.table(c, "evaluation_controls")} SET record=$1,expires_at=$2 WHERE id=$3 AND version=$4",
        [value, Doorman.now() + ttl, key, now]
      )

      value
    end
  end

  defp fetch(ip, opts) do
    response =
      Doorman.HTTP.get_json(
        Keyword.merge(opts[:req_options] || [],
          url: "https://api.abuseipdb.com/api/v2/check",
          params: [ipAddress: ip, maxAgeInDays: 30],
          headers: [{"key", opts[:api_key]}, {"accept", "application/json"}],
          retry: false,
          redirect: false,
          receive_timeout: opts[:timeout_ms],
          connect_options: [timeout: opts[:timeout_ms]]
        )
      )

    data = response.body["data"]

    unless response.status == 200 && is_map(data) && public_ip(data["ipAddress"]) == ip &&
             data["isPublic"] == true && is_integer(data["abuseConfidenceScore"]) &&
             data["abuseConfidenceScore"] in 0..100 && is_integer(data["totalReports"]) &&
             data["totalReports"] in 0..1_000_000_000,
           do: raise("invalid reputation response")

    value =
      Map.merge(empty("available"), %{
        "score" => data["abuseConfidenceScore"] / 100,
        "totalReports" => data["totalReports"]
      })

    case DateTime.from_iso8601(data["lastReportedAt"] || "") do
      {:ok, time, _} ->
        ms = DateTime.to_unix(time, :millisecond)

        if ms >= 0 && ms <= Doorman.now() + 5000,
          do: Map.put(value, "lastReportedAt", ms),
          else: value

      _ ->
        value
    end
  end

  defp public_ip(raw) when is_binary(raw) do
    case :inet.parse_address(String.to_charlist(raw)) do
      {:ok, {a, b, _, _} = address}
      when a != 0 and a != 10 and a != 127 and a < 224 and not (a == 169 and b == 254) and
             not (a == 172 and b >= 16 and b <= 31) and not (a == 192 and b == 168) and
             not (a == 100 and b >= 64 and b <= 127) and not (a == 198 and b in [18, 19]) ->
        to_string(:inet.ntoa(address))

      {:ok, {a, _, _, _, _, _, _, _} = address} when a >= 0x2000 and a <= 0x3FFF ->
        to_string(:inet.ntoa(address))

      _ ->
        nil
    end
  end

  defp public_ip(_), do: nil
  defp label(c, parts), do: Doorman.Identity.label(c.identity, Jason.encode!(parts))

  defp empty(status),
    do: %{
      "provider" => "abuseipdb",
      "status" => status,
      "cached" => false,
      "observedAt" => Doorman.now()
    }
end
