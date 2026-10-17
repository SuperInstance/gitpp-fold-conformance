#!/usr/bin/env node
// Cross-port DERIVE conformance runner.
// The leaf fuzz (gitpp-cross-port) tests record ENCODING. This tests fold SEMANTICS:
// ancestry reduction, class precedence, tie-breaks, orphans, cycles, conflict ledger.
// Every port must produce the same normalized {state, order, conflicts, orphans}.

import {readFileSync, writeFileSync, existsSync } from "node:fs";
import { spawnSync } from "node:child_process";

// Resolve against THIS file, not a hardcoded path and not the CWD. The
// previous value pointed at a scratch directory, so the suite being verified
// and the suite being pushed were different files -- which is how an
// inverted-setters port passed a case built to catch it.
const ROOT = new URL(".", import.meta.url).pathname.replace(/\/$/, "");
const corpusText = readFileSync(`${ROOT}/cases.json`, "utf8");
const corpus = JSON.parse(corpusText);

// Extract each case's `records` array as RAW TEXT by bracket-depth walk.
// Re-serializing through JSON.stringify loses float64 precision
// (1.5e20 -> 150000000000000000000), the same trap fuzz.mjs documents.
// Ports must see the exact bytes the corpus declares.
function rawRecordsArrays() {
  const out = new Map();
  const re = /"name"\s*:\s*"([^"]+)"[\s\S]*?"records"\s*:\s*\[/g;
  for (const m of corpusText.matchAll(re)) {
    const name = m[1];
    let i = m.index + m[0].length - 1;   // at the '['
    let depth = 0, inStr = false, esc = false, end = -1;
    for (; i < corpusText.length; i++) {
      const c = corpusText[i];
      if (inStr) {
        if (esc) esc = false;
        else if (c === "\\") esc = true;
        else if (c === '"') inStr = false;
        continue;
      }
      if (c === '"') { inStr = true; continue; }
      if (c === '[' || c === '{') depth++;
      else if (c === ']' || c === '}') {
        depth--;
        if (depth === 0) { end = i + 1; break; }
      }
    }
    if (end > 0) out.set(name, corpusText.slice(m.index + m[0].length - 1, end));
  }
  return out;
}
const RAW = rawRecordsArrays();

const run = (cmd, args, input) => {
  const r = spawnSync(cmd, args, { input, encoding: "utf8", timeout: 60000,
    env: { ...process.env, HOME: process.env.HOME || "/tmp/fake-home" } });
  if (r.status !== 0) throw new Error(`exit ${r.status}: ${(r.stderr || r.stdout || "").trim().split("\n").pop()}`);
  return r.stdout.trim();
};

const PORTS = {
  py: (j) => run("python3", [`${ROOT}/wrappers/PyDerive.py`], j),
  js: (j) => run("node", [`${ROOT}/wrappers/JsDerive.mjs`], j),
  // Resolve the C# wrapper across BOTH configurations. The workflow builds
  // it with `-c Release`, so a hardcoded bin/Debug path meant this port could
  // never run in CI -- and a participant that cannot run must be a FAILURE
  // (see the participant assertion below), not a silently smaller set.
  // A local `dotnet build` with no -c produces Debug, so both are checked.
  cs: (j) => {
    const rel = `${ROOT}/wrappers/CsDerive/bin`;
    for (const cfg of ["Release", "Debug"]) {
      const dll = `${rel}/${cfg}/net9.0/CsDerive.dll`;
      if (existsSync(dll)) return run("dotnet", [dll], j);
    }
    return run("dotnet", [`${rel}/Release/net9.0/CsDerive.dll`], j); // surfaces the real error
  },
  pl: (j) => run("perl", [`${ROOT}/wrappers/PlDerive.pl`], j),
};
PORTS.c = (j) => run("sh", [`${ROOT}/wrappers/CDerive.sh`], j);
const names = Object.keys(PORTS);

// Central normalization via Python (the reference implementation's own json module).
// This kills every wrapper-formatting difference: key order, spacing, separators.
function normalize(obj) {
  const r = spawnSync("python3", ["-c", `
import json,sys
def canon(v):
    # Compare state VALUES, not their serialization. The spec pins leaf encoding
    # (§3) but NOT state serialization, so JS's JSON.stringify(1e-5) -> 0.00001
    # and Python's repr(1e-5) -> 1e-05 are the same float64 and must compare equal.
    if isinstance(v, bool): return v
    if isinstance(v, float):
        if v != v: return "__nan__"
        if v == 0: return "0.0"
        if v == int(v) and abs(v) < 1e16: return "i" + str(int(v))
        return "f" + repr(v)
    if isinstance(v, int): return "i" + str(v)
    if isinstance(v, dict): return {k: canon(x) for k, x in sorted(v.items())}
    if isinstance(v, list): return [canon(x) for x in v]
    return v
d=json.load(sys.stdin)
out={
 "state": canon(d.get("state",{})),
 "setters": canon(d.get("setters",{})),
 "has_setters": "setters" in d,
 # NOT sorted. Kahn's order IS the assertion (SS5.4): a parent must
 # precede its children, and ties break smallest-id-first. Sorting here
 # meant NO case in this corpus ever tested topological order -- any
 # permutation passed. Found while adding d27, whose first draft
 # "failed" for an unrelated reason and exposed this.
 "order": d.get("order",[]),
 "conflicts": sorted([
   {"key":c["key"],"winner":c["winner"],"losers":sorted(c["losers"])}
   for c in d.get("conflicts",[])], key=lambda c:c["key"]),
 "orphans": sorted([o if isinstance(o,str) else o.get("id","") for o in d.get("orphans",[])]),
}
print(json.dumps(out,sort_keys=True,ensure_ascii=False,separators=(",",":")))
`], { input: JSON.stringify(obj), encoding: "utf8" });
  if (r.status !== 0) throw new Error("normalize failed: " + r.stderr.slice(0, 200));
  return r.stdout.trim();
}

let pass = 0, fail = 0, skipped = 0;
const failures = [];

for (const c of corpus.cases) {
  const input = RAW.get(c.name) || JSON.stringify(c.records);
  const got = {}, errs = {};
  for (const p of names) {
    try { got[p] = normalize(JSON.parse(run(PORTS[p] ? null : null, p) || "null")); }
    catch (e) { }
  }
  // (re-run properly below)
  const results = {};
  for (const p of names) {
    try { results[p] = normalize(JSON.parse(PORTS[p](input))); }
    catch (e) { results[p] = null; errs[p] = e.message.slice(0, 160); }
  }
  const live = names.filter(p => results[p] !== null);

  // A participant that errored is not a smaller denominator. It is a FAILURE.
  //
  // negctl's `participant-silently-absent` sabotage survives without this:
  // a run in which some ports are missing still reported 29/29, because the
  // remaining ports agreed with each other and with the (blinded) spec
  // check. The number looked identical while meaning something different
  // from yesterday -- which is the failure mode that made "five ports agree"
  // unverifiable when gitpp-doctor turned out to be 404.
  if (live.length < names.length) {
    const missing = names.filter(p => !live.includes(p));
    console.log(`  FAIL ${c.name}  [participants missing: ${missing.join(", ")}]`);
    // `expected` is not computed until later in this block, so record only
    // what is in scope here. An earlier version referenced it and threw
    // ReferenceError, which the runner reported as a crashed port -- the
    // same shape of error-as-signal this whole file exists to remove.
    failures.push({ name: c.name, why: c.why, agreeWithEachOther: false, matchSpec: false,
                    missingParticipants: missing });
    fail++;
    continue;
  }
  const expected = normalize(c.expect);

  if (live.length === 0) { skipped++; console.log(`  SKIP ${c.name} (all ports error)`); continue; }

  // A port that ERRORS must FAIL the case, not be filtered out of the live
  // set. Filtering made a broken import path look like a clean pass: the JS
  // wrapper had a wrong path, errored on every case, and was quietly excluded
  // while the suite reported 26/26. That is the sixth time a comparison bug
  // has produced a green suite in this project, and the most dangerous,
  // because it removes a port from the comparison entirely.
  const errored = names.filter((p) => results[p] === null);
  if (errored.length) {
    fail++;
    failures.push({ name: c.name, why: c.why, agreeWithEachOther: false, matchSpec: false,
                    errored, errs, expected, results });
    console.log(`  FAIL ${c.name}  [port(s) errored: ${errored.join(", ")}]`);
    for (const p of errored) console.log(`      ${p}: ${String(errs[p]).slice(0, 140)}`);
    continue;
  }

  // §5.6 `setters` is additive, but PRESENCE is a first-class check. A case
  // that expects setters must FAIL for a port that omits the field, rather
  // than comparing {} against {} and calling it a pass.
  //
  // Fourth time a comparison bug has produced a green suite here. Rule:
  // absent and empty are different answers; a required field is checked for
  // presence independently of its value.
  // `expected` is a STRING (the normalizer prints compact JSON). Reading
  // .setters off it yields undefined, so the check silently never activates --
  // which is how the previous draft of this very check passed vacuously.
  const expectedObj = JSON.parse(expected);
  const expectsSetters = expectedObj.setters && Object.keys(expectedObj.setters).length > 0;
  // results/expected are STRINGS, so compare them as strings.
  //
  // For a case that EXPECTS setters the WHOLE string is compared, values
  // included. An earlier draft stripped the setters VALUES out of both sides,
  // which made the suite blind to exactly the defect d26 exists to catch: an
  // inverted ancestry reduction returns the OLDEST record as setter, and that
  // is the bug class that shipped in four ports. Proven: a port returning
  // setters{x:"a"} compared EQUAL to one returning setters{x:"b"}.
  //
  // For a case that does NOT expect setters, the field is stripped from both
  // sides, so a port implementing §5.6 does not make every unrelated case look
  // like a disagreement.
  const strip = (s) => s.replace(/,"has_setters":(true|false)/, "").replace(/,"setters":\{[^}]*\}/, "");
  const has = (s) => /"has_setters":true/.test(s);
  // BUG (found by gitpp-reading-room's v0.4.6 audit): this was
  //     const cmp = expectsSetters ? (a, b) => a === b : strip;
  // `strip` takes ONE argument, so for any case that does not expect setters
  // cmp(a, b) returned strip(a) -- a truthy STRING that ignores b entirely.
  // Every such case compared as equal to the spec unconditionally, so 25 of
  // 29 cases asserted nothing at all. Cross-port agreement still worked,
  // which is why the suite reported 29/29 and nobody noticed.
  //
  // Proven: replacing d05's expected state/order/orphans with nonsense still
  // printed 'PASS d05'. d26, which declares setters, correctly FAILed the
  // same corruption.
  const cmp = expectsSetters ? (a, b) => a === b : (a, b) => strip(a) === strip(b);
  const agreeWithEachOther = live.every((p) =>
    (!expectsSetters || has(results[p]) === has(results[live[0]])) &&
    cmp(results[p], results[live[0]]));
  const matchSpec = live.every((p) =>
    (!expectsSetters || has(results[p])) &&
    cmp(results[p], expected));
  if (expectsSetters) {
    const missing = live.filter((p) => !has(results[p]));
    if (missing.length) console.log(`      MISSING setters (spec §5.6) in: ${missing.join(", ")}`);
  }

  // A case may only PASS if the spec comparison was actually EXERCISED.
  //
  // `cmp` is used by both checks above. When every port agrees, the
  // port-to-port check is satisfied on its own terms, so a blinded `cmp`
  // still yields a pass: negctl demonstrated 29/29 with the comparator
  // blinded AND 10 of 29 expected states corrupted to {"CORRUPT":1}.
  //
  // The fix for a blinded `cmp` is necessary but not sufficient, because
  // the two checks are not independent. This assertion makes the
  // dependency explicit and fatal: if `matchSpec` cannot be shown to have
  // compared anything, the case does not pass.
  const specCompared = (() => {
    // `expected` must be a real, non-empty comparison target. If cmp is
    // blind this is still true, so also require that cmp is the two-arg
    // form: a one-arg comparator returns a truthy string regardless of
    // its second argument, which is exactly the defect this guards.
    const comparatorIsTwoArg = cmp.length >= 2;
    const expectedIsPresent = typeof expected === "string" && expected.length > 0;
    return comparatorIsTwoArg && expectedIsPresent;
  })();
  if (!specCompared) {
    fail++;
    console.log(`  FAIL ${c.name}  [spec comparison not exercised: cmp.length=${cmp.length}]`);
    failures.push({ name: c.name, why: c.why, agreeWithEachOther, matchSpec, expected, results, errs,
                    why2: "spec comparison could not be shown to have run" });
  } else if (agreeWithEachOther && matchSpec) {
    pass++; console.log(`  PASS ${c.name}`);
  } else {
    fail++;
    failures.push({ name: c.name, why: c.why, agreeWithEachOther, matchSpec, expected, results, errs });
    const tags = [`ports-agree=${agreeWithEachOther}`, `match-spec=${matchSpec}`];
    console.log(`  FAIL ${c.name}  [${tags.join(" ")}]`);
    for (const p of names) {
      if (results[p] === null) console.log(`      ${p}: ERROR ${errs[p]}`);
    }
    if (!agreeWithEachOther) {
      for (const p of live) {
        if (results[p] !== results[live[0]]) console.log(`      ${p}: ${results[p]}`);
      }
      console.log(`      ${live[0]}: ${results[live[0]]}`);
    }
    console.log(`      spec:  ${expected}`);
  }
}

console.log(`\n${pass} pass, ${fail} fail, ${skipped} skip (of ${corpus.cases.length})`);
writeFileSync(`${ROOT}/results.json`, JSON.stringify({ pass, fail, skipped, total: corpus.cases.length, failures }, null, 2));
process.exit(fail ? 1 : 0);
