#!/usr/bin/env node
// Cross-port DERIVE conformance runner.
// The leaf fuzz (gitpp-cross-port) tests record ENCODING. This tests fold SEMANTICS:
// ancestry reduction, class precedence, tie-breaks, orphans, cycles, conflict ledger.
// Every port must produce the same normalized {state, order, conflicts, orphans}.

import { readFileSync, writeFileSync } from "node:fs";
import { spawnSync } from "node:child_process";

const ROOT = "/tmp/derive-corpus";
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
  cs: (j) => run("dotnet", [`${ROOT}/wrappers/CsDerive/bin/Debug/net9.0/CsDerive.dll`], j),
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
 "order": sorted(d.get("order",[])),
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
  // results/expected are STRINGS, so strip by string surgery, not by destructure.
  const strip = (s) => s.replace(/,"has_setters":(true|false)/, "").replace(/,"setters":\{[^}]*\}/, "");
  const has = (s) => /"has_setters":true/.test(s);
  const agreeWithEachOther = live.every((p) =>
    (!expectsSetters || has(results[p]) === has(results[live[0]])) &&
    strip(results[p]) === strip(results[live[0]]));
  const matchSpec = live.every((p) =>
    (!expectsSetters || has(results[p])) &&
    strip(results[p]) === strip(expected));
  if (expectsSetters) {
    const missing = live.filter((p) => !has(results[p]));
    if (missing.length) console.log(`      MISSING setters (spec §5.6) in: ${missing.join(", ")}`);
  }

  if (agreeWithEachOther && matchSpec) {
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
