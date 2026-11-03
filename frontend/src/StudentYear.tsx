// The student list with everything at a glance, student ID cards, end-of-year promotion and leaving letters.
import { useEffect, useMemo, useState, type ReactNode } from "react";
import { api, errorText, type SchoolClass } from "./api";
import { useBusy } from "./GrowthBits";
import Icon from "./Icon";
import { STAGE_LOOK, stageOf } from "./look";
import { go, href } from "./router";
import { PrintSheet, Qr } from "./Scanner";
import { Avatar, Field, hue, Modal } from "./ui";

// ---------- API ----------

export interface ListRow {
  id: string; admission_no: string; first_name: string; middle_name: string | null; last_name: string; nickname: string | null; gender: string;
  boarding_status: string; status: string; date_of_birth: string | null; thumb: string | null; class_id: string | null; class_name: string | null; level: string | null;
  house_id: string | null; house: string | null; house_colour: string | null; leadership: string | null; state_of_origin: string | null; lga: string | null; religion: string | null;
  parent: string | null; allergy: string | null; late_books: number; attendance: number | null; points: number; missing: string[]; complete: number;
}
interface Card { id: string; name: string; admission_no: string; class_name: string | null; house: string | null; house_colour: string | null; photo: string | null; boarder: boolean; code: string }
interface SchoolHead { name: string; logo: string | null; colour: string | null; motto: string | null; address: string | null; phone: string | null; email?: string | null; approval_number?: string | null }
interface Plan {
  classes: { class_id: string; name: string; level: string; students: number; to: string; to_name: string; missing_arm: boolean }[];
  options: { id: string; name: string }[]; no_class: number;
  runs: { id: string; label: string; at: string; undone: boolean; summary: { promoted: number; graduated: number; held: number }; by: string | null }[];
}
export interface LetterData {
  school: SchoolHead; head: string | null; today: string;
  student: { name: string; first_name: string; gender: string; admission_no: string; date_of_birth: string | null; class_name: string | null; admitted_on: string | null;
    entry_class: string | null; left_on: string | null; status: string; next_school: string | null; leave_reason: string | null; leadership: string | null; state_of_origin: string | null };
  record: { attendance: number | null; points: number; awards: string[] };
}

export const yapi = {
  list: (sid: string, bid: string, left: boolean) => api.raw<ListRow[]>("GET", `/api/schools/${sid}/student-list?branch_id=${bid}${left ? "&include_left=true" : ""}`),
  cards: (sid: string, q: string) => api.raw<{ school: SchoolHead; session: string; cards: Card[] }>("GET", `/api/schools/${sid}/student-cards?${q}`),
  plan: (sid: string) => api.raw<Plan>("GET", `/api/schools/${sid}/promotion/plan`),
  run: (sid: string, body: unknown) => api.raw<{ id: string; promoted: number; graduated: number; held: number }>("POST", `/api/schools/${sid}/promotion/run`, body),
  undo: (rid: string) => api.raw<{ restored: number }>("POST", `/api/promotion-runs/${rid}/undo`),
  leave: (id: string, body: unknown) => api.raw<{ status: string }>("POST", `/api/students/${id}/leave`, body),
  letter: (id: string) => api.raw<LetterData>("GET", `/api/students/${id}/letter`),
};

/** A tiny square copy of a photo for lists (a few KB). */
export function makeThumb(dataUrl: string, size = 96): Promise<string> {
  return new Promise((ok) => {
    const img = new Image();
    img.onload = () => {
      const c = document.createElement("canvas"); c.width = c.height = size;
      const s = Math.min(img.width, img.height);
      c.getContext("2d")?.drawImage(img, (img.width - s) / 2, (img.height - s) / 3, s, s, 0, 0, size, size);
      ok(c.toDataURL("image/jpeg", 0.72));
    };
    img.onerror = () => ok("");
    img.src = dataUrl;
  });
}

const stageHue = (level: string | null) => (level ? STAGE_LOOK[stageOf(level)].hue : "slate");
const niceDate = (d: string | null) => (d ? new Date(`${d}T12:00:00`).toLocaleDateString("en-GB", { day: "numeric", month: "long", year: "numeric" }) : "–");

function Face({ r, size = 38 }: { r: Pick<ListRow, "thumb" | "first_name" | "last_name" | "house_colour">; size?: number }) {
  return (
    <span className="face" style={{ ["--hc" as string]: r.house_colour || "transparent", width: size + 6, height: size + 6 }}>
      {r.thumb ? <img src={r.thumb} alt="" width={size} height={size} /> : <Avatar name={`${r.first_name} ${r.last_name}`} size={size} />}
    </span>
  );
}

// ---------- The list ----------

type Flag = "" | "photo" | "allergy" | "books" | "attendance" | "incomplete" | "boarder" | "day" | "leaders";
type Sort = "name" | "class" | "attendance" | "points" | "complete";
const FLAGS: { key: Exclude<Flag, "">; label: string; icon: string; hue: string; test: (r: ListRow) => boolean }[] = [
  { key: "photo", label: "No photo", icon: "camera", hue: "slate", test: (r) => !r.thumb },
  { key: "incomplete", label: "Profile under 70%", icon: "clipboard-list", hue: "amber", test: (r) => r.complete < 70 },
  { key: "allergy", label: "Allergies", icon: "circle-x", hue: "red", test: (r) => !!r.allergy },
  { key: "attendance", label: "Attendance under 85%", icon: "attendance", hue: "orange", test: (r) => r.attendance != null && r.attendance < 85 },
  { key: "books", label: "Late library books", icon: "book", hue: "sky", test: (r) => r.late_books > 0 },
  { key: "leaders", label: "Prefects and leaders", icon: "crown", hue: "violet", test: (r) => !!r.leadership },
];

export function StudentListView({ rows, schoolId, classes, canChange, hasBoarding, showLeft, onChanged }: {
  rows: ListRow[]; schoolId: string; classes: SchoolClass[]; canChange: boolean; hasBoarding: boolean; showLeft: boolean; onChanged: () => void;
}) {
  const [flag, setFlag] = useState<Flag>("");
  const [house, setHouse] = useState("");
  const [sort, setSort] = useState<Sort>("name");
  const [view, setView] = useState<"list" | "faces">(() => { try { return localStorage.getItem("sp_stu_view") === "faces" ? "faces" : "list"; } catch { return "list"; } });
  const [learn, setLearn] = useState(false);
  const [limit, setLimit] = useState(60);
  useEffect(() => setLimit(60), [rows, flag, house, sort]);
  const [shown, setShown] = useState<Set<string>>(new Set());
  const [cards, setCards] = useState<string | null>(null);
  const [promote, setPromote] = useState(false);
  useEffect(() => { try { localStorage.setItem("sp_stu_view", view); } catch { /* fine */ } }, [view]);

  const houses = useMemo(() => {
    const m = new Map<string, { name: string; colour: string | null; n: number }>();
    rows.forEach((r) => { if (r.house_id) { const h = m.get(r.house_id) ?? { name: r.house!, colour: r.house_colour, n: 0 }; h.n++; m.set(r.house_id, h); } });
    return [...m.entries()].sort((a, b) => a[1].name.localeCompare(b[1].name));
  }, [rows]);
  const list = useMemo(() => {
    let x = rows;
    const f = FLAGS.find((f) => f.key === flag);
    if (f) x = x.filter(f.test);
    if (flag === "boarder" || flag === "day") x = x.filter((r) => (r.boarding_status === "boarder") === (flag === "boarder"));
    if (house) x = x.filter((r) => r.house_id === house);
    const by: Record<Sort, (a: ListRow, b: ListRow) => number> = {
      name: (a, b) => `${a.last_name} ${a.first_name}`.localeCompare(`${b.last_name} ${b.first_name}`),
      class: (a, b) => (a.class_name ?? "~").localeCompare(b.class_name ?? "~", undefined, { numeric: true }) || by.name(a, b),
      attendance: (a, b) => (a.attendance ?? 101) - (b.attendance ?? 101),
      points: (a, b) => b.points - a.points,
      complete: (a, b) => a.complete - b.complete,
    };
    return [...x].sort(by[sort]);
  }, [rows, flag, house, sort]);
  const avgComplete = rows.length ? Math.round(rows.reduce((n, r) => n + r.complete, 0) / rows.length) : 0;
  const reveal = (id: string) => setShown((s) => new Set(s).add(id));

  function download() {
    const head = ["Admission no", "Surname", "First name", "Middle name", "Class", "House", "Gender", "Day or boarding", "Date of birth", "State of origin", "LGA",
      "Parent", "Allergies", "Attendance 30 days %", "Conduct points", "Profile %", "Missing", ...(showLeft ? ["Status"] : [])];
    const q = (v: unknown) => { const t = v == null ? "" : String(v); return /[",\n]/.test(t) ? `"${t.replace(/"/g, '""')}"` : t; };
    const lines = [head, ...list.map((r) => [r.admission_no, r.last_name, r.first_name, r.middle_name, r.class_name, r.house, r.gender, r.boarding_status, r.date_of_birth,
      r.state_of_origin, r.lga, r.parent, r.allergy, r.attendance, r.points, r.complete, r.missing.join("; "), ...(showLeft ? [r.status] : [])])].map((l) => l.map(q).join(","));
    const a = document.createElement("a");
    a.href = URL.createObjectURL(new Blob(["﻿" + lines.join("\r\n")], { type: "text/csv" }));
    a.download = `students-${new Date().toISOString().slice(0, 10)}.csv`; a.click(); URL.revokeObjectURL(a.href);
  }

  return (
    <>
      <div className="stu-flags" role="group" aria-label="Quick filters">
        <span className="flag-ring" title="Average profile completeness">
          <span className="setup-ring" style={{ ...hue(avgComplete >= 80 ? "green" : avgComplete >= 50 ? "amber" : "red"), ["--pct" as string]: `${avgComplete}%` }}><b>{avgComplete}%</b></span>
          <small>profiles<br />complete</small>
        </span>
        {FLAGS.map((f) => {
          const n = rows.filter(f.test).length;
          return (
            <button key={f.key} className={`flag-chip${flag === f.key ? " on" : ""}`} style={hue(f.hue as never)} disabled={!n && flag !== f.key}
                    onClick={() => setFlag(flag === f.key ? "" : f.key)}>
              <Icon name={f.icon} size={14} /><b>{n}</b>{f.label}
            </button>
          );
        })}
        {hasBoarding && (["boarder", "day"] as const).map((k) => (
          <button key={k} className={`flag-chip${flag === k ? " on" : ""}`} style={hue(k === "boarder" ? "indigo" : "amber")} onClick={() => setFlag(flag === k ? "" : k)}>
            <Icon name={k === "boarder" ? "bed" : "sun"} size={14} /><b>{rows.filter((r) => (r.boarding_status === "boarder") === (k === "boarder")).length}</b>{k === "boarder" ? "Boarders" : "Day"}
          </button>
        ))}
      </div>

      <div className="toolbar stu-list-bar">
        {houses.length > 0 && (
          <div className="house-pills" role="group" aria-label="Filter by house">
            {houses.map(([id, h]) => (
              <button key={id} className={house === id ? "on" : ""} style={{ ["--hc" as string]: h.colour || "#888" }} onClick={() => setHouse(house === id ? "" : id)}>
                <span className="house-dot" />{h.name}<small>{h.n}</small>
              </button>
            ))}
          </div>
        )}
        <span className="grow" />
        <label className="sort-pick"><span className="muted small">Sort</span>
          <select value={sort} onChange={(e) => setSort(e.target.value as Sort)}>
            <option value="name">Name</option><option value="class">Class</option><option value="attendance">Lowest attendance</option>
            <option value="points">Most conduct points</option><option value="complete">Least complete</option>
          </select>
        </label>
        <div className="segmented small-seg" role="group" aria-label="View">
          <button className={view === "list" ? "on" : ""} onClick={() => setView("list")}><Icon name="list" size={14} />List</button>
          <button className={view === "faces" ? "on" : ""} onClick={() => setView("faces")}><Icon name="grid" size={14} />Faces</button>
        </div>
        <button className="with-icon" onClick={download} disabled={!list.length}><Icon name="download" size={15} />Download</button>
        <button className="with-icon" onClick={() => setCards(`ids=${list.slice(0, 400).map((r) => r.id).join(",")}`)} disabled={!list.length}><Icon name="id-card" size={15} />ID cards</button>
        {canChange && <button className="with-icon accent-soft" onClick={() => setPromote(true)}><Icon name="graduation-cap" size={15} />End of year</button>}
      </div>

      {list.length === 0 && <p className="muted center-text">No students match these filters. <button className="text-link" onClick={() => { setFlag(""); setHouse(""); }}>Clear filters</button></p>}

      {view === "faces" && list.length > 0 && (
        <>
          <label className="check learn-toggle"><input type="checkbox" checked={learn} onChange={(e) => { setLearn(e.target.checked); setShown(new Set()); }} />
            <span><b>Learn names</b> — hide the names, guess, then tap to check. Great for new teachers.</span></label>
          <div className={`face-wall${learn ? " learning" : ""}`}>
            {list.slice(0, limit).map((r) => (
              <div key={r.id} className="face-card" style={{ ["--hc" as string]: r.house_colour || "var(--border)" }}>
                <a href={href({ page: "student", id: r.id })} className="face-pic" aria-label={`${r.first_name} ${r.last_name}`}>
                  {r.thumb ? <img src={r.thumb} alt="" /> : <Avatar name={`${r.first_name} ${r.last_name}`} size={72} />}
                  {r.allergy && <span className="face-badge red" title={`Allergic: ${r.allergy}`}><Icon name="circle-x" size={12} /></span>}
                  {r.leadership && <span className="face-badge amber left" title={r.leadership}><Icon name="crown" size={12} /></span>}
                </a>
                {learn && !shown.has(r.id)
                  ? <button className="face-guess" onClick={() => reveal(r.id)}>Who is this?</button>
                  : <span className="face-name"><b>{r.nickname || r.first_name}</b> {r.last_name}<small>{r.class_name ?? "No class"}{r.house ? ` · ${r.house}` : ""}</small></span>}
              </div>
            ))}
          </div>
          {learn && <p className="muted small center-text">{shown.size} of {list.length} checked</p>}
        </>
      )}

      {view === "list" && list.length > 0 && (
        <div className="table-wrap people-table stu-table">
          <table>
            <thead>
              <tr>
                <th>Student</th><th>Class</th><th className="hide-small">House</th><th className="hide-small">Attendance</th>
                <th className="hide-small">Points</th><th>Profile</th>{showLeft && <th>Status</th>}
              </tr>
            </thead>
            <tbody>
              {list.slice(0, limit).map((r) => (
                <tr key={r.id} className="clickable" onClick={() => go({ page: "student", id: r.id })}>
                  <td>
                    <span className="person">
                      <Face r={r} />
                      <span>
                        <a href={href({ page: "student", id: r.id })} onClick={(e) => e.stopPropagation()}>{r.last_name}, {r.first_name}{r.middle_name ? ` ${r.middle_name}` : ""}</a>
                        <span className="muted small block"><span className="mono">{r.admission_no}</span>
                          {r.boarding_status === "boarder" && hasBoarding && <> · <Icon name="bed" size={11} /> boarder</>}
                          {r.leadership && <> · <span className="lead-tag">{r.leadership}</span></>}</span>
                      </span>
                      <span className="row-alerts">
                        {r.allergy && <span className="alert-dot red" title={`Allergic: ${r.allergy}`}><Icon name="circle-x" size={12} /></span>}
                        {r.late_books > 0 && <span className="alert-dot sky" title={`${r.late_books} late library book${r.late_books > 1 ? "s" : ""}`}><Icon name="book" size={12} /></span>}
                      </span>
                    </span>
                  </td>
                  <td>{r.class_name ? <span className="class-chip" style={hue(stageHue(r.level))}>{r.class_name}</span> : <span className="muted">None</span>}</td>
                  <td className="hide-small">{r.house ? <span className="house-tag" style={{ ["--hc" as string]: r.house_colour || "#888" }}><span className="house-dot" />{r.house}</span> : <span className="muted">–</span>}</td>
                  <td className="hide-small">
                    {r.attendance == null ? <span className="muted">–</span> : (
                      <span className="att-bar" style={hue(r.attendance >= 90 ? "green" : r.attendance >= 85 ? "amber" : "red")}><span style={{ width: `${r.attendance * 0.54}px` }} /><b>{r.attendance}%</b></span>
                    )}
                  </td>
                  <td className="hide-small"><span className={`pts ${r.points > 0 ? "up" : r.points < 0 ? "down" : ""}`}>{r.points > 0 ? "+" : ""}{r.points}</span></td>
                  <td title={r.missing.length ? `Missing: ${r.missing.join(", ")}` : "Complete"}>
                    <span className="mini-ring" style={{ ...hue(r.complete >= 80 ? "green" : r.complete >= 50 ? "amber" : "red"), ["--pct" as string]: `${r.complete}%` }}><b>{r.complete}</b></span>
                  </td>
                  {showLeft && <td className="capitalize">{r.status}</td>}
                </tr>
              ))}
            </tbody>
          </table>
          <p className="muted small table-foot">{Math.min(limit, list.length)} of {list.length}{list.length < rows.length ? ` (${rows.length} in all)` : ""} {rows.length === 1 ? "student" : "students"}</p>
        </div>
      )}

      {list.length > limit && <button className="show-more" onClick={() => setLimit(limit + 100)}>Show {Math.min(100, list.length - limit)} more <span className="muted">({list.length - limit} left)</span></button>}
      {cards && <IdCards schoolId={schoolId} query={cards} onClose={() => setCards(null)} />}
      {promote && <Promotion schoolId={schoolId} rows={rows} classes={classes} onClose={() => setPromote(false)} onDone={onChanged} />}
    </>
  );
}

// ---------- ID cards ----------

export function IdCards({ schoolId, query, onClose }: { schoolId: string; query: string; onClose: () => void }) {
  const [d, setD] = useState<Awaited<ReturnType<typeof yapi.cards>> | null>(null);
  const [error, setError] = useState("");
  useEffect(() => { yapi.cards(schoolId, query).then(setD).catch((e) => setError(errorText(e))); }, [schoolId, query]);
  const colour = d?.school.colour || "#1e63d6";
  const noPhoto = d?.cards.filter((c) => !c.photo).length ?? 0;
  return (
    <PrintSheet title="Student ID cards" onClose={onClose}
                note={d ? `${d.cards.length} card${d.cards.length === 1 ? "" : "s"}, 10 to a page. Cut along the edges.${noPhoto ? ` ${noPhoto} without a photo.` : ""}` : "Loading…"}>
      {error && <p className="error">{error}</p>}
      <div className="id-cards">
        {d?.cards.map((c) => (
          <div key={c.id} className="id-card" style={{ ["--card" as string]: colour, ["--hc" as string]: c.house_colour || colour }}>
            <div className="idc-head">
              {d.school.logo ? <img src={d.school.logo} alt="" /> : <span className="idc-logo">{d.school.name[0]}</span>}
              <span><b>{d.school.name}</b>{d.school.motto && <small>{d.school.motto}</small>}</span>
            </div>
            <div className="idc-body">
              <div className="idc-photo">{c.photo ? <img src={c.photo} alt="" /> : <span>Photo</span>}</div>
              <div className="idc-text">
                <small className="idc-kind">STUDENT</small>
                <b className="idc-name">{c.name}</b>
                <span>{c.class_name ?? ""}{c.boarder ? " · Boarder" : ""}</span>
                <span className="mono">{c.admission_no}</span>
                {c.house && <span className="idc-house"><i />{c.house}</span>}
              </div>
              <div className="idc-qr"><Qr text={c.code} size={74} /><small>{d.session}</small></div>
            </div>
            <div className="idc-foot">If found, please return to the school{d.school.phone ? ` · ${d.school.phone}` : ""}</div>
          </div>
        ))}
      </div>
    </PrintSheet>
  );
}

// ---------- End of year ----------

function Promotion({ schoolId, rows, classes, onClose, onDone }: { schoolId: string; rows: ListRow[]; classes: SchoolClass[]; onClose: () => void; onDone: () => void }) {
  const [plan, setPlan] = useState<Plan | null>(null);
  const [to, setTo] = useState<Record<string, string>>({});
  const [step, setStep] = useState(1);
  const [hold, setHold] = useState<Set<string>>(new Set());
  const [q, setQ] = useState("");
  const [sure, setSure] = useState(false);
  const year = new Date().getFullYear();
  const [label, setLabel] = useState(`Promotion to ${new Date().getMonth() >= 6 ? year : year - 1}/${new Date().getMonth() >= 6 ? year + 1 : year}`);
  const [result, setResult] = useState<{ id: string; promoted: number; graduated: number; held: number } | null>(null);
  const [busy, error, run] = useBusy();
  const load = () => yapi.plan(schoolId).then((p) => { setPlan(p); setTo(Object.fromEntries(p.classes.map((c) => [c.class_id, c.to]))); });
  useEffect(() => { load().catch(() => {}); }, [schoolId]); // eslint-disable-line react-hooks/exhaustive-deps
  if (!plan) return <Modal title="End of year" onClose={onClose}><p className="muted">Loading…</p></Modal>;

  const inBranch = new Set(classes.map((c) => c.id));
  const mine = plan.classes.filter((c) => inBranch.has(c.class_id));
  const name = (id: string) => (id === "graduate" ? "Graduate" : id === "stay" ? "Stay in this class" : plan.options.find((o) => o.id === id)?.name ?? "?");
  // Warn when students would land in a class whose own students are staying put.
  const warn = mine.flatMap((c) => {
    const t = to[c.class_id];
    if (!t || t === "graduate" || t === "stay" || !c.students) return [];
    const tc = mine.find((x) => x.class_id === t);
    return tc && tc.students && to[t] === "stay" ? [`${c.name} would join ${tc.name}, whose students are staying.`] : [];
  });
  const merged = Object.entries(mine.reduce<Record<string, string[]>>((m, c) => { const t = to[c.class_id]; if (t && t !== "graduate" && t !== "stay" && c.students) (m[t] ??= []).push(c.name); return m; }, {}))
    .filter(([, v]) => v.length > 1).map(([t, v]) => `${v.join(" and ")} will all be in ${name(t)}.`);
  const moving = rows.filter((r) => r.status === "active" && r.class_id && inBranch.has(r.class_id));
  const count = { up: 0, grad: 0, stay: 0, repeat: 0 };
  moving.forEach((r) => {
    const t = to[r.class_id!];
    if (hold.has(r.id)) count.repeat++; else if (t === "graduate") count.grad++; else if (t === "stay" || !t) count.stay++; else count.up++;
  });
  const found = q.trim().length > 1 ? moving.filter((r) => `${r.first_name} ${r.last_name} ${r.admission_no}`.toLowerCase().includes(q.trim().toLowerCase()) && !hold.has(r.id)).slice(0, 8) : [];
  const lastRun = plan.runs.find((r) => !r.undone);

  async function go_() {
    await run(async () => {
      const r = await yapi.run(schoolId, { label, moves: mine.map((c) => ({ class_id: c.class_id, to: to[c.class_id] || "stay" })), hold_back: [...hold] });
      setResult(r); onDone(); await load();
    });
  }

  const Steps = () => (
    <ol className="wiz-steps">
      {["Where classes go", "Repeating", "Check and go"].map((s, i) => <li key={s} className={step === i + 1 ? "on" : step > i + 1 ? "done" : ""}><b>{step > i + 1 ? "✓" : i + 1}</b>{s}</li>)}
    </ol>
  );

  if (result) return (
    <Modal title="End of year" onClose={onClose}>
      <div className="promo-done">
        <span className="promo-burst" aria-hidden="true">🎓</span>
        <h3>All done!</h3>
        <div className="promo-nums">
          <span style={hue("green")}><b>{result.promoted}</b>moved up</span>
          <span style={hue("violet")}><b>{result.graduated}</b>graduated</span>
          <span style={hue("amber")}><b>{result.held}</b>repeating</span>
        </div>
        <p className="muted small">Every student's timeline shows the move. Bed, bus and fee records stay as they are. If something is wrong, you can undo it.</p>
        <div className="row"><button className="danger-soft with-icon" disabled={busy} onClick={() => run(async () => { await yapi.undo(result.id); setResult(null); setStep(1); onDone(); await load(); })}><Icon name="undo" size={15} />Undo this</button>
          <span className="grow" /><button className="primary" onClick={onClose}>Close</button></div>
        {error && <p className="error">{error}</p>}
      </div>
    </Modal>
  );

  return (
    <Modal title="End of year: move everyone up" onClose={onClose} wide>
      <Steps />
      {step === 1 && (
        <>
          <p className="muted small">Each class moves up one level in the same arm. The top class graduates. Change any you need to.</p>
          {plan.no_class > 0 && <p className="hint-line"><Icon name="info" size={14} />{plan.no_class} student{plan.no_class === 1 ? " is" : "s are"} not in a class and will not move.</p>}
          <div className="promo-list">
            {mine.map((c) => {
              const t = to[c.class_id];
              return (
                <div key={c.class_id} className={`promo-row${t === "graduate" ? " grad" : t === "stay" ? " stay" : ""}`}>
                  <span className="class-chip" style={hue(stageHue(c.level))}>{c.name}</span>
                  <span className="muted small promo-n">{c.students} student{c.students === 1 ? "" : "s"}</span>
                  <Icon name="arrow-right" size={16} />
                  <select value={t} onChange={(e) => setTo({ ...to, [c.class_id]: e.target.value })} aria-label={`Where ${c.name} goes`}>
                    {plan.options.filter((o) => inBranch.has(o.id) && o.id !== c.class_id).map((o) => <option key={o.id} value={o.id}>{o.name}</option>)}
                    <option value="graduate">🎓 Graduate (leave the school)</option>
                    <option value="stay">Stay in {c.name}</option>
                  </select>
                  {c.missing_arm && t === c.to && <span className="muted small">no {c.name.replace(c.level, "").trim()} arm next year</span>}
                </div>
              );
            })}
          </div>
          {[...warn, ...merged].map((w) => <p key={w} className="hint-line warn"><Icon name="info" size={14} />{w}</p>)}
          {lastRun && (
            <div className="promo-last">
              <Icon name="history" size={15} /><span>Last run: <b>{lastRun.label}</b> on {new Date(lastRun.at).toLocaleDateString("en-GB")}{lastRun.by ? ` by ${lastRun.by}` : ""} ({lastRun.summary.promoted} moved up, {lastRun.summary.graduated} graduated)</span>
              <button className="text-link danger-hover" disabled={busy} onClick={() => run(async () => { await yapi.undo(lastRun.id); onDone(); await load(); })}>Undo it</button>
            </div>
          )}
          <div className="row"><span className="grow" /><button onClick={onClose}>Cancel</button><button className="primary" onClick={() => setStep(2)}>Next</button></div>
        </>
      )}
      {step === 2 && (
        <>
          <p className="muted small">Anyone repeating their class this year? Find them here. Everyone else moves with their class.</p>
          <label className="search"><Icon name="search" size={16} /><input autoFocus placeholder="Type a name or admission number" value={q} onChange={(e) => setQ(e.target.value)} /></label>
          {found.length > 0 && (
            <ul className="pick-list">
              {found.map((r) => <li key={r.id}><button onClick={() => { setHold(new Set(hold).add(r.id)); setQ(""); }}><Face r={r} size={28} /><span>{r.first_name} {r.last_name}<small className="muted"> {r.class_name}</small></span><Icon name="plus" size={14} /></button></li>)}
            </ul>
          )}
          <div className="hold-chips">
            {[...hold].map((id) => { const r = rows.find((x) => x.id === id)!; return (
              <span key={id} className="hold-chip"><Face r={r} size={22} />{r.first_name} {r.last_name} <small>repeats {r.class_name}</small>
                <button aria-label="Remove" onClick={() => { const h = new Set(hold); h.delete(id); setHold(h); }}><Icon name="close" size={12} /></button></span>); })}
            {hold.size === 0 && <span className="muted small">Nobody repeating.</span>}
          </div>
          <div className="row"><button onClick={() => setStep(1)}>Back</button><span className="grow" /><button className="primary" onClick={() => setStep(3)}>Next</button></div>
        </>
      )}
      {step === 3 && (
        <>
          <div className="promo-nums">
            <span style={hue("green")}><b>{count.up}</b>move up</span>
            <span style={hue("violet")}><b>{count.grad}</b>graduate</span>
            <span style={hue("amber")}><b>{count.repeat}</b>repeat</span>
            {count.stay > 0 && <span style={hue("slate")}><b>{count.stay}</b>stay</span>}
          </div>
          <Field label="Name for this (shows on each student's timeline)"><input value={label} onChange={(e) => setLabel(e.target.value)} maxLength={80} /></Field>
          <label className="check"><input type="checkbox" checked={sure} onChange={(e) => setSure(e.target.checked)} />I have checked the classes. (You can undo this later if needed.)</label>
          {error && <p className="error">{error}</p>}
          <div className="row"><button onClick={() => setStep(2)}>Back</button><span className="grow" />
            <button className="primary with-icon" disabled={!sure || busy || label.trim().length < 2} onClick={go_}><Icon name="graduation-cap" size={16} />{busy ? "Moving…" : `Move ${count.up + count.grad} students`}</button></div>
        </>
      )}
    </Modal>
  );
}

// ---------- Leaving ----------

const REASONS = ["Moved to another school", "Family moved away", "Finished school", "Fees", "Health", "Asked to leave", "Other"];

export function LeaveForm({ studentId, name, status, onClose, onDone }: { studentId: string; name: string; status: string; onClose: () => void; onDone: () => void }) {
  const [kind, setKind] = useState<"withdrawn" | "graduated">("withdrawn");
  const [on, setOn] = useState(new Date().toISOString().slice(0, 10));
  const [reason, setReason] = useState(REASONS[0]);
  const [other, setOther] = useState("");
  const [next, setNext] = useState("");
  const [busy, error, run] = useBusy();
  if (status !== "active") return (
    <Modal title="Back on the roll?" onClose={onClose}>
      <p>{name} is not on the roll at the moment. Bring them back as an active student?</p>
      {error && <p className="error">{error}</p>}
      <div className="row"><span className="grow" /><button onClick={onClose}>Cancel</button>
        <button className="primary" disabled={busy} onClick={() => run(async () => { await yapi.leave(studentId, { status: "active" }); onDone(); })}>Bring back</button></div>
    </Modal>
  );
  return (
    <Modal title={`${name} is leaving`} onClose={onClose}>
      <form className="stack" onSubmit={(e) => { e.preventDefault(); run(async () => { await yapi.leave(studentId, { status: kind, left_on: on, reason: reason === "Other" ? other || null : reason, next_school: next || null }); onDone(); }); }}>
        <div className="segmented" role="group">
          <button type="button" className={kind === "withdrawn" ? "on" : ""} onClick={() => { setKind("withdrawn"); setReason(REASONS[0]); }}>Leaving early</button>
          <button type="button" className={kind === "graduated" ? "on" : ""} onClick={() => { setKind("graduated"); setReason("Finished school"); }}>🎓 Graduated</button>
        </div>
        <div className="form-grid">
          <Field label="Last day"><input type="date" value={on} onChange={(e) => setOn(e.target.value)} required /></Field>
          <Field label="Reason"><select value={reason} onChange={(e) => setReason(e.target.value)}>{REASONS.map((r) => <option key={r}>{r}</option>)}</select></Field>
          {reason === "Other" && <Field label="Say why"><input value={other} onChange={(e) => setOther(e.target.value)} maxLength={200} /></Field>}
          <Field label="Next school (if known)"><input value={next} onChange={(e) => setNext(e.target.value)} maxLength={150} placeholder="e.g. Loyola Jesuit College" /></Field>
        </div>
        <p className="hint-line"><Icon name="info" size={14} />Their bed and bus seat are freed. Their record stays, and you can print a transfer letter or testimonial afterwards.</p>
        {error && <p className="error">{error}</p>}
        <div className="row"><span className="grow" /><button type="button" onClick={onClose}>Cancel</button><button className="primary" disabled={busy}>Save</button></div>
      </form>
    </Modal>
  );
}

// ---------- Letters ----------

export function Letter({ studentId, kind, onClose }: { studentId: string; kind: "transfer" | "testimonial"; onClose: () => void }) {
  const [d, setD] = useState<LetterData | null>(null);
  const [error, setError] = useState("");
  useEffect(() => { yapi.letter(studentId).then(setD).catch((e) => setError(errorText(e))); }, [studentId]);
  const title = kind === "transfer" ? "Transfer letter" : "Testimonial";
  if (!d) return <PrintSheet title={title} onClose={onClose}>{error ? <p className="error">{error}</p> : <p>Loading…</p>}</PrintSheet>;
  const st = d.student, f = st.gender === "female";
  const he = f ? "she" : "he", his = f ? "her" : "his", him = f ? "her" : "him", He = f ? "She" : "He", His = f ? "Her" : "His";
  const conduct = d.record.points >= 20 ? "excellent" : d.record.points >= 0 ? "good" : "fair";
  const from = st.admitted_on ? niceDate(st.admitted_on) : null, to = st.left_on ? niceDate(st.left_on) : null;
  const paras: ReactNode[] = kind === "transfer" ? [
    <>This is to confirm that <b>{st.name}</b> (admission number {st.admission_no}){st.date_of_birth ? `, born on ${niceDate(st.date_of_birth)},` : ""} was a student of {d.school.name}
      {from ? ` from ${from}` : ""}{st.entry_class ? `, joining in ${st.entry_class}` : ""}{to ? ` until ${to}` : ""}.</>,
    <>{He} was last in <b>{st.class_name ?? "–"}</b>{st.status === "graduated" ? ` and completed ${his} studies with us` : ""}.{st.next_school ? ` ${He} is moving to ${st.next_school}.` : ""}</>,
    <>{His} attendance was {d.record.attendance != null ? `${d.record.attendance}% of school days` : "regular"} and {his} conduct was {conduct}. {He} leaves the school in good standing and owes no property of the school.</>,
    <>We wish {him} every success and will gladly answer any questions from {his} new school.</>,
  ] : [
    <>This is to certify that <b>{st.name}</b> (admission number {st.admission_no}) was a student of {d.school.name}{from ? ` from ${from}` : ""}{to ? ` to ${to}` : ""}
      {st.class_name ? `, reaching ${st.class_name}` : ""}.</>,
    <>During {his} time here, {he} was {conduct === "excellent" ? "a model student, respectful and hardworking" : conduct === "good" ? "well behaved, respectful and hardworking" : "a student who grew in maturity and self-discipline"}.
      {st.leadership ? ` ${He} served as ${st.leadership}.` : ""}{d.record.awards.length ? ` ${His} achievements include ${d.record.awards.join(", ")}.` : ""}</>,
    <>{His} attendance was {d.record.attendance != null ? `${d.record.attendance}%` : "regular"}. We are pleased to recommend {him} to any institution or employer.</>,
  ];
  return (
    <PrintSheet title={title} onClose={onClose} note="Click any line to change the wording before you print.">
      <article className="letter" style={{ ["--card" as string]: d.school.colour || "#1e63d6" }}>
        <header className="lt-head">
          {d.school.logo && <img src={d.school.logo} alt="" />}
          <div><h1>{d.school.name}</h1>{d.school.motto && <em>{d.school.motto}</em>}
            <small>{[d.school.address, d.school.phone, d.school.email].filter(Boolean).join(" · ")}</small>
            {d.school.approval_number && <small>Approval no. {d.school.approval_number}</small>}</div>
        </header>
        <div className="lt-meta"><span>Ref: {st.admission_no}/{kind === "transfer" ? "TR" : "TM"}</span><span>{niceDate(d.today)}</span></div>
        {kind === "transfer" && <p contentEditable suppressContentEditableWarning>To the Principal{st.next_school ? `, ${st.next_school}` : ""}</p>}
        {kind === "testimonial" && <p contentEditable suppressContentEditableWarning>To whom it may concern</p>}
        <h2>{kind === "transfer" ? `Transfer: ${st.name}` : "Testimonial"}</h2>
        {paras.map((p, i) => <p key={i} contentEditable suppressContentEditableWarning>{p}</p>)}
        <div className="lt-sign">
          <span className="lt-line" />
          <b contentEditable suppressContentEditableWarning>{d.head ?? " "}</b>
          <span contentEditable suppressContentEditableWarning>Principal</span>
          <span className="lt-stamp">School stamp</span>
        </div>
      </article>
    </PrintSheet>
  );
}
