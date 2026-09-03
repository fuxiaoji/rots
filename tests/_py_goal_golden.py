# 生成 py 参考引擎全部策略的 parse_goals 金标 JSON (供 JS erasmus_state parse 层对拍)。
# 用法: python tests/_py_goal_golden.py  -> tests/results/py-goals-golden.json
import json, os, sys
sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)) + "/..")
import erasmus_complete_ai_execution_engine as E
from erasmus_complete_ai_execution_engine import parse_goals, hex_label

out = {}
for role, libs in (("JP", [E.JP_EARLY_STRATEGIES, E.JP_MID_STRATEGIES, E.JP_LATE_STRATEGIES]),
                   ("AL", [E.AL_EARLY_STRATEGIES, E.AL_MID_STRATEGIES, E.AL_LATE_STRATEGIES])):
    out[role] = {}
    for phase, lib in zip(("early", "mid", "late"), libs):
        out[role][phase] = {}
        for name, s in lib.items():
            out[role][phase][name] = {
                "name": s.name,
                "targets": list(s.targets),
                "notes": list(s.notes),
                "instructions": s.instructions,
                "goals": [{
                    "priority": g.priority, "kind": g.kind, "text": g.text,
                    "hexes": g.hexes,
                    "hex_labels": [hex_label(h) for h in g.hexes],
                    "region": g.region, "sub": g.sub,
                } for g in parse_goals(s)],
            }
p = os.path.join(os.path.dirname(os.path.abspath(__file__)), "results", "py-goals-golden.json")
os.makedirs(os.path.dirname(p), exist_ok=True)
with open(p, "w", encoding="utf-8") as f:
    json.dump(out, f, ensure_ascii=False, indent=1)
print("wrote", p)
