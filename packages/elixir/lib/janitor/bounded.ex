defmodule Janitor.Bounded do
  @moduledoc false
  # No global worker/queue. Monitor one short-lived evaluation and kill it on timeout.
  def run(fun, timeout, detailed \\ false) do
    caller = self()
    ref = make_ref()

    {pid, monitor} =
      spawn_monitor(fn ->
        result =
          try do
            {:ok, fun.()}
          rescue
            _ -> :unavailable
          catch
            _, _ -> :unavailable
          end

        send(caller, {ref, result})
      end)

    receive do
      {^ref, result} ->
        Process.demonitor(monitor, [:flush])
        result

      {:DOWN, ^monitor, :process, ^pid, _} ->
        :unavailable
    after
      timeout ->
        Process.exit(pid, :kill)

        receive do
          {:DOWN, ^monitor, :process, ^pid, _} -> :ok
        end

        receive do
          {^ref, _} -> :ok
        after
          0 -> :ok
        end

        if detailed, do: :timeout, else: :unavailable
    end
  end
end
