defmodule Doorman.RiskEvidence do
  @moduledoc "Bounded server risk evidence. Never browser claims or identity evidence."
  def validate!(nil), do: %{}

  def validate!(value) do
    only!(value, ~w(edge activity reputation))
    now = Doorman.now()
    edge = value["edge"]
    activity = value["activity"]
    reputation = value["reputation"]

    if edge do
      only!(edge, ~w(source provider observedAt botScore verifiedBot signedAgent ja4))

      unless edge["source"] == "edge" && is_binary(edge["provider"]) &&
               byte_size(edge["provider"]) in 1..64,
             do: raise(ArgumentError, "invalid edge evidence")

      integer!(edge["observedAt"], 0, 9_007_199_254_740_991)
      if edge["botScore"], do: integer!(edge["botScore"], 1, 99)

      for key <- ~w(verifiedBot signedAgent),
          Map.has_key?(edge, key) && !is_boolean(edge[key]),
          do: raise(ArgumentError, "invalid edge flag")

      if edge["ja4"] &&
           !(is_binary(edge["ja4"]) &&
               Regex.match?(~r/^[tqd][a-z0-9]{9}_[a-f0-9]{12}_[a-f0-9]{12}$/, edge["ja4"])),
         do: raise(ArgumentError, "invalid JA4")
    end

    if activity do
      only!(activity, ~w(windowMs requests denials authenticationFailures))
      integer!(activity["windowMs"], 1000, 86_400_000)
      integer!(activity["requests"], 0, 1_000_000)
      integer!(activity["denials"], 0, activity["requests"])
      integer!(activity["authenticationFailures"], 0, activity["requests"])
    end

    if reputation do
      only!(reputation, ~w(provider status observedAt cached score totalReports lastReportedAt))

      unless reputation["provider"] == "abuseipdb" &&
               reputation["status"] in ~w(available unavailable limited not-requested) &&
               is_boolean(reputation["cached"]),
             do: raise(ArgumentError, "invalid reputation")

      integer!(reputation["observedAt"], 0, 9_007_199_254_740_991)

      if Map.has_key?(reputation, "score") &&
           !(is_number(reputation["score"]) && reputation["score"] >= 0 &&
               reputation["score"] <= 1),
         do: raise(ArgumentError, "invalid reputation score")

      if reputation["totalReports"], do: integer!(reputation["totalReports"], 0, 1_000_000_000)

      if reputation["lastReportedAt"],
        do: integer!(reputation["lastReportedAt"], 0, 9_007_199_254_740_991)
    end

    value
    |> then(fn v ->
      if edge && (edge["observedAt"] > now + 5000 || edge["observedAt"] < now - 300_000),
        do: Map.delete(v, "edge"),
        else: v
    end)
    |> then(fn v ->
      if reputation &&
           (reputation["observedAt"] > now + 5000 || reputation["observedAt"] < now - 3_600_000),
         do: Map.delete(v, "reputation"),
         else: v
    end)
  end

  def project(evidence),
    do:
      Map.new(evidence, fn
        {"edge", value} ->
          {"edge", Map.take(value, ~w(provider botScore verifiedBot signedAgent observedAt))}

        {"reputation", value} ->
          {"reputation",
           Map.take(value, ~w(provider status score totalReports lastReportedAt observedAt))}

        {"activity", value} ->
          {"activity", Map.take(value, ~w(windowMs requests denials authenticationFailures))}
      end)

  defp only!(value, keys) do
    unless is_map(value) && Enum.all?(Map.keys(value), &(&1 in keys)),
      do: raise(ArgumentError, "invalid risk evidence")
  end

  defp integer!(n, min, max) do
    unless is_integer(n) && n >= min && n <= max,
      do: raise(ArgumentError, "invalid risk evidence count")
  end
end
