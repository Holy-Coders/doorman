defmodule Janitor.AnalyticsTest do
  use ExUnit.Case, async: false
  import Plug.Conn
  alias Janitor.Analytics

  setup do
    Req.Test.set_req_test_to_shared()
    :ok
  end

  defp unpack(:posthog, payload),
    do:
      {payload["distinct_id"], payload["properties"],
       get_in(payload, ["properties", "$groups", "account"])}

  defp unpack(:mixpanel, [event]) do
    assert event["properties"]["$user_id"] == "agent:a"
    {event["properties"]["distinct_id"], event["properties"], event["properties"]["account"]}
  end

  defp identity do
    %{
      "visitorId" => "vis_" <> String.duplicate("a", 48),
      "confidence" => 0.98,
      "isReturning" => true,
      "risk" => %{"automation" => 0.01, "suspicious" => 0.01},
      "riskStatus" => "evaluated",
      "attribution" => %{
        "subject" => %{"status" => "verified", "id" => "sub_" <> String.duplicate("b", 64)},
        "actor" => %{
          "id" => "sub_" <> String.duplicate("c", 64),
          "kind" => "agent",
          "basis" => "verified-credential"
        },
        "delegation" => %{"status" => "none"}
      },
      "debug" => %{"collectedSignals" => "private"}
    }
  end

  test "low risk never manufactures a verified person or an account" do
    props = identity() |> Map.delete("attribution") |> Analytics.properties()
    assert props["janitor_actor_kind"] == "unknown"
    refute Map.has_key?(props, "janitor_actor_id")
    refute Map.has_key?(props, "janitor_account_id")
    refute Map.has_key?(props, "debug")
  end

  test "server agents have attribution without manufactured browser or risk evidence" do
    props =
      Analytics.properties(%{"attribution" => identity()["attribution"]}, %{
        account_id: "account-a"
      })

    assert props["janitor_actor_kind"] == "agent"
    assert props["janitor_account_id"] == "account-a"

    for key <- ~w(janitor_visitor_id janitor_confidence janitor_automation janitor_risk_status),
        do: refute(Map.has_key?(props, key))
  end

  test "API assessments export only summary scalars and keep browser confidence separate" do
    api = %{
      "riskStatus" => "evaluated",
      "risk" => %{"automation" => 0.9, "suspicious" => 0.1},
      "evaluatedAt" => 100,
      "expiresAt" => 200,
      "cached" => false,
      "summary" => %{
        "windowMs" => 60000,
        "truncated" => false,
        "buckets" => [%{"route" => "GET /private/:id", "requests" => 10}]
      }
    }

    input = %{"attribution" => identity()["attribution"], "apiActivity" => api}
    props = Analytics.properties(input)
    assert props["janitor_api_automation"] == 0.9
    assert props["janitor_api_requests"] == 10
    assert props["janitor_actor_kind"] == "agent"
    refute Map.has_key?(props, "janitor_visitor_id")
    refute Map.has_key?(props, "janitor_confidence")
    refute Jason.encode!(props) =~ "/private"

    unavailable =
      put_in(input, ["apiActivity", "riskStatus"], "unavailable") |> Analytics.properties()

    refute Map.has_key?(unavailable, "janitor_api_automation")
  end

  for provider <- [:posthog, :mixpanel] do
    test "#{provider} keeps the actor ID separate from changing account groups" do
      provider = unquote(provider)
      parent = self()

      Req.Test.stub(provider, fn conn ->
        {:ok, body, conn} = read_body(conn)
        send(parent, {:payload, Jason.decode!(body)})
        Req.Test.json(conn, %{status: 1})
      end)

      opts = [
        token: "test",
        api_key: "test",
        account_group: "account",
        request_options: [plug: {Req.Test, provider}]
      ]

      for account <- ["account-a", "account-b", nil] do
        assert :ok ==
                 Analytics.capture(
                   provider,
                   identity(),
                   "agent:a",
                   Keyword.put(opts, :account_id, account)
                 )

        assert_receive {:payload, payload}

        {distinct_id, props, group} = unpack(provider, payload)

        assert props["janitor_actor_kind"] == "agent"
        assert props["janitor_actor_basis"] == "verified-credential"
        assert props["janitor_actor_id"] == identity()["attribution"]["actor"]["id"]
        assert props["janitor_account_id"] == account

        assert distinct_id == "agent:a"
        assert group == account

        refute Jason.encode!(payload) =~ "private"
      end

      assert {:error, :unavailable} ==
               Analytics.capture(
                 provider,
                 identity(),
                 "a",
                 Keyword.put(opts, :account_group, "janitor_actor_kind")
               )
    end
  end

  test "original Mixpanel mode omits the simplified user property" do
    parent = self()

    Req.Test.stub(:original, fn conn ->
      {:ok, body, conn} = read_body(conn)
      send(parent, {:payload, Jason.decode!(body)})
      Req.Test.json(conn, %{status: 1})
    end)

    assert :ok ==
             Analytics.capture(:mixpanel, identity(), "user:a",
               token: "test",
               identity_merge: :original,
               request_options: [plug: {Req.Test, :original}]
             )

    assert_receive {:payload, [event]}
    refute Map.has_key?(event["properties"], "$user_id")
  end

  test "Amplitude and RudderStack use explicit provider payloads and no raw observations" do
    for provider <- [:amplitude, :rudderstack] do
      Req.Test.stub(__MODULE__, fn conn ->
        {:ok, raw, conn} = read_body(conn)
        body = Jason.decode!(raw)
        refute raw =~ "private"

        if provider == :amplitude do
          assert conn.request_path == "/2/httpapi"
          assert hd(body["events"])["user_id"] == "agent:a"
          assert hd(body["events"])["ip"] == "0.0.0.0"
          Req.Test.json(conn, %{"code" => 200})
        else
          assert conn.request_path == "/v1/track"

          assert get_req_header(conn, "authorization") == [
                   "Basic " <> Base.encode64("test-write:")
                 ]

          assert body["userId"] == "agent:a"
          assert body["properties"]["janitor_account_id"] == "account-a"
          send_resp(conn, 200, "OK")
        end
      end)

      assert :ok ==
               Analytics.capture(provider, identity(), "agent:a",
                 host: "https://analytics.example",
                 api_key: "test-key",
                 write_key: "test-write",
                 account_id: "account-a",
                 request_options: [plug: {Req.Test, __MODULE__}]
               )
    end
  end

  test "warehouse rows are stable scalar JSONL and omit private or injected data" do
    row =
      Janitor.Warehouse.event(identity(), "agent:a",
        event_id: "event-a",
        occurred_at: ~U[2026-09-23 00:00:00.000Z],
        account_id: "account-a"
      )

    line = row |> Map.put("debug", %{"signals" => "private"}) |> Janitor.Warehouse.encode()
    assert String.ends_with?(line, "\n")
    assert Jason.decode!(line)["event_id"] == "event-a"
    refute line =~ "private"
    assert_raise ArgumentError, fn -> Janitor.Warehouse.encode(%{"janitor_account_id" => %{}}) end
  end
end
