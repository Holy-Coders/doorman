defmodule Doorman.ActivityTest do
  use ExUnit.Case, async: false
  import Plug.Test
  import Plug.Conn
  alias Doorman.{Activity, ActivityPlug, ActivityStore, Identity, Storage}
  @route "GET /api/orders/:id"
  @context %{
    key: %{kind: "actor", id: "private-actor"},
    route: @route,
    actor: %{kind: "agent", delegated: true}
  }
  @outcome %{status: 200, duration_ms: 10}
  @fixtures File.read!(Path.expand("../priv/conformance.json", __DIR__)) |> Jason.decode!()

  setup do
    c =
      Doorman.new(
        repo: Doorman.TestRepo,
        prefix: "doorman_test",
        environment: :test,
        identity: [secret: String.duplicate("a", 64), namespace: Doorman.random_id("api_")],
        activity: [routes: [%{route: @route, sensitive: true}]]
      )

    {:ok, c: c}
  end

  test "configured Jev evaluates API activity through the typed transport", %{c: c} do
    Req.Test.set_req_test_to_shared()
    caller = self()

    Req.Test.stub(:api_activity, fn conn ->
      {:ok, body, conn} = read_body(conn)
      send(caller, {:jev_request, Jason.decode!(body)})

      Req.Test.json(conn, %{
        answers: %{automation: %{type: "noul", noul: 0.9}, suspicious: %{type: "noul", noul: 0.1}}
      })
    end)

    c = %{c | evaluator: [api_key: "test", request_options: [plug: {Req.Test, :api_activity}]]}

    assert Activity.observe(c, @context, @outcome)["assessment"]["risk"] == %{
             "automation" => 0.9,
             "suspicious" => 0.1
           }

    assert_receive {:jev_request, request}
    assert request["model"] == "jev-latest"
    assert Map.keys(request["questions"]) |> Enum.sort() == ~w(automation suspicious)
    assert request["state"]["actor"] == %{"kind" => "agent", "delegated" => true}
    refute Jason.encode!(request) =~ "private-actor"
  end

  test "native activity protocol and opaque keys agree with TypeScript" do
    options = [secret: String.duplicate("a", 64), namespace: "fixture"]

    assert Identity.label(options, Jason.encode!(["api-activity-v1", "actor", "private-actor"])) ==
             @fixtures["activityLabel"]

    assert Doorman.Jev.activity_input(@fixtures["activity"]["state"]) == @fixtures["activity"]
  end

  test "aggregates concurrent requests in SQL without raw identifiers or browser history", %{c: c} do
    c = %{c | activity: %{c.activity | routes: %{@route => false}, min_requests: 1000}}

    results =
      1..25
      |> Task.async_stream(fn _ -> Activity.observe(c, @context, @outcome) end,
        max_concurrency: 5
      )
      |> Enum.to_list()

    assert Enum.all?(results, &(&1 == {:ok, %{"status" => "recorded"}}))
    result = Activity.assess(c, @context)
    assert result["assessment"]["riskStatus"] == "disabled"
    rows = result["assessment"]["summary"]["buckets"]
    assert Enum.sum(Enum.map(rows, & &1["requests"])) == 25
    assert Enum.sum(Enum.map(rows, & &1["durationTotalMs"])) == 250
    assert length(rows) <= 2
    stored = Storage.query(c, "SELECT * FROM #{Storage.table(c, "api_activity_buckets")}")
    refute Jason.encode!(stored) =~ "private-actor"
  end

  test "shares assessment leases across processes, caches results and separates actor context", %{
    c: c
  } do
    caller = self()

    model = fn input ->
      send(caller, {:evaluation, input})
      %{"automation" => 0.9, "suspicious" => 0.1}
    end

    c = %{c | activity: %{c.activity | evaluator: model}}

    results =
      1..15
      |> Task.async_stream(fn _ -> Activity.observe(c, @context, @outcome) end,
        max_concurrency: 5
      )
      |> Enum.to_list()

    assert Enum.all?(results, fn {:ok, result} -> result["status"] == "recorded" end)
    assert_receive {:evaluation, input}
    refute Jason.encode!(input) =~ "private-actor"
    refute_receive {:evaluation, _}
    assert Activity.observe(c, @context, @outcome)["assessment"]["cached"]
    changed = put_in(@context, [:actor, :delegated], false)
    assert Activity.observe(c, changed, @outcome)["assessment"]["riskStatus"] == "evaluated"
    assert_receive {:evaluation, %{"actor" => %{"delegated" => false}}}
  end

  test "unknown routes and missing server context do no collection; malformed context fails open",
       %{c: c} do
    assert Activity.observe(c, nil, @outcome) == %{"status" => "skipped"}

    assert Activity.observe(c, %{@context | route: "GET /not-configured"}, @outcome) == %{
             "status" => "skipped"
           }

    assert Activity.observe(
             c,
             %{@context | route: "GET /api/orders/secret?email=private"},
             @outcome
           ) == %{"status" => "unavailable"}

    assert Activity.observe(c, Map.put(@context, :password, "secret"), @outcome) == %{
             "status" => "unavailable"
           }

    assert Activity.observe(c, %{@context | key: %{kind: "session", id: "ambiguous"}}, @outcome) ==
             %{"status" => "unavailable"}
  end

  test "Plug keeps bodies, headers, cookies and scores separate", %{c: c} do
    opts =
      ActivityPlug.init(
        config: c,
        context: fn conn -> if conn.assigns[:verified], do: @context end
      )

    conn =
      conn(:post, "https://app.test/api/orders/123?secret=query", "private-request-body")
      |> put_req_header("authorization", "Bearer secret")
      |> assign(:verified, true)
      |> ActivityPlug.call(opts)
      |> put_resp_cookie("app", "unchanged")
      |> send_resp(201, "application response")

    assert conn.status == 201
    assert conn.resp_body == "application response"
    assert conn.resp_cookies["app"].value == "unchanged"
    assert conn.assigns.doorman_api_activity["assessment"]["riskStatus"] == "disabled"
    refute Jason.encode!(conn.assigns.doorman_api_activity) =~ "secret"

    unknown =
      conn(:get, "/")
      |> put_req_header("x-actor-id", "private-actor")
      |> ActivityPlug.call(opts)
      |> send_resp(200, "ok")

    assert unknown.assigns.doorman_api_activity == %{"status" => "skipped"}
  end

  test "Plug preserves normal responses when context callbacks or storage fail", %{c: c} do
    for {config, context} <- [
          {c, fn _ -> raise "secret error" end},
          {%{c | prefix: "unavailable_activity_schema", auto_migrate: false},
           fn _ -> @context end}
        ] do
      opts = ActivityPlug.init(config: config, context: context)
      conn = conn(:get, "/") |> ActivityPlug.call(opts) |> send_resp(200, "ok")
      assert conn.status == 200 and conn.resp_body == "ok"
      assert conn.assigns.doorman_api_activity == %{"status" => "unavailable"}
    end
  end

  test "timeouts and malformed outputs return unavailable zero risk and are cached", %{c: c} do
    for model <- [
          fn _ -> raise "provider 500" end,
          fn _ -> %{"automation" => 2, "suspicious" => 0} end,
          fn _ ->
            Process.sleep(300)
            %{"automation" => 1, "suspicious" => 1}
          end
        ] do
      c = %{
        c
        | evaluator_timeout_ms: 20,
          identity: Keyword.put(c.identity, :namespace, Doorman.random_id("timeout_")),
          activity: %{c.activity | evaluator: model}
      }

      result = Activity.observe(c, @context, @outcome)
      assert result["assessment"]["riskStatus"] == "unavailable"
      assert result["assessment"]["risk"] == %{"automation" => 0, "suspicious" => 0}
      assert Activity.observe(c, @context, @outcome)["assessment"]["cached"]
    end
  end

  test "shared evaluator budgets prevent additional paid calls", %{c: c} do
    caller = self()

    model = fn _ ->
      send(caller, :paid)
      %{"automation" => 0.9, "suspicious" => 0.1}
    end

    c = %{
      c
      | protection: Doorman.Protection.configure(c.identity ++ [evaluator: [max_calls: 1]]),
        activity: %{c.activity | evaluator: model}
    }

    assert Activity.observe(c, @context, @outcome)["assessment"]["riskStatus"] == "evaluated"
    other = put_in(@context, [:key, :id], "other-actor")
    assert Activity.observe(c, other, @outcome)["assessment"]["riskStatus"] == "unavailable"
    assert_receive :paid
    refute_receive :paid
  end

  test "count milestones, first denials, retention and explicit erasure", %{c: c} do
    c = %{c | activity: %{c.activity | routes: %{@route => false}, min_requests: 4}}

    for _ <- 1..3,
        do: assert(Activity.observe(c, @context, @outcome) == %{"status" => "recorded"})

    assert Activity.observe(c, @context, @outcome)["assessment"]["riskStatus"] == "disabled"
    assert Activity.observe(c, @context, @outcome) == %{"status" => "recorded"}
    other = put_in(@context, [:key, :id], "denied-actor")

    assert Activity.observe(c, other, %{status: 403, duration_ms: 0})["assessment"]["summary"][
             "buckets"
           ]
           |> hd()
           |> Map.fetch!("denied") == 1

    Activity.delete_key(c, @context.key)
    assert Activity.assess(c, @context)["assessment"]["summary"]["buckets"] == []
    Storage.query(c, "UPDATE #{Storage.table(c, "api_activity_buckets")} SET expires_at=0")
    Activity.cleanup(c)

    assert Storage.query(
             c,
             "SELECT * FROM #{Storage.table(c, "api_activity_buckets")} WHERE expires_at=0"
           ) == []
  end

  test "expired leases cannot overwrite a newer cached assessment", %{c: c} do
    id = Doorman.random_id("lease_")
    now = Doorman.now()
    assert ActivityStore.claim(c, id, "owner", "old", now, now + 1)
    assert ActivityStore.claim(c, id, "owner", "new", now + 2, now + 1000)
    ActivityStore.save(c, id, "old", %{"expiresAt" => now + 1000})
    assert ActivityStore.cached(c, id, now + 3) == nil
  end
end
