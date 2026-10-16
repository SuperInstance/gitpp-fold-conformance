# §5.6 setter conformance — drafted, not yet trustworthy

`git.pp-spec` §5.6 (v0.5.0) requires `derive()` to return
`setters: {key: record id}` for **every** key in `state`, not only
contested ones. `gitpp-doctor` v0.2.4 implements it.

**Status: 1 of 5 ports.** `gitpp-js`, `gitpp-cs`, `gitpp-pl` and `gitpp-c`
do not return `setters`. They cannot drive the nudge loop in
[`gitpp-nudge`](https://github.com/SuperInstance/gitpp-nudge) yet.

## The drafted case exists and is not in the corpus yet

A conformance case `d26-setter-provenance` was written and then **removed**.
It passed while three ports did not implement the clause, which means the
runner's comparison path needed the same care as the leaf fuzz's raw-text
handling — and that care had not been given it.

This is recorded rather than quietly fixed because it is the third time in
this project that a comparison bug produced a green suite:

1. `fuzz.mjs` re-serialized corpus records through `JSON.stringify`, losing
   float64 precision, and reported disagreements that vanished on re-run.
2. `fuzz.mjs` called `json.load()` directly, bypassing the port's decoder, so
   it kept reporting a disagreement *after the port was fixed*.
3. `d26` passed vacuously because `setters` was not in the normalized
   comparison, and then a second draft passed vacuously again after the
   comparison was widened in a way that stripped the field from every side.

A green suite is a claim about what it actually compared. That claim has to
be checkable, or it is decoration.

## What has to be true before d26 is trustworthy

- `setters` is in the normalized output for **every** port, or the normalizer
  treats "absent" and "empty" as distinct rather than conflating them.
- A case cannot pass when the port omits a field the spec requires. The
  runner needs a *presence* check, not just a value comparison — the leaf
  suite has the same gap for any field a port silently drops.
- Then: port §5.6 to js, cs, pl, c; re-run; expect 26/26.

## Why this is worth doing properly

`gitpp-nudge` measured the cost of §5.6 being unimplemented:

```
parent on setters[key]        5/5 nudges landed
parent on the first record    2/5 landed, 3 silently lost
```

The three losses are silent: no conflict, no exception, state simply stops
moving. An agent writing three records, getting three `201`s, and moving on
would never notice. That is the failure mode a conformance case is for.
