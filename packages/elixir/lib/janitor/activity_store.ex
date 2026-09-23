defmodule Janitor.ActivityStore do
  @moduledoc false
  alias Janitor.Storage, as: S

  @fields ~w(window_start route requests denied client_errors server_errors duration_total_ms duration_max_ms first_seen_at last_seen_at short_gaps)
  @names ~w(windowStart route requests denied clientErrors serverErrors durationTotalMs durationMaxMs firstSeenAt lastSeenAt shortGaps)

  def increment(c, owner, route, status, duration, now) do
    window = div(now, c.activity.window_ms) * c.activity.window_ms
    expiry = now + c.activity.retention_days * 86_400_000

    [row] =
      S.query(
        c,
        """
        INSERT INTO #{S.table(c, "api_activity_buckets")} AS b
        (owner,window_start,route,requests,denied,client_errors,server_errors,duration_total_ms,duration_max_ms,first_seen_at,last_seen_at,short_gaps,expires_at)
        VALUES ($1,$2,$3,1,$4,$5,$6,$7,$7,$8,$8,0,$9)
        ON CONFLICT (owner,window_start,route) DO UPDATE SET
        requests=LEAST(b.requests+1,1000000000),denied=LEAST(b.denied+EXCLUDED.denied,1000000000),
        client_errors=LEAST(b.client_errors+EXCLUDED.client_errors,1000000000),server_errors=LEAST(b.server_errors+EXCLUDED.server_errors,1000000000),
        duration_total_ms=LEAST(b.duration_total_ms+EXCLUDED.duration_total_ms,60000000000000),duration_max_ms=GREATEST(b.duration_max_ms,EXCLUDED.duration_max_ms),
        short_gaps=LEAST(b.short_gaps+CASE WHEN EXCLUDED.last_seen_at >= b.last_seen_at AND EXCLUDED.last_seen_at-b.last_seen_at < 100 THEN 1 ELSE 0 END,1000000000),
        first_seen_at=LEAST(b.first_seen_at,EXCLUDED.first_seen_at),last_seen_at=GREATEST(b.last_seen_at,EXCLUDED.last_seen_at),
        expires_at=GREATEST(b.expires_at,EXCLUDED.expires_at) RETURNING *
        """,
        [
          owner,
          window,
          route,
          bit(status in [401, 403]),
          bit(status >= 400 and status < 500),
          bit(status >= 500),
          min(round(duration), 60_000),
          now,
          expiry
        ]
      )

    bucket(row)
  end

  def recent(c, owner, now) do
    window = div(now, c.activity.window_ms) * c.activity.window_ms

    S.query(
      c,
      "SELECT * FROM #{S.table(c, "api_activity_buckets")} WHERE owner=$1 AND window_start >= $2 AND window_start <= $3 ORDER BY window_start DESC,route LIMIT 129",
      [owner, window - 4 * c.activity.window_ms, window]
    )
    |> Enum.map(&bucket/1)
  end

  def claim(c, id, owner, lease, now, next_at) do
    S.query(
      c,
      """
      INSERT INTO #{S.table(c, "api_activity_assessments")} AS a (id,owner,lease,next_at) VALUES ($1,$2,$3,$4)
      ON CONFLICT (id) DO UPDATE SET lease=EXCLUDED.lease,next_at=EXCLUDED.next_at,record=NULL WHERE a.next_at <= $5 RETURNING id
      """,
      [id, owner, lease, next_at, now]
    ) != []
  end

  def cached(c, id, now) do
    case S.query(
           c,
           "SELECT record FROM #{S.table(c, "api_activity_assessments")} WHERE id=$1 AND next_at>$2",
           [id, now]
         ) do
      [%{"record" => %{"expiresAt" => expiry} = record}] when expiry > now -> record
      _ -> nil
    end
  end

  def save(c, id, lease, record),
    do:
      S.query(
        c,
        "UPDATE #{S.table(c, "api_activity_assessments")} SET record=$3 WHERE id=$1 AND lease=$2",
        [id, lease, record]
      )

  def delete(c, owner) do
    for table <- ~w(api_activity_buckets api_activity_assessments),
        do: S.query(c, "DELETE FROM #{S.table(c, table)} WHERE owner=$1", [owner])

    :ok
  end

  def cleanup(c) do
    now = Janitor.now()

    S.query(
      c,
      "DELETE FROM #{S.table(c, "api_activity_buckets")} WHERE (owner,window_start,route) IN (SELECT owner,window_start,route FROM #{S.table(c, "api_activity_buckets")} WHERE expires_at <= $1 ORDER BY expires_at LIMIT 100) AND expires_at <= $1",
      [now]
    )

    S.query(
      c,
      "DELETE FROM #{S.table(c, "api_activity_assessments")} WHERE id IN (SELECT id FROM #{S.table(c, "api_activity_assessments")} WHERE next_at <= $1 ORDER BY next_at LIMIT 100) AND next_at <= $1",
      [now]
    )
  end

  defp bucket(row),
    do: @fields |> Enum.zip(@names) |> Map.new(fn {field, name} -> {name, row[field]} end)

  defp bit(true), do: 1
  defp bit(false), do: 0
end
