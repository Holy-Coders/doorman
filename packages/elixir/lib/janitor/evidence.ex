defmodule Janitor.Evidence do
  @moduledoc "Server-owned events, bounded activity summaries and revocable verified associations. Never browser authentication."
  alias Janitor.Storage, as: S

  @events ~w(login-attempt login-success login-failure verification-success verification-failure recovery-requested recovery-completed sensitive-action action-denied)
  @actions ~w(sign-in recovery payment profile-update read other)
  @methods ~w(password passkey mfa oauth email-link recovery admin-review)
  @day 86_400_000

  def configure(nil, _), do: nil
  def configure(false, _), do: nil
  def configure(true, identity), do: configure([], identity)

  def configure(opts, identity) do
    if is_nil(identity), do: raise(ArgumentError, "evidence requires identity configuration")
    unless Keyword.keyword?(opts), do: raise(ArgumentError, "invalid evidence options")
    only!(Map.new(opts), [:event_retention_days, :link_retention_days, :max_events_per_query])

    %{
      event_retention_days: integer!(Keyword.get(opts, :event_retention_days, 7), 1, 30),
      link_retention_days: integer!(Keyword.get(opts, :link_retention_days, 90), 1, 365),
      max_events_per_query: integer!(Keyword.get(opts, :max_events_per_query, 1000), 1, 1000)
    }
  end

  def record(c, input) do
    enabled!(c)
    only!(input, [:id, :type, :action, :subject_id, :session_id, :actor_id, :visitor_id])
    type = one!(input[:type], @events)
    action = if input[:action], do: one!(input.action, @actions)
    subject = if input[:subject_id], do: ref!(input.subject_id, "sub_", 64)
    session = if input[:session_id], do: label!(input.session_id)
    actor = if input[:actor_id], do: ref!(input.actor_id, "sub_", 64)
    visitor = if input[:visitor_id], do: ref!(input.visitor_id, "vis_", 48)

    if is_nil(subject) and is_nil(session) and is_nil(actor),
      do: raise(ArgumentError, "activity key required")

    id = key(c, "event", label!(input[:id]))
    digest = key(c, "event-payload", [type, action, subject, session, actor, visitor])
    now = Janitor.now()

    event =
      clean(%{
        "id" => id,
        "scope" => scope(c),
        "digest" => digest,
        "type" => type,
        "action" => action,
        "subjectId" => subject,
        "sessionId" => if(session, do: key(c, "session", session)),
        "actorId" => actor,
        "visitorId" => visitor,
        "occurredAt" => now,
        "expiresAt" => now + c.evidence.event_retention_days * @day
      })

    rows =
      S.query(
        c,
        "INSERT INTO #{S.table(c, "application_events")} (id,scope,digest,subject_id,session_id,actor_id,visitor_id,action,occurred_at,expires_at,record) VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11) ON CONFLICT (id) DO NOTHING RETURNING id",
        [
          id,
          scope(c),
          digest,
          subject,
          event["sessionId"],
          actor,
          visitor,
          action,
          now,
          event["expiresAt"],
          event
        ]
      )

    if rows == [] do
      existing =
        List.first(
          S.query(
            c,
            "SELECT digest FROM #{S.table(c, "application_events")} WHERE id=$1 AND scope=$2",
            [id, scope(c)]
          )
        )

      if is_nil(existing) or existing["digest"] != digest,
        do: raise(ArgumentError, "event idempotency conflict")
    end

    %{"recorded" => rows != []}
  end

  def velocity(c, input) do
    enabled!(c)
    only!(input, [:subject_id, :session_id, :actor_id, :action, :window_ms])

    unless Enum.count([input[:subject_id], input[:session_id], input[:actor_id]], &(!is_nil(&1))) ==
             1,
           do: raise(ArgumentError, "select one activity key")

    {field, id} =
      cond do
        input[:subject_id] -> {"subject_id", ref!(input.subject_id, "sub_", 64)}
        input[:actor_id] -> {"actor_id", ref!(input.actor_id, "sub_", 64)}
        true -> {"session_id", key(c, "session", label!(input.session_id))}
      end

    action = if input[:action], do: one!(input.action, @actions)
    window = integer!(input[:window_ms] || 900_000, 1000, @day)
    now = Janitor.now()
    limit = c.evidence.max_events_per_query
    args = [scope(c), id, now - window, now, limit + 1] ++ if(action, do: [action], else: [])

    rows =
      S.query(
        c,
        "SELECT record->>'type' AS type FROM #{S.table(c, "application_events")} WHERE scope=$1 AND #{field}=$2 AND occurred_at >= $3 AND occurred_at <= $4 AND expires_at > $4 #{if action, do: "AND action=$6", else: ""} ORDER BY occurred_at DESC,id DESC LIMIT $5",
        args
      )

    counts = rows |> Enum.take(limit) |> Enum.frequencies_by(& &1["type"])

    clean(%{
      "source" => "application",
      "observedAt" => now,
      "windowMs" => window,
      "action" => action,
      "counts" => counts,
      "total" => min(length(rows), limit),
      "saturated" => length(rows) > limit
    })
  end

  def link_device(c, input) do
    enabled!(c)
    only!(input, [:subject_id, :visitor_id, :verification, :expires_at])
    subject = ref!(input[:subject_id], "sub_", 64)
    visitor = ref!(input[:visitor_id], "vis_", 48)
    proof = input[:verification]
    only!(proof, [:method, :issuer, :event_id, :verified_at])
    method = one!(proof[:method], @methods)
    issuer = label!(proof[:issuer])
    now = Janitor.now()
    verified = integer!(proof[:verified_at], max(0, now - 300_000), now + 5000)
    expires = integer!(input[:expires_at], now + 1, now + 90 * @day)
    proof_id = key(c, "verification", [issuer, label!(proof[:event_id])])
    id = String.replace_prefix(proof_id, "sub_", "dev_")
    digest = key(c, "device-payload", [subject, visitor, method, verified, expires])

    record = %{
      "id" => id,
      "scope" => scope(c),
      "digest" => digest,
      "subjectId" => subject,
      "visitorId" => visitor,
      "verification" => %{
        "method" => method,
        "issuer" => issuer,
        "eventId" => proof_id,
        "verifiedAt" => verified
      },
      "createdAt" => now,
      "expiresAt" => expires
    }

    rows =
      S.query(
        c,
        "INSERT INTO #{S.table(c, "device_links")} (id,scope,digest,subject_id,visitor_id,created_at,retire_at,record) VALUES ($1,$2,$3,$4,$5,$6,$7,$8) ON CONFLICT (id) DO NOTHING RETURNING record",
        [id, scope(c), digest, subject, visitor, now, expires, record]
      )

    existing =
      case rows do
        [row] -> row["record"]
        [] -> get_link(c, id)
      end

    if is_nil(existing) or existing["digest"] != digest,
      do: raise(ArgumentError, "device verification already used for another association")

    existing
  end

  def assess_device(c, input) do
    enabled!(c)
    only!(input, [:id, :subject_id, :visitor_id])
    id = ref!(input[:id], "dev_", 64)
    subject = ref!(input[:subject_id], "sub_", 64)
    visitor = ref!(input[:visitor_id], "vis_", 48)
    link = get_link(c, id)

    reason =
      cond do
        is_nil(link) -> "missing"
        link["revocation"] -> "revoked"
        link["expiresAt"] <= Janitor.now() -> "expired"
        link["subjectId"] != subject -> "subject"
        link["visitorId"] != visitor -> "visitor"
        true -> nil
      end

    if reason,
      do: %{"status" => "invalid", "reason" => reason},
      else: %{"status" => "verified-association", "link" => link}
  end

  def list_devices(c, subject, limit \\ 20) do
    enabled!(c)

    S.query(
      c,
      "SELECT record FROM #{S.table(c, "device_links")} WHERE scope=$1 AND subject_id=$2 ORDER BY created_at DESC,id DESC LIMIT $3",
      [scope(c), ref!(subject, "sub_", 64), integer!(limit, 1, 100)]
    )
    |> Enum.map(& &1["record"])
  end

  def revoke_device(c, id, input) do
    enabled!(c)
    only!(input, [:reason, :issuer, :event_id])
    issuer = label!(input[:issuer])
    now = Janitor.now()

    revoke = %{
      "reason" => one!(input[:reason], ~w(logout device-removed compromised account-recovery)),
      "issuer" => issuer,
      "eventId" => key(c, "revocation", [issuer, label!(input[:event_id])]),
      "revokedAt" => now
    }

    S.query(
      c,
      "UPDATE #{S.table(c, "device_links")} SET record=jsonb_set(record,'{revocation}',$1::jsonb),retire_at=LEAST(retire_at,$2) WHERE id=$3 AND scope=$4 AND NOT (record ? 'revocation')",
      [revoke, now, ref!(id, "dev_", 64), scope(c)]
    )

    :ok
  end

  def delete_session(c, id) do
    enabled!(c)

    S.query(
      c,
      "DELETE FROM #{S.table(c, "application_events")} WHERE scope=$1 AND session_id=$2",
      [scope(c), key(c, "session", label!(id))]
    )

    :ok
  end

  def delete_subject_events(c, id) do
    enabled!(c)

    S.query(
      c,
      "DELETE FROM #{S.table(c, "application_events")} WHERE scope=$1 AND (subject_id=$2 OR actor_id=$2)",
      [scope(c), ref!(id, "sub_", 64)]
    )

    :ok
  end

  def cleanup(c) do
    enabled!(c)
    now = Janitor.now()

    S.query(
      c,
      "DELETE FROM #{S.table(c, "application_events")} WHERE id IN (SELECT id FROM #{S.table(c, "application_events")} WHERE scope=$1 AND expires_at <= $2 ORDER BY expires_at LIMIT 100)",
      [scope(c), now]
    )

    S.query(
      c,
      "DELETE FROM #{S.table(c, "device_links")} WHERE id IN (SELECT id FROM #{S.table(c, "device_links")} WHERE scope=$1 AND retire_at <= $2 ORDER BY retire_at LIMIT 100)",
      [scope(c), now - c.evidence.link_retention_days * @day]
    )

    :ok
  end

  def request_evidence(input \\ nil) do
    input = input || %{}
    only!(input, [:edge, :authentication, :action])
    now = Janitor.now()

    edge =
      if e = input[:edge] do
        only!(e, [:source, :provider, :observed_at, :bot_score, :verified_bot, :signed_agent])

        unless e[:source] in [:edge, "edge"] and e[:provider] in [:cloudflare, "cloudflare"],
          do: raise(ArgumentError, "invalid edge provenance")

        clean(%{
          "source" => "edge",
          "provider" => "cloudflare",
          "observedAt" => integer!(e[:observed_at], max(0, now - 60_000), now + 5000),
          "botScore" => if(e[:bot_score], do: integer!(e.bot_score, 1, 99)),
          "verifiedBot" => boolean!(e[:verified_bot]),
          "signedAgent" => boolean!(e[:signed_agent])
        })
      end

    auth =
      if a = input[:authentication] do
        only!(a, [:method, :verified_at])

        %{
          "source" => "authentication",
          "method" => one!(a[:method], @methods),
          "verifiedAt" => integer!(a[:verified_at], max(0, now - 30 * @day), now + 5000)
        }
      end

    app =
      if input[:action],
        do: %{"source" => "application", "action" => one!(input.action, @actions)}

    clean(%{
      "client" => %{"source" => "browser", "authenticated" => false},
      "edge" => edge,
      "authentication" => auth,
      "application" => app
    })
  end

  defp get_link(c, id) do
    case S.query(c, "SELECT record FROM #{S.table(c, "device_links")} WHERE id=$1 AND scope=$2", [
           id,
           scope(c)
         ]) do
      [row] -> row["record"]
      [] -> nil
    end
  end

  defp enabled!(c),
    do: if(is_nil(c.evidence), do: raise(ArgumentError, "evidence is not enabled"))

  defp key(c, purpose, value),
    do: Janitor.Identity.label(c.identity, Jason.encode!(["evidence-v1", purpose, value]))

  defp scope(c), do: key(c, "scope", "application")
  defp clean(map), do: Map.reject(map, fn {_, v} -> is_nil(v) end)

  defp only!(map, keys),
    do:
      unless(is_map(map) and not is_struct(map) and Enum.all?(Map.keys(map), &(&1 in keys)),
        do: raise(ArgumentError, "unknown evidence field")
      )

  defp label!(v) do
    unless is_binary(v) and byte_size(v) <= 256 and String.trim(v) != "",
      do: raise(ArgumentError, "invalid evidence label")

    String.trim(v)
  end

  defp ref!(v, prefix, n) do
    unless is_binary(v) and Regex.match?(Regex.compile!("^#{prefix}[a-f0-9]{#{n}}$"), v),
      do: raise(ArgumentError, "invalid evidence reference")

    v
  end

  defp one!(v, values) do
    unless v in values, do: raise(ArgumentError, "invalid evidence category")
    v
  end

  defp integer!(v, min, max) do
    unless is_integer(v) and v >= min and v <= max,
      do: raise(ArgumentError, "invalid evidence limit or timestamp")

    v
  end

  defp boolean!(v) when is_boolean(v) or is_nil(v), do: v
  defp boolean!(_), do: raise(ArgumentError, "invalid evidence flag")
end
