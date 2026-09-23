defmodule JanitorExample.EndpointTest do
  use ExUnit.Case
  import Plug.Test

  test "page serves the client and the endpoint requires CSRF" do
    page = conn(:get, "/") |> JanitorExample.Endpoint.call([])
    assert page.status == 200
    assert page.resp_body =~ "csrf-token"
    asset = conn(:get, "/janitor/janitor.js") |> JanitorExample.Endpoint.call([])
    assert asset.status == 200
    assert asset.resp_body =~ "createVisitorClient"
    assert asset.resp_body =~ "createIdentityAnalytics"

    assert_raise Plug.CSRFProtection.InvalidCSRFTokenError, fn ->
      conn(:post, "/api/visitor", ~s({"signals":{}}))
      |> Plug.Conn.put_req_header("content-type", "application/json")
      |> JanitorExample.Endpoint.call([])
    end
  end

  test "opt-in API Plug records a server session and returns the ordinary application response" do
    previous = System.get_env("JANITOR_API_ACTIVITY")
    System.put_env("JANITOR_API_ACTIVITY", "1")

    on_exit(fn ->
      if previous,
        do: System.put_env("JANITOR_API_ACTIVITY", previous),
        else: System.delete_env("JANITOR_API_ACTIVITY")
    end)

    conn =
      conn(:get, "/api/example/orders/123?email=never-collected")
      |> JanitorExample.Endpoint.call([])

    assert conn.status == 200
    assert Jason.decode!(conn.resp_body) == %{"orderId" => "123", "status" => "example"}
    assert conn.assigns.janitor_api_activity == %{"status" => "recorded"}
    context = JanitorExample.Controller.activity_context(conn)

    result =
      Janitor.Activity.assess(%{JanitorExample.Controller.config() | evaluator: nil}, context)

    assert result["assessment"]["summary"]["buckets"] |> hd() |> Map.fetch!("route") ==
             "GET /api/example/orders/:id"

    refute Jason.encode!(result) =~ "never-collected"
    Janitor.Activity.delete_key(JanitorExample.Controller.config(), context.key)
  end
end
