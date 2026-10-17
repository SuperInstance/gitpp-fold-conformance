#!/usr/bin/env python3
import sys, json
import os; sys.path.insert(0, os.environ.get('GITPP_PY', '/tmp/rr2/readers/py'))
import fold as gitpp_doctor
d = gitpp_doctor.derive(json.load(sys.stdin))
print(json.dumps({
    "state": d.get("state", {}),
    "setters": d.get("setters", {}),
    "order": d.get("order", []),
    "conflicts": [{"key": c["key"], "winner": c["winner"], "losers": sorted(c["losers"])} for c in d.get("conflicts", [])],
    "orphans": sorted(d.get("orphans", [])),
}, sort_keys=True, ensure_ascii=False, separators=(",", ":")))
