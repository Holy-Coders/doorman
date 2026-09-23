defmodule Doorman.Warehouse do
  @moduledoc "Customer-owned, flat warehouse export. No network calls or raw observations."
  def event(identity, authenticated_id, opts) do
    event_id = Keyword.fetch!(opts, :event_id)

    for id <- [authenticated_id, event_id] do
      unless is_binary(id) and String.trim(id) != "" and String.length(id) <= 512,
        do: raise(ArgumentError, "warehouse actor and event IDs required")
    end

    time = Keyword.fetch!(opts, :occurred_at) |> DateTime.to_iso8601()

    Doorman.Analytics.properties(identity, %{account_id: opts[:account_id]})
    |> Map.merge(%{
      "event_id" => event_id,
      "occurred_at" => time,
      "event_name" => "doorman identified",
      "authenticated_id" => authenticated_id
    })
  end

  @doc "Serialize a single row built by event/3. Stream rows to your existing sink."
  def encode(row) do
    allowed =
      ~w(event_id occurred_at event_name authenticated_id doorman_schema_version doorman_account_id doorman_subject_id doorman_subject_status doorman_actor_id doorman_actor_basis doorman_visitor_id doorman_confidence doorman_returning doorman_automation doorman_suspicious doorman_risk_status doorman_actor_kind doorman_delegation_status doorman_api_risk_status doorman_api_automation doorman_api_suspicious doorman_api_evaluated_at doorman_api_expires_at doorman_api_cached doorman_api_window_ms doorman_api_requests doorman_api_truncated)

    clean = Map.take(row, allowed)

    unless Enum.all?(clean, fn {_, v} ->
             is_boolean(v) or is_number(v) or (is_binary(v) and String.length(v) <= 512)
           end),
           do: raise(ArgumentError, "warehouse rows must contain bounded scalar values")

    Jason.encode!(clean) <> "\n"
  end
end
