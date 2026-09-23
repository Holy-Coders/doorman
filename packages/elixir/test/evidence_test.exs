defmodule Janitor.EvidenceTest do
  use ExUnit.Case, async: false
  import Plug.Test
  import Plug.Conn
  alias Janitor.{Evidence, Identity, Storage}
  @fixtures File.read!(Path.expand("../priv/conformance.json", __DIR__)) |> Jason.decode!()
  @signals hd(@fixtures["vectors"])["raw"]

  test "cross-language evidence and protection labels agree" do
    options = [secret: String.duplicate("a", 64), namespace: "fixture"]

    for item <- @fixtures["evidenceLabels"] do
      assert Identity.label(
               options,
               Jason.encode!(["evidence-v1", item["purpose"], item["value"]])
             ) == item["expected"]
    end

    for item <- @fixtures["protectionLabels"] do
      assert Identity.label(options, Jason.encode!(["protection-v1", item["value"]])) ==
               item["expected"]
    end
  end

  setup do
    c =
      Janitor.new(
        repo: Janitor.TestRepo,
        prefix: "janitor_test",
        environment: :test,
        evidence: true,
        identity: [secret: String.duplicate("e", 64), namespace: Janitor.random_id("evidence_")]
      )

    subject = Identity.identify_user(c, "user-a")
    other = Identity.identify_user(c, "user-b")
    {:ok, c: c, subject: subject, other: other, visitor: Storage.create(c)}
  end

  defp proof(subject, visitor, id) do
    now = Janitor.now()

    %{
      subject_id: subject["id"],
      visitor_id: visitor,
      expires_at: now + 60_000,
      verification: %{method: "passkey", issuer: "app-auth", event_id: id, verified_at: now}
    }
  end

  test "concurrent duplicate events count once, and conflicting delivery fails", %{
    c: c,
    subject: s,
    other: other
  } do
    event = %{
      id: "private-event",
      type: "login-failure",
      subject_id: s["id"],
      session_id: "private-session",
      action: "sign-in"
    }

    outcomes =
      1..12
      |> Task.async_stream(fn _ -> Evidence.record(c, event) end, max_concurrency: 5)
      |> Enum.to_list()

    assert Enum.count(outcomes, &(&1 == {:ok, %{"recorded" => true}})) == 1

    assert %{"total" => 1, "counts" => %{"login-failure" => 1}, "saturated" => false} =
             Evidence.velocity(c, %{subject_id: s["id"]})

    assert %{"total" => 1} = Evidence.velocity(c, %{session_id: "private-session"})
    assert_raise ArgumentError, fn -> Evidence.record(c, %{event | subject_id: other["id"]}) end

    rows =
      Storage.query(
        c,
        "SELECT record FROM #{Storage.table(c, "application_events")} WHERE subject_id=$1",
        [s["id"]]
      )

    refute Jason.encode!(rows) =~ "private-event"
    refute Jason.encode!(rows) =~ "private-session"
  end

  test "bounded account, actor and action activity reports saturation", %{
    c: c,
    subject: s,
    other: other
  } do
    c = %{c | evidence: %{c.evidence | max_events_per_query: 2}}

    for n <- 1..5,
        do:
          Evidence.record(c, %{
            id: "event-#{n}",
            type: "sensitive-action",
            action: "payment",
            subject_id: s["id"],
            actor_id: other["id"]
          })

    Evidence.record(c, %{
      id: "read",
      type: "sensitive-action",
      action: "read",
      subject_id: s["id"]
    })

    assert %{"total" => 2, "saturated" => true} =
             Evidence.velocity(c, %{subject_id: s["id"], action: "payment"})

    assert %{"total" => 2, "saturated" => true} = Evidence.velocity(c, %{actor_id: other["id"]})

    assert %{"total" => 1, "saturated" => false} =
             Evidence.velocity(c, %{subject_id: s["id"], action: "read"})

    separate = %{c | identity: Keyword.put(c.identity, :namespace, "another")}
    assert %{"total" => 0} = Evidence.velocity(separate, %{subject_id: s["id"]})
  end

  test "verified associations preserve provenance, shared accounts and irreversible revocation",
       %{c: c, subject: s, other: other, visitor: visitor} do
    input = proof(s, visitor, "proof-a")
    link = Evidence.link_device(c, input)
    assert Evidence.link_device(c, input) == link

    assert_raise ArgumentError, fn ->
      Evidence.link_device(c, %{input | subject_id: other["id"]})
    end

    other_link = Evidence.link_device(c, proof(other, visitor, "proof-b"))
    refute other_link["id"] == link["id"]
    expected = %{id: link["id"], subject_id: s["id"], visitor_id: visitor}
    assert %{"status" => "verified-association"} = Evidence.assess_device(c, expected)

    assert %{"reason" => "subject"} =
             Evidence.assess_device(c, %{expected | subject_id: other["id"]})

    Evidence.revoke_device(c, link["id"], %{
      reason: "compromised",
      issuer: "security",
      event_id: "revocation-a"
    })

    Evidence.revoke_device(c, link["id"], %{
      reason: "logout",
      issuer: "later",
      event_id: "revocation-b"
    })

    assert %{"status" => "invalid", "reason" => "revoked"} = Evidence.assess_device(c, expected)
    assert Evidence.link_device(c, input)["revocation"]["issuer"] == "security"
    assert length(Evidence.list_devices(c, s["id"])) == 1
    stale = put_in(input, [:verification, :verified_at], Janitor.now() - 301_000)
    assert_raise ArgumentError, fn -> Evidence.link_device(c, stale) end
  end

  test "event and link erasure follows account and visitor deletion", %{
    c: c,
    subject: s,
    visitor: visitor
  } do
    Evidence.record(c, %{id: "a", type: "login-success", subject_id: s["id"], session_id: "a"})
    Evidence.record(c, %{id: "b", type: "login-success", subject_id: s["id"], session_id: "b"})
    Evidence.delete_session(c, "a")
    assert %{"total" => 1} = Evidence.velocity(c, %{subject_id: s["id"]})
    Evidence.link_device(c, proof(s, visitor, "proof"))
    Identity.delete_subject(c, s["id"])
    assert %{"total" => 0} = Evidence.velocity(c, %{session_id: "b"})
    assert Evidence.list_devices(c, s["id"]) == []
  end

  test "private request evidence is separate from public scores and rejects spoofed body fields",
       %{c: c} do
    c = %{c | expose_client_scores: true}

    context = %{
      evidence: %{
        edge: %{
          source: :edge,
          provider: :cloudflare,
          observed_at: Janitor.now(),
          bot_score: 5,
          signed_agent: true
        },
        authentication: %{method: "mfa", verified_at: Janitor.now()},
        action: "payment"
      }
    }

    req = fn body ->
      conn(:post, "https://app.test/api/visitor", Jason.encode!(body))
      |> put_req_header("content-type", "application/json")
      |> put_req_header("cf-bot-score", "99")
    end

    conn = Janitor.handle(req.(%{"signals" => @signals}), c, context)
    assert conn.status == 200
    assert conn.assigns.janitor_evidence["edge"]["botScore"] == 5
    refute conn.resp_body =~ "botScore"
    refute conn.resp_body =~ "payment"
    assert Janitor.handle(req.(%{"signals" => @signals, "evidence" => %{}}), c).status == 400
    default = Janitor.handle(req.(%{"signals" => @signals}), c)

    assert default.assigns.janitor_evidence == %{
             "client" => %{"source" => "browser", "authenticated" => false}
           }

    stale = put_in(context, [:evidence, :edge, :observed_at], Janitor.now() - 61_000)
    assert Janitor.handle(req.(%{"signals" => @signals}), c, stale).status == 503
  end

  test "rejects arbitrary data, ambiguous keys, overlarge windows and invalid provenance", %{
    c: c,
    subject: s
  } do
    assert_raise ArgumentError, fn ->
      Evidence.record(c, %{
        id: "bad",
        type: "login-attempt",
        subject_id: s["id"],
        password: "do-not-store"
      })
    end

    assert_raise ArgumentError, fn ->
      Evidence.velocity(c, %{subject_id: s["id"], session_id: "also"})
    end

    assert_raise ArgumentError, fn ->
      Evidence.velocity(c, %{subject_id: s["id"], window_ms: 86_400_001})
    end

    assert_raise ArgumentError, fn ->
      Evidence.request_evidence(%{
        edge: %{source: :browser, provider: :cloudflare, observed_at: Janitor.now()}
      })
    end
  end
end
