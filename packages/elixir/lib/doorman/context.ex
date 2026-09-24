defmodule Doorman.Context do
  @moduledoc "Private authenticated, remembered and inferred context. Never authorization."
  alias Doorman.{Identity, Storage}

  def configure(opts) do
    {secret, opts} = Keyword.pop(opts, :secret)
    {namespace, opts} = Keyword.pop(opts, :namespace)
    {cross_device, opts} = Keyword.pop(opts, :cross_device, false)
    unless is_boolean(cross_device), do: raise(ArgumentError, "cross_device must be boolean")

    if secret do
      identity = [secret: secret, namespace: namespace]
      Identity.validate_options!(identity)

      opts
      |> Keyword.put(:identity, identity)
      |> Keyword.put(:identity_context, true)
      |> Keyword.put(:restore_browser, false)
      |> Keyword.put(:expose_client_scores, false)
      |> Keyword.put_new(:classify_operator, true)
      |> Keyword.put(:lookup_planning, false)
      |> Keyword.put(
        :learning,
        if(cross_device, do: [enabled: true, collection_policy: :application], else: false)
      )
      |> Keyword.put_new(:protection, identity ++ [evaluator: [max_calls: 60]])
    else
      if namespace || cross_device, do: raise(ArgumentError, "secret and namespace are required")
      opts
    end
  end

  def authenticate(_, nil), do: nil

  def authenticate(%{identity_context: false}, _),
    do: raise(ArgumentError, "identity context is disabled")

  def authenticate(c, auth) do
    only!(auth, [:user_id, :account_id, :actor])
    user = label!(auth[:user_id])
    account = if auth[:account_id], do: label!(auth.account_id)
    actor = auth[:actor]
    if actor, do: only!(actor, [:id, :kind])

    if actor && actor[:kind] not in [:person, :agent],
      do: raise(ArgumentError, "invalid actor kind")

    if actor && actor[:kind] == :agent && actor[:id] == user,
      do: raise(ArgumentError, "agent must have a distinct ID")

    if actor, do: label!(actor[:id])
    subject = Identity.update_subject(c, %{id: user, kind: :person})
    actor = if actor, do: Identity.update_subject(c, actor), else: subject

    clean(%{
      "subjectId" => subject["id"],
      "actorId" => actor["id"],
      "actorKind" => actor["kind"],
      "accountId" => if(account, do: key(c, ["account-v1", account]))
    })
  end

  def resolve(%{identity_context: false}, _, _, _, _), do: nil

  def resolve(c, identity, cookie, auth, prediction) do
    base = %{
      "status" => "unknown",
      "basis" => "none",
      "candidates" => [],
      "calibrated" => false,
      "truncated" => false
    }

    now = Doorman.now()
    visitor = identity["visitorId"]

    cond do
      auth ->
        id =
          key(c, [
            "browser-association-v1",
            visitor,
            auth["subjectId"],
            auth["accountId"] || "",
            auth["actorId"]
          ])

        record =
          Map.merge(auth, %{
            "id" => id,
            "scope" => scope(c),
            "visitorId" => visitor,
            "seenAt" => now,
            "expiresAt" => now + c.observation_retention_days * 86_400_000
          })

        Storage.query(
          c,
          "INSERT INTO #{Storage.table(c, "browser_associations")} AS a (id,scope,visitor_id,subject_id,actor_id,seen_at,expires_at,record) VALUES ($1,$2,$3,$4,$5,$6,$7,$8) ON CONFLICT (id) DO UPDATE SET seen_at=EXCLUDED.seen_at,expires_at=EXCLUDED.expires_at,record=EXCLUDED.record WHERE a.seen_at <= EXCLUDED.seen_at",
          [
            id,
            scope(c),
            visitor,
            auth["subjectId"],
            auth["actorId"],
            now,
            record["expiresAt"],
            record
          ]
        )

        %{
          base
          | "status" => "authenticated",
            "basis" => "authentication",
            "candidates" => [Map.put(auth, "lastSeenAt", now)]
        }

      true ->
        retained = cookie == visitor && identity["isReturning"]
        previous = if retained, do: visitor, else: get_in(identity, ["browserMatch", "visitorId"])

        rows =
          if previous,
            do:
              Storage.query(
                c,
                "SELECT record FROM #{Storage.table(c, "browser_associations")} WHERE scope=$1 AND visitor_id=$2 AND expires_at > $3 ORDER BY expires_at DESC,id LIMIT 11",
                [scope(c), previous, now]
              ),
            else: []

        cond do
          rows != [] ->
            candidates =
              Enum.map(Enum.take(rows, 10), fn %{"record" => r} ->
                r
                |> Map.take(~w(subjectId accountId actorId actorKind))
                |> Map.put("lastSeenAt", r["seenAt"])
                |> Map.put(
                  "score",
                  if(!retained, do: get_in(identity, ["browserMatch", "score"]))
                )
                |> clean()
              end)

            %{
              base
              | "status" =>
                  if(length(rows) > 1,
                    do: "ambiguous",
                    else: if(retained, do: "remembered", else: "inferred")
                  ),
                "basis" => if(retained, do: "cookie-history", else: "browser-similarity"),
                "candidates" => candidates,
                "truncated" => length(rows) > 10
            }

          prediction && prediction["status"] == "suggested" ->
            %{
              base
              | "status" => "inferred",
                "basis" => "login-history",
                "candidates" => [Map.take(prediction, ~w(subjectId score))]
            }

          true ->
            base
        end
    end
  end

  def properties(identity, context, evidence) do
    candidates = if context, do: context["candidates"], else: []
    candidate = if length(candidates) == 1 && !context["truncated"], do: hd(candidates), else: %{}
    reputation = evidence["reputation"] || %{}

    Doorman.Analytics.properties(identity)
    |> Map.merge(
      clean(%{
        "doorman_session_id" => identity["sessionId"],
        "doorman_operator_status" => get_in(identity, ["operator", "status"]),
        "doorman_operator_label" => get_in(identity, ["operator", "label"]),
        "doorman_operator_calibrated" => get_in(identity, ["operator", "calibrated"]),
        "doorman_human_score" => get_in(identity, ["operator", "scores", "human"]),
        "doorman_assistant_score" => get_in(identity, ["operator", "scores", "assistant"]),
        "doorman_script_score" => get_in(identity, ["operator", "scores", "automation"]),
        "doorman_identity_status" => context && context["status"],
        "doorman_identity_basis" => context && context["basis"],
        "doorman_identity_calibrated" => context && false,
        "doorman_candidate_count" => length(candidates),
        "doorman_candidate_subject_id" =>
          if(context && context["status"] != "authenticated", do: candidate["subjectId"]),
        "doorman_candidate_score" => candidate["score"],
        "doorman_candidates_truncated" => context && context["truncated"],
        "doorman_context_account_id" => candidate["accountId"],
        "doorman_reputation_status" => reputation["status"],
        "doorman_reputation_provider" => reputation["provider"],
        "doorman_reputation_score" =>
          if(reputation["status"] == "available", do: reputation["score"]),
        "doorman_reputation_observed_at" => reputation["observedAt"]
      })
    )
  end

  def forget_user(c, id) do
    subject = Identity.label(c.identity, label!(id))

    Storage.query(
      c,
      "DELETE FROM #{Storage.table(c, "browser_associations")} WHERE scope=$1 AND subject_id=$2",
      [scope(c), subject]
    )

    Identity.delete_subject(c, subject)
  end

  def cleanup(c),
    do:
      Storage.query(
        c,
        "DELETE FROM #{Storage.table(c, "browser_associations")} WHERE id IN (SELECT id FROM #{Storage.table(c, "browser_associations")} WHERE scope=$1 AND expires_at <= $2 ORDER BY expires_at LIMIT 1000)",
        [scope(c), Doorman.now()]
      )

  defp scope(c), do: Identity.label(c.identity, "doorman-context-v1")
  defp key(c, values), do: Identity.label(c.identity, Jason.encode!(values))
  defp clean(map), do: Map.reject(map, fn {_, v} -> is_nil(v) end)

  defp label!(id) do
    unless is_binary(id) && String.trim(id) != "" && byte_size(id) <= 512,
      do: raise(ArgumentError, "invalid identity ID")

    String.trim(id)
  end

  defp only!(map, keys) do
    unless is_map(map) && Enum.all?(Map.keys(map), &(&1 in keys)),
      do: raise(ArgumentError, "invalid authenticated context")
  end
end
