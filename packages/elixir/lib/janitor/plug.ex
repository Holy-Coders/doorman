defmodule Janitor.Plug do
  @moduledoc "Phoenix controller adapter. Supply trusted context explicitly; mount before body logging or exclude signals from logs."
  import Plug.Conn

  def handle(conn, c, context \\ %{}) do
    origin =
      "#{conn.scheme}://#{conn.host}" <>
        if(conn.port == if(conn.scheme == :https, do: 443, else: 80),
          do: "",
          else: ":#{conn.port}"
        )

    cond do
      conn.request_path != c.endpoint_path ->
        reply(conn, 404, %{"error" => "Not found"})

      conn.method != "POST" ->
        conn |> put_resp_header("allow", "POST") |> reply(405, %{"error" => "Method not allowed"})

      get_req_header(conn, "origin") not in [[], [origin]] or
          get_req_header(conn, "sec-fetch-site") == ["cross-site"] ->
        reply(conn, 403, %{"error" => "Cross-origin requests are not allowed"})

      not json?(conn) ->
        reply(conn, 415, %{"error" => "Content-Type must be application/json"})

      not c.secure_cookie and conn.host not in ["localhost", "127.0.0.1", "::1"] ->
        reply(conn, 400, %{"error" => "Insecure cookies require localhost"})

      true ->
        identify(conn, c, context)
    end
  end

  defp identify(conn, c, context) do
    with {:ok, payload, conn} <- payload(conn, c), :ok <- Janitor.Validation.validate(payload) do
      try do
        if context[:verified] && is_nil(c.identity),
          do: raise("identity directory not configured")

        id = cookie(conn, c.cookie_name)
        id = if is_binary(id) and Regex.match?(~r/^vis_[a-f0-9]{48}$/, id), do: id

        case Janitor.assess(c, payload, Map.put(context, :visitor_id, id)) do
          {:ok, %{identity: identity, evidence: evidence}} ->
            learning_id = cookie(conn, c.cookie_name <> "_learning")

            learning_cookie =
              if c.learning,
                do: Janitor.Learning.observe(c, learning_id, context, identity, payload),
                else: {nil, 0}

            conn =
              put_resp_cookie(
                conn,
                c.cookie_name,
                identity["visitorId"],
                cookie_opts(c, c.cookie_max_age_days * 86400)
              )

            {next_id, max_age} = learning_cookie

            conn =
              if next_id || learning_id,
                do:
                  put_resp_cookie(
                    conn,
                    c.cookie_name <> "_learning",
                    next_id || "",
                    cookie_opts(c, max_age)
                  ),
                else: conn

            if context[:analytics_consent] == true and is_binary(context[:analytics_id]),
              do: Janitor.Analytics.capture_all(c.analytics, identity, context.analytics_id)

            public =
              if c.expose_client_scores,
                do: identity,
                else: Map.take(identity, ["visitorId", "isReturning"])

            conn
            |> assign(:janitor_identity, identity)
            |> assign(:janitor_evidence, evidence)
            |> reply(200, public)

          {:error, :invalid_payload} ->
            reply(conn, 400, %{"error" => "Invalid visitor payload"})

          {:error, {:rate_limited, retry}} ->
            conn
            |> put_resp_header("retry-after", to_string(retry))
            |> reply(429, %{"error" => "Visitor measurement rate limited"})

          _ ->
            reply(conn, 503, %{"error" => "Visitor storage is unavailable"})
        end
      rescue
        _ -> reply(conn, 503, %{"error" => "Visitor storage is unavailable"})
      catch
        :exit, _ -> reply(conn, 503, %{"error" => "Visitor storage is unavailable"})
      end
    else
      {:error, status, conn} ->
        reply(conn, status, %{
          "error" =>
            if(status == 413, do: "Request body too large", else: "Invalid visitor payload")
        })

      {:error, :invalid_payload} ->
        reply(conn, 400, %{"error" => "Invalid visitor payload"})
    end
  end

  defp payload(conn, c) do
    lengths = get_req_header(conn, "content-length")

    oversized =
      Enum.any?(lengths, fn value ->
        case Integer.parse(value) do
          {n, ""} when n >= 0 -> n > c.max_body_bytes
          _ -> true
        end
      end)

    cond do
      oversized ->
        {:error, 413, conn}

      is_map(conn.body_params) and not is_struct(conn.body_params) ->
        if byte_size(Jason.encode!(conn.body_params)) > c.max_body_bytes,
          do: {:error, 413, conn},
          else: {:ok, conn.body_params, conn}

      true ->
        case read_body(conn,
               length: c.max_body_bytes,
               read_length: c.max_body_bytes,
               read_timeout: c.request_timeout_ms
             ) do
          {:more, _, conn} ->
            {:error, 413, conn}

          {:error, _} ->
            {:error, 408, conn}

          {:ok, body, conn} ->
            case Jason.decode(body) do
              {:ok, payload} -> {:ok, payload, conn}
              _ -> {:error, 400, conn}
            end
        end
    end
  end

  defp cookie(conn, name) do
    cookies =
      for header <- get_req_header(conn, "cookie"),
          part <- String.split(header, ";"),
          String.starts_with?(String.trim(part), name <> "="),
          do: String.replace_prefix(String.trim(part), name <> "=", "")

    case cookies do
      [value] -> value
      _ -> nil
    end
  end

  defp cookie_opts(c, max_age),
    do: [http_only: true, secure: c.secure_cookie, same_site: "Lax", path: "/", max_age: max_age]

  defp json?(conn) do
    case get_req_header(conn, "content-type") do
      [value] ->
        value |> String.split(";") |> hd() |> String.trim() |> String.downcase() ==
          "application/json"

      _ ->
        false
    end
  end

  defp reply(conn, status, body),
    do:
      conn
      |> put_resp_header("cache-control", "private, no-store")
      |> put_resp_header("vary", "Cookie, Origin, Authorization")
      |> put_resp_header("x-content-type-options", "nosniff")
      |> put_resp_content_type("application/json")
      |> send_resp(status, Jason.encode!(body))
      |> halt()
end
