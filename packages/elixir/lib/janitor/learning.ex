defmodule Janitor.Learning do
  @moduledoc "Opt-in, implementer-owned verified login feedback and shadow predictions."
  alias Janitor.Storage, as: S
  def validate_options!(%{learning: false}), do: :ok

  def validate_options!(c) do
    opts = c.learning

    unless is_list(opts) and opts[:enabled] == true and c.identity,
      do: raise(ArgumentError, "learning needs explicit enablement and identity configuration")

    mode = mode(c)

    unless mode in [:collect, :shadow] and
             ((mode == :shadow and (is_function(opts[:predict], 1) or is_list(c.evaluator))) or
                (mode == :collect and is_nil(opts[:predict]))),
           do: raise(ArgumentError, "shadow mode requires Jev or a predictor")

    unless (opts[:collection_policy] || :per_request) in [:per_request, :application],
      do: raise(ArgumentError, "invalid collection policy")

    for {value, min, max} <- [
          {opts[:retention_days] || 30, 1, 90},
          {opts[:session_minutes] || 30, 1, 60},
          {opts[:evaluator_timeout_ms] || 1200, 1, 5000}
        ],
        not (is_integer(value) and value >= min and value <= max),
        do: raise(ArgumentError, "invalid learning limits")
  end

  defp mode(c),
    do:
      c.learning[:mode] ||
        if(is_function(c.learning[:predict], 1) or is_list(c.evaluator),
          do: :shadow,
          else: :collect
        )

  defp examples(c, current) do
    probes = [
      {"(signals_json #>> '{languages,0}')", List.first(current["languages"] || [])},
      {"(signals_json ->> 'timezone')", current["timezone"]}
    ]

    groups =
      probes
      |> Enum.reject(fn {_, value} -> is_nil(value) end)
      |> Enum.map(fn {column, value} ->
        S.query(
          c,
          "SELECT * FROM #{S.table(c, "learning_sessions")} WHERE scope = $1 AND #{column} = $2 AND verified_at >= $3 AND observed_at >= $3 AND subject_id IS NOT NULL AND disputed = 0 ORDER BY verified_at DESC,id DESC LIMIT 101",
          [scope(c), value, cutoff(c)]
        )
      end)

    rows =
      groups
      |> List.flatten()
      |> Enum.uniq_by(& &1["id"])
      |> Enum.sort_by(&{-&1["verified_at"], &1["id"]})

    saturated = length(rows) > 100 or Enum.any?(groups, &(length(&1) > 100))

    values =
      rows
      |> Enum.take(100)
      |> Enum.map(fn row ->
        %{
          "sessionId" => row["id"],
          "subjectId" => row["subject_id"],
          "observation" => row["signals_json"],
          "observedAt" => row["observed_at"],
          "verifiedAt" => row["verified_at"]
        }
      end)

    {values, saturated}
  end

  defp scope(c), do: Janitor.Identity.label(c.identity, "janitor-learning-scope-v1")
  defp cutoff(c), do: Janitor.now() - (c.learning[:retention_days] || 30) * 86_400_000
  defp valid_id?(id), do: is_binary(id) and Regex.match?(~r/^ses_[a-f0-9]{48}$/, id)

  def reports(c, limit \\ 100) do
    unless is_list(c.learning) and is_integer(limit) and limit in 1..100,
      do: raise(ArgumentError, "learning reports require enablement and a limit of 1–100")

    S.query(
      c,
      "SELECT * FROM #{S.table(c, "learning_sessions")} WHERE scope = $1 AND verified_at >= $2 AND observed_at >= $2 AND subject_id IS NOT NULL AND disputed = 0 ORDER BY verified_at DESC,id DESC LIMIT $3",
      [scope(c), cutoff(c), limit]
    )
    |> Enum.map(fn row ->
      %{
        "sessionId" => row["id"],
        "subjectId" => row["subject_id"],
        "observation" => row["signals_json"],
        "observedAt" => row["observed_at"],
        "verifiedAt" => row["verified_at"],
        "prediction" =>
          Janitor.Observation.clean(%{
            "status" => row["prediction_status"],
            "subjectId" => row["predicted_subject_id"],
            "score" => row["prediction_score"]
          })
      }
    end)
  end

  def delete_session(c, id) do
    unless valid_id?(id), do: raise(ArgumentError, "invalid learning session")

    S.query(c, "DELETE FROM #{S.table(c, "learning_sessions")} WHERE scope = $1 AND id = $2", [
      scope(c),
      id
    ])
  end

  def observe(c, id, context, identity, payload) do
    id = if valid_id?(id), do: id

    allowed =
      context[:learning_consent] == true or
        (context[:learning_consent] != false and c.learning[:collection_policy] == :application)

    if not allowed do
      if id, do: delete_session(c, id)
      {nil, 0, nil}
    else
      existing =
        if id,
          do:
            S.query(
              c,
              "SELECT * FROM #{S.table(c, "learning_sessions")} WHERE scope = $1 AND id = $2",
              [scope(c), id]
            )
            |> List.first()

      now = Janitor.now()

      if context[:verified] do
        attr = identity["attribution"]

        self_person =
          get_in(attr, ["subject", "status"]) == "verified" and
            get_in(attr, ["actor", "kind"]) == "person" and
            get_in(attr, ["actor", "id"]) == get_in(attr, ["subject", "id"]) and
            get_in(attr, ["delegation", "status"]) == "none"

        cond do
          existing && self_person && existing["expires_at"] > now ->
            confirm(c, id, attr["subject"]["id"], now)

          existing && is_nil(existing["subject_id"]) ->
            delete_session(c, id)

          true ->
            :ok
        end

        {nil, 0, nil}
      else
        observation = Janitor.Observation.normalize(payload["signals"], payload["behavior"])
        prediction = predict(c, observation)

        reuse =
          existing && is_nil(existing["subject_id"]) && existing["disputed"] == 0 &&
            existing["expires_at"] > now

        id = if reuse, do: id, else: Janitor.random_id("ses_")

        expires =
          if reuse,
            do: existing["expires_at"],
            else: now + (c.learning[:session_minutes] || 30) * 60000

        params = [
          scope(c),
          id,
          now,
          expires,
          observation,
          prediction["status"],
          prediction["subjectId"],
          prediction["score"]
        ]

        if reuse do
          S.query(
            c,
            "UPDATE #{S.table(c, "learning_sessions")} SET observed_at = $3,signals_json = $5,prediction_status = $6,predicted_subject_id = $7,prediction_score = $8 WHERE scope = $1 AND id = $2 AND expires_at = $4 AND expires_at > $3 AND subject_id IS NULL AND disputed = 0",
            params
          )
        else
          S.query(
            c,
            "INSERT INTO #{S.table(c, "learning_sessions")} (scope,id,started_at,observed_at,expires_at,signals_json,prediction_status,predicted_subject_id,prediction_score) VALUES ($1,$2,$3,$3,$4,$5,$6,$7,$8)",
            params
          )
        end

        {id, max(0, div(expires - Janitor.now(), 1000)), prediction}
      end
    end
  end

  defp confirm(c, id, subject, now) do
    S.query(
      c,
      "UPDATE #{S.table(c, "learning_sessions")} SET disputed = CASE WHEN subject_id IS NOT NULL AND subject_id <> $3 THEN 1 ELSE disputed END,subject_id = CASE WHEN subject_id IS NULL AND disputed = 0 THEN $3 ELSE subject_id END,verified_at = COALESCE(verified_at,$4) WHERE scope = $1 AND id = $2 AND expires_at > $4",
      [scope(c), id, subject, now]
    )

    S.query(
      c,
      "DELETE FROM #{S.table(c, "learning_sessions")} WHERE scope = $1 AND subject_id = $2 AND id IN (SELECT id FROM #{S.table(c, "learning_sessions")} WHERE scope = $1 AND subject_id = $2 ORDER BY verified_at DESC,id DESC OFFSET 20)",
      [scope(c), subject]
    )
  end

  defp predict(%{learning: opts} = c, observation) do
    if mode(c) != :shadow do
      %{"status" => "not-run"}
    else
      {examples, saturated} = examples(c, observation)

      if examples == [] or saturated do
        %{"status" => "abstained"}
      else
        input = %{current: observation, examples: examples}

        result =
          if is_function(opts[:predict], 1) do
            Janitor.Bounded.run(
              fn -> opts[:predict].(input) end,
              opts[:evaluator_timeout_ms] || 1200
            )
          else
            Janitor.Protection.evaluate(
              %{c | evaluator_timeout_ms: opts[:evaluator_timeout_ms] || 1200},
              fn -> Janitor.Jev.predict_identity(input, c.evaluator) end,
              &is_map/1
            )
          end

        case result do
          {:ok, %{subject_id: id, score: score}}
          when is_binary(id) and is_number(score) and score >= 0 and score <= 1 ->
            if Enum.any?(examples, &(&1["subjectId"] == id)),
              do: %{"status" => "suggested", "subjectId" => id, "score" => score},
              else: %{"status" => "unavailable"}

          {:ok, result} when is_map(result) and map_size(result) == 0 ->
            %{"status" => "abstained"}

          _ ->
            %{"status" => "unavailable"}
        end
      end
    end
  end

  def cleanup(c) do
    S.query(
      c,
      "DELETE FROM #{S.table(c, "learning_sessions")} WHERE scope = $1 AND (observed_at < $3 OR disputed = 1 OR (subject_id IS NULL AND expires_at <= $2))",
      [scope(c), Janitor.now(), cutoff(c)]
    )

    S.query(
      c,
      "DELETE FROM #{S.table(c, "learning_sessions")} WHERE id IN (SELECT id FROM (SELECT id,ROW_NUMBER() OVER (PARTITION BY subject_id ORDER BY verified_at DESC,id DESC) AS position FROM #{S.table(c, "learning_sessions")} WHERE scope = $1 AND subject_id IS NOT NULL) AS ranked WHERE position > 20)",
      [scope(c)]
    )
  end
end
