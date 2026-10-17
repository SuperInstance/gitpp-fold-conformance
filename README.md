# gitpp-fold-conformance

> Cross-port **fold** conformance. The leaf fuzz tests record *encoding*; this tests fold **semantics**: ancestry reduction, class precedence, tie-breaks, orphans, cycles, and the conflict ledger.

## The sixth port: `patchwork-quilt/gitpp-beam` (Elixir / OTP 27)

Added on `feat/elixir-port`. It is the only port in the fleet written by a
**different organisation** from the spec's author, so it is the only genuinely
independent one — and it disagrees with the other five on 6 of the 29 cases.

| Cases | Outcome | Why |
|---|---|---|
| 23 | PASS | identical state, order, conflicts and orphans |
| d24, d27 | FAIL — `participants missing: ex` | the port **raises** `FunctionClauseError` in `Canon.value_key(:null)` |
| d26, d28, d29 | FAIL — `MISSING setters (§5.6)` | `Fold.derive/1` returns no `setters`, and no public API can recover an uncontested key's setter |
| d12 | FAIL — `ports-agree=false` | the port **violates §5.5**: it auto-orphans an orphan's descendants, so `state` is `{}` where the spec requires `{"z": 7}` |

d12 is the interesting one: every other port applies `child` and orphans only
`orph`; the Elixir port orphans both and folds nothing. Spec §5.5 is explicit
— "the orphan's descendants are NOT auto-orphaned (the fold runs on what
stands)" — and its `do_kahn/3` comment asserts the opposite.

The toolchain is the hard part of adding it: the port uses a runtime-sized
binary segment (`<<...::binary-size(^decpt), ...>>`), which is Elixir 1.17
syntax, so ubuntu's apt Elixir 1.14 **cannot compile it** — and a wrapper that
cannot compile is indistinguishable, from the harness, from a port that
disagrees. `scripts/install-beam.sh` installs OTP 27 + Elixir 1.17 from
builds.hex.pm pinned by SHA-256, with no sudo.

## Why this exists

[`gitpp-cross-port`](../gitpp-cross-port) proves all 5 ports produce **byte-identical leaves** on 1,000/1,000 random float64 records. That is a claim about *encoding*.

It says nothing about whether the ports *fold the same way*. Two ports can hash a record identically and still disagree about which record wins a contested key.

We had exactly that, and the leaf fuzz was structurally incapable of finding it.

## What this tests

`cases.json` holds 25 hand-written cases, each naming the spec clause it exercises and carrying an expected result **written from the spec, not from any port**:

| # | Case | Spec clause |
|---|------|-------------|
| d01 | empty set | §5 |
| d02 | single root | §5 |
| **d03** | **linear task chain, most-derived wins** | **§5.2** |
| d04 | 4-deep chain | §5.2 |
| d05 | override beats task, even as ancestor | §5.1 |
| **d06** | **descendant witness still loses to ancestor task** | **§5.1** |
| d07 | uncontested witness reaches state | §5.1 |
| d08 | all three classes on one key | §5.1 |
| d09 | sibling tasks, smallest-id tie-break | §5.2 |
| d10 | diamond DAG | §5.2, §5.4 |
| d11 | orphan (missing parent) | §5.5 |
| d12 | orphan's descendant still folds | §5.5 |
| **d13** | **2-cycle excluded and reported** | **§5.4, §5.5** |
| **d14** | **3-cycle** | **§5.4, §5.5** |
| d15 | partial key overlap | §5.2 |
| **d16** | **same value from two records ⇒ NO conflict** | **§5.3** |
| d17 | non-BMP id sort order | §5.4 |
| d18 | nested effects | §5 |
| d19 | float edge values in effects | §3 |
| d20 | 10-way fan-out tie-break | §5.2 |
| d21 | override descends from task | §5.1 |
| d22 | empty-effects chain | §5.4 |
| **d23** | **self-parent (degenerate cycle)** | **§5.4** |
| d24 | realistic mixed set | all |
| **d25** | **numeric string vs number preserved through the fold** | **§3, §5.2** |
| **d26** | **setter provenance for every key, contested or not** | **§5.6** |
| **d27** | **a decision receipt is state-inert** | **§5.2, §5.1** |
| **d28** | **a licensed action applies (receipt is its parent)** | **§5.2, §5.4** |
| **d29** | **the same action without its receipt is orphaned and excluded** | **§5.5** |

**Bold** = cases that caught a real bug.

## Ports under test

| Port | Repo | Role |
|------|------|------|
| Python | [`git.pp-doctor`](../git.pp-doctor) | reference |
| JavaScript | [`gitpp-js`](../gitpp-js) | |
| C# / .NET 9 | [`gitpp-cs`](../gitpp-cs) | |
| Perl 5 | [`gitpp-pl`](../gitpp-pl) | |
| C99 | [`gitpp-c`](../gitpp-c) | joined in v0.2.0 |

## Running it

```bash
# clone the ports as siblings
git clone https://github.com/SuperInstance/gitpp-doctor   ../gitpp-doctor
git clone https://github.com/SuperInstance/gitpp-js       ../gitpp-js
git clone https://github.com/SuperInstance/gitpp-cs      ../gitpp-cs
git clone https://github.com/SuperInstance/gitpp-pl      ../gitpp-pl

# build the C# wrapper
dotnet build wrappers/CsDerive

# run
node run.mjs
```

Exit code 0 = all ports agree with each other and with the spec.

## Result

```
29 pass, 0 fail, 0 skip (of 29)
```

The `29` is the whole corpus:

- `d26` pins spec §5.6 (setter provenance).
- `d27` pins that a decision receipt — a record with `effects: {}`
  carrying a gate verdict in `reason` — cannot change state, setters, or
  the conflict ledger.
- `d28`/`d29` are a **pair**: the same action with and without its
  receipt. With the receipt it applies; without it, it is an orphan and
  excluded. Together they are the cross-port proof that a decision
  structurally *licences* an action — you cannot hold one without the
  record that licensed it. See
  [`gitpp-decision-parent`](https://github.com/SuperInstance/gitpp-decision-parent).

## What the corpus was blind to until d27

The runner normalised `order` with `sorted()`. Kahn's order **is** the
assertion in §5.4 — a parent must precede its children, ties break
smallest-id-first — and sorting erased exactly that. **No case in this
corpus had ever tested topological order.** Any permutation passed.

Found while writing d27, whose first draft failed for an unrelated reason
(a missing conflict I had forgotten) and sent me back to the normaliser.

Negative control, after the fix: reversing a port's topo order produces
2 failures. Before it, zero.

**All 5 leaf ports now fold.** The C99 port gained `derive()` in
`gitpp-c` v0.2.0, so the "7 ports" claim is no longer quietly "6 ports,
one of which cannot fold".

## Bugs this suite found

Five real bugs, in four ports, all now fixed:

| Port | Bug | Clause | Fix |
|------|-----|--------|-----|
| `gitpp-doctor` v0.2.1 | **Ancestry reduction inverted** — asked *"is another candidate my ancestor?"* instead of *"am I another's ancestor?"*, so a linear chain folded to the **oldest** record's value | §5.2 | v0.2.2 |
| `gitpp-js` v0.1.3 | **Cycles vanished.** `detectCycles` excluded cycle members from the fold but they were never added to the returned `orphans`, so a 2-cycle silently disappeared | §5.4/§5.5 | v0.1.4 |
| `gitpp-cs` v0.3.1 | **Spurious conflict** when two records set the same key to the *same* value. The streaming model records a loser on every outranking, never checking the values differ | §5.3 | v0.3.2 |
| `gitpp-pl` v0.1.4 | same spurious conflict | §5.3 | v0.1.5 |
| `gitpp-pl` v0.1.5 | **Numeric strings leaked into numbers.** `looks_like_number()` is true for both `1.5e20` and `"1.5e20"`, so a JSON *string* was emitted unquoted — changing the **leaf** | §3 | v0.1.6 |

### The Perl one is the interesting one

`JSON::PP` hands back a bare scalar for both a JSON number and a JSON string. The port used `looks_like_number()` to decide "is this a number?", which is true for both. So:

```json
{"effects": {"x": "1.5e20"}}
```

was canonicalised to `{"x": 1.5e20}` — unquoted, a different leaf, in a port whose leaves had passed 1,000/1,000.

The fuzz corpus never found it because `generate.py` only ever puts *numbers* in `effects`. The bug was in a code path the corpus never exercised.

The fix inspects SV flags with core `B`:

```perl
sub _is_json_number {
    my ($v) = @_;
    return 0 if ref $v;
    my $flags = B::svref_2object(\$v)->FLAGS;
    return 0 if $flags & B::SVp_POK();                    # POK => also a string
    return (($flags & B::SVp_IOK()) || ($flags & B::SVp_NOK())) ? 1 : 0;
}
```

`B` is core Perl, so the port stays stdlib-only.

## Two harness traps, documented so nobody re-steps in them

**1. Never re-serialize corpus records through `JSON.stringify`.**
`JSON.stringify(1.5e20)` emits `150000000000000000000`, which loses the distinction the test exists to check. The runner extracts each case's `records` array as **raw text** by bracket-depth walk and passes those exact bytes to every port. `fuzz.mjs` has the same guard for the same reason.

**2. Normalize in one place, not five.**
Each port's `derive()` returns a differently-*shaped* result (C# returns bare loser-id arrays, JS returns objects, Perl returns a hash). Comparing them directly is noise. Every wrapper emits one compact JSON line and the runner normalizes centrally through Python.

State floats are compared **by value**, not by serialization: the spec pins leaf encoding (§3) but *not* state serialization, so JS's `JSON.stringify(1e-5)` → `0.00001` and Python's `repr(1e-5)` → `1e-05` are the same float64 and must compare equal.

## One known limitation, precisely bounded

**`gitpp-pl` diverges on bare integer literals in [2^63, 1e21).** Everything
else in the 20,043-record leaf corpus agrees.

The cause is `JSON::PP`, not the port. Spec §2/§3 put every JSON number in
the float64 domain, and no flag makes `JSON::PP` do that:

| Input | `JSON::PP` yields | Why it is unrecoverable |
|-------|------------------|--------------------------|
| `724818294626474393600` | a plain **string** | a JSON string must stay a string, so there is no flag that distinguishes it from `"724818294626474393600"` |
| `9223372036854775807` | an exact **int64** | it fits in an IV, but stringifying any large IV also sets `SVp_POK`, so the POK test cannot separate it from a string either |

Both are cases where the *decoder* has already lost the information the
spec needs. Python (`json.loads(parse_int=float)`) and C#
(`Numbers.ParseRecords`) recover it. Perl cannot without a decoder that
records, per value, whether the source text was a bare number or a quoted
string — which means tokenising the input rather than calling `JSON::PP`.

`gitpp-pl` v0.1.7 documents this on the port itself.

## The gap that is now closed

Until `gitpp-c` v0.2.0, the C99 port had `recordLeaf` and `closureRoot` but
**no `derive`**. The spec said 7 ports; only 4 could fold. Any claim of the
form "all ports fold identically" was really about four.

Writing it turned up four more bugs, all caught by this corpus before the
code was ever pushed — which is the argument for having the suite:

- passed `NULL` as the ancestry set, which the helper dereferences (segfault)
- §5.3 distinctness written as a 0/1 flag tested against `< 2`, which is
  always true, so it dropped **every** conflict
- the displaced incumbent was recorded only when a previous winner existed,
  so the *first* takeover silently dropped it
- a conflict created by a losing record had `winner = NULL` and was
  discarded — the winner is the incumbent, and that had to be recorded

The leaf output was verified byte-identical to the pre-`derive` binary across
80 corpus records, and the fold handles a 900-deep chain, `MAX_RECORDS`
exactly, and over `MAX_RECORDS` (truncates rather than overflowing).
