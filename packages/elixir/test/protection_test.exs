defmodule Janitor.ProtectionTest do
  use ExUnit.Case, async: false
  import Plug.Test
  import Plug.Conn
  alias Janitor.{Storage, Protection}
  @fixtures File.read!(Path.expand("../priv/conformance.json", __DIR__)) |> Jason.decode!()
  @signals hd(@fixtures["vectors"])["raw"]
  defp config(extra \\ []) do
    Janitor.new(
      Keyword.merge(
        [
          repo: Janitor.TestRepo,
          prefix: "janitor_test",
          environment: :test,
          protection: [secret: String.duplicate("s", 64), namespace: Janitor.random_id("test_")]
        ],
        extra
      )
    )
  end

  test "compound evaluations reserve every provider call" do
    c =
      config(
        protection: [
          secret: String.duplicate("s", 64),
          namespace: Janitor.random_id("test_"),
          evaluator: [max_calls: 3, max_concurrent: 2]
        ]
      )

    result = %{"sameVisitor" => 0.9, "automation" => 0.1, "suspicious" => 0.1}

    assert {:ok, ^result} =
             Protection.evaluate(c, fn -> result end, &Janitor.Engine.valid_evaluation?/1, 2)

    assert :unavailable =
             Protection.evaluate(
               c,
               fn -> raise "no budget" end,
               &Janitor.Engine.valid_evaluation?/1,
               2
             )
  end

  test "shared request limits cap concurrent callers and never store raw keys" do
    c =
      config(
        protection: [
          secret: String.duplicate("s", 64),
          namespace: Janitor.random_id("test_"),
          requests: [global: 7]
        ]
      )

    results =
      1..20
      |> Task.async_stream(
        fn _ ->
          Protection.admit(c, %{account: "private-account", session: "private-session"})
        end,
        max_concurrency: 5
      )
      |> Enum.to_list()

    assert Enum.count(results, &(&1 == {:ok, :ok})) == 7
    rows = Storage.query(c, "SELECT * FROM #{Storage.table(c, "protection_quotas")}", [])
    refute Jason.encode!(rows) =~ "private-account"
    refute Jason.encode!(rows) =~ "private-session"
  end

  test "shared inference circuit fails open with conservative risk" do
    count = :atomics.new(1, [])

    c =
      config(
        evaluator: fn _ ->
          :atomics.add(count, 1, 1)
          raise "provider secret"
        end,
        protection: [
          secret: String.duplicate("s", 64),
          namespace: Janitor.random_id("test_"),
          evaluator: [failure_threshold: 1]
        ]
      )

    {:ok, first} = Janitor.identify(c, %{"signals" => @signals})
    {:ok, next} = Janitor.identify(c, %{"signals" => @signals}, %{visitor_id: first["visitorId"]})
    assert :atomics.get(count, 1) == 1
    assert next["visitorId"] == first["visitorId"]
    assert next["riskStatus"] == "unavailable"
    assert next["risk"] == %{"automation" => 0, "suspicious" => 0}
  end

  test "sharded request quotas preserve one global maximum across concurrent callers" do
    c =
      config(
        protection: [
          secret: String.duplicate("s", 64),
          namespace: Janitor.random_id("shards_"),
          requests: [global: 21, shards: 4, window_ms: 3_600_000]
        ]
      )

    outcomes =
      1..200
      |> Task.async_stream(fn _ -> Protection.admit(c, %{}) end, max_concurrency: 5)
      |> Enum.to_list()

    assert Enum.count(outcomes, &(&1 == {:ok, :ok})) == 21
  end

  test "timeout retains a bounded lease and a new instance cannot immediately retry" do
    c =
      config(
        evaluator_timeout_ms: 10,
        protection: [
          secret: String.duplicate("s", 64),
          namespace: Janitor.random_id("test_"),
          evaluator: [max_concurrent: 1]
        ]
      )

    assert :unavailable == Protection.evaluate(c, fn -> Process.sleep(1000) end)

    assert :unavailable ==
             Protection.evaluate(c, fn ->
               %{"sameVisitor" => 1, "automation" => 0, "suspicious" => 0}
             end)
  end

  test "successful evaluations still consume the shared call budget" do
    opts = [
      secret: String.duplicate("b", 64),
      namespace: Janitor.random_id("test_"),
      evaluator: [max_calls: 1]
    ]

    a = config(protection: opts)
    b = config(protection: opts)
    result = %{"sameVisitor" => 1, "automation" => 0, "suspicious" => 0}
    assert {:ok, ^result} = Protection.evaluate(a, fn -> result end)
    assert :unavailable = Protection.evaluate(b, fn -> raise "must not execute" end)
  end

  test "only one recovery probe runs after the shared circuit cooldown" do
    c =
      config(
        protection: [
          secret: String.duplicate("b", 64),
          namespace: Janitor.random_id("test_"),
          evaluator: [failure_threshold: 1, cooldown_ms: 1000]
        ]
      )

    assert :unavailable = Protection.evaluate(c, fn -> raise "provider unavailable" end)
    Process.sleep(1050)
    owner = self()
    result = %{"sameVisitor" => 1, "automation" => 0, "suspicious" => 0}

    task =
      Task.async(fn ->
        Protection.evaluate(c, fn ->
          send(owner, {:probe, self()})
          receive do: (:continue -> result)
        end)
      end)

    assert_receive {:probe, probe}, 1000
    assert :unavailable = Protection.evaluate(c, fn -> raise "second probe must not execute" end)
    send(probe, :continue)
    assert {:ok, ^result} = Task.await(task)
    assert {:ok, ^result} = Protection.evaluate(c, fn -> result end)
  end

  test "Plug limits only measurement and returns no scores" do
    c =
      config(
        protection: [
          secret: String.duplicate("s", 64),
          namespace: Janitor.random_id("test_"),
          requests: [global: 1]
        ]
      )

    req = fn ->
      conn(:post, "https://app.test/api/visitor", Jason.encode!(%{"signals" => @signals}))
      |> put_req_header("content-type", "application/json")
    end

    assert Janitor.handle(req.(), c).status == 200
    denied = Janitor.handle(req.(), c)
    assert denied.status == 429
    assert get_resp_header(denied, "retry-after") == ["60"]
    refute denied.resp_body =~ "risk"
  end

  test "a stolen cookie cannot replace history with a contradictory device" do
    c = config()
    {:ok, first} = Janitor.identify(c, %{"signals" => @signals})
    before = Storage.history(c, first["visitorId"])

    for _ <- 1..6 do
      {:ok, copied} =
        Janitor.identify(
          c,
          %{"signals" => %{"platform" => "Android", "hardware" => %{"maxTouchPoints" => 5}}},
          %{visitor_id: first["visitorId"]}
        )

      assert copied["visitorId"] == first["visitorId"]
    end

    assert Storage.history(c, first["visitorId"]) == before
  end
end
