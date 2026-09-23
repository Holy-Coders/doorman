defmodule Doorman.Observation do
  @moduledoc "Normalization and transparent deterministic evidence, shared with TypeScript conformance fixtures."
  @weights [
    {"samePlatform", 0.18},
    {"sameBrowser", 0.12},
    {"sameTimezone", 0.05},
    {"sameLanguages", 0.07},
    {"screenSimilarity", 0.14},
    {"viewportSimilarity", 0.02},
    {"sameHardwareConcurrency", 0.10},
    {"sameDeviceMemory", 0.07},
    {"sameTouchCapabilities", 0.05},
    {"sameWebglVendor", 0.07},
    {"sameWebglRenderer", 0.13}
  ]
  def normalize(raw, behavior \\ nil) do
    screen = nested(raw["screen"], &positive/1)

    screen =
      if screen && screen["width"] && screen["height"],
        do:
          Map.merge(screen, %{
            "width" => min(screen["width"], screen["height"]),
            "height" => max(screen["width"], screen["height"])
          }),
        else: screen

    languages =
      if raw["languages"],
        do:
          raw["languages"]
          |> Enum.map(&lower/1)
          |> Enum.reject(&is_nil/1)
          |> Enum.uniq()
          |> Enum.sort()

    hardware = nested(raw["hardware"], &positive/1)

    hardware =
      if hardware && Map.has_key?(raw["hardware"], "maxTouchPoints"),
        do: Map.put(hardware, "maxTouchPoints", raw["hardware"]["maxTouchPoints"]),
        else: hardware

    clean(%{
      "userAgent" => text(raw["userAgent"]),
      "platform" => platform(raw["platform"], raw["userAgent"]),
      "browser" => browser(raw["userAgent"]),
      "languages" => if(languages == [], do: nil, else: languages),
      "timezone" => text(raw["timezone"]),
      "screen" => screen,
      "viewport" => nested(raw["viewport"], &positive/1),
      "hardware" => hardware,
      "automation" => raw["automation"],
      "graphics" => nested(raw["graphics"], &lower/1),
      "fonts" => raw["fonts"],
      "environment" => raw["environment"],
      "behavior" => behavior
    })
  end

  def clean(map), do: Map.reject(map, fn {_, v} -> is_nil(v) end)
  defp nested(nil, _), do: nil
  defp nested(map, fun), do: Map.new(map, fn {k, v} -> {k, fun.(v)} end) |> clean()
  defp text(nil), do: nil

  defp text(v) do
    case String.trim(v) do
      "" -> nil
      s -> s
    end
  end

  defp lower(v), do: if(text(v), do: String.downcase(text(v)))
  defp positive(n) when is_number(n) and n > 0, do: n
  defp positive(_), do: nil
  defp browser(nil), do: nil

  defp browser(ua),
    do:
      Enum.find_value(
        [
          {~r/edg(e|a|ios)?\//i, "edge"},
          {~r/opr\/|opera/i, "opera"},
          {~r/firefox\/|fxios\//i, "firefox"},
          {~r/chrome\/|crios\//i, "chrome"},
          {~r/safari\//i, "safari"}
        ],
        fn {pattern, name} -> if Regex.match?(pattern, ua), do: name end
      )

  defp platform(p, ua) do
    value = lower(p)

    cond do
      Regex.match?(~r/iphone|ipad|ipod/i, ua || "") or
          Regex.match?(~r/iphone|ipad|ipod|^ios$/i, p || "") ->
        "ios"

      Regex.match?(~r/android/i, ua || "") or Regex.match?(~r/android/i, p || "") ->
        "android"

      value && String.starts_with?(value, "win") ->
        "windows"

      value && String.starts_with?(value, "mac") ->
        "macos"

      value && String.contains?(value, "linux") ->
        "linux"

      true ->
        value
    end
  end

  defp fonts(%{"version" => "local-12-v1", "available" => a}, %{
         "version" => "local-12-v1",
         "available" => b
       }) do
    if Regex.match?(~r/^[01]{12}$/, a) and Regex.match?(~r/^[01]{12}$/, b) and
         String.contains?(a, "1") and String.contains?(b, "1") do
      pairs = Enum.zip(String.codepoints(a), String.codepoints(b))

      Enum.count(pairs, fn {x, y} -> x == "1" and y == "1" end) /
        Enum.count(pairs, fn {x, y} -> x == "1" or y == "1" end)
    end
  end

  defp fonts(_, _), do: nil

  defp equal(nil, _), do: nil
  defp equal(_, nil), do: nil
  defp equal(a, b), do: a == b

  defp dimension(%{"width" => aw, "height" => ah}, %{"width" => bw, "height" => bh}) do
    (ratio(min(aw, ah), min(bw, bh)) + ratio(max(aw, ah), max(bw, bh))) / 2
  end

  defp dimension(_, _), do: nil
  defp ratio(a, a), do: 1
  defp ratio(a, b), do: min(a, b) / max(a, b)

  def similarity(a, b) do
    features =
      clean(%{
        "fontSimilarity" => fonts(a["fonts"], b["fonts"]),
        "samePlatform" => equal(a["platform"], b["platform"]),
        "sameBrowser" => equal(a["browser"], b["browser"]),
        "sameTimezone" => equal(a["timezone"], b["timezone"]),
        "sameLanguages" => equal(join(a["languages"]), join(b["languages"])),
        "screenSimilarity" => dimension(a["screen"], b["screen"]),
        "viewportSimilarity" => dimension(a["viewport"], b["viewport"]),
        "sameHardwareConcurrency" =>
          equal(
            get_in(a, ["hardware", "hardwareConcurrency"]),
            get_in(b, ["hardware", "hardwareConcurrency"])
          ),
        "sameDeviceMemory" =>
          equal(get_in(a, ["hardware", "deviceMemory"]), get_in(b, ["hardware", "deviceMemory"])),
        "sameTouchCapabilities" =>
          equal(
            get_in(a, ["hardware", "maxTouchPoints"]),
            get_in(b, ["hardware", "maxTouchPoints"])
          ),
        "sameWebglVendor" =>
          equal(get_in(a, ["graphics", "webglVendor"]), get_in(b, ["graphics", "webglVendor"])),
        "sameWebglRenderer" =>
          equal(
            get_in(a, ["graphics", "webglRenderer"]),
            get_in(b, ["graphics", "webglRenderer"])
          ),
        "webdriverDetected" =>
          if(
            get_in(a, ["automation", "webdriver"]) == true or
              get_in(b, ["automation", "webdriver"]) == true,
            do: true
          )
      })

    available = available(features)

    matched =
      Enum.reduce(@weights, 0, fn {name, weight}, total ->
        total + number(features[name]) * weight
      end)

    %{"score" => min(1, matched / max(available, 0.55)), "features" => features}
  end

  defp join(nil), do: nil
  defp join(v), do: Enum.join(v, ",")
  defp number(v) when is_number(v), do: v
  defp number(true), do: 1
  defp number(_), do: 0

  defp available(features),
    do:
      Enum.reduce(@weights, 0, fn {name, weight}, sum ->
        sum + if(Map.has_key?(features, name), do: weight, else: 0)
      end)

  def contradiction?(a, b) do
    screen = dimension(a["screen"], b["screen"])

    (not is_nil(a["platform"]) and not is_nil(b["platform"]) and a["platform"] != b["platform"]) or
      (not is_nil(screen) and screen < 0.55 and
         (equal(
            get_in(a, ["hardware", "maxTouchPoints"]),
            get_in(b, ["hardware", "maxTouchPoints"])
          ) == false or
            equal(
              get_in(a, ["graphics", "webglVendor"]),
              get_in(b, ["graphics", "webglVendor"])
            ) == false))
  end

  def evidence_cap(a, b),
    do:
      min(
        min(1, available(similarity(a, b)["features"]) / 0.55),
        if(contradiction?(a, b), do: 0.5, else: 1)
      )
end
