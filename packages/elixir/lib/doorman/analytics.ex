defmodule Doorman.Analytics do
  @moduledoc "Explicit, best-effort analytics exports. No raw observations or inferred account identifiers."
  def properties(identity, context \\ %{}) do
    actor = get_in(identity, ["attribution", "actor"]) || %{}
    subject = get_in(identity, ["attribution", "subject"]) || %{}
    verified_actor = actor["basis"] == "verified-credential" and is_binary(actor["id"])
    api = identity["apiActivity"] || %{}

    %{
      "doorman_schema_version" => 1,
      "doorman_account_id" => if(context[:account_id], do: valid_id!(context.account_id)),
      "doorman_subject_id" => if(subject["status"] == "verified", do: subject["id"]),
      "doorman_subject_status" => subject["status"] || "unknown",
      "doorman_actor_id" => if(verified_actor, do: actor["id"]),
      "doorman_actor_basis" => if(verified_actor, do: "verified-credential", else: "unknown"),
      "doorman_visitor_id" => identity["visitorId"],
      "doorman_confidence" => identity["confidence"],
      "doorman_returning" => identity["isReturning"],
      "doorman_automation" => get_in(identity, ["risk", "automation"]),
      "doorman_suspicious" => get_in(identity, ["risk", "suspicious"]),
      "doorman_risk_status" => identity["riskStatus"],
      "doorman_actor_kind" => if(verified_actor, do: actor["kind"], else: "unknown"),
      "doorman_delegation_status" => get_in(identity, ["attribution", "delegation", "status"]),
      "doorman_api_risk_status" => api["riskStatus"],
      "doorman_api_automation" =>
        if(api["riskStatus"] == "evaluated", do: get_in(api, ["risk", "automation"])),
      "doorman_api_suspicious" =>
        if(api["riskStatus"] == "evaluated", do: get_in(api, ["risk", "suspicious"])),
      "doorman_api_evaluated_at" => api["evaluatedAt"],
      "doorman_api_expires_at" => api["expiresAt"],
      "doorman_api_cached" => api["cached"],
      "doorman_api_window_ms" => get_in(api, ["summary", "windowMs"]),
      "doorman_api_truncated" => get_in(api, ["summary", "truncated"]),
      "doorman_api_requests" =>
        if(api["summary"], do: Enum.sum(Enum.map(api["summary"]["buckets"], & &1["requests"])))
    }
    |> Doorman.Observation.clean()
  end

  def capture_all(providers, identity, distinct_id, context \\ %{}),
    do:
      Enum.map(providers, fn {provider, opts} ->
        {provider,
         capture(
           provider,
           identity,
           distinct_id,
           opts
           |> Keyword.put(:account_id, context[:account_id])
           |> Keyword.put(:properties, context[:properties] || %{})
         )}
      end)

  def capture(provider, identity, distinct_id, opts) do
    props =
      Map.merge(properties(identity, %{account_id: opts[:account_id]}), opts[:properties] || %{})

    send_event(
      provider,
      "doorman identified",
      group_properties(provider, props, opts),
      distinct_id,
      opts
    )
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

        :amplitude ->
          send_event(:amplitude, "$identify", %{"$set" => traits}, distinct_id, opts)

        :rudderstack ->
          deliver(
            :rudderstack,
            "/v1/identify",
            %{
              "userId" => valid_id!(distinct_id),
              "traits" => traits,
              "context" => %{"ip" => "0.0.0.0"}
            },
            opts
          )

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

  defp send_event(:amplitude, event, props, id, opts) do
    item = %{
      "event_type" => event,
      "user_id" => valid_id!(id),
      "insert_id" => Doorman.random_id("evt_"),
      "ip" => "0.0.0.0"
    }

    item =
      Map.put(
        item,
        if(event == "$identify", do: "user_properties", else: "event_properties"),
        props
      )

    deliver(
      :amplitude,
      "/2/httpapi",
      %{"api_key" => Keyword.fetch!(opts, :api_key), "events" => [item]},
      opts
    )
  end

  defp send_event(:rudderstack, event, props, id, opts) do
    deliver(
      :rudderstack,
      "/v1/track",
      %{
        "userId" => valid_id!(id),
        "event" => event,
        "properties" => props,
        "messageId" => Doorman.random_id("evt_"),
        "timestamp" => DateTime.to_iso8601(DateTime.utc_now()),
        "context" => %{"ip" => "0.0.0.0"}
      },
      opts
    )
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
    props =
      if Keyword.get(opts, :identity_merge, :simplified) == :original,
        do: props,
        else: Map.put(props, "$user_id", valid_id!(id))

    body = [
      %{
        "event" => event,
        "properties" =>
          Map.merge(props, %{
            "token" => Keyword.fetch!(opts, :token),
            "distinct_id" => valid_id!(id),
            "time" => System.system_time(:second),
            "$insert_id" => Doorman.random_id("evt_")
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

  defp group_properties(provider, props, opts) do
    case opts[:account_group] do
      nil ->
        props

      group ->
        unless is_binary(group) and Regex.match?(~r/^[a-z][a-z0-9_]{0,63}$/, group) and
                 group not in ~w(distinct_id ip token time event properties user_id) and
                 (not String.starts_with?(group, "doorman_") or group == "doorman_account_id"),
               do: raise(ArgumentError, "invalid analytics account group")

        case props["doorman_account_id"] do
          nil ->
            props

          account ->
            if provider == :posthog,
              do: Map.put(props, "$groups", %{group => account}),
              else: Map.put(props, group, account)
        end
    end
  end

  defp deliver(provider, path, body, opts) do
    host =
      Keyword.get(
        opts,
        :host,
        case provider do
          :posthog -> "https://us.i.posthog.com"
          :mixpanel -> "https://api.mixpanel.com"
          :amplitude -> "https://api2.amplitude.com"
          :rudderstack -> Keyword.fetch!(opts, :host)
        end
      )

    unless URI.parse(host).scheme == "https" and is_nil(URI.parse(host).userinfo),
      do: raise(ArgumentError, "analytics host must be HTTPS")

    timeout = Keyword.get(opts, :timeout_ms, 750)

    case Doorman.Bounded.run(
           fn ->
             Doorman.HTTP.post_json(
               Keyword.merge(
                 [
                   url: String.trim_trailing(host, "/") <> path,
                   json: body,
                   headers:
                     if(provider == :rudderstack,
                       do: [
                         {"authorization",
                          "Basic " <> Base.encode64(Keyword.fetch!(opts, :write_key) <> ":")}
                       ],
                       else: []
                     ),
                   plain_text_response: provider == :rudderstack,
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
