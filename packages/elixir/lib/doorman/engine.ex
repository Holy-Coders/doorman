defmodule Doorman.Engine do
  @moduledoc false
  alias Doorman.{Observation, Storage}
  @candidate_floor 0.65
  @evaluation_limit 3
  @deterministic_weight 0.35
  @evaluator_weight 0.65
  @ambiguity_margin 0.03
  @zero %{"automation" => 0, "suspicious" => 0}
  def identify(c, payload, context) do
    current = Observation.normalize(payload["signals"], payload["behavior"])
    history = if context[:visitor_id], do: Storage.history(c, context[:visitor_id]), else: []

    {id, confidence, returning, score, count, evaluation, used, latency} =
      if history != [] do
        score = history |> Enum.map(&Observation.similarity(&1, current)["score"]) |> Enum.max()
        {evaluation, latency} = evaluate(c, history, current, score)
        {context.visitor_id, 1, true, score, 0, evaluation, not is_nil(evaluation), latency}
      else
        scope =
          if is_list(c.evaluator) and c.lookup_planning do
            case Doorman.Protection.evaluate(
                   c,
                   fn -> Doorman.Jev.plan_lookup(current, c.evaluator) end,
                   &is_map/1
                 ) do
              {:ok, value} -> value
              _ -> %{}
            end
          else
            %{}
          end

        found = Storage.candidates(c, current, scope)

        candidates =
          if found == [] and Enum.any?(Map.values(scope), &(&1 == false)),
            do: Storage.candidates(c, current),
            else: found

        histories = Storage.histories(c, Enum.map(candidates, & &1["visitor_id"]))

        ranked =
          candidates
          |> Enum.map(fn candidate ->
            history = Map.get(histories, candidate["visitor_id"], [])

            best =
              history
              |> Enum.reject(&Observation.contradiction?(&1, current))
              |> Enum.map(fn h ->
                %{
                  score: Observation.similarity(h, current)["score"],
                  cap: Observation.evidence_cap(h, current)
                }
              end)
              |> Enum.sort_by(&(-&1.score))
              |> List.first()

            %{
              id: candidate["visitor_id"],
              lookup_saturated: candidate["lookup_saturated"],
              seen: candidate["last_seen_at"],
              history: history,
              score: if(best, do: best.score, else: 0),
              cap: if(best, do: best.cap, else: 0)
            }
          end)
          |> Enum.filter(&(&1.score >= @candidate_floor))
          |> Enum.sort_by(&{-&1.score, -&1.seen, &1.id})

        selected = Enum.take(ranked, if(is_list(c.evaluator), do: 10, else: @evaluation_limit))
        batch_started = System.monotonic_time(:millisecond)

        batch =
          if selected != [] and is_list(c.evaluator) do
            case Doorman.Protection.evaluate(
                   c,
                   fn -> Doorman.Jev.evaluate_candidates(current, selected, c.evaluator) end,
                   &is_list/1,
                   2
                 ) do
              {:ok, value} -> value
              _ -> []
            end
          else
            []
          end

        batch_latency = System.monotonic_time(:millisecond) - batch_started

        evaluated =
          selected
          |> Enum.with_index()
          |> Enum.map(fn {candidate, index} ->
            {result, latency} =
              if is_list(c.evaluator),
                do: {Enum.at(batch, index), if(index == 0, do: batch_latency, else: 0)},
                else: evaluate(c, candidate.history, current, candidate.score)

            confidence =
              min(
                candidate.cap,
                if(result,
                  do:
                    candidate.score * @deterministic_weight +
                      result["sameVisitor"] * @evaluator_weight,
                  else: candidate.score
                )
              )

            Map.merge(candidate, %{confidence: confidence, result: result, latency: latency})
          end)
          |> Enum.sort_by(&{-&1.confidence, -&1.seen, &1.id})

        best = List.first(evaluated)

        if best do
          runner_up =
            Enum.max(
              [0] ++
                Enum.map(Enum.drop(evaluated, 1), & &1.confidence) ++
                Enum.map(Enum.reject(ranked, &(&1.id == best.id)), & &1.score)
            )

          restore =
            not best.lookup_saturated and best.confidence >= c.restore_threshold and
              best.confidence - runner_up >= @ambiguity_margin

          {if(restore, do: best.id), if(restore, do: best.confidence, else: 0), restore,
           best.score, length(candidates), best.result, Enum.any?(evaluated, & &1.result),
           Enum.reduce(evaluated, 0, &(&1.latency + &2))}
        else
          {result, latency} = evaluate(c, [], current, 0)
          {nil, 0, false, 0, length(candidates), result, not is_nil(result), latency}
        end
      end

    id = id || Storage.create(c)

    save =
      history == [] or
        Enum.any?(history, fn previous ->
          not Observation.contradiction?(previous, current) and
            Observation.similarity(previous, current)["score"] >= @candidate_floor and
            Observation.evidence_cap(previous, current) >= 0.9
        end)

    if save, do: Storage.save(c, id, current), else: Storage.touch(c, id)
    risk = if evaluation, do: Map.take(evaluation, ["automation", "suspicious"]), else: @zero

    status =
      cond do
        evaluation -> "evaluated"
        c.evaluator -> "unavailable"
        true -> "disabled"
      end

    identity = %{
      "visitorId" => id,
      "confidence" => confidence,
      "isReturning" => returning,
      "risk" => risk,
      "riskStatus" => status
    }

    identity =
      if c.identity,
        do: Map.put(identity, "attribution", Doorman.Identity.assess(c, context[:verified])),
        else: identity

    identity =
      if c.debug and payload["debug"] == true,
        do:
          Map.put(identity, "debug", %{
            "deterministicScore" => score,
            "evaluatorUsed" => used,
            "candidateCount" => count,
            "collectedSignals" => payload["signals"]
          }),
        else: identity

    if c.on_metrics do
      try do
        c.on_metrics.(%{
          candidate_count: count,
          deterministic_score: score,
          final_confidence: confidence,
          evaluator_used: used,
          evaluator_latency: latency,
          is_returning: returning,
          observation_saved: save
        })
      rescue
        _ -> :ok
      catch
        _, _ -> :ok
      end
    end

    identity
  end

  def valid_evaluation?(result) when is_map(result),
    do:
      Enum.all?(~w(sameVisitor automation suspicious), fn k ->
        is_number(result[k]) and result[k] >= 0 and result[k] <= 1
      end)

  def valid_evaluation?(_), do: false
  defp evaluate(%{evaluator: nil}, _, _, _), do: {nil, 0}

  defp evaluate(c, history, current, score) do
    input = %{"history" => history, "current" => current, "deterministicSimilarity" => score}
    started = System.monotonic_time(:millisecond)

    result =
      Doorman.Protection.evaluate(
        c,
        fn ->
          case c.evaluator do
            fun when is_function(fun, 1) -> fun.(input)
            opts when is_list(opts) -> Doorman.Jev.evaluate(input, opts)
          end
        end,
        &valid_evaluation?/1,
        if(is_list(c.evaluator), do: 2, else: 1)
      )

    value =
      case result do
        {:ok, result} -> if valid_evaluation?(result), do: result
        _ -> nil
      end

    {value, System.monotonic_time(:millisecond) - started}
  end
end
