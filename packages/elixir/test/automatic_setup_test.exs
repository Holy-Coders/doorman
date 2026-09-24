defmodule Doorman.AutomaticSetupTest do
  use ExUnit.Case, async: false
  alias Doorman.TestRepo

  test "an empty schema initializes concurrently and keeps remembered identity" do
    prefix = Doorman.random_id("auto_")

    c =
      Doorman.new(
        repo: TestRepo,
        prefix: prefix,
        secret: String.duplicate("s", 32),
        namespace: "auto-test"
      )

    on_exit(fn ->
      Ecto.Adapters.SQL.query!(TestRepo, ~s(DROP SCHEMA IF EXISTS "#{prefix}" CASCADE), [],
        log: false
      )
    end)

    assert Enum.all?(
             1..6 |> Task.async_stream(fn _ -> Doorman.ready(c) end) |> Enum.to_list(),
             &(&1 == {:ok, :ok})
           )

    conn =
      Plug.Test.conn(:post, "/api/visitor", Jason.encode!(%{signals: %{platform: "MacIntel"}}))
      |> Plug.Conn.put_req_header("content-type", "application/json")

    response = Doorman.handle(conn, c, %{auth: %{user_id: "alex"}})
    assert response.status == 200
    assert response.assigns.doorman_context["status"] == "authenticated"
    cookie = response.resp_cookies["__visitor"].value

    returning =
      conn |> Plug.Conn.put_req_header("cookie", "__visitor=#{cookie}") |> Doorman.handle(c)

    assert returning.status == 200
    assert returning.assigns.doorman_context["status"] == "remembered"
    assert returning.assigns.doorman_identity["visitorId"] == cookie
    assert :ok == Doorman.ready(c)
    Doorman.forget_user(c, "alex")

    unknown =
      conn |> Plug.Conn.put_req_header("cookie", "__visitor=#{cookie}") |> Doorman.handle(c)

    assert unknown.assigns.doorman_context["status"] == "unknown"
  end

  test "explicitly managed schema is not created automatically" do
    prefix = Doorman.random_id("skip_")
    c = Doorman.new(repo: TestRepo, prefix: prefix, auto_migrate: false)
    assert :ok == Doorman.ready(c)

    assert %{rows: [[nil]]} =
             Ecto.Adapters.SQL.query!(TestRepo, "SELECT to_regnamespace($1)::text", [prefix],
               log: false
             )
  end

  test "a rolled-back application transaction cannot cache schema readiness" do
    prefix = Doorman.random_id("rollback_")
    c = Doorman.new(repo: TestRepo, prefix: prefix)

    on_exit(fn ->
      Ecto.Adapters.SQL.query!(TestRepo, ~s(DROP SCHEMA IF EXISTS "#{prefix}" CASCADE), [],
        log: false
      )
    end)

    assert {:error, :cancelled} =
             TestRepo.transaction(fn ->
               Doorman.ready(c)
               TestRepo.rollback(:cancelled)
             end)

    assert %{rows: [[nil]]} =
             Ecto.Adapters.SQL.query!(TestRepo, "SELECT to_regnamespace($1)::text", [prefix],
               log: false
             )

    assert :ok == Doorman.ready(c)

    assert %{rows: [[10]]} =
             Ecto.Adapters.SQL.query!(
               TestRepo,
               ~s|SELECT max(version) FROM "#{prefix}"."_doorman_schema"|,
               [], log: false)
  end
end
