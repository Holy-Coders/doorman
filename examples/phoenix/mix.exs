defmodule DoormanExample.MixProject do
  use Mix.Project

  def project,
    do: [
      app: :doorman_example,
      version: "0.7.0",
      elixir: "~> 1.17",
      deps: deps(),
      aliases: [setup: ["deps.get", "ecto.create"]]
    ]

  def application, do: [mod: {DoormanExample.Application, []}, extra_applications: [:logger]]

  defp deps,
    do: [
      {:doorman_identity, path: "../../packages/elixir"},
      {:phoenix, "~> 1.8.14"},
      {:bandit, "~> 1.12"},
      {:phoenix_html, "~> 4.3"}
    ]
end
