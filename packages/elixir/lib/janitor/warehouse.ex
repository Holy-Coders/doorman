defmodule Janitor.Warehouse do
  @moduledoc "Customer-owned, flat warehouse export. No network calls or raw observations."
  def event(identity, authenticated_id, opts) do
    event_id = Keyword.fetch!(opts, :event_id)

    for id <- [authenticated_id, event_id] do
      unless is_binary(id) and String.trim(id) != "" and String.length(id) <= 512,
        do: raise(ArgumentError, "warehouse actor and event IDs required")
    end

    time = Keyword.fetch!(opts, :occurred_at) |> DateTime.to_iso8601()

    Janitor.Analytics.properties(identity, %{account_id: opts[:account_id]})
    |> Map.merge(%{
      "event_id" => event_id,
      "occurred_at" => time,
      "event_name" => "janitor identified",
      "authenticated_id" => authenticated_id
    })
  end

  @doc "Serialize a single row built by event/3. Stream rows to your existing sink."
  def encode(row) do
    allowed =
      ~w(event_id occurred_at event_name authenticated_id janitor_schema_version janitor_account_id janitor_subject_id janitor_subject_status janitor_actor_id janitor_actor_basis janitor_visitor_id janitor_confidence janitor_returning janitor_automation janitor_suspicious janitor_risk_status janitor_actor_kind janitor_delegation_status janitor_api_risk_status janitor_api_automation janitor_api_suspicious janitor_api_evaluated_at janitor_api_expires_at janitor_api_cached janitor_api_window_ms janitor_api_requests janitor_api_truncated)

    clean = Map.take(row, allowed)

    unless Enum.all?(clean, fn {_, v} ->
             is_boolean(v) or is_number(v) or (is_binary(v) and String.length(v) <= 512)
           end),
           do: raise(ArgumentError, "warehouse rows must contain bounded scalar values")

    Jason.encode!(clean) <> "\n"
  end
end
