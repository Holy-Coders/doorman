defmodule Janitor.Validation do
  @moduledoc false
  @external_resource Path.expand("../../priv/payload.schema.json", __DIR__)
  @schema @external_resource |> File.read!() |> Jason.decode!()
  def validate(value), do: if(valid?(value, @schema), do: :ok, else: {:error, :invalid_payload})

  defp valid?(v, %{"type" => "object"} = s) when is_map(v) and not is_struct(v) do
    props = s["properties"] || %{}

    Enum.all?(s["required"] || [], &Map.has_key?(v, &1)) and
      Enum.all?(v, fn {key, value} -> Map.has_key?(props, key) and valid?(value, props[key]) end)
  end

  defp valid?(v, %{"type" => "array"} = s) when is_list(v),
    do: length(v) <= (s["maxItems"] || 100) and Enum.all?(v, &valid?(&1, s["items"]))

  defp valid?(v, %{"type" => "string"} = s) when is_binary(v),
    do:
      String.valid?(v) and
        div(byte_size(:unicode.characters_to_binary(v, :utf8, {:utf16, :little})), 2) <=
          (s["maxLength"] || 512)

  defp valid?(v, %{"type" => "boolean"}) when is_boolean(v), do: true

  defp valid?(v, %{"type" => t} = s) when t in ["number", "integer"] and is_number(v) do
    (t != "integer" or trunc(v) == v) and v >= (s["minimum"] || 0) and
      v <= (s["maximum"] || 9_007_199_254_740_991)
  end

  defp valid?(_, _), do: false
end
