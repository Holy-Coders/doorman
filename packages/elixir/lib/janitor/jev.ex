defmodule Janitor.Jev do
  @moduledoc "TypeSafe Jev typed questions. Bounded, replaceable and failure-tolerant in the engine."
  @external_resource Path.expand("../../priv/jev-questions.json", __DIR__)
  @questions @external_resource |> File.read!() |> Jason.decode!()
  @external_resource Path.expand("../../priv/jev-intelligence.json", __DIR__)
  @intelligence Path.expand("../../priv/jev-intelligence.json", __DIR__)
                |> File.read!()
                |> Jason.decode!()
  def input(input) do
    history = Enum.take(input["history"], 5)

    %{
      "state" => %{
        "history" => Enum.map(history, &compact/1),
        "current" => compact(input["current"]),
        "deterministicSimilarity" => input["deterministicSimilarity"],
        "evidence" =>
          Enum.map(history, &Janitor.Observation.similarity(&1, input["current"])["features"])
      },
      "questions" => @questions
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
      "behavior" => o["behavior"]
    }
    |> Map.merge(o["hardware"] || %{})
    |> Map.merge(o["automation"] || %{})
    |> Map.merge(o["graphics"] || %{})
    |> Janitor.Observation.clean()
  end

  def evaluate(input, opts), do: parse(request(input(input), opts))

  def plan_lookup(current, opts) do
    response =
      request(
        %{
          "state" => %{"current" => compact(current)},
          "questions" => Map.take(@intelligence, ~w(graphics locale))
        },
        opts
      )

    %{
      "graphics" => noul(response, "graphics") >= 0.5,
      "locale" => noul(response, "locale") >= 0.5
    }
  end

  def evaluate_candidates(current, candidates, opts) do
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
      |> Map.merge(Map.take(@questions, ~w(automation suspicious)))

    state = %{
      "current" => compact(current),
      "candidates" =>
        Enum.map(candidates, fn c ->
          %{
            "history" => Enum.map(Enum.take(c.history, 5), &compact/1),
            "deterministicSimilarity" => c.score
          }
        end)
    }

    response = request(%{"state" => state, "questions" => questions}, opts)
    automation = noul(response, "automation")
    suspicious = noul(response, "suspicious")

    candidates
    |> Enum.with_index()
    |> Enum.map(fn {_, i} ->
      %{
        "sameVisitor" => noul(response, "candidate#{i}"),
        "automation" => automation,
        "suspicious" => suspicious
      }
    end)
  end

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
        "current" => compact(current),
        "candidates" =>
          Enum.map(candidates, fn {_, rows} ->
            %{
              "history" =>
                Enum.map(
                  rows,
                  &%{
                    "observation" => compact(&1["observation"]),
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
      Janitor.HTTP.post_json(
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

    if Janitor.Engine.valid_evaluation?(result),
      do: result,
      else: raise("Invalid Jev probabilities")
  end

  def parse(_), do: raise("Malformed Jev response")
end
