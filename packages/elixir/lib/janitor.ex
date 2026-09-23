defmodule Janitor do
  @moduledoc "Native first-party identity for Plug/Phoenix. Browser scores never authorize access."
  defstruct repo: nil,
            prefix: "janitor",
            evaluator: nil,
            evaluator_timeout_ms: 1200,
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
        do: raise(ArgumentError, "invalid Janitor limit")
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

    if config.identity, do: Janitor.Identity.validate_options!(config.identity)
    Janitor.Learning.validate_options!(config)

    %{
      config
      | protection: Janitor.Protection.configure(config.protection),
        evidence: Janitor.Evidence.configure(config.evidence, config.identity)
    }
  end

  @doc "Identify a validated JSON payload; context must originate in server-verified authentication."
  def identify(config, payload, context \\ %{}) do
    with :ok <- Janitor.Validation.validate(payload) do
      try do
        case Janitor.Protection.admit(config, context[:admission]) do
          :ok -> {:ok, Janitor.Engine.identify(config, payload, context)}
          error -> error
        end
      rescue
        _ -> {:error, :storage_unavailable}
      catch
        :exit, _ -> {:error, :storage_unavailable}
      end
    end
  end

  def handle(conn, config, context \\ %{}), do: Janitor.Plug.handle(conn, config, context)

  @doc "Return private identity and source-labeled request evidence to server code."
  def assess(config, payload, context \\ %{}) do
    evidence = Janitor.Evidence.request_evidence(context[:evidence])

    with {:ok, identity} <- identify(config, payload, context),
         do: {:ok, %{identity: identity, evidence: evidence}}
  rescue
    _ -> {:error, :invalid_context}
  end

  def cleanup(config, opts \\ []) do
    progress = Janitor.Storage.cleanup(config, opts)
    if config.identity, do: Janitor.Identity.cleanup(config)
    if config.learning, do: Janitor.Learning.cleanup(config)
    if config.protection, do: Janitor.Protection.cleanup(config)
    if config.evidence, do: Janitor.Evidence.cleanup(config)
    progress
  end

  def delete_visitor(config, id), do: Janitor.Storage.delete_visitor(config, id)
  def random_id(prefix), do: prefix <> Base.encode16(:crypto.strong_rand_bytes(24), case: :lower)
  def now, do: System.system_time(:millisecond)
end
