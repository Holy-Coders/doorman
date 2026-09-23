defmodule Doorman.Storage do
  @moduledoc false
  def table(config, name), do: ~s("#{config.prefix}"."#{name}")

  def query(config, sql, params \\ []) do
    result = Ecto.Adapters.SQL.query!(config.repo, sql, params, log: false)
    Enum.map(result.rows || [], &Map.new(Enum.zip(result.columns, &1)))
  end

  def cutoff(c), do: Doorman.now() - c.observation_retention_days * 86_400_000

  @rows_per_probe 100
  @candidate_limit 10
  def candidates(c, o, scope \\ %{}) do
    screen = o["screen"] || %{}
    hardware = o["hardware"] || %{}
    renderer = get_in(o, ["graphics", "webglRenderer"])
    base = [o["platform"], o["browser"]]
    dimensions = [screen["width"], screen["height"]]

    screen_fields = [
      "(signals_json #>> '{screen,width}')",
      "(signals_json #>> '{screen,height}')"
    ]

    probes = [
      {["platform", "browser"] ++
         screen_fields ++ ["(signals_json #>> '{hardware,hardwareConcurrency}')"],
       base ++ dimensions ++ [hardware["hardwareConcurrency"]]},
      {["platform", "browser"] ++ screen_fields ++ ["timezone"],
       base ++ dimensions ++ [o["timezone"]]},
      {["platform", "browser", "webgl_renderer", "timezone"], base ++ [renderer, o["timezone"]]},
      {["platform", "browser"], base},
      {["webgl_renderer"], [renderer]},
      {["timezone", "browser"], [o["timezone"], o["browser"]]}
    ]

    {branches, params} =
      probes
      |> Enum.filter(fn {fields, _} ->
        (scope["graphics"] != false or "webgl_renderer" not in fields) and
          (scope["locale"] != false or "timezone" not in fields)
      end)
      |> Enum.filter(fn {_, values} -> Enum.all?(values, &(not is_nil(&1))) end)
      |> Enum.with_index()
      |> Enum.reduce({[], [cutoff(c)]}, fn {{fields, values}, probe}, {branches, params} ->
        where =
          fields
          |> Enum.with_index(length(params) + 1)
          |> Enum.map_join(" AND ", fn {field, index} -> "#{field} = $#{index}" end)

        branch =
          "(SELECT visitor_id, seen_at, signals_json, #{probe} AS probe FROM #{table(c, "observations")} WHERE #{where} AND seen_at >= $1 ORDER BY seen_at DESC LIMIT #{@rows_per_probe + 1})"

        {branches ++ [branch], params ++ Enum.map(values, &to_string/1)}
      end)

    rows = if branches == [], do: [], else: query(c, Enum.join(branches, " UNION ALL "), params)
    counts = Enum.frequencies_by(rows, & &1["probe"])

    rows
    |> Enum.reject(&Doorman.Observation.contradiction?(&1["signals_json"], o))
    |> Enum.map(
      &Map.put(&1, "score", Doorman.Observation.similarity(&1["signals_json"], o)["score"])
    )
    |> Enum.filter(&(&1["score"] >= 0.65))
    |> Enum.group_by(& &1["visitor_id"])
    |> Enum.map(fn {id, matches} ->
      %{
        "visitor_id" => id,
        "last_seen_at" => Enum.max_by(matches, & &1["seen_at"])["seen_at"],
        "score" => Enum.max_by(matches, & &1["score"])["score"],
        "lookup_saturated" => Enum.all?(matches, &(counts[&1["probe"]] > @rows_per_probe))
      }
    end)
    |> Enum.sort_by(&{-&1["score"], -&1["last_seen_at"], &1["visitor_id"]})
    |> Enum.take(@candidate_limit)
  end

  def histories(_, []), do: %{}

  def histories(c, ids) do
    query(
      c,
      "SELECT wanted.visitor_id, h.signals_json FROM unnest($1::text[]) AS wanted(visitor_id)
      CROSS JOIN LATERAL (SELECT signals_json, seen_at, id FROM #{table(c, "observations")}
        WHERE visitor_id = wanted.visitor_id AND seen_at >= $2
        ORDER BY seen_at DESC, id DESC LIMIT 5) h
      ORDER BY wanted.visitor_id, h.seen_at DESC, h.id DESC",
      [Enum.take(Enum.uniq(ids), @candidate_limit), cutoff(c)]
    )
    |> Enum.group_by(& &1["visitor_id"], & &1["signals_json"])
  end

  def history(c, id),
    do:
      query(
        c,
        "SELECT signals_json FROM #{table(c, "observations")} WHERE visitor_id = $1 AND seen_at >= $2 ORDER BY seen_at DESC, id DESC LIMIT 5",
        [id, cutoff(c)]
      )
      |> Enum.map(& &1["signals_json"])

  def create(c) do
    id = Doorman.random_id("vis_")

    query(
      c,
      "INSERT INTO #{table(c, "visitors")} (id,created_at,last_seen_at) VALUES ($1,$2,$2)",
      [id, Doorman.now()]
    )

    id
  end

  def save(c, id, o) do
    query(
      c,
      "INSERT INTO #{table(c, "observations")} (visitor_id,seen_at,platform,browser,timezone,webgl_renderer,signals_json) VALUES ($1,$2,$3,$4,$5,$6,$7)",
      [
        id,
        Doorman.now(),
        o["platform"],
        o["browser"],
        o["timezone"],
        get_in(o, ["graphics", "webglRenderer"]),
        o
      ]
    )

    query(
      c,
      "DELETE FROM #{table(c, "observations")} WHERE visitor_id = $1 AND (seen_at < $2 OR id IN (SELECT id FROM #{table(c, "observations")} WHERE visitor_id = $1 ORDER BY seen_at DESC, id DESC OFFSET $3))",
      [id, cutoff(c), c.max_observations_per_visitor]
    )

    query(
      c,
      "UPDATE #{table(c, "visitors")} SET last_seen_at = GREATEST(last_seen_at,$1) WHERE id = $2",
      [Doorman.now(), id]
    )
  end

  def delete_visitor(c, id),
    do: query(c, "DELETE FROM #{table(c, "visitors")} WHERE id = $1", [id])

  def touch(c, id),
    do:
      query(
        c,
        "UPDATE #{table(c, "visitors")} SET last_seen_at = GREATEST(last_seen_at,$1) WHERE id = $2",
        [Doorman.now(), id]
      )

  def cleanup(c, opts \\ []) do
    size = Keyword.get(opts, :batch_size, 100)

    unless is_integer(size) and size in 1..1000,
      do: raise(ArgumentError, "invalid cleanup batch size")

    recent = cutoff(c)

    expired =
      query(
        c,
        "DELETE FROM #{table(c, "observations")} WHERE id IN (SELECT id FROM #{table(c, "observations")} WHERE seen_at < $1 ORDER BY seen_at LIMIT $2) RETURNING id",
        [recent, size]
      )

    visitors =
      query(c, "SELECT id FROM #{table(c, "visitors")} WHERE id > $1 ORDER BY id LIMIT $2", [
        Keyword.get(opts, :after_visitor_id, ""),
        size + 1
      ])

    ids = visitors |> Enum.take(size) |> Enum.map(& &1["id"])

    if ids != [] do
      query(
        c,
        "DELETE FROM #{table(c, "observations")} WHERE id IN (SELECT id FROM (SELECT id, ROW_NUMBER() OVER (PARTITION BY visitor_id ORDER BY seen_at DESC,id DESC) AS position FROM #{table(c, "observations")} WHERE visitor_id = ANY($1::text[])) AS ranked WHERE position > $2)",
        [ids, c.max_observations_per_visitor]
      )
    end

    removed =
      query(
        c,
        "DELETE FROM #{table(c, "visitors")} AS v WHERE id = ANY($1::text[]) AND last_seen_at < $2 AND NOT EXISTS (SELECT 1 FROM #{table(c, "observations")} WHERE visitor_id = v.id) RETURNING id",
        [ids, recent]
      )

    %{
      next_visitor_id: if(length(visitors) > size, do: List.last(ids)),
      has_more_expired: length(expired) == size or length(removed) == size
    }
  end
end
