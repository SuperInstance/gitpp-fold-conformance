#!/usr/bin/env elixir
# Elixir/OTP fold (derive) wrapper for patchwork-quilt/gitpp-beam.
#
# Interface, identical to wrappers/PyDerive.py, JsDerive.mjs and PlDerive.pl:
# read a JSON record array on STDIN, write the derive() result to STDOUT.
# run.mjs passes the records as RAW TEXT on purpose -- re-serialising through
# JSON.stringify loses float64 precision -- so this wrapper decodes the bytes it
# is given with OTP 27's :json.decode and never round-trips them through a
# language-native object first.
#
# THE PORT HAS NO `setters`
# ----------------------------
# Spec SS5.6 requires derive() to return setter provenance for EVERY key in
# state, not only for contested ones, and run.mjs treats PRESENCE of the field
# as a first-class check: a case that expects setters must FAIL for a port that
# omits them, rather than comparing {} against {}.
#
# `Gitpp.Fold.derive/1` returns %{"state", "order", "conflicts", "orphans"} and
# nothing else. There is no public API from which an uncontested key's setter
# can be recovered either -- the per-key winner is computed inside the private
# `resolve/3` and survives only for CONTESTED keys, inside conflicts[].winner.
#
# So this wrapper does not emit a `setters` key at all. Emitting an empty one
# would produce the same FAIL but would erase the distinction between "the port
# has no setters" and "the port has setters and computed none", which is the
# distinction a reader needs. Inventing the values would be worse than either.
# The field's absence is the finding; run.mjs reports it as
# "MISSING setters (spec SS5.6) in: ex", which is the correct outcome.

defmodule ElixirDerive do
  alias Gitpp.Fold

  def run(payload) do
    records = :json.decode(payload)
    d = Fold.derive(records)

    out = %{
      "state" => d["state"] || %{},
      "order" => d["order"] || [],
      "conflicts" =>
        Enum.map(d["conflicts"] || [], fn c ->
          %{"key" => c["key"], "winner" => c["winner"], "losers" => c["losers"] || []}
        end),
      "orphans" => d["orphans"] || []
    }

    IO.puts(:json.encode(out))
  end
end

# ---------------------------------------------------------------------------

argv = System.argv()

cond do
  "--version" in argv ->
    IO.puts("ElixirDerive: elixir #{System.version()} / OTP #{System.otp_release()}")

  true ->
    payload = IO.read(:stdio, :eof) || ""

    if String.trim(payload) == "" do
      IO.puts(:stderr, "ElixirDerive: empty payload on STDIN")
      System.halt(2)
    end

    try do
      ElixirDerive.run(payload)
    rescue
      e ->
        # One legible line. run.mjs prints only the last stderr line per port,
        # so a 40-frame Elixir stacktrace would arrive as noise; the first
        # three frames carry the port module and line, which is the diagnosis.
        top =
          Exception.format_stacktrace(__STACKTRACE__)
          |> String.split("\n")
          |> Enum.take(3)
          |> Enum.join(" | ")

        IO.puts(:stderr, "ElixirDerive: #{inspect(e.__struct__)}: #{Exception.message(e)}")
        IO.puts(:stderr, "ElixirDerive: " <> top)
        System.halt(1)
    end
end
