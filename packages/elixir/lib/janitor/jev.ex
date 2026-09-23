defmodule Janitor.Jev do
  @moduledoc "TypeSafe Jev typed questions. Bounded, replaceable and failure-tolerant in the engine."
  @external_resource Path.expand("../../priv/jev-questions.json", __DIR__)
  @questions @external_resource |> File.read!() |> Jason.decode!()
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

  def evaluate(input, opts) do
    key = Keyword.fetch!(opts, :api_key)
    body = Map.put(input(input), "model", Keyword.get(opts, :model, "jev-latest"))

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
    parse(response.body)
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
