defmodule Doorman.HTTP do
  @moduledoc false
  # Bound before decoding. No retries, redirects or raw-payload logging.
  def post_json(opts), do: request_json(:post, opts)
  def get_json(opts), do: request_json(:get, opts)

  defp request_json(method, opts) do
    {plain_text, opts} = Keyword.pop(opts, :plain_text_response, false)

    response =
      Req.request!(
        Keyword.merge(opts,
          method: method,
          decode_body: false,
          into: fn {:data, chunk}, {request, response} ->
            body = (response.body || "") <> chunk
            if byte_size(body) > 65_536, do: raise("Provider response exceeds 64 KiB")
            {:cont, {request, %{response | body: body}}}
          end
        )
      )

    body =
      if is_binary(response.body) and not plain_text,
        do: Jason.decode!(response.body),
        else: response.body

    %{response | body: body}
  end
end
