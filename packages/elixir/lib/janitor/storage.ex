defmodule Janitor.Storage do
  @moduledoc false
  def table(config, name), do: ~s("#{config.prefix}"."#{name}")

  def query(config, sql, params \\ []) do
    result = Ecto.Adapters.SQL.query!(config.repo, sql, params, log: false)
    Enum.map(result.rows || [], &Map.new(Enum.zip(result.columns, &1)))
  end

  def cutoff(c), do: Janitor.now() - c.observation_retention_days * 86_400_000

  def candidates(c, o) do
    {branches, params} =
      Enum.reduce(
        [
          {o["platform"] && o["browser"], "platform = $2 AND browser = $3",
           [o["platform"], o["browser"]]},
          {get_in(o, ["graphics", "webglRenderer"]), "webgl_renderer = $2",
           [get_in(o, ["graphics", "webglRenderer"])]},
          {o["timezone"] && o["browser"], "timezone = $2 AND browser = $3",
           [o["timezone"], o["browser"]]}
        ],
        {[], [cutoff(c)]},
        fn {present, where, values}, {branches, params} ->
          if present do
            # Shift only this branch's numbered parameters; values remain bound, never interpolated.
            shifted =
              Regex.replace(~r/\$(\d+)/, where, fn _, n ->
                "$#{String.to_integer(n) + length(params) - 1}"
              end)

            {[
               "(SELECT visitor_id, seen_at FROM #{table(c, "observations")} WHERE #{shifted} AND seen_at >= $1 ORDER BY seen_at DESC LIMIT 50)"
               | branches
             ], params ++ values}
          else
            {branches, params}
          end
        end
      )

    if branches == [],
      do: [],
      else:
        query(
          c,
          "SELECT visitor_id, MAX(seen_at) AS last_seen_at FROM (#{Enum.join(branches, " UNION ALL ")}) AS plausible GROUP BY visitor_id ORDER BY last_seen_at DESC, visitor_id LIMIT 10",
          params
        )
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
    id = Janitor.random_id("vis_")

    query(
      c,
      "INSERT INTO #{table(c, "visitors")} (id,created_at,last_seen_at) VALUES ($1,$2,$2)",
      [id, Janitor.now()]
    )

    id
  end

  def save(c, id, o) do
    query(
      c,
      "INSERT INTO #{table(c, "observations")} (visitor_id,seen_at,platform,browser,timezone,webgl_renderer,signals_json) VALUES ($1,$2,$3,$4,$5,$6,$7)",
      [
        id,
        Janitor.now(),
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
      [Janitor.now(), id]
    )
  end

  def delete_visitor(c, id),
    do: query(c, "DELETE FROM #{table(c, "visitors")} WHERE id = $1", [id])

  def cleanup(c) do
    query(c, "DELETE FROM #{table(c, "observations")} WHERE seen_at < $1", [cutoff(c)])

    query(
      c,
      "DELETE FROM #{table(c, "observations")} WHERE id IN (SELECT id FROM (SELECT id, ROW_NUMBER() OVER (PARTITION BY visitor_id ORDER BY seen_at DESC,id DESC) AS position FROM #{table(c, "observations")}) AS ranked WHERE position > $1)",
      [c.max_observations_per_visitor]
    )

    query(
      c,
      "DELETE FROM #{table(c, "visitors")} AS v WHERE last_seen_at < $1 AND NOT EXISTS (SELECT 1 FROM #{table(c, "observations")} WHERE visitor_id = v.id)",
      [cutoff(c)]
    )
  end
end
