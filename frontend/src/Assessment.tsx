// Assessment: score sheets (CA and exam), homework and marking, the class broadsheet, report cards and publishing results.
// Families see homework (students hand it in) and published report cards. Anyone can check a printed card with its QR code.
import { useEffect, useMemo, useRef, useState, type ClipboardEvent, type KeyboardEvent } from "react";
import { api, errorText, type Me } from "./api";
import { useBusy } from "./GrowthBits";
import Icon from "./Icon";
import Layout from "./Layout";
import { subjectLook } from "./look";
import { href } from "./router";
import { PrintSheet, Qr } from "./Scanner";
import { Avatar, Field, Glyph, hue, Modal, Stat } from "./ui";
import { ControlRoom, FamilyScores } from "./ScoreControl";
import { SchoolAnalysis } from "./Analysis";

// ---------- Types and calls ----------

interface TermInfo { id: string; name: string; number: number; session: string; starts_on: string | null; ends_on: string | null; terms: { id: string; name: string; number: number }[] }
interface Col { key: string; label: string; group: string | null; max: number }
interface Band { grade: string; min: number; max: number; remark: string }
interface SheetRow { id: string; name: string; first_name: string; admission_no: string; thumb: string | null; class_name: string | null; marks: Record<string, number | null>;
  absent: string[]; components: Record<string, number | null>; total: number | null; grade: string | null; remark: string | null; filled: number; position: string | null; locked: string[]; checks: Record<string, string> }
export interface SheetQuery { id: string; student_id: string; student: string; component: string; status: string; label: string; text: string | null; claimed: number | null;
  has_photo: boolean; official: Record<string, number | null>; total: number | null; recorded: Record<string, { value: number }>; reply: string | null;
  history: { at: string; by: string; action: string; note: string | null }[]; locked: boolean; can_answer: boolean; can_decide: boolean }
export interface Step { status: string; label: string; waiting_for: string | null; waiting_for_id: string | null; can_type: boolean; why_not: string | null;
  deadline: { closes_at: string | null; closed: boolean; open_for_me: boolean; opened_until: string | null }; locked_classes: string[]; published_classes: string[];
  locked: boolean; published: boolean; can_submit: boolean; can_check: boolean; row_notes: Record<string, string>; history: { at: string; by: string; action: string; note: string | null }[] }
export interface Sheet {
  scope: string; title: string; subject: { id: string; name: string }; group: string; level: string; class_id: string | null; school_id: string; teacher: string | null; term: TermInfo;
  scheme: { name: string; max: number; parts: { name: string; max: number }[] }[]; columns: Col[]; bands: Band[]; students: SheetRow[]; status: string;
  steps: Record<string, Step>; queries: SheetQuery[]; can_edit: boolean; is_teacher: boolean; is_authority: boolean; teacher_id: string | null;
  checks?: Record<string, { warnings: { level: string; text: string }[] }>;
  stats: { average: number | null; highest: number | null; lowest: number | null; passed: number; scored: number; students: number; complete: number; grades: Record<string, number>; pass_mark: number };
  homework: { id: string; title: string; kind: string; max_score: number; counts_to: string | null; marked: number }[];
}
interface MySheet { scope: string; subject: string; group: string; level: string; students: number; progress: number; status: string; term: string; term_id: string; school_id: string;
  tests: { name: string; status: string; label: string; closes_at: string | null; closed: boolean; open_for_me: boolean }[] }
interface Work { id: string; scope: string; kind: string; kind_label: string; title: string; instructions: string | null; link: string | null; set_on: string; due_on: string | null; due: string;
  max_score: number | null; online: boolean; counts_to: string | null; subject: string; group: string; teacher: string | null; students: number; handed_in: number; to_mark: number; marked: number; missing: number }
interface WorkRow { id: string; name: string; thumb: string | null; has_login: boolean; state: string; late: boolean; text: string | null; link: string | null; handed_in_at: string | null; score: number | null; feedback: string | null }
interface WorkDetail extends Work { rows: WorkRow[]; can_edit: boolean; columns: Col[]; sheet_open: boolean }
interface BroadRow { id: string; name: string; first_name: string; thumb: string | null; gender: string | null; scores: Record<string, { total: number | null; grade: string | null }>;
  total: number | null; average: number | null; subjects: number; taking: number; position: string | null;
  card: { status: string; comment: boolean; principal: boolean; traits: number; seen: boolean } | null }
interface Broad {
  class: { id: string; name: string; level: string; form_teacher: string | null }; school: { id: string; name: string }; term: TermInfo;
  subjects: { id: string; name: string; short: string; scopes: string[]; teacher: string | null; status: string; average: number | null; highest: number | null; lowest: number | null; scored: number; takers: number; complete: boolean }[];
  students: BroadRow[]; stats: { average: number | null; highest: number | null; lowest: number | null; size: number }; sheets_in: number; can_manage: boolean; can_publish: boolean; is_form_teacher: boolean;
  published: number; traits: Record<string, string[]>; bands: Band[];
}
export interface Card {
  school: { name: string; motto: string | null; logo: string | null; address: string | null; phone: string | null; email: string | null; colour: string | null };
  student: { id: string; name: string; first_name: string; admission_no: string; gender: string | null; photo: string | null; date_of_birth: string | null; house: string | null };
  class: { name: string | null; level: string | null; form_teacher: string | null; size: number };
  term: { id: string; name: string; number: number; session: string; ends_on: string | null; next_starts_on: string | null };
  scheme: { name: string; max: number }[];
  subjects: { subject: string; components: Record<string, number | null>; total: number | null; grade: string | null; remark: string | null; position: string | null;
    class_average: number | null; highest: number | null; lowest: number | null; teacher: string | null; earlier: (number | null)[]; cumulative: number | null }[];
  summary: { total: number | null; average: number | null; subjects: number; taking: number; position: string | null; out_of: number; class_average: number | null; grade: string | null;
    remark: string | null; best: string | null; merit_points: number; earlier: { term: string; average: number | null }[]; cumulative: number | null };
  attendance: { present: number | null; days: number | null; absent?: number };
  traits: Record<string, number>; trait_groups: Record<string, string[]>; trait_words: Record<string, string>;
  teacher_comment: string | null; principal_comment: string | null; bands: Band[]; code?: string;
}
interface StaffCard { card: Card; class_id: string; can_publish: boolean; status: string; code: string | null; published_at: string | null; can_manage: boolean; can_comment: boolean; seen: boolean }
interface HomeItem { id: string; kind: string; kind_label: string; title: string; instructions: string | null; link: string | null; subject: string; teacher: string | null; set_on: string;
  due_on: string | null; due: string; days: number | null; online: boolean; max_score: number | null; state: string;
  mine: { text: string | null; link: string | null; at: string | null; score: number | null; feedback: string | null } | null }
interface CardRow { id: string; term_id: string; term: string; session: string; class_name: string; average: number | null; position: string | null; out_of: number; grade: string | null;
  subjects: number; best: string | null; published_at: string; seen: boolean }

const tq = (t?: string | null) => (t ? `?term_id=${t}` : "");
export const aapi = {
  mySheets: () => api.raw<MySheet[]>("GET", "/api/me/score-sheets"),
  sheet: (scope: string, term?: string | null, check = false) => api.raw<Sheet>("GET", `/api/score-sheets/${encodeURIComponent(scope)}${tq(term)}${check ? `${term ? "&" : "?"}check=true` : ""}`),
  marks: (scope: string, term_id: string, marks: { student_id: string; key: string; value: number | null; absent: boolean }[]) => api.raw<Sheet>("PUT", `/api/score-sheets/${encodeURIComponent(scope)}`, { term_id, marks }),
  handInSheet: (scope: string, term_id: string, components: string[], even_if_missing: boolean, note: string | null) => api.raw<Sheet>("POST", `/api/score-sheets/${encodeURIComponent(scope)}/hand-in`, { term_id, components, even_if_missing, note }),
  check: (scope: string, b: unknown) => api.raw<{ status: string }>("POST", `/api/score-sheets/${encodeURIComponent(scope)}/check`, b),
  work: () => api.raw<{ assignments: Work[]; scopes: { scope: string; title: string; subject: string; group: string; level: string }[]; kinds: Record<string, string> }>("GET", "/api/me/assignments"),
  addWork: (b: unknown) => api.raw<Work>("POST", "/api/assignments", b),
  editWork: (id: string, b: unknown) => api.raw<Work>("PUT", `/api/assignments/${id}`, b),
  delWork: (id: string) => api.raw("DELETE", `/api/assignments/${id}`),
  oneWork: (id: string) => api.raw<WorkDetail>("GET", `/api/assignments/${id}`),
  markWork: (id: string, marks: unknown[]) => api.raw<WorkDetail>("POST", `/api/assignments/${id}/marks`, { marks }),
  toSheet: (id: string, key: string) => api.raw<{ sent: number }>("POST", `/api/assignments/${id}/to-sheet`, { key }),
  broad: (cid: string, term?: string | null) => api.raw<Broad>("GET", `/api/classes/${cid}/results${tq(term)}`),
  card: (sid: string, term?: string | null) => api.raw<StaffCard>("GET", `/api/report-cards/${sid}${tq(term)}`),
  saveCard: (sid: string, b: unknown) => api.raw<StaffCard>("PUT", `/api/report-cards/${sid}`, b),
  suggest: (sid: string, term_id: string, who: string, seed: number) => api.raw<{ text: string }>("POST", `/api/report-cards/${sid}/suggest`, { term_id, who, seed }),
  publish: (cid: string, term_id: string, student_ids?: string[]) => api.raw<{ published: number }>("POST", `/api/classes/${cid}/results/publish`, { term_id, student_ids }),
  unpublish: (cid: string, term_id: string, student_ids?: string[]) => api.raw<{ taken_back: number }>("POST", `/api/classes/${cid}/results/unpublish`, { term_id, student_ids }),
  homework: (sid: string) => api.raw<{ items: HomeItem[]; can_act: boolean; counts?: { todo: number; late: number; marked: number } }>("GET", `/api/me/children/${sid}/homework`),
  handIn: (sid: string, aid: string, b: unknown) => api.raw<{ items: HomeItem[]; can_act: boolean }>("POST", `/api/me/children/${sid}/homework/${aid}`, b),
  results: (sid: string) => api.raw<{ cards: CardRow[] }>("GET", `/api/me/children/${sid}/results`),
  familyCard: (sid: string, cid: string) => api.raw<{ card: Card; code: string; published_at: string }>("GET", `/api/me/children/${sid}/report-cards/${cid}`),
  overview: (sid: string, term?: string | null) => api.raw<{ term: TermInfo; can_manage: boolean; classes: { id: string; name: string; level: string; form_teacher: string | null; students: number;
    subjects: number; sheets_in: number; waiting_for: string[]; published: number; seen: number }[] }>("GET", `/api/schools/${sid}/results${tq(term)}`),
};

const nice = (d: string) => new Date(d.length === 10 ? `${d}T12:00:00` : d).toLocaleDateString("en-GB", { day: "numeric", month: "short", year: "numeric" });
export const gradeHue = (g: string | null | undefined) => !g ? "slate" : g.startsWith("A") ? "green" : g.startsWith("B") ? "teal" : g.startsWith("C") ? "sky" : g.startsWith("D") ? "amber" : g.startsWith("E") ? "orange" : "red";
const fmt = (n: number | null | undefined) => (n == null ? "–" : Number.isInteger(n) ? String(n) : n.toFixed(1));
const KIND_HUE: Record<string, string> = { homework: "violet", classwork: "sky", project: "orange", test: "rose" };
const KIND_ICON: Record<string, string> = { homework: "notebook", classwork: "pen-tool", project: "rocket", test: "clipboard-list" };

function TermPick({ term, onPick }: { term: TermInfo; onPick: (id: string) => void }) {
  return (
    <label className="term-pick"><Icon name="calendar-range" size={15} /><select value={term.id} onChange={(e) => onPick(e.target.value)} aria-label="Term">
      {term.terms.map((t) => <option key={t.id} value={t.id}>{t.name} {term.session}</option>)}</select></label>
  );
}

function Ring({ value, size = 54, label }: { value: number; size?: number; label?: string }) {
  return <span className="as-ring" style={{ width: size, height: size, ["--p" as string]: `${Math.max(0, Math.min(100, value))}` }}><b>{label ?? `${Math.round(value)}%`}</b></span>;
}

// ---------- My marking (teachers) ----------

export function MarkingCard() {
  const [s, setS] = useState<MySheet[] | null>(null);
  const [w, setW] = useState<Work[]>([]);
  const [q, setQ] = useState<{ id: string; scope: string; as: string; title: string; component: string; student: string }[]>([]);
  useEffect(() => { aapi.mySheets().then(setS).catch(() => setS([])); aapi.work().then((x) => setW(x.assignments)).catch(() => {});
    api.raw<typeof q>("GET", "/api/me/score-queries").then((x) => setQ(x.filter((y) => y.as === "teacher"))).catch(() => {}); }, []);
  if (!s || (s.length === 0 && w.length === 0)) return null;
  const open = s.filter((x) => x.status !== "submitted");
  const toMark = w.reduce((n, x) => n + x.to_mark, 0);
  return (
    <section className="card editor portal-card" style={hue("fuchsia")}>
      <div className="card-head"><h2 className="with-glyph"><Glyph icon="chart" hue="fuchsia" size={34} />My marking</h2><span className="grow" />
        <a className="small-btn with-icon" href={href({ page: "marks", tab: "sheets" })}><Icon name="arrow-right" size={13} />Open</a></div>
      <div className="as-mini-stats">
        <a href={href({ page: "marks", tab: "sheets" })}><b>{open.length}</b><small>score sheet{open.length === 1 ? "" : "s"} to finish</small></a>
        <a href={href({ page: "marks", tab: "homework" })}><b>{toMark}</b><small>piece{toMark === 1 ? "" : "s"} of work to mark</small></a>
        {q.length > 0 && <a href={href({ page: "sheet", scope: q[0].scope })} style={hue("violet")}><b>{q.length}</b><small>student quer{q.length === 1 ? "y" : "ies"} to answer</small></a>}
      </div>
      <ul className="as-mini-sheets">{open.slice(0, 4).map((x) => (
        <li key={x.scope}><a href={href({ page: "sheet", scope: x.scope })} style={hue(subjectLook(x.subject).hue)}>
          <span className="grow"><b>{x.subject}</b> <small className="muted">{x.group}</small></span>
          <span className="as-bar"><span style={{ width: `${x.progress}%` }} /></span><small>{x.progress}%</small></a></li>))}</ul>
    </section>
  );
}

export function MarksPage({ me, onLogout, tab }: { me: Me; onLogout: () => void; tab: "sheets" | "homework" }) {
  return (
    <Layout wide me={me} onLogout={onLogout} crumbs={[{ label: "Home", href: "#/" }, { label: "My marking" }]}>
      <header className="class-hero as-hero" style={hue("fuchsia")}>
        <span className="hero-pattern" aria-hidden="true" />
        <Glyph icon="chart" hue="fuchsia" size={56} />
        <div className="grow"><h1>My marking</h1><p>Score sheets for the classes you teach, and homework to set and mark.</p></div>
      </header>
      <div className="segmented" role="tablist">
        <a className={tab === "sheets" ? "on" : ""} href={href({ page: "marks", tab: "sheets" })}><Icon name="grid" size={15} />Score sheets</a>
        <a className={tab === "homework" ? "on" : ""} href={href({ page: "marks", tab: "homework" })}><Icon name="notebook" size={15} />Homework and tests</a>
      </div>
      {tab === "sheets" ? <MySheets /> : <MyWork />}
    </Layout>
  );
}

function MySheets() {
  const [s, setS] = useState<MySheet[] | null>(null);
  const [error, setError] = useState("");
  useEffect(() => { aapi.mySheets().then(setS).catch((e) => setError(errorText(e))); }, []);
  if (error) return <p className="error">{error}</p>;
  if (!s) return <div className="skeleton"><span /><span /></div>;
  if (s.length === 0) return <div className="adm-empty"><span>📝</span><p><b>You don't have any score sheets.</b></p><p className="muted small">Score sheets appear for the subjects you are set to teach (Teaching page).</p></div>;
  const done = s.filter((x) => x.status === "submitted").length;
  return (
    <section className="stack">
      <p className="muted">{s[0].term} · {done} of {s.length} handed in</p>
      <div className="as-sheets">
        {s.map((x) => { const l = subjectLook(x.subject); return (
          <a key={x.scope} className={`as-sheet-card${x.status === "submitted" ? " done" : ""}`} href={href({ page: "sheet", scope: x.scope })} style={hue(l.hue)}>
            <Glyph icon={l.icon} hue={l.hue} size={42} />
            <span className="grow"><b>{x.subject}</b><small className="block">{x.group} · {x.students} students</small>
              <span className="as-mini-tests">{(x.tests ?? []).map((t) => <span key={t.name} className="hue-chip" style={hue(({ draft: t.closed && !t.open_for_me ? "slate" : "sky", submitted: "amber", returned: "red", approved: "green" } as Record<string, string>)[t.status])}
                title={t.closes_at ? `Closes ${new Date(t.closes_at).toLocaleString("en-GB")}` : undefined}>{t.status === "draft" && t.closed && !t.open_for_me ? "🔒 " : ""}{t.name}: {t.status === "draft" ? (t.closed && !t.open_for_me ? "closed" : "typing") : t.label.toLowerCase()}</span>)}</span></span>
            <Ring value={x.progress} />
          </a>); })}
      </div>
    </section>
  );
}

// ---------- The score sheet ----------

export function SheetPage({ me, onLogout, scope }: { me: Me; onLogout: () => void; scope: string }) {
  const [d, setD] = useState<Sheet | null>(null);
  const [term, setTerm] = useState<string | null>(null);
  const [error, setError] = useState("");
  const [draft, setDraft] = useState<Record<string, string>>({});       // "studentId|key" -> what is typed
  const [saving, setSaving] = useState<"" | "saving" | "saved" | "error">("");
  const [saveErr, setSaveErr] = useState("");
  const [modal, setModal] = useState<null | "handin" | "homework" | { check: string }>(null);
  const [history, setHistory] = useState(false);
  const pending = useRef<Record<string, { student_id: string; key: string; value: number | null; absent: boolean }>>({});
  const timer = useRef<number | undefined>(undefined);
  const load = (t: string | null) => aapi.sheet(scope, t, true).then((x) => { setD(x); setDraft({}); }).catch((e) => setError(errorText(e)));
  useEffect(() => { void load(term); }, [scope, term]); // eslint-disable-line react-hooks/exhaustive-deps

  const flush = async () => {
    if (!d) return;
    const marks = Object.values(pending.current);
    if (!marks.length) return;
    pending.current = {};
    setSaving("saving");
    try {
      const x = await aapi.marks(scope, d.term.id, marks);
      setD((old) => ({ ...x, checks: old?.checks }));
      setDraft((dr) => { const n = { ...dr }; for (const m of marks) delete n[`${m.student_id}|${m.key}`]; return n; });
      setSaving("saved"); setSaveErr("");
    } catch (e) { setSaving("error"); setSaveErr(errorText(e)); }
  };
  useEffect(() => () => window.clearTimeout(timer.current), []);

  if (error) return <Layout me={me} onLogout={onLogout} crumbs={[{ label: "Home", href: "#/" }, { label: "Score sheet" }]}><p className="error">{error}</p></Layout>;
  if (!d) return <Layout me={me} onLogout={onLogout} crumbs={[{ label: "Home", href: "#/" }]}><div className="skeleton"><span /><span /><span /></div></Layout>;
  const cols = d.columns;
  const l = subjectLook(d.subject.name);
  const compOf = (k: string) => k.split(" › ")[0];
  const editable = (r: SheetRow, c: Col) => d.steps[compOf(c.key)]?.can_type && !r.locked.includes(compOf(c.key));
  const valueOf = (r: SheetRow, k: string) => draft[`${r.id}|${k}`] ?? (r.absent.includes(k) ? "ABS" : r.marks[k] == null ? "" : String(r.marks[k]));
  const bad = (txt: string, c: Col) => { if (txt === "" || /^abs$/i.test(txt)) return false; const n = Number(txt); return Number.isNaN(n) || n < 0 || n > c.max; };
  const change = (r: SheetRow, c: Col, txt: string) => {
    setDraft((dr) => ({ ...dr, [`${r.id}|${c.key}`]: txt }));
    if (bad(txt, c)) return;
    const absent = /^abs$/i.test(txt.trim());
    pending.current[`${r.id}|${c.key}`] = { student_id: r.id, key: c.key, value: absent || txt.trim() === "" ? null : Number(txt), absent };
    window.clearTimeout(timer.current);
    timer.current = window.setTimeout(() => void flush(), 700);
  };
  const focusCell = (ri: number, ci: number) => (document.querySelector(`[data-cell="${ri}-${ci}"]`) as HTMLInputElement | null)?.focus();
  const onKey = (e: KeyboardEvent<HTMLInputElement>, ri: number, ci: number) => {
    if (e.key === "Enter" || e.key === "ArrowDown") { e.preventDefault(); focusCell(ri + 1, ci); }
    else if (e.key === "ArrowUp") { e.preventDefault(); focusCell(ri - 1, ci); }
  };
  const onPaste = (e: ClipboardEvent<HTMLInputElement>, ri: number, ci: number) => {
    const lines = e.clipboardData.getData("text").replace(/\r/g, "").split("\n").filter((x, i, a) => x !== "" || i < a.length - 1);
    if (lines.length < 2 && !lines[0]?.includes("\t")) return;
    e.preventDefault();
    lines.forEach((line, i) => line.split("\t").forEach((cell, j) => { const r = d.students[ri + i], c = cols[ci + j]; if (r && c && editable(r, c)) change(r, c, cell.trim()); }));
  };
  const grades = d.bands.map((b) => ({ ...b, n: d.stats.grades[b.grade] ?? 0 }));
  const most = Math.max(1, ...grades.map((g) => g.n));
  const missing = d.stats.students - d.stats.complete;
  const canHandIn = Object.values(d.steps).some((x) => x.can_submit);
  const notes = Object.values(d.steps).reduce<Record<string, string[]>>((m, x) => { for (const [sid, t] of Object.entries(x.row_notes)) (m[sid] ??= []).push(t); return m; }, {});
  const allHistory = Object.entries(d.steps).flatMap(([c, x]) => x.history.map((h) => ({ ...h, test: c }))).sort((a, b) => b.at.localeCompare(a.at));
  const crumbs = [{ label: "Home", href: "#/" }, ...(d.is_teacher ? [{ label: "My marking", href: href({ page: "marks", tab: "sheets" }) }] : d.class_id ? [{ label: "Results", href: href({ page: "results", id: d.class_id }) }] : []), { label: d.title }];
  return (
    <Layout wide me={me} onLogout={onLogout} crumbs={crumbs}>
      <header className="class-hero as-hero" style={hue(l.hue)}>
        <span className="hero-pattern" aria-hidden="true" />
        <Glyph icon={l.icon} hue={l.hue} size={56} />
        <div className="grow"><h1>{d.subject.name} <small>{d.group}</small></h1>
          <p>{d.teacher ? `Teacher: ${d.teacher}` : "No teacher set"} · {d.scheme.map((c) => `${c.name} ${c.max}`).join(" + ")} = 100</p></div>
        <div className="class-hero-actions">
          <TermPick term={d.term} onPick={setTerm} />
          {d.can_edit && d.homework.length > 0 && <button className="on-band with-icon" onClick={() => setModal("homework")}><Icon name="notebook" size={15} />Use homework marks</button>}
          {canHandIn && <button className="on-band with-icon" onClick={() => setModal("handin")}><Icon name="send" size={15} />Hand in</button>}
        </div>
      </header>
      <TestsStrip d={d} onCheck={(c) => setModal({ check: c })} />
      <div className="stat-strip">
        <Stat icon="students" hue="violet" value={`${d.stats.complete}/${d.stats.students}`} label="students complete" note={missing ? `${missing} still have gaps` : "Every mark is in"} />
        <Stat icon="chart" hue="blue" value={fmt(d.stats.average)} label="class average" note={d.stats.highest != null ? `Highest ${fmt(d.stats.highest)} · lowest ${fmt(d.stats.lowest)}` : undefined} />
        <Stat icon="circle-check" hue="green" value={`${d.stats.passed}/${d.stats.scored || 0}`} label={`scored ${d.stats.pass_mark} or more`} note={d.students.some((r) => r.total != null && !r.grade) ? "Grades show once every test is in" : undefined} />
      </div>
      <div className="as-grades" aria-label="Grades">
        {grades.map((g) => <span key={g.grade} style={hue(gradeHue(g.grade))} title={`${g.grade}: ${g.min}–${g.max} ${g.remark}`}><i style={{ height: `${8 + (52 * g.n) / most}px` }} /><b>{g.n}</b><small>{g.grade}</small></span>)}
      </div>
      <section className="card editor">
        <div className="row wrap"><h3 className="grow">Scores</h3>
          <span className={`as-save ${saving}`}>{saving === "saving" ? "Saving…" : saving === "saved" ? <><Icon name="check" size={13} />Saved</> : saving === "error" ? saveErr : d.can_edit ? "Type a mark. Enter goes down. ABS = absent. You can paste a column from Excel." : "Read only"}</span></div>
        <div className="as-sheet-wrap">
          <table className="as-sheet">
            <thead>
              {d.scheme.some((c) => c.parts.length) && <tr><th colSpan={2} />{d.scheme.map((c) => <th key={c.name} colSpan={Math.max(1, c.parts.length)} className="grp">{c.name}</th>)}<th colSpan={3} /></tr>}
              <tr><th>#</th><th className="name">Student</th>{cols.map((c) => { const st = d.steps[compOf(c.key)]; return (
                <th key={c.key} className={st?.can_type ? "" : "shut"} title={st?.can_type ? undefined : st?.why_not ?? undefined}>
                  {st?.locked ? "🔒 " : !st?.can_type ? <Icon name="lock" size={11} /> : null}{c.label}<small>/{c.max}</small></th>); })}<th>Total</th><th>Grade</th><th>Pos</th></tr>
            </thead>
            <tbody>
              {d.students.map((r, ri) => (
                <tr key={r.id} className={notes[r.id] ? "noted" : ""}>
                  <td className="muted">{ri + 1}</td>
                  <td className="name">{r.thumb ? <img className="mini-face" src={r.thumb} alt="" /> : <Avatar name={r.name} size={28} />}
                    <span>{r.name}{d.level && r.class_name && d.group !== r.class_name && <small className="muted"> {r.class_name}</small>}
                      {notes[r.id] && <small className="as-row-note">⚠ {notes[r.id].join(" · ")}</small>}
                      {Object.entries(r.checks ?? {}).filter(([, v]) => !["match", "confirmed", "accepted", "closed", "corrected", "answered"].includes(v)).map(([k, v]) => (
                        <small key={k} className={`as-chk s-${v}`}>{k}: {CHECK_WORD[v] ?? v}</small>))}</span></td>
                  {cols.map((c, ci) => { const v = valueOf(r, c.key); const ok = editable(r, c); return (
                    <td key={c.key} className={`${bad(v, c) ? "bad" : ""}${ok ? "" : " shut"}`}>
                      <input data-cell={`${ri}-${ci}`} inputMode="decimal" value={v} disabled={!ok} aria-label={`${r.name} ${c.key}`}
                             onChange={(e) => change(r, c, e.target.value)} onKeyDown={(e) => onKey(e, ri, ci)} onPaste={(e) => onPaste(e, ri, ci)} onFocus={(e) => e.target.select()} />
                    </td>); })}
                  <td className="tot">{fmt(r.total)}</td>
                  <td>{r.grade && <span className="as-grade" style={hue(gradeHue(r.grade))}>{r.grade}</span>}</td>
                  <td className="muted">{r.position ?? ""}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </section>
      {d.queries.length > 0 && <QueriesPanel d={d} onDone={() => void load(d.term.id)} />}
      {allHistory.length > 0 && (
        <section className="card editor">
          <button className="text-link with-icon" onClick={() => setHistory(!history)}><Icon name="history" size={15} />{history ? "Hide" : "Show"} the history of this sheet ({allHistory.length})</button>
          {history && <ol className="as-history">{allHistory.map((h, i) => <li key={i}><b>{h.test}</b> · {h.action} by {h.by}{h.note ? `: “${h.note}”` : ""}<small className="muted block">{new Date(h.at).toLocaleString("en-GB", { dateStyle: "medium", timeStyle: "short" })}</small></li>)}</ol>}
        </section>
      )}
      {modal === "handin" && <HandInBox d={d} onClose={() => setModal(null)} onGo={async (comps, note) => { await flush(); const x = await aapi.handInSheet(scope, d.term.id, comps, true, note); setD({ ...x, checks: d.checks }); setModal(null); }} />}
      {modal === "homework" && <UseHomework d={d} onClose={() => setModal(null)} onDone={() => { setModal(null); void load(d.term.id); }} />}
      {modal && typeof modal === "object" && <CheckBox d={d} comp={modal.check} onClose={() => setModal(null)} onDone={() => { setModal(null); void load(d.term.id); }} />}
    </Layout>
  );
}

const CHECK_WORD: Record<string, string> = { waiting: "student checking", different: "student's book differs", queried: "❓ query", escalated: "📣 with the head", correcting: "✏️ correcting" };

function QueriesPanel({ d, onDone }: { d: Sheet; onDone: () => void }) {
  const [open, setOpen] = useState<SheetQuery | null>(null);
  const [photos, setPhotos] = useState<string[] | null>(null);
  const waitingMe = d.queries.filter((q) => q.can_answer || q.can_decide).length;
  return (
    <section className="card editor as-queries">
      <h3 className="with-glyph"><Glyph icon="message" hue="violet" size={30} />Students' queries{waitingMe ? <span className="count-badge">{waitingMe}</span> : null}</h3>
      <p className="small muted">Students compare approved marks with their marked scripts. Keep a mark with a reply, or correct it (a correction goes back to be checked).</p>
      <ul className="as-qlist">{d.queries.map((q) => (
        <li key={q.id} className={`s-${q.status}`}>
          <div className="row wrap"><b className="grow">{q.student} · {q.component}</b><span className="hue-chip" style={hue(({ queried: "violet", escalated: "fuchsia", correcting: "orange", answered: "sky", corrected: "teal", closed: "slate" } as Record<string, string>)[q.status] ?? "slate")}>{q.label}</span></div>
          <p className="small">Sheet: <b>{fmt(q.total)}</b>{q.claimed != null ? <> · student says <b>{fmt(q.claimed)}</b></> : null}{Object.keys(q.recorded).length ? <> · score book {Object.values(q.recorded).map((r) => fmt(r.value)).join(" + ")}</> : null}</p>
          <ol className="as-qthread">{q.history.filter((h) => h.note).map((h, i) => <li key={i}><small className="muted">{h.by} · {h.action}</small> {h.note}</li>)}</ol>
          <div className="row wrap">
            {q.has_photo && <button className="small-btn with-icon" onClick={async () => setPhotos((await api.raw<{ photos: string[] }>("GET", `/api/score-checks/${q.id}/photo`)).photos)}><Icon name="camera" size={13} />See the script</button>}
            <span className="grow" />
            {(q.can_answer || q.can_decide) && <button className="small-btn primary with-icon" onClick={() => setOpen(q)}><Icon name="message" size={13} />{q.can_answer ? "Answer" : "Decide"}</button>}
          </div>
        </li>))}</ul>
      {open && <AnswerBox d={d} q={open} onClose={() => setOpen(null)} onDone={() => { setOpen(null); onDone(); }} />}
      {photos && <Modal wide title="The student's script" onClose={() => setPhotos(null)}><div className="as-photos">{photos.map((p, i) => <img key={i} src={p} alt="Script" />)}</div></Modal>}
    </section>
  );
}

function AnswerBox({ d, q, onClose, onDone }: { d: Sheet; q: SheetQuery; onClose: () => void; onDone: () => void }) {
  const head = q.can_decide;
  const [mode, setMode] = useState<"keep" | "change">("keep");
  const [reply, setReply] = useState("");
  const keys = d.columns.filter((c) => c.key.split(" › ")[0] === q.component);
  const [marks, setMarks] = useState<Record<string, string>>(Object.fromEntries(keys.map((c) => [c.key, q.official[c.key] == null ? "" : String(q.official[c.key])])));
  const [busy, error, run] = useBusy();
  const bad = keys.some((c) => marks[c.key] === "" || Number.isNaN(Number(marks[c.key])) || Number(marks[c.key]) > c.max || Number(marks[c.key]) < 0);
  return (
    <Modal title={`${head ? "Decide" : "Answer"}: ${q.student} · ${q.component}`} onClose={onClose}>
      <div className="stack">
        <p className="as-instr">“{q.text}”</p>
        <div className="segmented"><button className={mode === "keep" ? "on" : ""} onClick={() => setMode("keep")}>Keep the mark</button>
          <button className={mode === "change" ? "on" : ""} disabled={q.locked} onClick={() => setMode("change")}>{head ? "Send back to the teacher" : "Correct the mark"}</button></div>
        {q.locked && <p className="small muted">🔒 This test is published. The principal, VP or ICT must take the padlock off before a mark can change.</p>}
        {mode === "change" && !head && <div className="form-grid">{keys.map((c) => <Field key={c.key} label={`${c.key} (out of ${c.max})`}><input inputMode="decimal" value={marks[c.key]} onChange={(e) => setMarks({ ...marks, [c.key]: e.target.value })} /></Field>)}</div>}
        <Field label={head ? "Your decision (the student and teacher see it)" : "Reply to the student"}><textarea rows={3} maxLength={600} value={reply} onChange={(e) => setReply(e.target.value)}
          placeholder={mode === "keep" ? "e.g. Question 4 needed the working shown, so 12 is correct" : head ? "e.g. Please re-mark question 2" : "e.g. You're right, I added it up wrongly"} /></Field>
        {mode === "change" && !head && <p className="small muted">The corrected mark goes back to the unit head (or HOD) to check before the student sees it.</p>}
        {error && <p className="error">{error}</p>}
        <div className="row"><span className="grow" /><button onClick={onClose}>Cancel</button>
          <button className="primary" disabled={busy || reply.trim().length < 2 || (mode === "change" && !head && bad)} onClick={() => run(async () => {
            if (head) await api.raw("POST", `/api/score-checks/${q.id}/decide`, { action: mode === "keep" ? "keep" : "send_back", reply });
            else await api.raw("POST", `/api/score-checks/${q.id}/answer`, { action: mode === "keep" ? "keep" : "correct", reply, marks: mode === "change" ? Object.fromEntries(keys.map((c) => [c.key, Number(marks[c.key])])) : {} });
            onDone(); })}>Send</button></div>
      </div>
    </Modal>
  );
}

const STEP_HUE: Record<string, string> = { draft: "slate", submitted: "amber", returned: "red", approved: "green" };
const whenText = (iso: string) => new Date(iso).toLocaleString("en-GB", { weekday: "short", day: "numeric", month: "short", hour: "2-digit", minute: "2-digit" });

function TestsStrip({ d, onCheck }: { d: Sheet; onCheck: (comp: string) => void }) {
  return (
    <div className="as-tests">
      {d.scheme.map((c) => { const st = d.steps[c.name]; if (!st) return null; const dl = st.deadline; return (
        <div key={c.name} className={`as-test s-${st.status}${st.locked ? " locked" : ""}`} style={hue(st.locked ? "indigo" : STEP_HUE[st.status])}>
          <div className="row"><b className="grow">{st.locked ? "🔒 " : ""}{c.name} <small className="muted">/{c.max}</small></b>
            <span className="hue-chip">{st.locked ? "Published" : st.published && st.status === "approved" ? "Published · 🔓" : st.label}</span></div>
          <small className="as-test-line">
            {st.status === "submitted" ? <>Waiting for <b>{st.waiting_for}</b></>
              : st.status === "returned" ? "Sent back: fix and hand in again"
              : st.status === "approved" ? (st.locked ? "Families can see it" : "Students can see it")
              : dl.closes_at ? (dl.closed ? (dl.opened_until ? <>Open for you until <b>{whenText(dl.opened_until)}</b></> : <>Closed {whenText(dl.closes_at)}</>) : <>Closes <b>{whenText(dl.closes_at)}</b></>) : "No deadline set"}
          </small>
          {d.checks?.[c.name] && st.can_check && <ul className="as-warn">{d.checks[c.name].warnings.map((w, i) => <li key={i} className={w.level}>{w.level === "green" ? "✔" : "⚠"} {w.text}</li>)}</ul>}
          {st.can_check && <button className="small-btn primary with-icon" onClick={() => onCheck(c.name)}><Icon name="clipboard-list" size={13} />Check {c.name}</button>}
        </div>); })}
    </div>
  );
}

function HandInBox({ d, onClose, onGo }: { d: Sheet; onClose: () => void; onGo: (comps: string[], note: string | null) => Promise<void> }) {
  const ready = d.scheme.filter((c) => d.steps[c.name]?.can_submit).map((c) => c.name);
  const gaps = (comp: string) => { const keys = d.columns.filter((c) => c.key.split(" › ")[0] === comp).map((c) => c.key);
    return d.students.filter((r) => keys.some((k) => r.marks[k] == null && !r.absent.includes(k))).length; };
  const typed = (comp: string) => d.students.some((r) => d.columns.some((c) => c.key.split(" › ")[0] === comp && r.marks[c.key] != null));
  const [pick, setPick] = useState<string[]>(ready.filter(typed));
  const [note, setNote] = useState("");
  const [busy, error, run] = useBusy();
  const miss = pick.reduce((n, c) => n + gaps(c), 0);
  return (
    <Modal title="Hand in for checking" onClose={onClose}>
      <div className="stack">
        <p className="small muted">Choose the tests that are finished. They go to the unit head (or HOD) to check, and you can't change them unless they are sent back.</p>
        <div className="rec-tick-grid">{ready.map((c) => <label key={c} className={`check-pill${pick.includes(c) ? " on" : ""}`}><input type="checkbox" checked={pick.includes(c)} onChange={() => setPick(pick.includes(c) ? pick.filter((x) => x !== c) : [...pick, c])} />{c}{gaps(c) ? <small className="muted"> · {gaps(c)} empty</small> : <small> ✔</small>}</label>)}</div>
        {miss > 0 && <p className="as-banner" style={hue("amber")}><Icon name="info" size={16} />{miss} empty mark{miss === 1 ? "" : "s"}. Type ABS for anyone who missed the test.</p>}
        <Field label="Note for the checker (optional)"><input value={note} maxLength={300} onChange={(e) => setNote(e.target.value)} placeholder="e.g. Two students wrote the test late" /></Field>
        {error && <p className="error">{error}</p>}
        <div className="row"><span className="grow" /><button onClick={onClose}>Not yet</button><button className="primary" disabled={busy || !pick.length} onClick={() => run(() => onGo(pick, note || null))}>Hand in {pick.join(", ")}</button></div>
      </div>
    </Modal>
  );
}

function CheckBox({ d, comp, onClose, onDone }: { d: Sheet; comp: string; onClose: () => void; onDone: () => void }) {
  const [mode, setMode] = useState<"approve" | "return">("approve");
  const [note, setNote] = useState("");
  const [rows, setRows] = useState<Record<string, string>>({});
  const [busy, error, run] = useBusy();
  const keys = d.columns.filter((c) => c.key.split(" › ")[0] === comp);
  const warn = d.checks?.[comp]?.warnings ?? [];
  return (
    <Modal wide title={`Check ${comp} · ${d.title}`} onClose={onClose}>
      <div className="stack">
        <ul className="as-warn big">{warn.map((w, i) => <li key={i} className={w.level}>{w.level === "green" ? "✔" : "⚠"} {w.text}</li>)}</ul>
        <div className="segmented"><button className={mode === "approve" ? "on" : ""} onClick={() => setMode("approve")}><Icon name="circle-check" size={14} />Approve</button>
          <button className={mode === "return" ? "on" : ""} onClick={() => setMode("return")}><Icon name="undo" size={14} />Send back</button></div>
        {mode === "return" && <>
          <p className="small muted">Write a note next to any student whose mark needs looking at. The teacher sees it on their sheet.</p>
          <ul className="as-check-rows">{d.students.map((r) => (
            <li key={r.id}><span className="grow">{r.name}</span><b>{keys.map((c) => r.absent.includes(c.key) ? "ABS" : fmt(r.marks[c.key])).join(" + ")}</b>
              <input value={rows[r.id] ?? ""} maxLength={300} placeholder="Note (optional)" onChange={(e) => setRows({ ...rows, [r.id]: e.target.value })} /></li>))}</ul>
        </>}
        <Field label={mode === "approve" ? "Note (optional)" : "What should the teacher fix?"}><input value={note} maxLength={500} onChange={(e) => setNote(e.target.value)} /></Field>
        {error && <p className="error">{error}</p>}
        <div className="row"><span className="grow" /><button onClick={onClose}>Cancel</button>
          <button className="primary" disabled={busy || (mode === "return" && !note.trim() && !Object.values(rows).some((x) => x.trim()))}
                  onClick={() => run(async () => { await aapi.check(d.scope, { term_id: d.term.id, component: comp, action: mode, note: note || null, row_notes: rows }); onDone(); })}>
            {mode === "approve" ? `Approve ${comp}` : "Send back"}</button></div>
      </div>
    </Modal>
  );
}

function UseHomework({ d, onClose, onDone }: { d: Sheet; onClose: () => void; onDone: () => void }) {
  const [hw, setHw] = useState(d.homework[0]?.id ?? "");
  const [key, setKey] = useState(d.columns.find((c) => !/exam/i.test(c.key))?.key ?? d.columns[0].key);
  const [busy, error, run] = useBusy();
  const h = d.homework.find((x) => x.id === hw), c = d.columns.find((x) => x.key === key);
  return (
    <Modal title="Use homework marks" onClose={onClose}>
      <div className="stack">
        <Field label="Marked work"><select value={hw} onChange={(e) => setHw(e.target.value)}>{d.homework.map((x) => <option key={x.id} value={x.id}>{x.title} (out of {x.max_score}, {x.marked} marked){x.counts_to ? ` · already in ${x.counts_to}` : ""}</option>)}</select></Field>
        <Field label="Put into"><select value={key} onChange={(e) => setKey(e.target.value)}>{d.columns.map((x) => <option key={x.key} value={x.key}>{x.key} (out of {x.max})</option>)}</select></Field>
        {h && c && <p className="small muted">Marks are scaled: {Math.round(h.max_score * 0.8)}/{h.max_score} becomes {fmt(Math.round(c.max * 0.8 * 10) / 10)}/{c.max}. Existing {c.key} marks for these students are replaced.</p>}
        {error && <p className="error">{error}</p>}
        <div className="row"><span className="grow" /><button onClick={onClose}>Cancel</button><button className="primary" disabled={busy || !hw} onClick={() => run(async () => { await aapi.toSheet(hw, key); onDone(); })}>Put the marks in</button></div>
      </div>
    </Modal>
  );
}

// ---------- Homework (teachers) ----------

function MyWork() {
  const [d, setD] = useState<Awaited<ReturnType<typeof aapi.work>> | null>(null);
  const [form, setForm] = useState<Work | "new" | null>(null);
  const [open, setOpen] = useState<string | null>(null);
  const [error, setError] = useState("");
  const load = () => aapi.work().then(setD).catch((e) => setError(errorText(e)));
  useEffect(() => { void load(); }, []);
  if (error) return <p className="error">{error}</p>;
  if (!d) return <div className="skeleton"><span /><span /></div>;
  return (
    <section className="stack">
      <div className="row wrap"><p className="muted grow">Set homework, classwork, projects and tests. Students see them on their portal and can hand in online. Marks can go straight into a CA.</p>
        {d.scopes.length > 0 && <button className="primary with-icon" onClick={() => setForm("new")}><Icon name="plus" size={15} />Set work</button>}</div>
      {d.assignments.length === 0 ? <div className="adm-empty"><span>📚</span><p><b>No work set yet.</b></p></div> : (
        <ul className="as-work">{d.assignments.map((a) => (
          <li key={a.id}><button className="as-work-row" onClick={() => setOpen(a.id)} style={hue(KIND_HUE[a.kind] ?? "violet")}>
            <Glyph icon={KIND_ICON[a.kind] ?? "notebook"} hue={KIND_HUE[a.kind] ?? "violet"} size={38} />
            <span className="grow"><b>{a.title}</b><small className="block muted">{a.kind_label} · {a.subject} · {a.group} · {a.due}</small></span>
            <span className="as-work-counts">
              {a.to_mark > 0 && <span className="hue-chip" style={hue("amber")}>{a.to_mark} to mark</span>}
              <span className="as-bar two" title={`${a.handed_in} handed in, ${a.marked} marked of ${a.students}`}><span style={{ width: `${a.students ? (100 * a.handed_in) / a.students : 0}%` }} /><i style={{ width: `${a.students ? (100 * a.marked) / a.students : 0}%` }} /></span>
              <small className="muted">{a.marked}/{a.students} marked</small>
            </span>
          </button></li>))}</ul>
      )}
      {form && <WorkForm scopes={d.scopes} kinds={d.kinds} w={form === "new" ? null : form} onClose={() => setForm(null)} onDone={() => { setForm(null); void load(); }} />}
      {open && <WorkDetailBox id={open} onClose={() => { setOpen(null); void load(); }} onEdit={(w) => { setOpen(null); setForm(w); }} />}
    </section>
  );
}

function WorkForm({ scopes, kinds, w, onClose, onDone }: { scopes: { scope: string; title: string }[]; kinds: Record<string, string>; w: Work | null; onClose: () => void; onDone: () => void }) {
  const soon = new Date(Date.now() + 3 * 86400000).toISOString().slice(0, 10);
  const [f, setF] = useState({ scope: w?.scope ?? scopes[0]?.scope ?? "", kind: w?.kind ?? "homework", title: w?.title ?? "", instructions: w?.instructions ?? "", link: w?.link ?? "",
    due_on: w?.due_on ?? soon, max_score: w?.max_score ? String(w.max_score) : "10", online: w?.online ?? true });
  const [busy, error, run] = useBusy();
  return (
    <Modal wide title={w ? "Change work" : "Set work"} onClose={onClose}>
      <div className="stack">
        <div className="form-grid">
          <Field label="Class and subject"><select value={f.scope} disabled={!!w} onChange={(e) => setF({ ...f, scope: e.target.value })}>{scopes.map((s) => <option key={s.scope} value={s.scope}>{s.title}</option>)}</select></Field>
          <Field label="What kind"><select value={f.kind} onChange={(e) => setF({ ...f, kind: e.target.value })}>{Object.entries(kinds).map(([k, v]) => <option key={k} value={k}>{v}</option>)}</select></Field>
          <Field label="Due"><input type="date" value={f.due_on} onChange={(e) => setF({ ...f, due_on: e.target.value })} /></Field>
          <Field label="Marked out of (blank: not scored)"><input inputMode="numeric" value={f.max_score} onChange={(e) => setF({ ...f, max_score: e.target.value.replace(/\D/g, "") })} /></Field>
        </div>
        <Field label="Title"><input value={f.title} maxLength={150} onChange={(e) => setF({ ...f, title: e.target.value })} placeholder="e.g. Exercise 4B, questions 1 to 10" /></Field>
        <Field label="Instructions (optional)"><textarea rows={4} maxLength={5000} value={f.instructions} onChange={(e) => setF({ ...f, instructions: e.target.value })} placeholder="What to do, pages to read, how to hand it in" /></Field>
        <Field label="Link (optional)"><input value={f.link} maxLength={500} onChange={(e) => setF({ ...f, link: e.target.value })} placeholder="e.g. a video or worksheet online" /></Field>
        <label className="row"><input type="checkbox" checked={f.online} onChange={(e) => setF({ ...f, online: e.target.checked })} />Students can hand it in on their portal</label>
        {!w && <p className="small muted">Students with a login get a notice.</p>}
        {error && <p className="error">{error}</p>}
        <div className="row"><span className="grow" /><button onClick={onClose}>Cancel</button>
          <button className="primary" disabled={busy || f.title.trim().length < 3 || !f.scope} onClick={() => run(async () => {
            const b = { ...f, instructions: f.instructions || null, link: f.link || null, due_on: f.due_on || null, max_score: f.max_score ? Number(f.max_score) : null };
            await (w ? aapi.editWork(w.id, b) : aapi.addWork(b)); onDone(); })}>{w ? "Save" : "Set it"}</button></div>
      </div>
    </Modal>
  );
}

const STATE_LOOK: Record<string, [string, string]> = { not_yet: ["Not in yet", "slate"], not_in: ["Not handed in", "red"], handed_in: ["Handed in", "blue"], marked: ["Marked", "green"],
  missing: ["Missing", "red"], excused: ["Excused", "sky"] };
const QUICK = ["Excellent work!", "Well done.", "Good effort.", "Show your working.", "Check your spelling.", "See me."];

function WorkDetailBox({ id, onClose, onEdit }: { id: string; onClose: () => void; onEdit: (w: Work) => void }) {
  const [d, setD] = useState<WorkDetail | null>(null);
  const [edits, setEdits] = useState<Record<string, { state: string; score: string; feedback: string }>>({});
  const [show, setShow] = useState<string | null>(null);
  const [focus, setFocus] = useState<string | null>(null);
  const [toKey, setToKey] = useState("");
  const [msg, setMsg] = useState("");
  const [busy, error, run] = useBusy();
  useEffect(() => { aapi.oneWork(id).then((x) => { setD(x); setToKey(x.columns[0]?.key ?? ""); }).catch(() => {}); }, [id]);
  if (!d) return <Modal title="…" onClose={onClose}><div className="skeleton"><span /></div></Modal>;
  const val = (r: WorkRow) => edits[r.id] ?? { state: r.state, score: r.score == null ? "" : String(r.score), feedback: r.feedback ?? "" };
  const set = (r: WorkRow, p: Partial<{ state: string; score: string; feedback: string }>) => setEdits({ ...edits, [r.id]: { ...val(r), ...p } });
  const changed = Object.keys(edits).length;
  const save = () => run(async () => {
    const marks = Object.entries(edits).map(([sid, e]) => ({ student_id: sid, state: e.state === "marked" || e.score !== "" ? (e.state === "missing" || e.state === "excused" ? e.state : "marked") : e.state === "not_yet" || e.state === "not_in" ? "clear" : e.state,
      score: e.score === "" ? null : Number(e.score), feedback: e.feedback || null }));
    setD(await aapi.markWork(id, marks)); setEdits({}); setMsg("Saved");
  });
  return (
    <Modal wide title={d.title} onClose={onClose}>
      <div className="stack">
        <div className="row wrap"><span className="grow muted">{d.kind_label} · {d.subject} · {d.group} · {d.due}{d.max_score ? ` · out of ${d.max_score}` : ""}</span>
          {d.can_edit && <button className="small-btn with-icon" onClick={() => onEdit(d)}><Icon name="edit" size={13} />Change</button>}
          {d.can_edit && <button className="small-btn with-icon" disabled={busy} onClick={() => run(async () => { if (confirm("Delete this work and all its marks?")) { await aapi.delWork(id); onClose(); } })}><Icon name="trash" size={13} />Delete</button>}</div>
        {d.instructions && <p className="as-instr">{d.instructions}</p>}
        <div className="as-work-sum">
          <span style={hue("blue")}><b>{d.handed_in}</b>handed in</span><span style={hue("green")}><b>{d.marked}</b>marked</span>
          <span style={hue("amber")}><b>{d.to_mark}</b>to mark</span><span style={hue("red")}><b>{d.rows.filter((r) => r.state === "not_in" || r.state === "missing").length}</b>missing</span>
        </div>
        <ul className="as-mark-list">{d.rows.map((r) => { const v = val(r); const [lab, h] = STATE_LOOK[v.state] ?? [v.state, "slate"]; return (
          <li key={r.id}>
            <div className="row wrap">
              {r.thumb ? <img className="mini-face" src={r.thumb} alt="" /> : <Avatar name={r.name} size={32} />}
              <span className="grow"><b>{r.name}</b> <span className="hue-chip" style={hue(h)}>{lab}{r.late ? " · late" : ""}</span></span>
              {d.can_edit && <>
                {d.max_score ? <input className="as-score" inputMode="decimal" onFocus={() => setFocus(r.id)} aria-label={`${r.name} score`} value={v.score} onChange={(e) => set(r, { score: e.target.value.replace(/[^\d.]/g, ""), state: e.target.value ? "marked" : v.state })} placeholder={`/${d.max_score}`} />
                  : <button className={`small-btn${v.state === "marked" ? " primary" : ""}`} onClick={() => set(r, { state: "marked" })}>Done</button>}
                <button className={`small-btn${v.state === "missing" ? " on" : ""}`} onClick={() => set(r, { state: "missing", score: "" })}>Missing</button>
                <button className={`small-btn${v.state === "excused" ? " on" : ""}`} onClick={() => set(r, { state: "excused", score: "" })}>Excused</button>
              </>}
              {(r.text || r.link) && <button className="text-link small" onClick={() => setShow(show === r.id ? null : r.id)}>{show === r.id ? "Hide" : "Read"}</button>}
            </div>
            {show === r.id && <div className="as-answer">{r.text && <p>{r.text}</p>}{r.link && <a href={r.link} target="_blank" rel="noreferrer">{r.link}</a>}</div>}
            {d.can_edit && (v.state === "marked" || v.score) && (
              <div className="row wrap as-feedback"><input value={v.feedback} maxLength={600} placeholder="Feedback (optional)" onFocus={() => setFocus(r.id)} onChange={(e) => set(r, { feedback: e.target.value })} />
                {focus === r.id && QUICK.map((q) => <button key={q} className="chip-btn" onClick={() => set(r, { feedback: q })}>{q}</button>)}</div>
            )}
          </li>); })}</ul>
        {error && <p className="error">{error}</p>}
        {d.can_edit && <div className="row wrap"><span className="grow small muted">{msg}</span>
          {d.max_score && d.marked > 0 && d.sheet_open && d.columns.length > 0 && <span className="row"><select value={toKey} onChange={(e) => setToKey(e.target.value)} aria-label="CA column">{d.columns.map((c) => <option key={c.key} value={c.key}>{c.key} (/{c.max})</option>)}</select>
            <button className="with-icon" disabled={busy || changed > 0} onClick={() => run(async () => { const x = await aapi.toSheet(id, toKey); setMsg(`${x.sent} marks put into ${toKey} on the score sheet`); })}><Icon name="arrow-right" size={14} />Put on score sheet</button></span>}
          <button className="primary" disabled={busy || !changed} onClick={save}>Save {changed || ""} mark{changed === 1 ? "" : "s"}</button></div>}
      </div>
    </Modal>
  );
}

// ---------- Results: the broadsheet ----------

export function ResultsPage({ me, onLogout, classId }: { me: Me; onLogout: () => void; classId: string }) {
  const [d, setD] = useState<Broad | null>(null);
  const [term, setTerm] = useState<string | null>(null);
  const [error, setError] = useState("");
  const [open, setOpen] = useState<string | null>(null);
  const [sort, setSort] = useState<"name" | "position">("position");
  const [printAll, setPrintAll] = useState<Card[] | null>(null);
  const [busy, err, run] = useBusy();
  const load = (t: string | null) => aapi.broad(classId, t).then(setD).catch((e) => setError(errorText(e)));
  useEffect(() => { void load(term); }, [classId, term]); // eslint-disable-line react-hooks/exhaustive-deps
  const rows = useMemo(() => !d ? [] : [...d.students].sort(sort === "position" ? (a, b) => (b.average ?? -1) - (a.average ?? -1) : () => 0), [d, sort]);
  if (error) return <Layout me={me} onLogout={onLogout} crumbs={[{ label: "Home", href: "#/" }, { label: "Results" }]}><p className="error">{error}</p></Layout>;
  if (!d) return <Layout me={me} onLogout={onLogout} crumbs={[{ label: "Home", href: "#/" }]}><div className="skeleton"><span /><span /><span /></div></Layout>;
  const waiting = d.subjects.filter((s) => s.status !== "submitted");
  const unpublished = d.students.filter((r) => r.average != null && r.card?.status !== "published").length;
  const commented = d.students.filter((r) => r.card?.comment).length;
  return (
    <Layout wide me={me} onLogout={onLogout} crumbs={[{ label: "Home", href: "#/" }, ...(d.can_manage ? [{ label: d.school.name, href: href({ page: "school", id: d.school.id, tab: "results" }) }] : []), { label: `${d.class.name} results` }]}>
      <header className="class-hero as-hero" style={hue("fuchsia")}>
        <span className="hero-pattern" aria-hidden="true" />
        <Glyph icon="chart" hue="fuchsia" size={56} />
        <div className="grow"><h1>{d.class.name} results</h1><p>{d.term.name} {d.term.session}{d.class.form_teacher ? ` · Form teacher: ${d.class.form_teacher}` : ""}</p></div>
        <div className="class-hero-actions">
          <TermPick term={d.term} onPick={setTerm} />
          <button className="on-band with-icon" disabled={busy} onClick={() => run(async () => { const cs: Card[] = []; for (const r of d.students.filter((x) => x.average != null)) cs.push((await aapi.card(r.id, d.term.id)).card); setPrintAll(cs); })}><Icon name="printer" size={15} />Print all cards</button>
          {d.can_publish && unpublished > 0 && <button className="on-band with-icon" disabled={busy} onClick={() => run(async () => { await aapi.publish(classId, d.term.id); await load(d.term.id); })}><Icon name="send" size={15} />Publish {unpublished} card{unpublished === 1 ? "" : "s"}</button>}
          {d.can_publish && d.published > 0 && <button className="on-band with-icon" disabled={busy} onClick={() => run(async () => { if (confirm(`Take back all ${d.published} report cards? Families will not see them until you publish again.`)) { await aapi.unpublish(classId, d.term.id); await load(d.term.id); } })}><Icon name="undo" size={15} />Take back</button>}
        </div>
      </header>
      {err && <p className="error">{err}</p>}
      <div className="as-steps">
        <div className={d.sheets_in === d.subjects.length ? "done" : ""}><b>1</b><span>Score sheets in<small>{d.sheets_in} of {d.subjects.length} subjects</small></span></div>
        <div className={commented === d.students.length ? "done" : ""}><b>2</b><span>Comments and habits<small>{commented} of {d.students.length} written</small></span></div>
        <div className={d.published === d.students.length ? "done" : ""}><b>3</b><span>Published to families<small>{d.published} of {d.students.length} · {d.students.filter((r) => r.card?.seen).length} opened</small></span></div>
      </div>
      <div className="stat-strip">
        <Stat icon="chart" hue="blue" value={fmt(d.stats.average)} label="class average" note={d.stats.highest != null ? `Best ${fmt(d.stats.highest)} · lowest ${fmt(d.stats.lowest)}` : undefined} />
        <Stat icon="students" hue="violet" value={d.stats.size} label="students" />
        <Stat icon="presentation" hue="fuchsia" value={d.subjects.length} label="subjects" note={waiting.length ? `Waiting for ${waiting.length}` : "All handed in"} />
      </div>
      {waiting.length > 0 && (
        <section className="card editor">
          <h3 className="with-glyph"><Glyph icon="hourglass" hue="amber" size={30} />Waiting for these score sheets</h3>
          <ul className="as-waiting">{waiting.map((s) => <li key={s.id} style={hue(subjectLook(s.name).hue)}>
            <a href={href({ page: "sheet", scope: s.scopes[0] })}><b>{s.name}</b><small>{s.teacher ?? "No teacher"} · {s.scored}/{s.takers} scored</small></a></li>)}</ul>
        </section>
      )}
      <section className="card editor">
        <div className="row wrap"><h3 className="grow with-glyph"><Glyph icon="grid" hue="indigo" size={30} />Broadsheet</h3>
          <label className="sort-pick"><span className="small muted">Sort</span><select value={sort} onChange={(e) => setSort(e.target.value as typeof sort)}><option value="position">Position</option><option value="name">Name</option></select></label></div>
        <p className="small muted">Tap a student to write their report card and see it.</p>
        <div className="as-sheet-wrap">
          <table className="as-broad">
            <thead><tr><th>Pos</th><th className="name">Student</th>{d.subjects.map((s) => <th key={s.id} title={s.name} className={s.status === "submitted" ? "" : "waiting"}><span>{s.name}</span></th>)}<th>Total</th><th>Avg</th><th>Card</th></tr></thead>
            <tbody>
              {rows.map((r) => (
                <tr key={r.id} onClick={() => setOpen(r.id)} className="clickable">
                  <td><b>{r.position ?? ""}</b></td>
                  <td className="name">{r.thumb ? <img className="mini-face" src={r.thumb} alt="" /> : <Avatar name={r.name} size={28} />}<span>{r.name}</span></td>
                  {d.subjects.map((s) => { const x = r.scores[s.id]; return <td key={s.id} className={x ? "" : "na"}>{x ? (x.total == null ? <span className="muted">·</span> : <span className="as-cell" style={hue(gradeHue(x.grade))}>{fmt(x.total)}</span>) : ""}</td>; })}
                  <td className="tot">{fmt(r.total)}</td><td className="tot">{fmt(r.average)}</td>
                  <td>{r.card?.status === "published" ? <span className="hue-chip" style={hue("green")}>{r.card.seen ? "Seen" : "Sent"}</span> : r.card?.comment ? <span className="hue-chip" style={hue("blue")}>Ready</span> : <span className="hue-chip" style={hue("slate")}>Draft</span>}</td>
                </tr>
              ))}
            </tbody>
            <tfoot><tr><td /><td className="name"><b>Class average</b></td>{d.subjects.map((s) => <td key={s.id} className="muted">{fmt(s.average)}</td>)}<td /><td className="tot">{fmt(d.stats.average)}</td><td /></tr></tfoot>
          </table>
        </div>
      </section>
      {open && <CardEditor sid={open} termId={d.term.id} traits={d.traits} onClose={() => { setOpen(null); void load(d.term.id); }} />}
      {printAll && <PrintSheet title={`${d.class.name} report cards`} note={`${printAll.length} cards`} onClose={() => setPrintAll(null)}>{printAll.map((c) => <ReportCardView key={c.student.id} card={c} code={c.code} />)}</PrintSheet>}
    </Layout>
  );
}

function CardEditor({ sid, termId, traits, onClose }: { sid: string; termId: string; traits: Record<string, string[]>; onClose: () => void }) {
  const [d, setD] = useState<StaffCard | null>(null);
  const [f, setF] = useState<{ traits: Record<string, number>; teacher_comment: string; principal_comment: string }>({ traits: {}, teacher_comment: "", principal_comment: "" });
  const [seed, setSeed] = useState(1);
  const [dirty, setDirty] = useState(false);
  const [print, setPrint] = useState(false);
  const [busy, error, run] = useBusy();
  const take = (x: StaffCard) => { setD(x); setF({ traits: x.card.traits ?? {}, teacher_comment: x.card.teacher_comment ?? "", principal_comment: x.card.principal_comment ?? "" }); setDirty(false); };
  useEffect(() => { aapi.card(sid, termId).then(take).catch(() => {}); }, [sid, termId]);
  if (!d) return <Modal wide title="Report card" onClose={onClose}><div className="skeleton"><span /><span /></div></Modal>;
  const locked = d.status === "published";
  const upd = (p: Partial<typeof f>) => { setF({ ...f, ...p }); setDirty(true); };
  const preview: Card = { ...d.card, traits: f.traits, teacher_comment: f.teacher_comment || null, principal_comment: f.principal_comment || null };
  return (
    <Modal wide title={`${d.card.student.name} · ${d.card.term.name} report card`} onClose={() => { if (!dirty || confirm("Close without saving?")) onClose(); }}>
      <div className="as-card-edit">
        <div className="stack">
          {locked && <p className="as-banner" style={hue("green")}><Icon name="circle-check" size={16} />Published{d.published_at ? ` on ${nice(d.published_at)}` : ""}{d.seen ? " · the family has opened it" : ""}.{d.can_publish && " Take it back to change anything."}</p>}
          {!d.can_comment && !locked && <p className="small muted">Only the form teacher and the principal can write on this card.</p>}
          {Object.entries(traits).map(([g, list]) => (
            <fieldset key={g} className="as-traits" disabled={locked || !d.can_comment}><legend>{g}</legend>
              {list.map((t) => <div key={t} className="as-trait"><span>{t}</span><span className="as-stars" role="radiogroup" aria-label={t}>{[1, 2, 3, 4, 5].map((n) => (
                <button key={n} type="button" role="radio" aria-checked={f.traits[t] === n} className={(f.traits[t] ?? 0) >= n ? "on" : ""} onClick={() => upd({ traits: { ...f.traits, [t]: n } })} title={d.card.trait_words[String(n)]}>★</button>))}</span></div>)}
            </fieldset>
          ))}
          <Field label={<span className="row">Class teacher's comment<span className="grow" />{d.can_comment && !locked && <button type="button" className="chip-btn with-icon" disabled={busy} onClick={() => run(async () => { setSeed(seed + 1); upd({ teacher_comment: (await aapi.suggest(sid, termId, "teacher", seed)).text }); })}><Icon name="sparkle" size={12} />Suggest</button>}</span>}>
            <textarea rows={3} maxLength={600} value={f.teacher_comment} disabled={locked || !d.can_comment} onChange={(e) => upd({ teacher_comment: e.target.value })} placeholder="What went well, and what to work on" /></Field>
          <Field label={<span className="row">Principal's comment<span className="grow" />{d.can_manage && !locked && <button type="button" className="chip-btn with-icon" disabled={busy} onClick={() => run(async () => { setSeed(seed + 1); upd({ principal_comment: (await aapi.suggest(sid, termId, "principal", seed)).text }); })}><Icon name="sparkle" size={12} />Suggest</button>}</span>}>
            <textarea rows={2} maxLength={600} value={f.principal_comment} disabled={locked || !d.can_manage} onChange={(e) => upd({ principal_comment: e.target.value })} /></Field>
          {error && <p className="error">{error}</p>}
          <div className="row wrap"><button className="with-icon" onClick={() => setPrint(true)}><Icon name="printer" size={14} />Print</button><span className="grow" />
            {d.can_publish && locked && <button disabled={busy} onClick={() => run(async () => { await aapi.unpublish(d.class_id, termId, [sid]); take(await aapi.card(sid, termId)); })}>Take back</button>}
            {!locked && d.can_comment && <button className="primary" disabled={busy || !dirty} onClick={() => run(async () => take(await aapi.saveCard(sid, { term_id: termId, traits: f.traits, teacher_comment: f.teacher_comment,
              ...(d.can_manage ? { principal_comment: f.principal_comment } : {}) })))}>Save</button>}
            {!locked && d.can_publish && <button className="primary with-icon" disabled={busy} onClick={() => run(async () => {
              if (dirty) await aapi.saveCard(sid, { term_id: termId, traits: f.traits, teacher_comment: f.teacher_comment, principal_comment: f.principal_comment });
              await aapi.publish(d.class_id, termId, [sid]); take(await aapi.card(sid, termId)); })}><Icon name="send" size={14} />Publish this card</button>}
          </div>
        </div>
        <div className="as-card-preview"><ReportCardView card={preview} code={d.code} /></div>
      </div>
      {print && <PrintSheet title="Report card" onClose={() => setPrint(false)}><ReportCardView card={preview} code={d.code} /></PrintSheet>}
    </Modal>
  );
}

// ---------- The report card itself ----------

export function ReportCardView({ card: c, code }: { card: Card; code?: string | null }) {
  const verify = code ? `${location.origin}${location.pathname}#/verify/${code}` : null;
  const early = c.summary.earlier ?? [];
  const att = c.attendance;
  return (
    <article className="rc" style={{ ["--rc" as string]: c.school.colour || "#1e3a8a" }}>
      <header className="rc-head">
        {c.school.logo ? <img src={c.school.logo} alt="" className="rc-logo" /> : <span className="rc-logo rc-logo-blank"><Icon name="school" size={30} /></span>}
        <div className="grow"><h2>{c.school.name}</h2>{c.school.motto && <p className="rc-motto">“{c.school.motto}”</p>}
          <p className="rc-addr">{[c.school.address, c.school.phone, c.school.email].filter(Boolean).join(" · ")}</p></div>
        {verify && <div className="rc-qr"><Qr text={verify} size={64} /><small>{code}</small></div>}
      </header>
      <div className="rc-title">Report card · {c.term.name} · {c.term.session} session</div>
      <section className="rc-who">
        {c.student.photo ? <img src={c.student.photo} alt="" className="rc-photo" /> : <span className="rc-photo"><Avatar name={c.student.name} size={64} /></span>}
        <dl>
          <div><dt>Name</dt><dd><b>{c.student.name}</b></dd></div><div><dt>Admission no</dt><dd>{c.student.admission_no}</dd></div>
          <div><dt>Class</dt><dd>{c.class.name}</dd></div><div><dt>Sex</dt><dd>{c.student.gender === "female" ? "Female" : c.student.gender === "male" ? "Male" : "–"}</dd></div>
          {c.student.house && <div><dt>House</dt><dd>{c.student.house}</dd></div>}<div><dt>Form teacher</dt><dd>{c.class.form_teacher ?? "–"}</dd></div>
        </dl>
        <div className="rc-big">
          <div><b>{fmt(c.summary.average)}%</b><small>average</small></div>
          <div><b>{c.summary.position ?? "–"}</b><small>of {c.summary.out_of}</small></div>
          <div><b>{c.summary.grade ?? "–"}</b><small>{c.summary.remark ?? "grade"}</small></div>
        </div>
      </section>
      <table className="rc-table">
        <thead><tr><th className="l">Subject</th>{c.scheme.map((x) => <th key={x.name}>{x.name}<small>{x.max}</small></th>)}<th>Total<small>100</small></th>
          {early.map((e) => <th key={e.term} className="soft">{e.term.replace(" term", "")}</th>)}{early.length > 0 && <th>Cum.</th>}
          <th>Grade</th><th>Pos</th><th className="soft">Class avg</th><th className="l">Remark</th></tr></thead>
        <tbody>{c.subjects.map((s) => (
          <tr key={s.subject}><td className="l">{s.subject}</td>{c.scheme.map((x) => <td key={x.name}>{fmt(s.components[x.name])}</td>)}<td><b>{fmt(s.total)}</b></td>
            {early.map((e, i) => <td key={e.term} className="soft">{fmt(s.earlier[i])}</td>)}{early.length > 0 && <td>{fmt(s.cumulative)}</td>}
            <td><span className="rc-grade" style={hue(gradeHue(s.grade))}>{s.grade ?? "–"}</span></td><td>{s.position ?? ""}</td><td className="soft">{fmt(s.class_average)}</td><td className="l">{s.remark ?? ""}</td></tr>))}</tbody>
        <tfoot><tr><td className="l"><b>Total</b></td><td colSpan={c.scheme.length} /><td><b>{fmt(c.summary.total)}</b></td>{early.map((e) => <td key={e.term} className="soft">{fmt(e.average)}</td>)}{early.length > 0 && <td>{fmt(c.summary.cumulative)}</td>}<td colSpan={4} className="l">Class average {fmt(c.summary.class_average)}% · best subject: {c.summary.best ?? "–"}</td></tr></tfoot>
      </table>
      <div className="rc-row">
        <section className="rc-box"><h4>Attendance</h4>
          {att.days ? <p><b>{att.present}</b> of {att.days} school days{att.absent ? ` · absent ${att.absent}` : ""}</p> : <p className="muted">Not recorded</p>}
          <p className="small">Merit points this term: <b>{c.summary.merit_points > 0 ? `+${c.summary.merit_points}` : c.summary.merit_points}</b></p>
          <p className="small">Next term begins: <b>{c.term.next_starts_on ? nice(c.term.next_starts_on) : "to be announced"}</b></p></section>
        {Object.entries(c.trait_groups).map(([g, list]) => (
          <section key={g} className="rc-box"><h4>{g}</h4><ul className="rc-traits">{list.map((t) => <li key={t}><span>{t}</span><b className="rc-dots">{[1, 2, 3, 4, 5].map((n) => <i key={n} className={(c.traits[t] ?? 0) >= n ? "on" : ""} />)}</b></li>)}</ul></section>
        ))}
      </div>
      <section className="rc-comments">
        <div><h4>Class teacher</h4><p>{c.teacher_comment ?? "…"}</p><small>{c.class.form_teacher}</small></div>
        <div><h4>Principal</h4><p>{c.principal_comment ?? "…"}</p></div>
      </section>
      <footer className="rc-key">{c.bands.map((b) => <span key={b.grade}><b>{b.grade}</b> {b.min}–{b.max}</span>)}{code && <span className="grow rc-check">Check this card: scan the code</span>}</footer>
    </article>
  );
}

export function VerifyPage({ code }: { code: string }) {
  const [d, setD] = useState<{ school: string; student: string; admission_no: string; class_name: string; term: string; session: string; average: number; position: string; out_of: number;
    subjects: { subject: string; total: number | null; grade: string | null }[]; published_at: string } | null>(null);
  const [bad, setBad] = useState(false);
  useEffect(() => { api.raw<NonNullable<typeof d>>("GET", `/api/verify/report/${code}`).then(setD).catch(() => setBad(true)); }, [code]);
  return (
    <div className="verify-page">
      {bad ? <div className="verify-card" style={hue("red")}><span className="verify-icon">✖</span><h1>Not found</h1><p>No published report card has the code <b>{code}</b>. It may have been changed, or the card is not genuine.</p></div>
        : !d ? <div className="skeleton"><span /><span /></div> : (
          <div className="verify-card" style={hue("green")}>
            <span className="verify-icon">✔</span><h1>Genuine report card</h1>
            <p><b>{d.student}</b> ({d.admission_no}) · {d.class_name}<br />{d.school} · {d.term} {d.session}</p>
            <div className="verify-big"><span><b>{fmt(d.average)}%</b>average</span><span><b>{d.position}</b>of {d.out_of}</span></div>
            <ul>{d.subjects.map((s) => <li key={s.subject}><span>{s.subject}</span><b>{fmt(s.total)}</b><span className="as-grade" style={hue(gradeHue(s.grade))}>{s.grade}</span></li>)}</ul>
            <small className="muted">Published {nice(d.published_at)} · code {code}</small>
          </div>
        )}
    </div>
  );
}

// ---------- Students and parents ----------

const HW_LOOK: Record<string, [string, string, string]> = { late: ["Overdue", "red", "⏰"], todo: ["To do", "amber", "📝"], handed_in: ["Handed in", "blue", "📤"], marked: ["Marked", "green", "✅"],
  missing: ["Missing", "red", "❌"], excused: ["Excused", "sky", "🙏"] };

export function HomeworkPage({ studentId, self }: { studentId: string; self: boolean }) {
  const [d, setD] = useState<Awaited<ReturnType<typeof aapi.homework>> | null>(null);
  const [hand, setHand] = useState<HomeItem | null>(null);
  const [filter, setFilter] = useState<"now" | "done">("now");
  useEffect(() => { aapi.homework(studentId).then(setD).catch(() => {}); }, [studentId]);
  if (!d) return <div className="skeleton"><span /><span /></div>;
  if (d.items.length === 0) return <div className="adm-empty"><span>🎒</span><p><b>No homework yet.</b></p><p className="muted small">When teachers set work, it shows here.</p></div>;
  const now = d.items.filter((i) => ["late", "todo", "handed_in"].includes(i.state));
  const done = d.items.filter((i) => !["late", "todo", "handed_in"].includes(i.state));
  const list = filter === "now" ? now : done;
  return (
    <section className="stack">
      <div className="as-hw-sum">
        <span style={hue("red")}><b>{d.counts?.late ?? 0}</b>overdue</span><span style={hue("amber")}><b>{d.counts?.todo ?? 0}</b>to do</span><span style={hue("green")}><b>{d.counts?.marked ?? 0}</b>marked</span>
      </div>
      <div className="segmented"><button className={filter === "now" ? "on" : ""} onClick={() => setFilter("now")}>{self ? "To do" : "Current"} ({now.length})</button><button className={filter === "done" ? "on" : ""} onClick={() => setFilter("done")}>Marked and past ({done.length})</button></div>
      {list.length === 0 && <p className="muted">{filter === "now" ? "All done! 🎉" : "Nothing here yet."}</p>}
      <div className="as-hw">{list.map((i) => { const l = subjectLook(i.subject); const [lab, h, emo] = HW_LOOK[i.state]; return (
        <article key={i.id} className={`as-hw-item s-${i.state}`} style={hue(l.hue)}>
          <div className="row"><Glyph icon={l.icon} hue={l.hue} size={38} />
            <span className="grow"><b>{i.title}</b><small className="block muted">{i.subject} · {i.kind_label}{i.teacher ? ` · ${i.teacher}` : ""}</small></span>
            <span className="hue-chip" style={hue(h)}>{emo} {lab}</span></div>
          {i.instructions && <p className="small as-instr">{i.instructions}</p>}
          {i.link && <a className="small" href={i.link} target="_blank" rel="noreferrer"><Icon name="link" size={12} /> {i.link}</a>}
          <div className="row wrap small"><span className={`as-due${i.state === "late" ? " late" : i.days != null && i.days <= 1 && i.state === "todo" ? " soon" : ""}`}><Icon name="clock" size={12} />{i.due}</span>
            {i.max_score && <span className="muted">· out of {i.max_score}</span>}{!i.online && <span className="muted">· hand in on paper</span>}<span className="grow" />
            {d.can_act && i.online && ["todo", "late", "handed_in"].includes(i.state) && <button className="small-btn primary with-icon" onClick={() => setHand(i)}><Icon name="send" size={12} />{i.state === "handed_in" ? "Change my answer" : "Hand in"}</button>}</div>
          {i.state === "marked" && i.mine && <div className="as-marked">{i.mine.score != null && i.max_score && <Ring value={(100 * i.mine.score) / i.max_score} size={46} label={`${fmt(i.mine.score)}/${i.max_score}`} />}
            {i.mine.feedback && <p className="as-bubble">“{i.mine.feedback}”{i.teacher && <small className="block muted">{i.teacher}</small>}</p>}</div>}
        </article>); })}</div>
      {hand && <HandIn sid={studentId} item={hand} onClose={() => setHand(null)} onDone={(x) => { setD({ ...d, ...x }); setHand(null); }} />}
    </section>
  );
}

function HandIn({ sid, item, onClose, onDone }: { sid: string; item: HomeItem; onClose: () => void; onDone: (x: { items: HomeItem[]; can_act: boolean }) => void }) {
  const [text, setText] = useState(item.mine?.text ?? "");
  const [link, setLink] = useState(item.mine?.link ?? "");
  const [busy, error, run] = useBusy();
  return (
    <Modal wide title={`Hand in: ${item.title}`} onClose={onClose}>
      <div className="stack">
        {item.instructions && <p className="as-instr small">{item.instructions}</p>}
        <Field label="My answer"><textarea rows={8} maxLength={8000} value={text} onChange={(e) => setText(e.target.value)} placeholder="Type your answer here" /></Field>
        <Field label="Link (optional)" hint="For example a Google Doc or a photo of your work saved online"><input value={link} maxLength={500} onChange={(e) => setLink(e.target.value)} /></Field>
        {item.state === "late" && <p className="small" style={{ color: "var(--danger, #c62828)" }}>This is late. Your teacher will see when you handed it in.</p>}
        {error && <p className="error">{error}</p>}
        <div className="row"><span className="grow" /><button onClick={onClose}>Cancel</button><button className="primary with-icon" disabled={busy || (!text.trim() && !link.trim())} onClick={() => run(async () => onDone(await aapi.handIn(sid, item.id, { text: text || null, link: link || null })))}><Icon name="send" size={14} />Hand in</button></div>
      </div>
    </Modal>
  );
}

export function ResultsList({ studentId, self }: { studentId: string; self: boolean }) {
  const [d, setD] = useState<CardRow[] | null>(null);
  const [open, setOpen] = useState<{ card: Card; code: string } | null>(null);
  const [busy, error, run] = useBusy();
  useEffect(() => { aapi.results(studentId).then((x) => setD(x.cards)).catch(() => setD([])); }, [studentId]);
  if (!d) return <div className="skeleton"><span /><span /></div>;
  return (
    <section className="stack">
      <FamilyScores studentId={studentId} />
      {d.length === 0 && <div className="adm-empty"><span>📊</span><p><b>No report cards yet.</b></p><p className="muted small">{self ? "Your" : "The"} report card shows here when the school publishes results at the end of term. Each test shows above as soon as it is published.</p></div>}
      {error && <p className="error">{error}</p>}
      <div className="as-results">{d.map((c) => (
        <button key={c.id} className={`as-result${c.seen ? "" : " new"}`} disabled={busy} onClick={() => run(async () => { const x = await aapi.familyCard(studentId, c.id); setOpen({ card: x.card, code: x.code }); setD(d.map((y) => y.id === c.id ? { ...y, seen: true } : y)); })}
                style={hue(gradeHue(c.grade))}>
          {!c.seen && <span className="as-new">New</span>}
          <Ring value={c.average ?? 0} size={78} label={`${fmt(c.average)}%`} />
          <span className="grow"><b>{c.term} {c.session}</b><small className="block">{c.class_name} · {c.subjects} subjects</small>
            <span className="as-result-pos">{c.position ? <><b>{c.position}</b> of {c.out_of}</> : null}{c.best && <small className="block muted">Best: {c.best}</small>}</span></span>
          <Icon name="arrow-right" size={18} />
        </button>))}</div>
      {open && <PrintSheet title={`${open.card.term.name} report card`} onClose={() => setOpen(null)}><ReportCardView card={open.card} code={open.code} /></PrintSheet>}
    </section>
  );
}

// ---------- School-wide overview ----------

export function ResultsOverview({ schoolId }: { schoolId: string }) {
  const [view, setView] = useState<"tests" | "cards" | "analysis">("tests");
  return (
    <section className="stack">
      <div className="segmented"><button className={view === "tests" ? "on" : ""} onClick={() => setView("tests")}><Icon name="send" size={15} />Tests and publishing</button>
        <button className={view === "cards" ? "on" : ""} onClick={() => setView("cards")}><Icon name="award" size={15} />Report cards</button>
        <button className={view === "analysis" ? "on" : ""} onClick={() => setView("analysis")}><Icon name="trending" size={15} />Analysis</button></div>
      {view === "tests" ? <ControlRoom schoolId={schoolId} /> : view === "cards" ? <CardsOverview schoolId={schoolId} /> : <SchoolAnalysis schoolId={schoolId} />}
    </section>
  );
}

function CardsOverview({ schoolId }: { schoolId: string }) {
  const [d, setD] = useState<Awaited<ReturnType<typeof aapi.overview>> | null>(null);
  const [term, setTerm] = useState<string | null>(null);
  const [error, setError] = useState("");
  useEffect(() => { aapi.overview(schoolId, term).then(setD).catch((e) => setError(errorText(e))); }, [schoolId, term]);
  if (error) return <p className="error">{error}</p>;
  if (!d) return <div className="skeleton"><span /><span /></div>;
  const all = d.classes.reduce((n, c) => n + c.subjects, 0), inn = d.classes.reduce((n, c) => n + c.sheets_in, 0);
  const pub = d.classes.reduce((n, c) => n + c.published, 0), studs = d.classes.reduce((n, c) => n + c.students, 0);
  return (
    <section className="stack">
      <div className="row wrap"><p className="muted grow">Follow score sheets and report cards for every class. Open a class to see its broadsheet, write comments and publish.</p><TermPick term={d.term} onPick={setTerm} /></div>
      <div className="stat-strip">
        <Stat icon="grid" hue="fuchsia" value={`${all ? Math.round((100 * inn) / all) : 0}%`} label="score sheets in" note={`${inn} of ${all}`} />
        <Stat icon="send" hue="green" value={pub} label="report cards published" note={`of ${studs} students`} />
        <Stat icon="eye" hue="sky" value={d.classes.reduce((n, c) => n + c.seen, 0)} label="opened by families" />
      </div>
      <div className="as-classes">{d.classes.map((c) => { const p = c.subjects ? Math.round((100 * c.sheets_in) / c.subjects) : 0; return (
        <a key={c.id} className="as-class" href={href({ page: "results", id: c.id })}>
          <div className="row"><b className="grow">{c.name}</b>{c.published ? <span className="hue-chip" style={hue("green")}>{c.published} published</span> : null}</div>
          <small className="muted">{c.form_teacher ?? "No form teacher"} · {c.students} students</small>
          <span className="as-bar"><span style={{ width: `${p}%` }} /></span>
          <small>{c.sheets_in}/{c.subjects} score sheets in{c.waiting_for.length > 0 && c.sheets_in > 0 ? ` · waiting for ${c.waiting_for.slice(0, 2).join(", ")}${c.waiting_for.length > 2 ? "…" : ""}` : ""}</small>
        </a>); })}</div>
    </section>
  );
}
