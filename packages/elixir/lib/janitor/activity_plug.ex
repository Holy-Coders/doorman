defmodule Janitor.ActivityPlug do
  @moduledoc "Observe allowlisted API responses. Resolve context from application authentication; never from request claims."
  @behaviour Plug
  import Plug.Conn

  def init(opts) do
    unless Keyword.keyword?(opts) and Keyword.has_key?(opts, :config) and
             is_function(opts[:context], 1),
           do: raise(ArgumentError, "ActivityPlug requires config and a server context function")

    opts
  end

  def call(conn, opts) do
    started = System.monotonic_time(:millisecond)

    register_before_send(conn, fn conn ->
      result =
        try do
          config = if is_function(opts[:config], 0), do: opts[:config].(), else: opts[:config]

          Janitor.Activity.observe(config, opts[:context].(conn), %{
            status: conn.status,
            duration_ms: max(0, System.monotonic_time(:millisecond) - started)
          })
        rescue
          _ -> %{"status" => "unavailable"}
        catch
          _, _ -> %{"status" => "unavailable"}
        end

      assign(conn, :janitor_api_activity, result)
    end)
  end
end
