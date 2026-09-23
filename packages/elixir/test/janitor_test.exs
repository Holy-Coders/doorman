defmodule JanitorTest do
  use ExUnit.Case, async: false
  import Plug.Test
  import Plug.Conn
  alias Janitor.{Observation, Identity, Learning, Analytics}
  @fixtures File.read!(Path.expand("../priv/conformance.json", __DIR__)) |> Jason.decode!()
  @signals hd(@fixtures["vectors"])["raw"]
  setup do
    Ecto.Adapters.SQL.query!(
      Janitor.TestRepo,
      "TRUNCATE janitor_test.visitors, janitor_test.identity_subjects, janitor_test.learning_sessions CASCADE",
      [],
      log: false
    )

    Req.Test.set_req_test_to_shared()
    {:ok, c: config()}
  end

  defp config(extra \\ []),
    do:
      Janitor.new(
        Keyword.merge([repo: Janitor.TestRepo, prefix: "janitor_test", environment: :test], extra)
      )

  defp req(signals \\ @signals, cookie \\ "", extra \\ %{}),
    do:
      conn(
        :post,
        "https://app.test/api/visitor",
        Jason.encode!(Map.merge(%{"signals" => signals}, extra))
      )
      |> put_req_header("content-type", "application/json")
      |> put_req_header("cookie", cookie)

  defp body(conn), do: Jason.decode!(conn.resp_body)

  defp learning_cookie(conn),
    do: "__visitor_learning=" <> conn.resp_cookies["__visitor_learning"].value

  defp with_identity(opts \\ []),
    do:
      config(
        Keyword.merge([identity: [secret: String.duplicate("s", 64), namespace: "test"]], opts)
      )

  for {vector, index} <- Enum.with_index(@fixtures["vectors"]) do
    @vector vector
    test "TypeScript normalization and matching conformance #{index}" do
      v = @vector
      assert Observation.normalize(v["raw"]) == v["normalized"]
      actual = Observation.similarity(@fixtures["reference"], v["normalized"])
      assert actual["features"] == v["similarity"]["features"]
      assert_in_delta actual["score"], v["similarity"]["score"], 1.0e-12

      assert_in_delta Observation.evidence_cap(@fixtures["reference"], v["normalized"]),
                      v["cap"],
                      1.0e-12

      assert Observation.contradiction?(@fixtures["reference"], v["normalized"]) ==
               v["contradiction"]
    end
  end

  test "HMAC subjects and Jev request agree with TypeScript" do
    for item <- @fixtures["subjects"],
        do:
          assert(
            Identity.label([secret: item["secret"], namespace: item["namespace"]], item["id"]) ==
              item["expected"]
          )

    assert Janitor.Jev.input(%{
             "history" => [@fixtures["reference"]],
             "current" => @fixtures["reference"],
             "deterministicSimilarity" => 1
           }) == @fixtures["jev"]
  end

  test "cookie and cookieless paths restore a retained visitor", %{c: c} do
    first = Janitor.handle(req(), c)
    assert first.status == 200
    id = body(first)["visitorId"]
    assert %{"isReturning" => false, "riskStatus" => "disabled"} = body(first)
    assert first.resp_cookies["__visitor"].http_only
    assert first.resp_cookies["__visitor"].secure

    for cookie <- ["__visitor=" <> id, ""],
        do:
          assert(
            %{"visitorId" => ^id, "isReturning" => true} =
              body(Janitor.handle(req(@signals, cookie), c))
          )

    Janitor.delete_visitor(c, id)
    refute body(Janitor.handle(req(@signals, "__visitor=" <> id), c))["isReturning"]
  end

  test "contradictions and sparse evidence cannot be amplified by Jev" do
    c = config(evaluator: fn _ -> %{"sameVisitor" => 1, "automation" => 0, "suspicious" => 0} end)
    first = body(Janitor.handle(req(), c))
    other = body(Janitor.handle(req(Enum.at(@fixtures["vectors"], 6)["raw"]), c))
    refute first["visitorId"] == other["visitorId"]
    refute body(Janitor.handle(req(%{}), c))["isReturning"]
  end

  test "ambiguity does not restore an arbitrary device", %{c: c} do
    for _ <- 1..2 do
      id = Janitor.Storage.create(c)
      Janitor.Storage.save(c, id, Observation.normalize(@signals))
    end

    refute body(Janitor.handle(req(), c))["isReturning"]
  end

  defp failing_evaluator(:timeout), do: Process.sleep(500)
  defp failing_evaluator(:throw), do: raise("private detail")
  defp failing_evaluator(:malformed), do: %{"sameVisitor" => 2}

  for mode <- [:timeout, :throw, :malformed] do
    test "evaluator #{mode} falls back" do
      mode = unquote(mode)

      c =
        config(
          evaluator_timeout_ms: 10,
          evaluator: fn _ -> failing_evaluator(mode) end
        )

      result = body(Janitor.handle(req(), c))
      assert result["riskStatus"] == "unavailable"
      assert result["risk"] == %{"automation" => 0, "suspicious" => 0}
    end
  end

  test "typed Jev requests follow the documented API" do
    parent = self()

    Req.Test.stub(:jev, fn conn ->
      {:ok, raw, conn} = read_body(conn)

      send(
        parent,
        {:jev, conn.request_path, get_req_header(conn, "authorization"), Jason.decode!(raw)}
      )

      Req.Test.json(conn, %{
        answers: %{
          sameVisitor: %{type: "noul", noul: 0.98},
          automation: %{type: "noul", noul: 0.8},
          suspicious: %{type: "noul", noul: 0.1}
        }
      })
    end)

    c = config(evaluator: [api_key: "test", request_options: [plug: {Req.Test, :jev}]])
    result = body(Janitor.handle(req(), c))
    assert result["riskStatus"] == "evaluated"
    assert result["risk"]["automation"] == 0.8
    assert_receive {:jev, "/v1/systemone", ["Bearer test"], payload}
    assert payload["model"] == "jev-latest"
  end

  test "HTTP boundary rejects claims, size abuse and foreign origins", %{c: c} do
    for extra <- [%{"verified" => %{}}, %{"learningConsent" => true}, %{"subjectId" => "someone"}],
        do: assert(Janitor.handle(req(@signals, "", extra), c).status == 400)

    assert Janitor.handle(req(%{"userAgent" => String.duplicate("x", 513)}), c).status == 400
    assert Janitor.handle(req(%{"userAgent" => String.duplicate("x", 17000)}), c).status == 413
    assert Janitor.handle(put_req_header(req(), "origin", "https://evil.test"), c).status == 403
    assert Janitor.handle(conn(:get, "/api/visitor"), c).status == 405
    assert Janitor.handle(req(), %{c | prefix: "missing_schema"}).status == 503
    assert get_resp_header(Janitor.handle(req(), c), "cache-control") == ["private, no-store"]
  end

  test "verified keys and scoped delegation" do
    c = with_identity()
    owner = Identity.identify_user(c, "account-1")
    agent = Identity.update_subject(c, %{id: "assistant-1", kind: :agent})
    email = %{type: :email, issuer: "app", value: "Aaron@EXAMPLE.COM"}
    assert :ok == Identity.add_verified_key(c, owner["id"], email)
    assert Identity.find_subject(c, %{email | value: "Aaron@example.com"}) == owner
    assert_raise ArgumentError, fn -> Identity.add_verified_key(c, agent["id"], email) end

    grant =
      Identity.create_delegation(c, %{
        principal_id: owner["id"],
        actor_id: agent["id"],
        audience: "open-calls",
        scopes: ["calls:read"],
        expires_at: Janitor.now() + 60000
      })

    ctx = %{
      subject_id: owner["id"],
      actor_id: agent["id"],
      delegation_id: grant["id"],
      audience: "open-calls",
      required_scopes: ["calls:read"]
    }

    result = body(Janitor.handle(req(), c, %{verified: ctx}))
    assert result["attribution"]["actor"]["kind"] == "agent"
    assert result["attribution"]["delegation"]["status"] == "valid"

    assert Identity.assess(c, %{ctx | required_scopes: ["calls:write"]})["delegation"]["reason"] ==
             "scope"

    Identity.revoke_delegation(c, grant["id"])
    assert Identity.assess(c, ctx)["delegation"]["reason"] == "revoked"
    Identity.delete_subject(c, owner["id"])
    assert Identity.find_subject(c, email) == nil
  end

  test "implementer chooses application or per-request collection policy" do
    c = with_identity(learning: [enabled: true])
    assert Janitor.handle(req(), c).resp_cookies["__visitor_learning"] == nil
    c = %{c | learning: [enabled: true, collection_policy: :application]}
    anon = Janitor.handle(req(), c)
    assert anon.resp_cookies["__visitor_learning"].value =~ "ses_"
    person = Identity.identify_user(c, "account")
    ctx = %{verified: %{subject_id: person["id"], actor_id: person["id"]}}

    login =
      Janitor.handle(
        req(Map.put(@signals, "timezone", "Europe/London"), learning_cookie(anon)),
        c,
        ctx
      )

    assert login.resp_cookies["__visitor_learning"].max_age == 0

    assert [%{"observation" => %{"timezone" => "Asia/Jerusalem"}, "subjectId" => subject}] =
             Learning.reports(c)

    assert subject == person["id"]

    assert Janitor.handle(req(@signals, learning_cookie(anon)), c, %{learning_consent: false}).status ==
             200

    assert Learning.reports(c) == []
  end

  test "conflicting verified accounts never become learning examples" do
    c = with_identity(learning: [enabled: true, collection_policy: :application])
    first = Janitor.handle(req(), c)
    assert Learning.reports(c) == []

    for id <- ~w(one two) do
      person = Identity.identify_user(c, id)

      assert Janitor.handle(req(@signals, learning_cookie(first)), c, %{
               verified: %{subject_id: person["id"], actor_id: person["id"]}
             }).status == 200
    end

    assert Learning.reports(c) == []
    assert :ok == Janitor.cleanup(c)
  end

  test "shadow predictions stay private and are removed from predictor evidence" do
    predict = fn %{examples: examples} ->
      refute(Map.has_key?(hd(examples), "prediction"))
      %{subject_id: hd(examples)["subjectId"], score: 0.8}
    end

    c =
      with_identity(
        learning: [
          enabled: true,
          collection_policy: :application,
          mode: :shadow,
          predict: predict
        ]
      )

    person = Identity.identify_user(c, "person")
    ctx = %{verified: %{subject_id: person["id"], actor_id: person["id"]}}
    first = Janitor.handle(req(), c)
    Janitor.handle(req(@signals, learning_cookie(first)), c, ctx)
    second = Janitor.handle(req(), c)
    refute second.resp_body =~ person["id"]
    Janitor.handle(req(@signals, learning_cookie(second)), c, ctx)
    assert Enum.any?(Learning.reports(c), &(&1["prediction"]["status"] == "suggested"))
    Identity.delete_subject(c, person["id"])
    assert Learning.reports(c) == []
  end

  for provider <- [:posthog, :mixpanel] do
    test "#{provider} exports allowlisted evidence and explicit profile updates", %{c: c} do
      parent = self()
      provider = unquote(provider)

      Req.Test.stub(provider, fn conn ->
        {:ok, raw, conn} = read_body(conn)
        send(parent, {:analytics, conn.request_path, Jason.decode!(raw)})
        Req.Test.json(conn, %{status: 1})
      end)

      opts = [api_key: "test", token: "test", request_options: [plug: {Req.Test, provider}]]

      identity =
        body(Janitor.handle(req(), c)) |> Map.put("debug", %{"collectedSignals" => @signals})

      assert :ok == Analytics.capture(provider, identity, "account-123", opts)
      assert_receive {:analytics, _, payload}
      refute Jason.encode!(payload) =~ "Mozilla"
      refute Jason.encode!(payload) =~ "collectedSignals"

      assert :ok ==
               Analytics.identify_user(
                 provider,
                 "account-123",
                 %{"email" => "a@example.test", "plan" => "pro", "password" => "never"},
                 opts
               )

      assert_receive {:analytics, _, payload}
      assert Jason.encode!(payload) =~ "a@example.test"
      refute Jason.encode!(payload) =~ "password"
    end
  end

  test "candidate lookup, history and retention remain bounded", %{c: c} do
    observation = Observation.normalize(@signals)

    for _ <- 1..15 do
      id = Janitor.Storage.create(c)
      Janitor.Storage.save(c, id, observation)
    end

    candidates = Janitor.Storage.candidates(c, observation)
    assert length(candidates) == 10
    assert Janitor.Storage.candidates(c, %{}) == []
    id = hd(candidates)["visitor_id"]
    for _ <- 1..15, do: Janitor.Storage.save(c, id, observation)
    assert length(Janitor.Storage.history(c, id)) == 5

    assert [%{"n" => 10}] =
             Janitor.Storage.query(
               c,
               "SELECT COUNT(*) AS n FROM janitor_test.observations WHERE visitor_id=$1",
               [id]
             )

    Janitor.Storage.query(
      c,
      "UPDATE janitor_test.observations SET seen_at=0 WHERE visitor_id=$1",
      [id]
    )

    assert Janitor.Storage.history(c, id) == []
    Janitor.cleanup(c)

    assert [%{"n" => 0}] =
             Janitor.Storage.query(
               c,
               "SELECT COUNT(*) AS n FROM janitor_test.observations WHERE visitor_id=$1",
               [id]
             )
  end

  test "provider body limits, HTTP failures and analytics rejection are controlled" do
    Req.Test.stub(:too_big, fn conn ->
      conn
      |> put_resp_content_type("application/json")
      |> send_resp(200, String.duplicate("x", 65_537))
    end)

    c = config(evaluator: [api_key: "test", request_options: [plug: {Req.Test, :too_big}]])
    assert body(Janitor.handle(req(), c))["riskStatus"] == "unavailable"
    Req.Test.stub(:server_error, fn conn -> send_resp(conn, 500, "private error") end)
    c = config(evaluator: [api_key: "test", request_options: [plug: {Req.Test, :server_error}]])
    assert body(Janitor.handle(req(), c))["riskStatus"] == "unavailable"
    Req.Test.stub(:rejected, fn conn -> Req.Test.json(conn, %{"status" => 0}) end)

    assert {:error, :rejected} ==
             Analytics.capture(:mixpanel, body(Janitor.handle(req(), config())), "account",
               token: "test",
               request_options: [plug: {Req.Test, :rejected}]
             )
  end

  test "learning does not label unknown, delegated or agent actors" do
    c = with_identity(learning: [enabled: true, collection_policy: :application])
    owner = Identity.identify_user(c, "owner")
    family = Identity.identify_user(c, "family")
    agent = Identity.update_subject(c, %{id: "agent", kind: :agent})

    for actor <- [nil, family["id"], agent["id"]] do
      anon = Janitor.handle(req(), c)

      Janitor.handle(req(@signals, learning_cookie(anon)), c, %{
        verified: %{subject_id: owner["id"], actor_id: actor}
      })
    end

    assert Learning.reports(c) == []
  end

  test "production debug gates and telemetry exceptions cannot leak or break identity" do
    assert_raise ArgumentError, fn -> config(environment: :production, debug: true) end
    assert_raise ArgumentError, fn -> config(environment: :production, secure_cookie: false) end
    c = config(on_metrics: fn _ -> throw(:failed_logger) end)
    assert Janitor.handle(req(), c).status == 200
    refute Map.has_key?(body(Janitor.handle(req(@signals, "", %{"debug" => true}), c)), "debug")
  end
end
