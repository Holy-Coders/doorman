defmodule Janitor.MixProject do
  use Mix.Project

  def project do
    [
      app: :janitor,
      version: "0.7.0",
      elixir: "~> 1.17",
      start_permanent: Mix.env() == :prod,
      description:
        "First-party browser identity, Jev risk, verified actors and opt-in login feedback.",
      package: [
        licenses: ["MIT"],
        links: %{"GitHub" => "https://github.com/Holy-Coders/janitor"},
        files: ~w(lib priv mix.exs README.md LICENSE .formatter.exs)
      ],
      deps: [
        {:ecto_sql, "~> 3.14"},
        {:postgrex, "~> 0.22"},
        {:plug, "~> 1.20"},
        {:jason, "~> 1.4"},
        {:req, "~> 0.7"}
      ]
    ]
  end

  def application, do: [extra_applications: [:crypto, :logger]]
end
