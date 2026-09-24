defmodule Doorman.Jev do
  @moduledoc "TypeSafe Jev typed questions. Bounded, replaceable and failure-tolerant in the engine."
  @external_resource Path.expand("../../priv/jev-questions.json", __DIR__)
  @questions Path.expand("../../priv/jev-questions.json", __DIR__)
             |> File.read!()
             |> Jason.decode!()
  @external_resource Path.expand("../../priv/jev-operators.json", __DIR__)
  @operators Path.expand("../../priv/jev-operators.json", __DIR__)
             |> File.read!()
             |> Jason.decode!()
  @external_resource Path.expand("../../priv/jev-intelligence.json", __DIR__)
  @intelligence Path.expand("../../priv/jev-intelligence.json", __DIR__)
                |> File.read!()
                |> Jason.decode!()
  @external_resource Path.expand("../../priv/jev-activity.json", __DIR__)
  @activity Path.expand("../../priv/jev-activity.json", __DIR__)
            |> File.read!()
            |> Jason.decode!()

  def activity_input(input) do
    activity = input["activity"]

    buckets =
      Enum.map(
        Enum.take(activity["buckets"], 128),
        &Map.take(
          &1,
          ~w(windowStart route requests denied clientErrors serverErrors durationTotalMs durationMaxMs firstSeenAt lastSeenAt shortGaps)
        )
      )

    state =
      input
      |> Map.take(~w(route sensitive))
      |> Map.put(
        "activity",
        activity
        |> Map.take(~w(source observedAt windowMs truncated))
        |> Map.put("buckets", buckets)
      )

    state =
      if input["actor"],
        do: Map.put(state, "actor", Map.take(input["actor"], ~w(kind delegated))),
        else: state

    %{"state" => state, "questions" => @activity}
  end

  def evaluate_activity(input, opts) do
    response = request(activity_input(input), opts)
    Map.new(~w(automation suspicious), &{&1, noul(response, &1)})
  end

  def input(input) do
    history = Enum.take(input["history"], 5)

    %{
      "state" => %{
        "history" => Enum.map(history, &compact_identity/1),
        "current" => compact_identity(input["current"]),
        "deterministicSimilarity" => input["deterministicSimilarity"],
        "evidence" =>
          Enum.map(
            history,
            &(Doorman.Observation.similarity(&1, input["current"])["features"]
              |> Map.delete("webdriverDetected"))
          )
      },
      "questions" => Map.take(@questions, ~w(sameVisitor))
    }
  end

  def compact(o) do
    %{
      "platform" => o["platform"],
      "browser" => o["browser"],
      "timezone" => o["timezone"],
      "languages" => o["languages"],
      "screen" =>
        if(get_in(o, ["screen", "width"]) && get_in(o, ["screen", "height"]),
          do: "#{o["screen"]["width"]}x#{o["screen"]["height"]}"
        ),
      "colorDepth" => get_in(o, ["screen", "colorDepth"]),
      "pixelRatio" => get_in(o, ["screen", "pixelRatio"]),
      "viewport" => o["viewport"],
      "behavior" => o["behavior"],
      "fonts" => o["fonts"],
      "environment" => o["environment"],
      "environmentCaveat" =>
        if(
          o["environment"] || o["fonts"] ||
            Enum.any?(
              ~w(targetSampleCount focusSampleCount decoyActivationCount),
              &Map.has_key?(o["behavior"] || %{}, &1)
            ),
          do:
            "Experimental client claims. Runtime markers and permission states are spoofable and can reflect extensions, browser policy or tests. Page font failures are normal. Focus changes do not detect screenshots. Target alignment and decoys do not establish AI, intent or abuse. Fonts compare environments, never people; missing fonts may be privacy filtering."
        )
    }
    |> Map.merge(o["hardware"] || %{})
    |> Map.merge(o["automation"] || %{})
    |> Map.merge(o["graphics"] || %{})
    |> Doorman.Observation.clean()
  end

  def compact_identity(o),
    do:
      o
      |> Map.take(~w(platform browser timezone languages screen viewport hardware graphics fonts))
      |> compact()

  def risk_input(current, evidence \\ nil, classify_operator \\ false),
    do: %{
      "state" =>
        Map.merge(
          %{"current" => compact(current)},
          if(evidence,
            do: %{"serverEvidence" => Doorman.RiskEvidence.project(evidence)},
            else: %{}
          )
        ),
      "questions" =>
        Map.merge(
          Map.take(@questions, ~w(automation suspicious)),
          if(classify_operator,
            do: %{
              "human" => @operators["human"],
              "assistant" => @operators["assistant"],
              "script" => @operators["automation"]
            },
            else: %{}
          )
        )
    }

  # Parallel, separately scoped provider calls. Wait for both before releasing admission.
  defp paired(identity, risk, opts) do
    [a, b] =
      [identity, risk]
      |> Task.async_stream(
        fn input ->
          try do
            {:ok, request(input, opts)}
          rescue
            _ -> :unavailable
          end
        end,
        max_concurrency: 2,
        timeout: Keyword.get(opts, :timeout_ms, 1000) + 100,
        on_timeout: :kill_task
      )
      |> Enum.to_list()

    with {:ok, {:ok, identity_response}} <- a,
         {:ok, {:ok, risk_response}} <- b do
      {identity_response, risk_response}
    else
      _ -> raise("Jev unavailable")
    end
  end

  def evaluate(input, opts) do
    {identity, risk} =
      paired(
        input(input),
        risk_input(input["current"], input["riskEvidence"], input["classifyOperator"]),
        opts
      )

    %{
      "sameVisitor" => noul(identity, "sameVisitor"),
      "automation" => noul(risk, "automation"),
      "suspicious" => noul(risk, "suspicious")
    }
    |> Map.merge(operator_scores(risk, input["classifyOperator"]))
  end

  def plan_lookup(current, opts) do
    response =
      request(
        %{
          "state" => %{"current" => compact_identity(current)},
          "questions" => Map.take(@intelligence, ~w(graphics locale))
        },
        opts
      )

    %{
      "graphics" => noul(response, "graphics") >= 0.5,
      "locale" => noul(response, "locale") >= 0.5
    }
  end

  def evaluate_candidates(current, candidates, opts, evidence \\ nil, classify_operator \\ false) do
    unless length(candidates) in 1..10, do: raise("Invalid Jev candidate count")

    questions =
      candidates
      |> Enum.with_index()
      |> Map.new(fn {_, i} ->
        q =
          Map.update!(
            @questions["sameVisitor"],
            "instructions",
            &(&1 <>
                " Evaluate only candidates[#{i}].history against current; candidates[#{i}].deterministicSimilarity is supporting evidence.")
          )

        {"candidate#{i}", q}
      end)

    state = %{
      "current" => compact_identity(current),
      "candidates" =>
        Enum.map(candidates, fn c ->
          %{
            "history" => Enum.map(Enum.take(c.history, 5), &compact_identity/1),
            "deterministicSimilarity" => c.score
          }
        end)
    }

    {response, risk} =
      paired(
        %{"state" => state, "questions" => questions},
        risk_input(current, evidence, classify_operator),
        opts
      )

    automation = noul(risk, "automation")
    suspicious = noul(risk, "suspicious")

    candidates
    |> Enum.with_index()
    |> Enum.map(fn {_, i} ->
      %{
        "sameVisitor" => noul(response, "candidate#{i}"),
        "automation" => automation,
        "suspicious" => suspicious
      }
      |> Map.merge(operator_scores(risk, classify_operator))
    end)
  end

  defp operator_scores(_, value) when value in [false, nil], do: %{}

  defp operator_scores(risk, true),
    do: %{
      "operator" => %{
        "human" => noul(risk, "human"),
        "assistant" => noul(risk, "assistant"),
        "automation" => noul(risk, "script")
      }
    }

  def predict_identity(%{current: current, examples: examples}, opts) do
    candidates =
      examples
      |> Enum.take(100)
      |> Enum.group_by(& &1["subjectId"])
      |> Enum.map(fn {id, rows} ->
        {id, rows |> Enum.uniq_by(& &1["sessionId"]) |> Enum.take(3)}
      end)
      |> Enum.filter(fn {_, rows} -> length(rows) >= 2 end)
      |> Enum.sort_by(fn {id, rows} -> {-hd(rows)["verifiedAt"], id} end)

    if candidates == [] or length(candidates) > 10 do
      %{}
    else
      questions =
        candidates
        |> Enum.with_index()
        |> Map.new(fn {_, i} ->
          q =
            Map.update!(
              @intelligence["samePerson"],
              "instructions",
              &(&1 <>
                  " Evaluate candidates[#{i}] against current. Other candidates are alternatives, not evidence about this person.")
            )

          {"person#{i}", q}
        end)

      state = %{
        "current" =>
          Map.put(compact_identity(current), "behavior", current["behavior"])
          |> Doorman.Observation.clean(),
        "candidates" =>
          Enum.map(candidates, fn {_, rows} ->
            %{
              "history" =>
                Enum.map(
                  rows,
                  &%{
                    "observation" =>
                      Map.put(
                        compact_identity(&1["observation"]),
                        "behavior",
                        &1["observation"]["behavior"]
                      )
                      |> Doorman.Observation.clean(),
                    "observedAt" => &1["observedAt"]
                  }
                )
            }
          end)
      }

      response = request(%{"state" => state, "questions" => questions}, opts)

      ranked =
        candidates
        |> Enum.with_index()
        |> Enum.map(fn {{id, _}, i} -> %{subject_id: id, score: noul(response, "person#{i}")} end)
        |> Enum.sort_by(&(-&1.score))

      best = hd(ranked)
      runner = if length(ranked) > 1, do: Enum.at(ranked, 1).score, else: 0
      if best.score >= 0.9 and best.score - runner >= 0.1, do: best, else: %{}
    end
  end

  defp noul(%{"answers" => answers}, key) do
    case answers[key] do
      %{"type" => "noul", "noul" => n} when is_number(n) and n >= 0 and n <= 1 -> n
      _ -> raise("Malformed Jev answer")
    end
  end

  defp noul(_, _), do: raise("Malformed Jev response")

  defp request(input, opts) do
    key = Keyword.fetch!(opts, :api_key)
    body = Map.put(input, "model", Keyword.get(opts, :model, "jev-latest"))

    if byte_size(Jason.encode!(body)) > 65_536, do: raise("Jev input exceeds 64 KiB")

    response =
      Doorman.HTTP.post_json(
        Keyword.merge(
          [
            url: "https://api.typesafe.ai/v1/systemone",
            auth: {:bearer, key},
            json: body,
            retry: false,
            redirect: false,
            receive_timeout: Keyword.get(opts, :timeout_ms, 1000),
            connect_options: [timeout: Keyword.get(opts, :timeout_ms, 1000)]
          ],
          Keyword.get(opts, :request_options, [])
        )
      )

    if response.status != 200, do: raise("Jev unavailable")
    response.body
  end

  def parse(%{"answers" => answers}) do
    result =
      Map.new(~w(sameVisitor automation suspicious), fn key ->
        %{"type" => "noul", "noul" => value} = answers[key]
        {key, value}
      end)

    if Doorman.Engine.valid_evaluation?(result),
      do: result,
      else: raise("Invalid Jev probabilities")
  end

  def parse(_), do: raise("Malformed Jev response")
end
