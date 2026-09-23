defmodule Doorman do
  @moduledoc "Native first-party identity for Plug/Phoenix. Browser scores never authorize access."
  defstruct repo: nil,
            prefix: "doorman",
            evaluator: nil,
            evaluator_timeout_ms: 1200,
            lookup_planning: true,
            restore_threshold: 0.9,
            observation_retention_days: 90,
            max_observations_per_visitor: 10,
            cookie_name: "__visitor",
            cookie_max_age_days: 90,
            secure_cookie: true,
            environment: :production,
            max_body_bytes: 16384,
            request_timeout_ms: 5000,
            endpoint_path: "/api/visitor",
            debug: false,
            expose_client_scores: false,
            identity: nil,
            learning: false,
            protection: nil,
            evidence: nil,
            activity: nil,
            analytics: [],
            on_metrics: nil

  def new(opts) do
    config = struct!(__MODULE__, opts)

    unless is_atom(config.repo) and not is_nil(config.repo),
      do: raise(ArgumentError, "repo is required")

    unless is_binary(config.prefix) and Regex.match?(~r/^[a-z_][a-z0-9_]{0,62}$/, config.prefix),
      do: raise(ArgumentError, "invalid schema prefix")

    unless is_binary(config.cookie_name) and
             Regex.match?(~r/^[A-Za-z0-9_-]{1,64}$/, config.cookie_name),
           do: raise(ArgumentError, "invalid cookie name")

    for {value, min, max} <- [
          {config.max_body_bytes, 1, 65536},
          {config.request_timeout_ms, 100, 30000},
          {config.evaluator_timeout_ms, 1, 5000},
          {config.observation_retention_days, 1, 3650},
          {config.max_observations_per_visitor, 1, 100},
          {config.cookie_max_age_days, 1, 400}
        ] do
      unless is_integer(value) and value >= min and value <= max,
        do: raise(ArgumentError, "invalid Doorman limit")
    end

    unless is_number(config.restore_threshold) and config.restore_threshold >= 0.8 and
             config.restore_threshold <= 1,
           do: raise(ArgumentError, "invalid restore threshold")

    unless config.environment in [:production, :development, :test] and is_boolean(config.debug) and
             is_boolean(config.secure_cookie) and is_boolean(config.expose_client_scores),
           do: raise(ArgumentError, "invalid environment")

    if config.environment == :production and (config.debug or not config.secure_cookie),
      do: raise(ArgumentError, "production requires secure cookies and no debug")

    unless is_binary(config.endpoint_path) and String.starts_with?(config.endpoint_path, "/") and
             byte_size(config.endpoint_path) <= 256 and
             not String.contains?(config.endpoint_path, ["?", "#", " "]),
           do: raise(ArgumentError, "invalid endpoint path")

    unless is_boolean(config.lookup_planning),
      do: raise(ArgumentError, "invalid lookup planning option")

    unless is_nil(config.evaluator) or is_function(config.evaluator, 1) or
             (is_list(config.evaluator) and Keyword.keyword?(config.evaluator) and
                is_binary(config.evaluator[:api_key]) and
                String.trim(config.evaluator[:api_key]) != ""),
           do: raise(ArgumentError, "evaluator must be a function or Jev options")

    unless is_nil(config.on_metrics) or is_function(config.on_metrics, 1),
      do: raise(ArgumentError, "on_metrics must be a function")

    unless is_list(config.analytics) and Keyword.keyword?(config.analytics) and
             Enum.all?(config.analytics, fn {provider, opts} ->
               provider in [:posthog, :mixpanel] and is_list(opts) and Keyword.keyword?(opts)
             end),
           do: raise(ArgumentError, "invalid analytics configuration")

    if config.identity, do: Doorman.Identity.validate_options!(config.identity)
    Doorman.Learning.validate_options!(config)

    %{
      config
      | protection: Doorman.Protection.configure(config.protection),
        evidence: Doorman.Evidence.configure(config.evidence, config.identity),
        activity: Doorman.Activity.configure(config.activity, config.identity)
    }
  end

  @doc "Identify a validated JSON payload; context must originate in server-verified authentication."
  def identify(config, payload, context \\ %{}) do
    with :ok <- Doorman.Validation.validate(payload) do
      try do
        case Doorman.Protection.admit(config, context[:admission]) do
          :ok -> {:ok, Doorman.Engine.identify(config, payload, context)}
          error -> error
        end
      rescue
        _ -> {:error, :storage_unavailable}
      catch
        :exit, _ -> {:error, :storage_unavailable}
      end
    end
  end

  def handle(conn, config, context \\ %{}), do: Doorman.Plug.handle(conn, config, context)

  @doc "Return private identity and source-labeled request evidence to server code."
  def assess(config, payload, context \\ %{}) do
    evidence = Doorman.Evidence.request_evidence(context[:evidence])

    with {:ok, identity} <- identify(config, payload, context),
         do: {:ok, %{identity: identity, evidence: evidence}}
  rescue
    _ -> {:error, :invalid_context}
  end

  def cleanup(config, opts \\ []) do
    progress = Doorman.Storage.cleanup(config, opts)
    if config.identity, do: Doorman.Identity.cleanup(config)
    if config.learning, do: Doorman.Learning.cleanup(config)
    if config.protection, do: Doorman.Protection.cleanup(config)
    if config.evidence, do: Doorman.Evidence.cleanup(config)

    if config.activity do
      Doorman.Activity.cleanup(config)
      if is_nil(config.protection), do: Doorman.Protection.cleanup(config)
    end

    progress
  end

  def delete_visitor(config, id), do: Doorman.Storage.delete_visitor(config, id)
  def random_id(prefix), do: prefix <> Base.encode16(:crypto.strong_rand_bytes(24), case: :lower)
  def now, do: System.system_time(:millisecond)
end
