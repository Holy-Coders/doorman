defmodule Doorman.MixProject do
  use Mix.Project

  def project do
    [
      app: :doorman_identity,
      version: "0.12.0",
      elixir: "~> 1.17",
      source_url: "https://github.com/Holy-Coders/doorman",
      source_ref: "v0.12.0",
      docs: [main: "readme", extras: ["README.md"]],
      start_permanent: Mix.env() == :prod,
      description:
        "First-party browser identity, Jev risk, verified actors and opt-in login feedback.",
      package: [
        licenses: ["MIT"],
        links: %{"GitHub" => "https://github.com/Holy-Coders/doorman"},
        files: ~w(lib priv mix.exs README.md LICENSE .formatter.exs)
      ],
      deps: [
        {:ecto_sql, "~> 3.14"},
        {:postgrex, "~> 0.22"},
        {:plug, "~> 1.20"},
        {:jason, "~> 1.4"},
        {:req, "~> 0.7"},
        {:ex_doc, "~> 0.40", only: :dev, runtime: false}
      ]
    ]
  end

  def application, do: [extra_applications: [:crypto, :logger]]
end
