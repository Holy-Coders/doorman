defmodule JanitorExample.MixProject do
  use Mix.Project

  def project,
    do: [
      app: :janitor_example,
      version: "0.5.0",
      elixir: "~> 1.17",
      deps: deps(),
      aliases: [setup: ["deps.get", "ecto.create", "ecto.migrate"]]
    ]

  def application, do: [mod: {JanitorExample.Application, []}, extra_applications: [:logger]]

  defp deps,
    do: [
      {:janitor, path: "../../packages/elixir"},
      {:phoenix, "~> 1.8.14"},
      {:bandit, "~> 1.12"},
      {:phoenix_html, "~> 4.3"}
    ]
end
