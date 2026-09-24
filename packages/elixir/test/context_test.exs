defmodule Doorman.ContextTest do
  use ExUnit.Case, async: false
  import Plug.Test
  import Plug.Conn

  @signals File.read!(Path.expand("../priv/conformance.json", __DIR__))
           |> Jason.decode!()
           |> Map.fetch!("vectors")
           |> hd()
           |> Map.fetch!("raw")
  setup do
    Ecto.Adapters.SQL.query!(
      Doorman.TestRepo,
      "TRUNCATE doorman_test.visitors,doorman_test.identity_subjects,doorman_test.learning_sessions,doorman_test.evaluation_controls,doorman_test.protection_quotas CASCADE",
      []
    )

    Req.Test.set_req_test_to_shared()

    c =
      Doorman.new(
        repo: Doorman.TestRepo,
        prefix: "doorman_test",
        environment: :test,
        secret: String.duplicate("a", 64),
        namespace: "context"
      )

    {:ok, c: c}
  end

  defp req(cookie \\ "", body \\ %{"signals" => @signals}),
    do:
      conn(:post, "https://app.test/api/visitor", Jason.encode!(body))
      |> put_req_header("content-type", "application/json")
      |> put_req_header("cookie", cookie)

  defp cookie(conn),
    do: Enum.map_join(conn.resp_cookies, "; ", fn {name, value} -> name <> "=" <> value.value end)

  test "shared browser context stays private and missing-cookie matches do not merge", %{c: c} do
    first = Doorman.handle(req(), c, %{auth: %{user_id: "alice", account_id: "home"}})
    assert first.status == 200
    assert first.assigns.doorman_context["status"] == "authenticated"
    retained = cookie(first)
    next = Doorman.handle(req(retained), c)
    assert next.assigns.doorman_context["status"] == "remembered"

    assert get_in(next.assigns.doorman_identity, ["attribution", "subject", "status"]) ==
             "unknown"

    assert Map.keys(Jason.decode!(next.resp_body)) |> Enum.sort() ==
             ~w(isReturning sessionId visitorId)

    second = Doorman.handle(req(retained), c, %{auth: %{user_id: "bob", account_id: "home"}})
    assert second.status == 200
    shared = Doorman.handle(req(retained), c)
    assert shared.assigns.doorman_context["status"] == "ambiguous"
    assert length(shared.assigns.doorman_context["candidates"]) == 2
    assert is_nil(shared.assigns.doorman_properties["doorman_candidate_subject_id"])
    lost = Doorman.handle(req(), c)

    assert lost.assigns.doorman_identity["visitorId"] !=
             first.assigns.doorman_identity["visitorId"]

    assert lost.assigns.doorman_context["basis"] == "browser-similarity"
    Doorman.forget_user(c, "alice")
    assert length(Doorman.handle(req(retained), c).assigns.doorman_context["candidates"]) == 1
    Doorman.delete_visitor(c, first.assigns.doorman_identity["visitorId"])
    assert Doorman.Storage.query(c, "SELECT * FROM doorman_test.browser_associations", []) == []
  end

  test "private server risk reaches only risk questions", %{c: c} do
    risk = %{
      "activity" => %{
        "requests" => 50,
        "denials" => 40,
        "authenticationFailures" => 20,
        "windowMs" => 60000
      }
    }

    send_to = self()

    evaluator = fn input ->
      send(send_to, {:evaluated, input})
      %{"sameVisitor" => 0.0, "automation" => 0.3, "suspicious" => 0.8}
    end

    response = Doorman.handle(req(), %{c | evaluator: evaluator}, %{risk_evidence: risk})
    assert response.status == 200
    assert_receive {:evaluated, input}
    assert input["riskEvidence"] == risk
    refute Map.has_key?(Doorman.Jev.input(input)["state"], "serverEvidence")
    assert Doorman.Jev.risk_input(input["current"], risk)["state"]["serverEvidence"] == risk
    refute String.contains?(response.resp_body, "suspicious")

    assert Doorman.handle(req("", %{"signals" => @signals, "auth" => %{"userId" => "forged"}}), c).status ==
             400
  end

  test "operator scores require activity evidence and remain private", %{c: c} do
    evaluate = fn _ ->
      %{
        "sameVisitor" => 0.9,
        "automation" => 0.7,
        "suspicious" => 0.1,
        "operator" => %{"human" => 0.1, "assistant" => 0.9, "automation" => 0.2}
      }
    end

    c = %{c | evaluator: evaluate}
    first = Doorman.handle(req(), c)

    assert get_in(first.assigns.doorman_identity, ["operator", "status"]) ==
             "insufficient-evidence"

    second =
      Doorman.handle(req(cookie(first)), c, %{
        risk_evidence: %{
          "activity" => %{
            "requests" => 40,
            "denials" => 0,
            "authenticationFailures" => 0,
            "windowMs" => 60000
          }
        }
      })

    assert second.assigns.doorman_properties["doorman_operator_label"] == "assistant"
    assert second.assigns.doorman_properties["doorman_assistant_score"] == 0.9
    refute String.contains?(second.resp_body, "assistant")
    assert Map.has_key?(Doorman.Jev.risk_input(%{}, nil, true)["questions"], "assistant")
  end

  test "reputation cache and budget survive new configs; raw IP never persists", %{c: c} do
    Req.Test.stub(Doorman.ContextTest, fn conn ->
      assert conn.request_path == "/api/v2/check"
      assert conn.method == "GET"

      Req.Test.json(conn, %{
        "data" => %{
          "ipAddress" => "8.8.8.8",
          "isPublic" => true,
          "abuseConfidenceScore" => 80,
          "totalReports" => 4
        }
      })
    end)

    options =
      Doorman.Reputation.configure(
        [
          api_key: "test",
          max_requests_per_hour: 1,
          req_options: [plug: {Req.Test, Doorman.ContextTest}]
        ],
        c.identity
      )

    c = %{c | reputation: options}
    assert Doorman.Reputation.check(c, "8.8.8.8")["score"] == 0.8
    assert Doorman.Reputation.check(c, "8.8.8.8")["cached"] == true
    assert Doorman.Reputation.check(c, "1.1.1.1")["status"] == "limited"
    assert Doorman.Reputation.check(c, "127.0.0.1")["status"] == "not-requested"

    records =
      Doorman.Storage.query(c, "SELECT record FROM doorman_test.evaluation_controls", [])
      |> Jason.encode!()

    refute String.contains?(records, "8.8.8.8")
    refute String.contains?(records, "test")
  end
end
