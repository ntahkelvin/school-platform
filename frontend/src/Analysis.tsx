// Analysis from official (approved) marks: the school dashboard, a head of department's view, and one student's picture.
// Every figure is a percentage of the marks available in the approved tests so far. Charts are plain SVG/HTML.
import { Fragment, useEffect, useState, type ReactNode } from "react";
import { api, errorText, type Me } from "./api";
import { gradeHue } from "./Assessment";
import Icon from "./Icon";
import Layout from "./Layout";
import { subjectLook } from "./look";
import { href } from "./router";
import { Avatar, Glyph, hue, Stat } from "./ui";

interface Trend { term: string; average: number | null; pass: number | null; students: number }
interface School {
  school: { id: string; name: string }; term: { id: string; name: string; session: string; terms: { id: string; name: string }[] }; limited_to: string | null; previous_term: string | null;
  kpis: { students: number; average: number | null; pass: number | null; credit: number | null; entries: number; previous_average: number | null; at_risk: number };
  trend: Trend[]; classes: { id: string; name: string; level: string; students: number; average: number | null; pass: number | null; credit: number | null; best: string | null; weakest: string | null; previous: number | null }[];
  levels: string[]; subjects: { id: string; name: string; average: number | null; pass: number | null; credit: number | null; entries: number; levels: Record<string, number | null> }[];
  grades: { grade: string; min: number; max: number; remark: string; count: number }[];
  at_risk: { id: string; name: string; class_name: string | null; thumb: string | null; average: number | null; previous: number | null; reasons: string[]; weak: string[] }[];
  improved: { id: string; name: string; class_name: string | null; average: number; previous: number; change: number }[];
  top: { id: string; name: string; class_name: string | null; thumb: string | null; average: number; subjects: number }[];
  gender: Record<string, { average: number | null; students: number }>; houses: { name: string; colour: string | null; average: number | null; students: number }[];
  teachers: { scope: string; teacher: string; subject: string; group: string; students: number; average: number | null; pass: number | null; ca: number | null; exam: number | null; gap: number | null;
    book_compared: number; book_differ: number; queries: number; corrected: number }[];
  quality: { teacher: string; compared: number; differ: number; queries: number; corrected: number; sheets: number; differ_rate: number | null }[];
  waec: { id: string; name: string; class_name: string; english: number | null; maths: number | null; credits: number; on_track: boolean; short: string[] }[];
  pass_mark: number; credit_mark: number;
}
interface Picture { term: unknown; source: string; average: number | null; class_average: number | null; class_size?: number;
  subjects: { subject: string; percent: number; class_average: number | null; vs_class: number | null; history: { term: string; percent: number }[] }[];
  strengths: string[]; weak: string[]; overall: { term: string; average: number | null }[]; pass_mark?: number; credit_mark?: number }

const pc = (n: number | null | undefined) => (n == null ? "–" : `${Number.isInteger(n) ? n : n.toFixed(1)}%`);
const bandHue = (v: number | null | undefined) => (v == null ? "slate" : v >= 75 ? "green" : v >= 60 ? "teal" : v >= 50 ? "sky" : v >= 40 ? "amber" : "red");

// ---------- Charts (plain SVG and HTML) ----------

/** One line over terms, 0–100%, with a dot and value on each point and a hover readout. */
export function LineTrend({ points, height = 180, label }: { points: { label: string; value: number | null; note?: string }[]; height?: number; label: string }) {
  const [hover, setHover] = useState<number | null>(null);
  const pts = points.filter((p) => p.value != null) as { label: string; value: number; note?: string }[];
  if (pts.length === 0) return <p className="muted small">No marks yet.</p>;
  const W = 600, H = height, L = 34, R = 18, T = 14, B = 30;
  const lo = Math.max(0, Math.floor((Math.min(...pts.map((p) => p.value)) - 10) / 10) * 10), hi = Math.min(100, Math.ceil((Math.max(...pts.map((p) => p.value)) + 8) / 10) * 10);
  const x = (i: number) => L + (pts.length === 1 ? (W - L - R) / 2 : (i * (W - L - R)) / (pts.length - 1));
  const y = (v: number) => T + ((hi - v) * (H - T - B)) / Math.max(1, hi - lo);
  const ticks = [lo, Math.round((lo + hi) / 2), hi];
  return (
    <div className="an-chart" onMouseLeave={() => setHover(null)}>
      <svg viewBox={`0 0 ${W} ${H}`} role="img" aria-label={label}>
        {ticks.map((t) => <g key={t}><line x1={L} x2={W - R} y1={y(t)} y2={y(t)} className="an-grid" /><text x={L - 6} y={y(t) + 4} className="an-tick" textAnchor="end">{t}</text></g>)}
        <polyline points={pts.map((p, i) => `${x(i)},${y(p.value)}`).join(" ")} className="an-line" />
        {pts.map((p, i) => <g key={i}>
          <circle cx={x(i)} cy={y(p.value)} r={hover === i ? 6 : 4.5} className="an-dot" />
          <rect x={x(i) - 24} y={T} width={48} height={H - T - B} fill="transparent" onMouseEnter={() => setHover(i)} onFocus={() => setHover(i)} tabIndex={0} />
          <text x={x(i)} y={H - 10} className="an-tick" textAnchor="middle">{p.label}</text>
          {(i === pts.length - 1 || hover === i) && <text x={x(i)} y={y(p.value) - 10} className="an-val" textAnchor="middle">{pc(p.value)}</text>}
        </g>)}
      </svg>
      {hover != null && pts[hover].note && <div className="an-tip" style={{ left: `${(100 * x(hover)) / W}%` }}><b>{pc(pts[hover].value)}</b><span>{pts[hover].label} · {pts[hover].note}</span></div>}
    </div>
  );
}

/** Horizontal bars 0–100% with an optional marker (e.g. the class average) and value at the tip. */
export function HBars({ rows, marker = "class average", fixed }: { rows: { label: ReactNode; key: string; value: number | null; ref?: number | null; note?: string }[]; marker?: string; fixed?: string }) {
  return (
    <div className="an-hbars">
      {rows.map((r) => (
        <div key={r.key} className="an-hbar" title={`${typeof r.label === "string" ? r.label : r.key}: ${pc(r.value)}${r.ref != null ? ` · ${marker} ${pc(r.ref)}` : ""}${r.note ? ` · ${r.note}` : ""}`}>
          <span className="an-hbar-label">{r.label}</span>
          <span className="an-hbar-track" style={hue(fixed ?? bandHue(r.value))}>
            <span className="an-hbar-fill" style={{ width: `${Math.max(1, r.value ?? 0)}%` }} />
            {r.ref != null && <i className="an-hbar-ref" style={{ left: `${r.ref}%` }} />}
          </span>
          <b className="an-hbar-val">{pc(r.value)}</b>
        </div>
      ))}
    </div>
  );
}

function GradeColumns({ grades }: { grades: School["grades"] }) {
  const most = Math.max(1, ...grades.map((g) => g.count));
  const total = grades.reduce((n, g) => n + g.count, 0) || 1;
  return (
    <div className="an-cols">
      {grades.map((g) => (
        <div key={g.grade} className="an-col" title={`${g.grade} (${g.min}–${g.max}, ${g.remark}): ${g.count} · ${Math.round((100 * g.count) / total)}%`} style={hue(gradeHue(g.grade))}>
          <small>{g.count}</small><i style={{ height: `${4 + (120 * g.count) / most}px` }} /><b>{g.grade}</b></div>))}
    </div>
  );
}

// ---------- School dashboard ----------

type View = "overview" | "classes" | "students" | "teachers" | "waec";

export function SchoolAnalysis({ schoolId }: { schoolId: string }) {
  const [d, setD] = useState<School | null>(null);
  const [term, setTerm] = useState<string | null>(null);
  const [view, setView] = useState<View>("overview");
  const [error, setError] = useState("");
  const [loading, setLoading] = useState(false);
  useEffect(() => { setLoading(true); api.raw<School>("GET", `/api/schools/${schoolId}/analysis${term ? `?term_id=${term}` : ""}`).then(setD).catch((e) => setError(errorText(e))).finally(() => setLoading(false)); }, [schoolId, term]);
  if (error) return <p className="error">{error}</p>;
  if (!d) return <div className="skeleton"><span /><span /><span /></div>;
  const k = d.kpis;
  const change = k.average != null && k.previous_average != null ? k.average - k.previous_average : null;
  const views: [View, string, string][] = [["overview", "Overview", "chart"], ["classes", "Classes and subjects", "classes"], ["students", "Students", "students"], ["teachers", "Teachers", "presentation"],
    ...(d.waec.length ? [["waec", "WAEC readiness", "graduation-cap"] as [View, string, string]] : [])];
  return (
    <section className={`stack an${loading ? " an-loading" : ""}`}>
      <div className="row wrap">
        <p className="muted grow">From approved marks only, as a percentage of the marks available so far.{d.limited_to ? <> Showing <b>{d.limited_to}</b>.</> : null}</p>
        <label className="term-pick"><Icon name="calendar-range" size={15} /><select value={d.term.id} onChange={(e) => setTerm(e.target.value)}>{d.term.terms.map((t) => <option key={t.id} value={t.id}>{t.name} {d.term.session}</option>)}</select></label>
      </div>
      <div className="segmented an-views">{views.map(([v, l, i]) => <button key={v} className={view === v ? "on" : ""} onClick={() => setView(v)}><Icon name={i} size={14} />{l}</button>)}</div>
      {k.entries === 0 ? <div className="adm-empty"><span>📊</span><p><b>No approved marks for this term yet.</b></p><p className="muted small">Analysis starts as soon as heads approve the first tests.</p></div> : <>
        {view === "overview" && <>
          <div className="stat-strip">
            <Stat icon="chart" hue="blue" value={pc(k.average)} label="average mark" note={change != null ? `${change >= 0 ? "▲" : "▼"} ${Math.abs(change).toFixed(1)} on ${d.previous_term}` : `${k.students} students`} />
            <Stat icon="circle-check" hue="green" value={pc(k.pass)} label={`of marks ${d.pass_mark}% or more`} note={`${pc(k.credit)} at credit (${d.credit_mark}%+)`} />
            <Stat icon="heart-pulse" hue="red" value={k.at_risk} label="students to help" note="See the Students tab" />
          </div>
          <div className="sections wide">
            <section className="card editor"><h3 className="with-glyph"><Glyph icon="trending" hue="blue" size={30} />Average across terms</h3>
              <LineTrend label="School average by term" points={d.trend.map((t) => ({ label: t.term, value: t.average, note: `${t.students} students · ${pc(t.pass)} passed` }))} />
              <p className="small muted">Earlier terms only include the classes that had approved marks then.</p></section>
            <section className="card editor"><h3 className="with-glyph"><Glyph icon="award" hue="violet" size={30} />Grades</h3><GradeColumns grades={d.grades} />
              <p className="small muted">Every student's mark in every subject, graded on the school's scale.</p></section>
          </div>
          <div className="sections wide">
            <section className="card editor"><h3 className="with-glyph"><Glyph icon="trophy" hue="amber" size={30} />Top students</h3><PeopleList rows={d.top.map((t) => ({ ...t, right: pc(t.average) }))} empty="Needs at least five subjects with marks." /></section>
            <section className="card editor"><h3 className="with-glyph"><Glyph icon="users" hue="pink" size={30} />Girls, boys and houses</h3>
              <HBars marker="school" rows={[...Object.entries(d.gender).filter(([, g]) => g.students).map(([g, x]) => ({ key: g, label: `${g === "female" ? "Girls" : "Boys"} (${x.students})`, value: x.average })),
                ...d.houses.map((h) => ({ key: h.name, label: <><span className="house-dot" style={{ background: h.colour ?? "#888" }} /> {h.name}</>, value: h.average }))]} /></section>
          </div>
        </>}
        {view === "classes" && <>
          <section className="card editor"><h3 className="with-glyph"><Glyph icon="classes" hue="orange" size={30} />Classes</h3>
            <div className="as-sheet-wrap"><table className="an-table">
              <thead><tr><th className="l">Class</th><th className="l bar">Average</th><th>Change</th><th>Pass</th><th>Credit</th><th className="l">Best subject</th><th className="l">Weakest</th></tr></thead>
              <tbody>{d.classes.map((c) => <tr key={c.id}>
                <td className="l"><a href={href({ page: "results", id: c.id })}><b>{c.name}</b></a><small className="muted block">{c.students} students</small></td>
                <td className="l bar"><span className="an-inbar" style={hue(bandHue(c.average))}><i style={{ width: `${c.average ?? 0}%` }} /></span><b>{pc(c.average)}</b></td>
                <td>{c.previous != null && c.average != null ? <span className={c.average >= c.previous ? "an-up" : "an-down"}>{c.average >= c.previous ? "▲" : "▼"} {Math.abs(c.average - c.previous).toFixed(1)}</span> : <span className="muted">–</span>}</td>
                <td>{pc(c.pass)}</td><td>{pc(c.credit)}</td><td className="l small">{c.best}</td><td className="l small">{c.weakest}</td></tr>)}</tbody>
            </table></div></section>
          <section className="card editor"><h3 className="with-glyph"><Glyph icon="grid" hue="indigo" size={30} />Subjects across the levels</h3>
            <p className="small muted">Each cell is the average mark in that subject at that level. Darker is higher.</p>
            <div className="as-sheet-wrap"><table className="an-heat">
              <thead><tr><th className="l">Subject</th><th>All</th>{d.levels.map((l) => <th key={l}>{l}</th>)}</tr></thead>
              <tbody>{d.subjects.map((s) => <tr key={s.id}><td className="l"><span className="an-subj" style={hue(subjectLook(s.name).hue)}><i />{s.name}</span></td>
                <td className="an-hcell all" style={heat(s.average)} title={`${s.name}: ${pc(s.average)} · pass ${pc(s.pass)} · ${s.entries} marks`}>{pc(s.average)}</td>
                {d.levels.map((l) => <td key={l} className="an-hcell" style={heat(s.levels[l])} title={s.levels[l] != null ? `${s.name}, ${l}: ${pc(s.levels[l])}` : `${s.name} is not taken in ${l}`}>{s.levels[l] != null ? Math.round(s.levels[l]!) : ""}</td>)}</tr>)}</tbody>
            </table></div></section>
        </>}
        {view === "students" && <>
          <section className="card editor"><h3 className="with-glyph"><Glyph icon="heart-pulse" hue="red" size={30} />Students to help ({d.at_risk.length})</h3>
            <p className="small muted">Below {d.pass_mark}% in three or more subjects, an average under 45%, or down 8 points or more on last term.</p>
            {d.at_risk.length === 0 ? <p>Nobody at the moment. 🎉</p> : <ul className="an-risk">{d.at_risk.map((r) => (
              <li key={r.id}><a href={href({ page: "student", id: r.id })}>{r.thumb ? <img className="mini-face" src={r.thumb} alt="" /> : <Avatar name={r.name} size={32} />}
                <span className="grow"><b>{r.name}</b> <small className="muted">{r.class_name}</small>
                  <small className="block">{r.reasons.map((x) => <span key={x} className="hue-chip" style={hue("red")}>{x}</span>)}</small>
                  {r.weak.length > 0 && <small className="muted block">Weakest: {r.weak.join(", ")}</small>}</span>
                <span className="an-risk-num"><b>{pc(r.average)}</b>{r.previous != null && <small className="muted">was {pc(r.previous)}</small>}</span></a></li>))}</ul>}
          </section>
          <div className="sections wide">
            <section className="card editor"><h3 className="with-glyph"><Glyph icon="trending" hue="green" size={30} />Most improved</h3>
              <PeopleList rows={d.improved.map((t) => ({ ...t, thumb: null, right: `▲ ${t.change}` }))} empty={d.previous_term ? "Nobody up 6 points or more yet." : "Needs a previous term with approved marks."} /></section>
            <section className="card editor"><h3 className="with-glyph"><Glyph icon="trophy" hue="amber" size={30} />Top students</h3><PeopleList rows={d.top.map((t) => ({ ...t, right: pc(t.average) }))} empty="Needs at least five subjects with marks." /></section>
          </div>
        </>}
        {view === "teachers" && <>
          <TeacherTable rows={d.teachers} />
          <section className="card editor"><h3 className="with-glyph"><Glyph icon="shield-check" hue="teal" size={30} />Marking quality</h3>
            <p className="small muted">How often students' score books (what the teacher wrote on the script) differ from the sheet, plus queries and corrections. A high rate usually means slips when typing marks in.</p>
            {d.quality.length === 0 ? <p className="muted">No score book entries yet.</p> :
              <HBars marker="" fixed="amber" rows={d.quality.map((q) => ({ key: q.teacher, label: q.teacher, value: q.differ_rate, note: `${q.differ}/${q.compared} differ · ${q.queries} queries · ${q.corrected} corrected` }))} />}
          </section>
        </>}
        {view === "waec" && d.waec.length > 0 && <WaecView rows={d.waec} credit={d.credit_mark} />}
      </>}
    </section>
  );
}

function TeacherTable({ rows }: { rows: School["teachers"] }) {
  const [q, setQ] = useState("");
  const [open, setOpen] = useState<string | null>(null);
  const [flagged, setFlagged] = useState(false);
  const by = new Map<string, School["teachers"]>();
  for (const r of rows) by.set(r.teacher, [...(by.get(r.teacher) ?? []), r]);
  const people = [...by.entries()].map(([teacher, list]) => {
    const all = list.flatMap((r) => Array(r.students).fill(r.average));
    const gaps = list.map((r) => r.gap).filter((g): g is number => g != null);
    return { teacher, list, subjects: [...new Set(list.map((r) => r.subject))], students: list.reduce((n, r) => n + r.students, 0),
      average: all.length ? Math.round((10 * all.reduce((a, b) => a + (b ?? 0), 0)) / all.length) / 10 : null,
      worst: gaps.length ? gaps.reduce((a, b) => (Math.abs(b) > Math.abs(a) ? b : a)) : null, queries: list.reduce((n, r) => n + r.queries, 0) };
  }).filter((p) => (!q || `${p.teacher} ${p.subjects.join(" ")}`.toLowerCase().includes(q.toLowerCase())) && (!flagged || (p.worst != null && Math.abs(p.worst) >= 10)))
    .sort((a, b) => Math.abs(b.worst ?? 0) - Math.abs(a.worst ?? 0) || a.teacher.localeCompare(b.teacher));
  return (
    <section className="card editor"><h3 className="with-glyph"><Glyph icon="presentation" hue="fuchsia" size={30} />Teachers</h3>
      <p className="small muted">CA against exam: a gap of 10 points or more (amber) can mean CA marking is too generous. Shown once the exam is approved. Tap a teacher to see each class.</p>
      <div className="row wrap"><input className="grow" placeholder="Find a teacher or subject" value={q} onChange={(e) => setQ(e.target.value)} />
        <label className="row small"><input type="checkbox" checked={flagged} onChange={(e) => setFlagged(e.target.checked)} />Only gaps of 10+</label></div>
      <div className="as-sheet-wrap"><table className="an-table">
        <thead><tr><th className="l">Teacher</th><th className="l">Subjects</th><th>Classes</th><th className="l bar">Average</th><th>Largest CA–exam gap</th><th>Queries</th></tr></thead>
        <tbody>{people.map((p) => <Fragment key={p.teacher}>
          <tr className="clickable" onClick={() => setOpen(open === p.teacher ? null : p.teacher)}>
            <td className="l"><b>{open === p.teacher ? "▾" : "▸"} {p.teacher}</b></td><td className="l small">{p.subjects.join(", ")}</td><td>{p.list.length}</td>
            <td className="l bar"><span className="an-inbar" style={hue(bandHue(p.average))}><i style={{ width: `${p.average ?? 0}%` }} /></span><b>{pc(p.average)}</b></td>
            <td>{p.worst == null ? <span className="muted">–</span> : <span className={Math.abs(p.worst) >= 10 ? "an-flag" : ""}>{p.worst > 0 ? "+" : ""}{p.worst}</span>}</td><td>{p.queries || ""}</td></tr>
          {open === p.teacher && p.list.map((t) => <tr key={t.scope} className="an-sub">
            <td className="l small">↳ <a href={href({ page: "sheet", scope: t.scope })}>{t.subject} · {t.group}</a></td><td className="l small">{t.students} students · pass {pc(t.pass)}</td><td />
            <td className="l bar"><span className="an-inbar" style={hue(bandHue(t.average))}><i style={{ width: `${t.average ?? 0}%` }} /></span><b>{pc(t.average)}</b></td>
            <td className="small">CA {pc(t.ca)} · exam {pc(t.exam)}{t.gap != null && <> · <span className={Math.abs(t.gap) >= 10 ? "an-flag" : ""}>{t.gap > 0 ? "+" : ""}{t.gap}</span></>}</td>
            <td className="small">{t.queries || ""}{t.corrected ? ` (${t.corrected} fixed)` : ""}</td></tr>)}
        </Fragment>)}</tbody>
      </table></div>
      {people.length === 0 && <p className="muted small">Nobody matches.</p>}
    </section>
  );
}

function heat(v: number | null | undefined) {
  if (v == null) return {};
  const t = Math.max(0, Math.min(1, (v - 45) / 40));
  return { background: `color-mix(in srgb, #4338ca ${Math.round(6 + t * 84)}%, var(--surface))`, color: t > .5 ? "#fff" : "var(--text)" };
}

function PeopleList({ rows, empty }: { rows: { id: string; name: string; class_name: string | null; thumb?: string | null; right: string }[]; empty: string }) {
  if (!rows.length) return <p className="muted small">{empty}</p>;
  return <ol className="an-people">{rows.map((r) => <li key={r.id}><a href={href({ page: "student", id: r.id })}>{r.thumb ? <img className="mini-face" src={r.thumb} alt="" /> : <Avatar name={r.name} size={28} />}
    <span className="grow">{r.name} <small className="muted">{r.class_name}</small></span><b>{r.right}</b></a></li>)}</ol>;
}

function WaecView({ rows, credit }: { rows: School["waec"]; credit: number }) {
  const ok = rows.filter((r) => r.on_track).length;
  return (
    <section className="card editor">
      <h3 className="with-glyph"><Glyph icon="graduation-cap" hue="indigo" size={30} />WAEC readiness (SS 3)</h3>
      <p className="small muted">On track = credit ({credit}%+) in English, Mathematics and at least three other subjects, from this term's approved marks.</p>
      <div className="an-waec-head">
        <span className="as-ring" style={{ width: 96, height: 96, ["--p" as string]: `${(100 * ok) / rows.length}`, ["--hue" as string]: "#16a34a" }}><b>{Math.round((100 * ok) / rows.length)}%</b></span>
        <p><b>{ok} of {rows.length}</b> SS 3 students are on track.<br /><span className="muted">{rows.length - ok} need help in the subjects listed below.</span></p>
      </div>
      <div className="as-sheet-wrap"><table className="an-table">
        <thead><tr><th className="l">Student</th><th className="l">Class</th><th>English</th><th>Maths</th><th>Credits</th><th className="l">Short of</th></tr></thead>
        <tbody>{rows.map((r) => <tr key={r.id}><td className="l"><a href={href({ page: "student", id: r.id })}>{r.name}</a></td><td className="l">{r.class_name}</td>
          <td className={(r.english ?? 0) < credit ? "an-low" : ""}>{pc(r.english)}</td><td className={(r.maths ?? 0) < credit ? "an-low" : ""}>{pc(r.maths)}</td><td>{r.credits}</td>
          <td className="l">{r.on_track ? <span className="hue-chip" style={hue("green")}>✔ On track</span> : r.short.join(", ")}</td></tr>)}</tbody>
      </table></div>
    </section>
  );
}

export function AnalysisPage({ me, onLogout, schoolId }: { me: Me; onLogout: () => void; schoolId: string }) {
  return (
    <Layout wide me={me} onLogout={onLogout} crumbs={[{ label: "Home", href: "#/" }, { label: "Results analysis" }]}>
      <header className="class-hero as-hero" style={hue("indigo")}><span className="hero-pattern" aria-hidden="true" />
        <Glyph icon="chart" hue="indigo" size={56} /><div className="grow"><h1>Results analysis</h1><p>How classes, subjects and students are doing, from approved marks.</p></div></header>
      <SchoolAnalysis schoolId={schoolId} />
    </Layout>
  );
}

export function AnalysisCard() {
  const [d, setD] = useState<{ id: string; name: string; scope: string }[]>([]);
  useEffect(() => { api.raw<typeof d>("GET", "/api/me/analysis").then(setD).catch(() => {}); }, []);
  if (!d.length) return null;
  return (
    <section className="card editor portal-card" style={hue("indigo")}>
      <div className="card-head"><h2 className="with-glyph"><Glyph icon="chart" hue="indigo" size={34} />Results analysis</h2></div>
      <ul className="as-mini-sheets">{d.map((x) => <li key={x.id}><a href={`#/analysis/${x.id}`}><span className="grow"><b>{x.name}</b> <small className="muted">{x.scope}</small></span><Icon name="arrow-right" size={15} /></a></li>)}</ul>
    </section>
  );
}

// ---------- One student ----------

export function StudentInsights({ studentId, family, title }: { studentId: string; family: boolean; title: string }) {
  const [d, setD] = useState<Picture | null>(null);
  useEffect(() => { api.raw<Picture>("GET", family ? `/api/me/children/${studentId}/analysis` : `/api/students/${studentId}/analysis`).then(setD).catch(() => setD(null)); }, [studentId, family]);
  if (!d || !d.subjects.length) return null;
  const diff = d.average != null && d.class_average != null ? d.average - d.class_average : null;
  return (
    <section className="card editor an-me">
      <h3 className="with-glyph"><Glyph icon="sparkle" hue="violet" size={30} />{title}</h3>
      <p className="small muted">{d.source === "published" ? "From published tests." : "From approved marks."} Each bar is the mark as a percentage; the black tick is the class average.</p>
      <div className="an-me-top">
        <div className="an-me-big" style={hue(bandHue(d.average))}><b>{pc(d.average)}</b><small>average</small>
          {diff != null && <em className={diff >= 0 ? "an-up" : "an-down"}>{diff >= 0 ? "▲" : "▼"} {Math.abs(diff).toFixed(1)} {diff >= 0 ? "above" : "below"} the class</em>}</div>
        <div className="grow stack">
          {d.strengths.length > 0 && <p className="an-chips"><b>Strengths</b>{d.strengths.map((s) => <span key={s} className="hue-chip" style={hue("green")}>💪 {s}</span>)}</p>}
          {d.weak.length > 0 && <p className="an-chips"><b>Needs work</b>{d.weak.map((s) => <span key={s} className="hue-chip" style={hue("amber")}>📌 {s}</span>)}</p>}
        </div>
        {d.overall.length > 1 && <div className="an-me-trend"><small className="muted">Average over time</small><LineTrend height={120} label="Average over time" points={d.overall.map((o) => ({ label: o.term.replace(/ \d{4}\/\d{4}$/, ""), value: o.average }))} /></div>}
      </div>
      <HBars rows={[...d.subjects].sort((a, b) => b.percent - a.percent).map((s) => ({ key: s.subject, label: s.subject, value: s.percent, ref: s.class_average,
        note: s.history.length ? `before: ${s.history.map((h) => pc(h.percent)).join(", ")}` : undefined }))} />
    </section>
  );
}
