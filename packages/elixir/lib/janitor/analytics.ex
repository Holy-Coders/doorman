defmodule Janitor.Analytics do
  @moduledoc "Explicit, best-effort PostHog and Mixpanel exports. No raw observations or inferred account identifiers."
  def properties(identity, context \\ %{}) do
    actor = get_in(identity, ["attribution", "actor"]) || %{}
    subject = get_in(identity, ["attribution", "subject"]) || %{}
    verified_actor = actor["basis"] == "verified-credential" and is_binary(actor["id"])

    %{
      "janitor_schema_version" => 1,
      "janitor_account_id" => if(context[:account_id], do: valid_id!(context.account_id)),
      "janitor_subject_id" => if(subject["status"] == "verified", do: subject["id"]),
      "janitor_subject_status" => subject["status"] || "unknown",
      "janitor_actor_id" => if(verified_actor, do: actor["id"]),
      "janitor_actor_basis" => if(verified_actor, do: "verified-credential", else: "unknown"),
      "janitor_visitor_id" => identity["visitorId"],
      "janitor_confidence" => identity["confidence"],
      "janitor_returning" => identity["isReturning"],
      "janitor_automation" => get_in(identity, ["risk", "automation"]),
      "janitor_suspicious" => get_in(identity, ["risk", "suspicious"]),
      "janitor_risk_status" => identity["riskStatus"],
      "janitor_actor_kind" => if(verified_actor, do: actor["kind"], else: "unknown"),
      "janitor_delegation_status" => get_in(identity, ["attribution", "delegation", "status"])
    }
    |> Janitor.Observation.clean()
  end

  def capture_all(providers, identity, distinct_id, context \\ %{}),
    do:
      Enum.map(providers, fn {provider, opts} ->
        {provider,
         capture(
           provider,
           identity,
           distinct_id,
           Keyword.put(opts, :account_id, context[:account_id])
         )}
      end)

  def capture(provider, identity, distinct_id, opts) do
    props = properties(identity, %{account_id: opts[:account_id]})

    send_event(
      provider,
      "janitor identified",
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

  defp group_properties(provider, props, opts) do
    case opts[:account_group] do
      nil ->
        props

      group ->
        unless is_binary(group) and Regex.match?(~r/^[a-z][a-z0-9_]{0,63}$/, group) and
                 group not in ~w(distinct_id ip token time event properties user_id) and
                 (not String.starts_with?(group, "janitor_") or group == "janitor_account_id"),
               do: raise(ArgumentError, "invalid analytics account group")

        case props["janitor_account_id"] do
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
