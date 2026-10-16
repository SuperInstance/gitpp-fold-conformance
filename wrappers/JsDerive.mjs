import { derive } from "../../gitpp-js/src/gitpp.js";
const text = await new Promise((res, rej) => { let c = []; process.stdin.on("data", x => c.push(x)); process.stdin.on("end", () => res(Buffer.concat(c).toString("utf8"))); process.stdin.on("error", rej); });
const d = derive(JSON.parse(text));
console.log(JSON.stringify({
  state: d.state || {},
  setters: d.setters || {},
  order: d.order || [],
  conflicts: (d.conflicts || []).map(c => ({ key: c.key, winner: c.winner, losers: [...c.losers].sort() })),
  orphans: (d.orphans || []).map(o => typeof o === "string" ? o : o.id).sort(),
}));
