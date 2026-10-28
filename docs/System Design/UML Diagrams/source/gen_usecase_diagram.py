"""Hand-laid-out UML use case diagram for SmartFix -> SVG + PNG.
Layout is explicit so lines don't cross; notation follows Lecture 4
(stick-figure actors, system boundary, <<include>>, <<extend>>, generalization)."""
import math, cairosvg

W, H = 1500, 1430
FILL, STROKE = "#FFF3B0", "#6B5B00"
out = []
def add(s): out.append(s)

def text(x, y, s, size=13, anchor="middle", weight="normal", style="normal", fill="#111"):
    lines = s.split("\n")
    y0 = y - (len(lines) - 1) * size * 0.6
    for i, ln in enumerate(lines):
        ln = ln.replace("&", "&amp;").replace("<", "&lt;").replace(">", "&gt;")
        add(f'<text x="{x}" y="{y0 + i*size*1.2 + size*0.35:.1f}" font-family="DejaVu Sans" font-size="{size}" '
            f'text-anchor="{anchor}" font-weight="{weight}" font-style="{style}" fill="{fill}">{ln}</text>')

UC = {}
def usecase(key, cx, cy, label, w=None, h=50):
    lines = label.split("\n")
    w = w or max(150, max(len(l) for l in lines) * 7.6 + 40)
    UC[key] = (cx, cy, w / 2, h / 2)
    add(f'<ellipse cx="{cx}" cy="{cy}" rx="{w/2}" ry="{h/2}" fill="{FILL}" stroke="{STROKE}" stroke-width="1.3"/>')
    text(cx, cy, label, 12.5)

ACT = {}
def actor(key, x, y, label, note=None):
    ACT[key] = (x, y)
    add(f'<g stroke="#222" stroke-width="1.8" fill="none">'
        f'<circle cx="{x}" cy="{y-38}" r="11" fill="#fff"/>'
        f'<line x1="{x}" y1="{y-27}" x2="{x}" y2="{y+5}"/>'
        f'<line x1="{x-20}" y1="{y-15}" x2="{x+20}" y2="{y-15}"/>'
        f'<line x1="{x}" y1="{y+5}" x2="{x-16}" y2="{y+30}"/>'
        f'<line x1="{x}" y1="{y+5}" x2="{x+16}" y2="{y+30}"/></g>')
    text(x, y + 47, label, 13, weight="bold")
    if note:
        text(x, y + 64 + 7 * (label.count("\n")), note, 11, style="italic", fill="#444")

def edge_point(key, tx, ty):
    if key in UC:
        cx, cy, a, b = UC[key]
        dx, dy = tx - cx, ty - cy
        t = 1 / math.sqrt((dx / a) ** 2 + (dy / b) ** 2)
        return cx + dx * t, cy + dy * t
    x, y = ACT[key]
    return (x + (22 if tx > x else -22), y - 8)

def center(key):
    return UC[key][:2] if key in UC else (ACT[key][0], ACT[key][1] - 8)

def assoc(a, b):
    (ax, ay), (bx, by) = center(a), center(b)
    x1, y1 = edge_point(a, bx, by); x2, y2 = edge_point(b, ax, ay)
    add(f'<line x1="{x1:.1f}" y1="{y1:.1f}" x2="{x2:.1f}" y2="{y2:.1f}" stroke="#333" stroke-width="1.3"/>')

def dep(a, b, label, lx=0, ly=-10):
    """dashed arrow a -> b with open arrowhead and a stereotype label"""
    (ax, ay), (bx, by) = center(a), center(b)
    x1, y1 = edge_point(a, bx, by); x2, y2 = edge_point(b, ax, ay)
    add(f'<line x1="{x1:.1f}" y1="{y1:.1f}" x2="{x2:.1f}" y2="{y2:.1f}" stroke="#333" stroke-width="1.2" stroke-dasharray="7,5"/>')
    ang = math.atan2(y2 - y1, x2 - x1)
    for s in (+1, -1):
        hx = x2 - 12 * math.cos(ang + s * 0.42); hy = y2 - 12 * math.sin(ang + s * 0.42)
        add(f'<line x1="{x2:.1f}" y1="{y2:.1f}" x2="{hx:.1f}" y2="{hy:.1f}" stroke="#333" stroke-width="1.3"/>')
    mx, my = (x1 + x2) / 2 + lx, (y1 + y2) / 2 + ly
    lines = label.split("\n")
    bw = max(len(l) for l in lines) * 6.6 + 8; bh = len(lines) * 13 + 4
    add(f'<rect x="{mx-bw/2:.1f}" y="{my-bh/2:.1f}" width="{bw:.1f}" height="{bh}" fill="#fff" opacity="0.92"/>')
    text(mx, my, label, 11, fill="#222")

def gen(child, parent):
    cx, cy = ACT[child]; px, py = ACT[parent]
    x1, y1 = cx, cy - 52; x2, y2 = px, py + 62
    ang = math.atan2(y2 - y1, x2 - x1)
    bx, by = x2 - 16 * math.cos(ang), y2 - 16 * math.sin(ang)
    add(f'<line x1="{x1}" y1="{y1}" x2="{bx:.1f}" y2="{by:.1f}" stroke="#333" stroke-width="1.3"/>')
    p1 = (bx + 9 * math.sin(ang), by - 9 * math.cos(ang)); p2 = (bx - 9 * math.sin(ang), by + 9 * math.cos(ang))
    add(f'<polygon points="{x2},{y2} {p1[0]:.1f},{p1[1]:.1f} {p2[0]:.1f},{p2[1]:.1f}" fill="#fff" stroke="#333" stroke-width="1.3"/>')

# ---------------------------------------------------------------- canvas
add(f'<svg xmlns="http://www.w3.org/2000/svg" width="{W}" height="{H}" viewBox="0 0 {W} {H}">')
add(f'<rect width="{W}" height="{H}" fill="#fff"/>')
text(W / 2, 30, "SmartFix: Use Case Diagram", 20, weight="bold")

# system boundary
add('<rect x="300" y="60" width="900" height="1035" rx="6" fill="#FAFAFA" stroke="#333" stroke-width="1.5"/>')
text(318, 82, "SmartFix system", 14, anchor="start", weight="bold")

A, B, C = 470, 760, 1030
# resident
usecase("submit", A, 140, "Submit infrastructure\nreport (FR-1)")
usecase("photo", B, 112, "Attach photo")
usecase("pin", B, 175, "Pin location on map")
usecase("track", A, 230, "Track report status")
usecase("notify", A, 320, "Receive status\nnotification (FR-12)")
usecase("confirm", A, 420, "Confirm repair (FR-10)")
usecase("dispute", A, 525, "Dispute repair (FR-9)")
usecase("classify", 930, 615, "Classify report and\nrate severity (FR-2)")
usecase("merge", 705, 490, "Merge duplicate\nreport (FR-3)")
usecase("flag", 640, 740, "Flag report for\nreview (FR-4)")
# operator
usecase("map", C, 205, "View live issue map (FR-13)")
usecase("filter", C, 120, "Filter by status, type or severity")
usecase("review", C, 280, "Review flagged report\n(approve or reject)")
usecase("reassign", C, 350, "Reassign work order (FR-13)")
usecase("timeline", C, 420, "View issue timeline (FR-14)")
usecase("stats", C, 490, "View repair statistics (FR-15)")
# crew
usecase("viewwo", A, 690, "View assigned work\norders (FR-7)")
usecase("status", A, 775, "Update work order\nstatus (FR-7)")
usecase("complete", A, 860, "Complete repair (FR-7)")
usecase("after", B, 860, "Upload after photo")
usecase("verify", C, 790, "Verify repair from before\nand after photos (FR-8)")
# scheduler / supervisor
usecase("escalate", A, 960, "Escalate overdue\nwork order (FR-11)")
usecase("autoclose", A, 1045, "Auto-close issue after\n7 days with no reply (FR-10)")
usecase("alert", C, 960, "Receive escalation alert")

# actors
actor("resident", 120, 290, "Resident")
actor("crew", 120, 790, "Crew Member")
actor("sched", 120, 1015, "Deadline\nScheduler", "<<timer>>")
actor("operator", 1390, 320, "City Operator")
actor("ai", 1390, 715, "AI Vision Model", "<<system>> Ollama, local")
actor("super", 1390, 960, "Supervisor")

for u in ["submit", "track", "notify", "confirm"]: assoc("resident", u)
for u in ["map", "review", "reassign", "timeline", "stats"]: assoc("operator", u)
for u in ["viewwo", "status", "complete"]: assoc("crew", u)
for u in ["escalate", "autoclose"]: assoc("sched", u)
assoc("classify", "ai"); assoc("verify", "ai"); assoc("alert", "super")

dep("submit", "photo", "<<include>>", ly=-12)
dep("submit", "pin", "<<include>>", lx=0, ly=10)
dep("submit", "classify", "<<include>>", lx=40, ly=-10)
dep("merge", "classify", "<<extend>>\n[open issue of same\ntype within 50 m]", lx=-75, ly=-6)
dep("flag", "classify", "<<extend>>\n[low confidence or\nnot infrastructure]", lx=40, ly=10)
dep("dispute", "confirm", "<<extend>>\n[resident says\nnot fixed]", lx=-66, ly=0)
dep("filter", "map", "<<extend>>", lx=40, ly=0)
dep("complete", "after", "<<include>>", ly=14)
dep("complete", "verify", "<<include>>", lx=110, ly=-26)
dep("escalate", "alert", "<<include>>", ly=-12)

# ---------------------------------------------------------------- actor generalization inset
add('<rect x="300" y="1125" width="900" height="285" rx="6" fill="#fff" stroke="#999" stroke-dasharray="6,4"/>')
text(318, 1147, "Actor generalization: every user logs in; each role inherits it", 12.5, anchor="start", style="italic", fill="#444")
actor("user", 560, 1215, "User")
for k, x in [("g_res", 380), ("g_op", 500), ("g_crew", 620), ("g_sup", 740)]:
    pass
ACT["g_res"] = (390, 1352); ACT["g_op"] = (510, 1352); ACT["g_crew"] = (630, 1352); ACT["g_sup"] = (750, 1352)
for k, lab in [("g_res", "Resident"), ("g_op", "City Operator"), ("g_crew", "Crew Member"), ("g_sup", "Supervisor")]:
    x, y = ACT[k]
    add(f'<g stroke="#222" stroke-width="1.6" fill="none"><circle cx="{x}" cy="{y-30}" r="8" fill="#fff"/>'
        f'<line x1="{x}" y1="{y-22}" x2="{x}" y2="{y+2}"/><line x1="{x-14}" y1="{y-12}" x2="{x+14}" y2="{y-12}"/>'
        f'<line x1="{x}" y1="{y+2}" x2="{x-11}" y2="{y+20}"/><line x1="{x}" y1="{y+2}" x2="{x+11}" y2="{y+20}"/></g>')
    text(x, y + 35, lab, 12)

px, py = 560, 1277
add(f'<polygon points="{px},{py} {px-10},{py+16} {px+10},{py+16}" fill="#fff" stroke="#333" stroke-width="1.3"/>')
add(f'<line x1="{px}" y1="{py+16}" x2="{px}" y2="{py+30}" stroke="#333" stroke-width="1.3"/>')
add(f'<line x1="390" y1="{py+30}" x2="750" y2="{py+30}" stroke="#333" stroke-width="1.3"/>')
for k in ["g_res","g_op","g_crew","g_sup"]:
    x, y = ACT[k]
    add(f'<line x1="{x}" y1="{py+30}" x2="{x}" y2="{y-39}" stroke="#333" stroke-width="1.3"/>')
usecase("login", 980, 1215, "Log in")
assoc("user", "login")
add('<rect x="880" y="1170" width="200" height="90" rx="4" fill="none" stroke="#333" stroke-width="1"/>')
text(980, 1184, "SmartFix system", 10.5, weight="bold")

# legend
text(1210, 1120, "", 1)
add('</svg>')
svg = "\n".join(out)
open("use_case.svg", "w").write(svg)
cairosvg.svg2png(bytestring=svg.encode(), write_to="use_case.png", output_width=W * 2)
print("ok")
