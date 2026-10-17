#!/usr/bin/env python3
# Python reference port wrapper.
#
# The module path is resolved at RUN time from GITPP_PY, defaulting to the
# sibling checkout the workflow creates. It was hardcoded to a scratch
# directory on one machine, so in CI the import failed and the port simply
# did not participate -- and a run over four ports reports the same pass
# count as a run over five.
import sys, os, json
sys.path.insert(0, os.environ.get("GITPP_PY", os.path.join(
    os.path.dirname(os.path.dirname(os.path.abspath(__file__))), "..", "gitpp-doctor")))
import gitpp_doctor

d = gitpp_doctor.derive(json.load(sys.stdin))
print(json.dumps({
    "state": d.get("state", {}),
    "setters": d.get("setters", {}),
    "order": d.get("order", []),
    "conflicts": [{"key": c["key"], "winner": c["winner"],
                   "losers": sorted(c["losers"])}
                  for c in d.get("conflicts", [])],
    "orphans": sorted(d.get("orphans", [])),
}, sort_keys=True, ensure_ascii=False, separators=(",", ":")))
