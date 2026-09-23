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
end
