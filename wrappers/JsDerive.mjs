// A static import cannot read process.env, so this is dynamic on purpose.
// GITPP_JS_SRC lets the harness point at whichever checkout is under test;
// the default is a sibling clone, which is what the repo layout assumed.
const { derive } = await import(process.env.GITPP_JS_SRC || "../../gitpp-js/src/gitpp.js");
const text = await new Promise((res, rej) => { let c = []; process.stdin.on("data", x => c.push(x)); process.stdin.on("end", () => res(Buffer.concat(c).toString("utf8"))); process.stdin.on("error", rej); });
const d = derive(JSON.parse(text));
console.log(JSON.stringify({
  state: d.state || {},
  setters: d.setters || {},
  order: d.order || [],
  conflicts: (d.conflicts || []).map(c => ({ key: c.key, winner: c.winner, losers: [...c.losers].sort() })),
  orphans: (d.orphans || []).map(o => typeof o === "string" ? o : o.id).sort(),
}));
