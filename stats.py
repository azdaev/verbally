"""Summary of telemetry.jsonl: where the time goes. Run: python3 stats.py [file]"""
import json, statistics, sys
from collections import defaultdict

rows = [json.loads(l) for l in open(sys.argv[1] if len(sys.argv) > 1 else "telemetry.jsonl") if l.strip()]
page = [r for r in rows if r.get("src") == "page"]
server = {r["id"]: r for r in rows if r.get("src") == "server"}
groups = defaultdict(list)
for r in page:
    kind = "error" if r.get("error") else ("retry " if r.get("retry") else "") + r.get("kind", "?")
    groups[(r["model"].split("/")[-1], kind)].append(r)

def med(rs, key):
    v = [r[key] for r in rs if key in r]
    return f"{statistics.median(v):6.0f}" if v else "     -"

# wait = speech to request start, first = first token, done = request end, total = speech to screen
print(f"{'model':18} {'kind':11} {'n':>3}  {'wait':>6} {'first':>6} {'done':>6} {'total':>6}  {'reply chars':>11}   (medians, ms)")
for (model, kind), rs in sorted(groups.items()):
    print(f"{model:18} {kind:11} {len(rs):3}  {med(rs,'wait_ms')} {med(rs,'first_ms')} {med(rs,'done_ms')} {med(rs,'total_ms')}  {med(rs,'reply_chars'):>11}")
edits = [r for r in page if r.get("kind") == "edit"]
if edits:
    print(f"\nedits that fit the page: {sum(bool(r.get('fit')) for r in edits)}/{len(edits)}")
if server:
    warm = sum(bool(r.get("warm_process")) for r in server.values())
    print(f"claude requests with a started process: {warm}/{len(server)}")
errors = [r for r in page if r.get("error")]
for r in errors[-5:]:
    print("error:", r["at"], r["error"][:100])
