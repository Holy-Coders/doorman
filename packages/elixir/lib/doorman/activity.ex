defmodule Doorman.Activity do
  @moduledoc "Opt-in, bounded API activity on the implementer's server. Never an authorization or identity decision."
  alias Doorman.ActivityStore, as: Store
  @route ~r/^(GET|POST|PUT|PATCH|DELETE|HEAD|OPTIONS) \/[A-Za-z0-9_\/:.*{}-]*$/
  @defaults [
    window_ms: 60_000,
    retention_days: 1,
    min_requests: 20,
    evaluation_interval_ms: 60_000,
    timeout_ms: 1500,
    evaluator: nil
  ]

  def configure(nil, _identity), do: nil

  def configure(opts, identity) do
    if is_nil(identity), do: raise(ArgumentError, "API activity requires identity configuration")

    unless Keyword.keyword?(opts) and
             Enum.all?(Keyword.keys(opts), &(&1 in [:routes | Keyword.keys(@defaults)])),
           do: raise(ArgumentError, "invalid API activity options")

    config = Map.new(Keyword.merge(@defaults, opts))

    unless is_list(config[:routes]) and length(config.routes) in 1..32,
      do: raise(ArgumentError, "API activity requires 1-32 routes")

    routes =
      Map.new(config.routes, fn r ->
        unless is_map(r) and Map.keys(r) -- [:route, :sensitive] == [] and valid_route?(r[:route]) and
                 is_boolean(Map.get(r, :sensitive, false)),
               do: raise(ArgumentError, "invalid API route template")

        {r.route, Map.get(r, :sensitive, false)}
      end)

    if map_size(routes) != length(config.routes), do: raise(ArgumentError, "duplicate API routes")

    for {key, min, max} <- [
          {:window_ms, 10_000, 900_000},
          {:retention_days, 1, 30},
          {:min_requests, 1, 10_000},
          {:evaluation_interval_ms, 5000, 900_000},
          {:timeout_ms, 50, 5000}
        ] do
      value = config[key]

      unless is_integer(value) and value >= min and value <= max,
        do: raise(ArgumentError, "invalid API activity limit")
    end

    unless is_nil(config.evaluator) or is_function(config.evaluator, 1),
      do: raise(ArgumentError, "invalid activity evaluator")

    %{config | routes: routes}
  end

  def observe(c, context, outcome) do
    if is_nil(c.activity) or is_nil(context),
      do: %{"status" => "skipped"},
      else:
        bounded(c, fn ->
          context!(context)

          if Map.has_key?(c.activity.routes, context.route) do
            unless is_map(outcome) and Map.keys(outcome) -- [:status, :duration_ms] == [] and
                     is_integer(outcome[:status]) and outcome.status in 100..599 and
                     is_number(outcome[:duration_ms]) and outcome.duration_ms >= 0,
                   do: raise(ArgumentError, "invalid API outcome")

            owner = owner(c, context.key)

            row =
              Store.increment(
                c,
                owner,
                context.route,
                outcome.status,
                outcome.duration_ms,
                Doorman.now()
              )

            count = row["requests"]

            milestone =
              rem(count, c.activity.min_requests) == 0 and
                power_of_two?(div(count, c.activity.min_requests))

            if c.activity.routes[context.route] or milestone or
                 (row["denied"] == 1 and outcome.status in [401, 403]),
               do: evaluate(c, context, owner),
               else: %{"status" => "recorded"}
          else
            %{"status" => "skipped"}
          end
        end)
  end

  @doc "Assess recent completed activity before a sensitive action; returns private advisory context."
  def assess(c, context) do
    if is_nil(c.activity),
      do: %{"status" => "skipped"},
      else:
        bounded(c, fn ->
          context!(context)

          if Map.has_key?(c.activity.routes, context.route),
            do: evaluate(c, context, owner(c, context.key)),
            else: %{"status" => "skipped"}
        end)
  end

  defp evaluate(c, context, owner) do
    now = Doorman.now()
    actor = context[:actor]

    id =
      Doorman.Identity.label(
        c.identity,
        Jason.encode!([
          "api-assessment-v1",
          owner,
          context.route,
          if(actor, do: actor.kind),
          if(actor, do: actor.delegated),
          c.activity.window_ms,
          c.activity.routes[context.route]
        ])
      )

    lease = Doorman.random_id("activity_")
    expiry = now + c.activity.evaluation_interval_ms

    if Store.claim(c, id, owner, lease, now, expiry) do
      rows = Store.recent(c, owner, now)

      summary = %{
        "source" => "application-api",
        "observedAt" => now,
        "windowMs" => c.activity.window_ms,
        "truncated" => length(rows) > 128,
        "buckets" =>
          rows |> Enum.take(128) |> Enum.filter(&Map.has_key?(c.activity.routes, &1["route"]))
      }

      input = %{
        "activity" => summary,
        "route" => context.route,
        "sensitive" => c.activity.routes[context.route]
      }

      input =
        if actor,
          do: Map.put(input, "actor", %{"kind" => actor.kind, "delegated" => actor.delegated}),
          else: input

      fun =
        cond do
          is_function(c.activity.evaluator, 1) -> fn -> c.activity.evaluator.(input) end
          is_list(c.evaluator) -> fn -> Doorman.Jev.evaluate_activity(input, c.evaluator) end
          true -> nil
        end

      protection =
        c.protection || Doorman.Protection.configure(c.identity ++ [evaluator: [max_calls: 60]])

      result =
        if fun && summary["buckets"] != [],
          do: Doorman.Protection.evaluate(%{c | protection: protection}, fun, &valid_risk?/1),
          else: nil

      risk =
        case result do
          {:ok, r} -> if valid_risk?(r), do: Map.take(r, ~w(automation suspicious))
          _ -> nil
        end

      assessment = %{
        "source" => "application-api",
        "evaluatedAt" => now,
        "expiresAt" => expiry,
        "summary" => summary,
        "cached" => false,
        "risk" => risk || %{"automation" => 0, "suspicious" => 0},
        "riskStatus" =>
          cond do
            risk -> "evaluated"
            fun -> "unavailable"
            true -> "disabled"
          end
      }

      Store.save(c, id, lease, assessment)
      %{"status" => "recorded", "assessment" => assessment}
    else
      case Store.cached(c, id, now) do
        nil -> %{"status" => "recorded"}
        cached -> %{"status" => "recorded", "assessment" => Map.put(cached, "cached", true)}
      end
    end
  end

  def valid_risk?(value) when is_map(value),
    do:
      Enum.all?(~w(automation suspicious), fn k ->
        is_number(value[k]) and value[k] >= 0 and value[k] <= 1
      end)

  def valid_risk?(_), do: false

  def delete_key(c, key) do
    key!(key)
    Store.delete(c, owner(c, key))
  end

  def cleanup(c), do: Store.cleanup(c)

  defp bounded(c, fun) do
    case Doorman.Bounded.run(fun, c.activity.timeout_ms) do
      {:ok, result} -> result
      _ -> %{"status" => "unavailable"}
    end
  end

  defp owner(c, key),
    do: Doorman.Identity.label(c.identity, Jason.encode!(["api-activity-v1", key.kind, key.id]))

  defp valid_route?(value),
    do: is_binary(value) and byte_size(value) <= 160 and Regex.match?(@route, value)

  defp key!(key) do
    unless is_map(key) and Map.keys(key) -- [:kind, :id] == [] and
             key[:kind] in ["session", "actor"] and is_binary(key[:id]) and
             byte_size(key.id) in 1..512 and String.trim(key.id) != "",
           do: raise(ArgumentError, "invalid API activity key")
  end

  defp context!(context) do
    unless is_map(context) and Map.keys(context) -- [:key, :route, :actor] == [] and
             valid_route?(context[:route]),
           do: raise(ArgumentError, "invalid API activity context")

    key!(context[:key])

    if actor = context[:actor] do
      unless context.key.kind == "actor" and is_map(actor) and
               Map.keys(actor) -- [:kind, :delegated] == [] and
               actor[:kind] in ["person", "agent"] and is_boolean(actor[:delegated]),
             do: raise(ArgumentError, "invalid verified API actor")
    end
  end

  defp power_of_two?(1), do: true
  defp power_of_two?(n) when n > 1 and rem(n, 2) == 0, do: power_of_two?(div(n, 2))
  defp power_of_two?(_), do: false
end
