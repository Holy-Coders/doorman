defmodule Janitor.Analytics do
  @moduledoc "Explicit, best-effort PostHog and Mixpanel exports. No raw observations or inferred account identifiers."
  def properties(identity) do
    %{
      "janitor_visitor_id" => identity["visitorId"],
      "janitor_confidence" => identity["confidence"],
      "janitor_returning" => identity["isReturning"],
      "janitor_automation" => get_in(identity, ["risk", "automation"]),
      "janitor_suspicious" => get_in(identity, ["risk", "suspicious"]),
      "janitor_risk_status" => identity["riskStatus"],
      "janitor_actor_kind" => get_in(identity, ["attribution", "actor", "kind"]),
      "janitor_delegation_status" => get_in(identity, ["attribution", "delegation", "status"])
    }
    |> Janitor.Observation.clean()
  end

  def capture_all(providers, identity, distinct_id),
    do:
      Enum.map(providers, fn {provider, opts} ->
        {provider, capture(provider, identity, distinct_id, opts)}
      end)

  def capture(provider, identity, distinct_id, opts) do
    send_event(provider, "janitor identified", properties(identity), distinct_id, opts)
  rescue
    _ -> {:error, :unavailable}
  catch
    _, _ -> {:error, :unavailable}
  end

  @doc "Explicit profile update for an authenticated account. Only allowlisted name/email/plan traits are exported."
  def identify_user(provider, distinct_id, traits, opts) do
    traits = Map.take(traits, ~w(name email plan))

    if Enum.all?(traits, fn {_, v} -> is_binary(v) and String.length(v) <= 256 end) do
      case provider do
        :posthog ->
          send_event(:posthog, "$identify", %{"$set" => traits}, distinct_id, opts)

        :mixpanel ->
          props =
            Map.new(traits, fn {k, v} ->
              {if(k in ["name", "email"], do: "$" <> k, else: k), v}
            end)

          deliver(
            :mixpanel,
            "/engage?ip=0&verbose=1",
            [
              %{
                "$token" => Keyword.fetch!(opts, :token),
                "$distinct_id" => valid_id!(distinct_id),
                "$set" => props
              }
            ],
            opts
          )
      end
    else
      {:error, :invalid_properties}
    end
  rescue
    _ -> {:error, :unavailable}
  end

  defp send_event(:posthog, event, props, id, opts) do
    body = %{
      "api_key" => Keyword.fetch!(opts, :api_key),
      "event" => event,
      "distinct_id" => valid_id!(id),
      "properties" => Map.put(props, "$geoip_disable", true)
    }

    deliver(:posthog, "/i/v0/e/", body, opts)
  rescue
    _ -> {:error, :unavailable}
  end

  defp send_event(:mixpanel, event, props, id, opts) do
    body = [
      %{
        "event" => event,
        "properties" =>
          Map.merge(props, %{
            "token" => Keyword.fetch!(opts, :token),
            "distinct_id" => valid_id!(id),
            "time" => System.system_time(:second),
            "$insert_id" => Janitor.random_id("evt_")
          })
      }
    ]

    deliver(:mixpanel, "/track?ip=0&verbose=1", body, opts)
  rescue
    _ -> {:error, :unavailable}
  end

  defp valid_id!(id) do
    unless is_binary(id) and String.trim(id) != "" and String.length(id) <= 512,
      do: raise(ArgumentError, "verified analytics ID required")

    id
  end

  defp deliver(provider, path, body, opts) do
    host =
      Keyword.get(
        opts,
        :host,
        if(provider == :posthog, do: "https://us.i.posthog.com", else: "https://api.mixpanel.com")
      )

    unless URI.parse(host).scheme == "https" and is_nil(URI.parse(host).userinfo),
      do: raise(ArgumentError, "analytics host must be HTTPS")

    timeout = Keyword.get(opts, :timeout_ms, 750)

    case Janitor.Bounded.run(
           fn ->
             Janitor.HTTP.post_json(
               Keyword.merge(
                 [
                   url: String.trim_trailing(host, "/") <> path,
                   json: body,
                   retry: false,
                   redirect: false,
                   receive_timeout: timeout,
                   connect_options: [timeout: timeout]
                 ],
                 Keyword.get(opts, :request_options, [])
               )
             )
           end,
           timeout
         ) do
      {:ok, %{status: status, body: response}} when status in 200..299 ->
        if provider == :mixpanel and response not in [1, "1", %{"status" => 1}] and
             not (is_map(response) and response["status"] == 1),
           do: {:error, :rejected},
           else: :ok

      _ ->
        {:error, :unavailable}
    end
  end
end
