// Probation: students whose results show they are failing, and the plan everyone follows to help them.
// Staff see the list and each case (plan, actions, meetings, team, letter). Families see the plan and acknowledge it.
import { useEffect, useState } from "react";
import { api, errorText, type Me } from "./api";
import { TermPick, type TermInfo } from "./Assessment";
import { useBusy } from "./GrowthBits";
import Icon from "./Icon";
import Layout from "./Layout";
import { PrintSheet } from "./Scanner";
import { Avatar, Empty, Field, Glyph, hue, Modal, Stat } from "./ui";

interface Weak { subject_id: string; subject: string; pct: number }
interface Row {
  id: string; student: { id: string; name: string; first_name: string; admission_no: string; thumb: string | null; class_name: string | null };
  term: { id: string; name: string; session: string }; status: string; status_label: string; average: number | null; reasons: string[]; weak: Weak[];
  family_told: boolean; review_on: string | null; opened_at: string | null; acknowledged: string | null; plan: unknown; actions_done: number; actions: unknown;
}
interface Action { id: string; what: string; who: string | null; due: string | null; done: string | null; by?: string }
interface Meeting { id: string; on: string; with: string; notes: string; by: string }
interface Case extends Omit<Row, "plan" | "actions"> {
  plan: string | null; actions: Action[]; meetings: Meeting[]; team: { id: string; name: string; role: string }[]; history: { at: string; by: string; action: string }[];
  parent_note: string | null; acknowledged_by: string | null; actions_total: number; can_lead: boolean; statuses: Record<string, string>;
  school: { id: string; name: string; logo: string | null; address: string | null; phone: string | null; motto: string | null };
}
interface List { term: TermInfo; cases: Row[]; counts: Record<string, number>; rules: { line: number; fails: number; drop: number }; can_scan: boolean; all: boolean; statuses: Record<string, string> }
export interface FamilyCase {
  id: string; student: Row["student"]; term: Row["term"]; status: string; status_label: string; average: number | null; reasons: string[]; weak: Weak[]; review_on: string | null;
  opened_at: string | null; plan: string | null; acknowledged: string | null; acknowledged_by: string | null; parent_note: string | null; actions_done: number; actions_total: number;
  actions: { what: string; who: string | null; due: string | null; done: boolean }[]; meetings: { on: string; with: string }[]; contacts: { id: string; name: string; role: string }[];
}

const pb = {
  list: (sid: string, term: string | null) => api.raw<List>("GET", `/api/schools/${sid}/probation${term ? `?term_id=${term}` : ""}`),
  scan: (sid: string, term: string) => api.raw<{ opened: number; updated: number; families_told: number }>("POST", `/api/schools/${sid}/probation/scan?term_id=${term}`),
  one: (id: string) => api.raw<Case>("GET", `/api/probation/${id}`),
  save: (id: string, b: { plan?: string; status?: string; review_on?: string }) => api.raw<Case>("PUT", `/api/probation/${id}`, b),
  act: (id: string, b: { what: string; who: string | null; due: string | null }) => api.raw<Case>("POST", `/api/probation/${id}/actions`, b),
  done: (id: string, aid: string) => api.raw<Case>("POST", `/api/probation/${id}/actions/${aid}/done`),
  meet: (id: string, b: { on: string; with_who: string; notes: string }) => api.raw<Case>("POST", `/api/probation/${id}/meetings`, b),
  mine: () => api.raw<{ total: number; no_plan: number; schools: { id: string; name: string }[]; cases: Row[] }>("GET", "/api/me/probation"),
  student: (sid: string) => api.raw<Row[]>("GET", `/api/students/${sid}/probation`),
  family: (sid: string) => api.raw<{ relation: string; cases: FamilyCase[] }>("GET", `/api/me/children/${sid}/probation`),
  ack: (sid: string, cid: string, note: string) => api.raw<{ relation: string; cases: FamilyCase[] }>("POST", `/api/me/children/${sid}/probation/${cid}/acknowledge`, { note: note || null }),
};

const STATUS_HUE: Record<string, string> = { open: "red", plan: "orange", review: "amber", improved: "green", closed: "slate" };
const STEPS = ["open", "plan", "review", "improved"] as const;
const pct = (n: number | null | undefined) => (n == null ? "–" : `${Number.isInteger(n) ? n : n.toFixed(1)}%`);
const day = (iso: string | null | undefined) => (iso ? new Date(iso).toLocaleDateString("en-GB", { day: "numeric", month: "short", year: "numeric" }) : "–");
const barHue = (p: number) => (p < 40 ? "red" : p < 50 ? "orange" : p < 65 ? "amber" : "green");

function WeakBars({ weak }: { weak: Weak[] }) {
  return (
    <ul className="pb-weak">
      {weak.map((w) => (
        <li key={w.subject_id} style={hue(barHue(w.pct))}><span>{w.subject}</span><i><em style={{ width: `${Math.max(3, Math.min(100, w.pct))}%` }} /></i><b>{pct(w.pct)}</b></li>
      ))}
    </ul>
  );
}

// ---------- The list (principal, VP, everyone on a team) ----------

export function ProbationPage({ me, onLogout, schoolId }: { me: Me; onLogout: () => void; schoolId: string }) {
  const [d, setD] = useState<List | null>(null);
  const [term, setTerm] = useState<string | null>(null);
  const [error, setError] = useState("");
  const [show, setShow] = useState<"active" | "all">("active");
  const [msg, setMsg] = useState("");
  const [busy, err, run] = useBusy();
  const load = () => pb.list(schoolId, term).then(setD).catch((e) => setError(errorText(e)));
  useEffect(() => { void load(); }, [schoolId, term]); // eslint-disable-line react-hooks/exhaustive-deps
  const crumbs = [{ label: "Home", href: "#/" }, { label: "Probation" }];
  if (error) return <Layout me={me} onLogout={onLogout} crumbs={crumbs}><p className="error">{error}</p></Layout>;
  if (!d) return <Layout me={me} onLogout={onLogout} crumbs={crumbs}><div className="skeleton"><span /><span /><span /></div></Layout>;
  const active = d.cases.filter((c) => ["open", "plan", "review"].includes(c.status));
  const rows = show === "active" ? active : d.cases;
  return (
    <Layout wide me={me} onLogout={onLogout} crumbs={crumbs}>
      <header className="class-hero pb-hero" style={hue("orange")}>
        <span className="hero-pattern" aria-hidden="true" />
        <Glyph icon="life-buoy" hue="orange" size={56} />
        <div className="grow"><h1>Probation <small>{d.term.name} {d.term.session}</small></h1>
          <p>Students who need help now. Rules: average below {d.rules.line}%{d.rules.fails ? `, failing ${d.rules.fails}+ subjects` : ""}{d.rules.drop ? `, or dropping ${d.rules.drop}+ points` : ""}.</p></div>
        <div className="class-hero-actions">
          <TermPick term={d.term} onPick={setTerm} />
          {d.can_scan && <button className="on-band with-icon" disabled={busy} onClick={() => run(async () => { const r = await pb.scan(schoolId, d.term.id); setMsg(`Checked: ${r.opened} new, ${r.updated} updated, ${r.families_told} families told.`); await load(); })}>
            <Icon name="refresh" size={15} />Check everyone now</button>}
        </div>
      </header>
      {(msg || err) && <p className={err ? "error" : "pb-msg"}>{err || msg}</p>}
      <div className="stat-strip">
        <Stat icon="alert-triangle" hue="red" value={d.counts.open ?? 0} label="just started" note="No plan yet" />
        <Stat icon="clipboard-list" hue="orange" value={(d.counts.plan ?? 0) + (d.counts.review ?? 0)} label="with a plan" note={`${d.counts.review ?? 0} being reviewed`} />
        <Stat icon="trending" hue="green" value={d.counts.improved ?? 0} label="improved" />
        <Stat icon="users" hue="violet" value={active.filter((c) => c.family_told && !c.acknowledged).length} label="parents to acknowledge" />
      </div>
      <section className="card editor">
        <div className="row wrap"><h3 className="grow">{d.all ? "Every student on probation" : "Students you are helping"}</h3>
          <div className="segmented small-seg"><button className={show === "active" ? "on" : ""} onClick={() => setShow("active")}>Active ({active.length})</button>
            <button className={show === "all" ? "on" : ""} onClick={() => setShow("all")}>All ({d.cases.length})</button></div></div>
        {rows.length === 0 && <Empty icon="circle-check">Nobody is on probation{show === "active" ? " right now" : ""}. Cases open by themselves when approved marks fall below the rules.</Empty>}
        <ul className="pb-list">
          {rows.map((c) => (
            <li key={c.id}><a href={`#/probation/${c.id}`} style={hue(STATUS_HUE[c.status] ?? "slate")}>
              {c.student.thumb ? <img className="mini-face" src={c.student.thumb} alt="" /> : <Avatar name={c.student.name} size={40} />}
              <span className="grow"><b>{c.student.name}</b> <small className="muted">{c.student.class_name}</small>
                <small className="block pb-reasons">{c.reasons.join(" · ")}</small>
                <small className="block muted">Weakest: {c.weak.slice(0, 3).map((w) => `${w.subject} ${pct(w.pct)}`).join(", ")}</small></span>
              <span className="pb-side">
                <b className="pb-avg">{pct(c.average)}</b>
                <span className="hue-chip">{c.status_label}</span>
                <small className="muted">{c.family_told ? (c.acknowledged ? "✓ parent signed" : "parent told") : "family not told yet"}</small>
              </span>
            </a></li>
          ))}
        </ul>
        <p className="small muted">Families are told only once the marks behind a case are published. Until then only staff can see it.</p>
      </section>
    </Layout>
  );
}

// ---------- One case ----------

export function ProbationCasePage({ me, onLogout, caseId }: { me: Me; onLogout: () => void; caseId: string }) {
  const [c, setC] = useState<Case | null>(null);
  const [error, setError] = useState("");
  const [plan, setPlan] = useState<string | null>(null);
  const [modal, setModal] = useState<null | "action" | "meeting" | "letter">(null);
  const [busy, err, run] = useBusy();
  useEffect(() => { pb.one(caseId).then(setC).catch((e) => setError(errorText(e))); }, [caseId]);
  const crumbs = [{ label: "Home", href: "#/" }, ...(c ? [{ label: "Probation", href: `#/probation-list/${c.school.id}` }] : []), { label: c?.student.name ?? "Case" }];
  if (error) return <Layout me={me} onLogout={onLogout} crumbs={crumbs}><p className="error">{error}</p></Layout>;
  if (!c) return <Layout me={me} onLogout={onLogout} crumbs={crumbs}><div className="skeleton"><span /><span /><span /></div></Layout>;
  const step = STEPS.indexOf(c.status as typeof STEPS[number]);
  const save = (b: Parameters<typeof pb.save>[1]) => run(async () => { setC(await pb.save(c.id, b)); setPlan(null); });
  return (
    <Layout me={me} onLogout={onLogout} crumbs={crumbs}>
      <header className="class-hero pb-hero" style={hue(STATUS_HUE[c.status] ?? "orange")}>
        <span className="hero-pattern" aria-hidden="true" />
        {c.student.thumb ? <img className="hero-face" src={c.student.thumb} alt="" /> : <Glyph icon="life-buoy" hue="orange" size={56} />}
        <div className="grow"><h1>{c.student.name} <small>{c.student.class_name}</small></h1>
          <p>On probation since {day(c.opened_at)} · {c.term.name} {c.term.session} · average {pct(c.average)}</p></div>
        <div className="class-hero-actions">
          <a className="on-band with-icon button-like" href={`#/student/${c.student.id}`}><Icon name="user" size={15} />Profile</a>
          <button className="on-band with-icon" onClick={() => setModal("letter")}><Icon name="printer" size={15} />Letter to parents</button>
        </div>
      </header>
      {err && <p className="error">{err}</p>}
      <ol className="pb-steps">
        {STEPS.map((k, i) => <li key={k} className={i < step ? "done" : i === step ? "now" : ""}><b>{i + 1}</b><span>{c.statuses[k]}</span></li>)}
      </ol>
      <section className="card editor">
        <h3 className="with-glyph"><Glyph icon="alert-triangle" hue="red" size={30} />Why</h3>
        <ul className="pb-why">{c.reasons.map((r) => <li key={r}>{r}</li>)}</ul>
        <WeakBars weak={c.weak} />
        <p className="small muted">{c.family_told ? `The student and parents have been told${c.acknowledged ? `; ${c.acknowledged_by} acknowledged the plan on ${day(c.acknowledged)}` : ""}.` : "The family has not been told yet: the marks behind this are not published."}
          {c.parent_note && <> Parent's note: “{c.parent_note}”</>}</p>
      </section>
      <section className="card editor">
        <div className="row wrap"><h3 className="grow with-glyph"><Glyph icon="target" hue="violet" size={30} />Support plan</h3>
          {plan == null && <button className="ghost small with-icon" onClick={() => setPlan(c.plan ?? "")}><Icon name="edit" size={14} />{c.plan ? "Change" : "Write the plan"}</button>}</div>
        {plan == null
          ? (c.plan ? <p className="pb-plan">{c.plan}</p> : <Empty icon="target">No plan yet. Write what the school will do, what the student will do, and what parents can do at home.</Empty>)
          : <div className="stack">
              <textarea rows={7} value={plan} maxLength={4000} aria-label="Support plan" onChange={(e) => setPlan(e.target.value)}
                        placeholder={"Extra lessons in Mathematics and English, Tuesday and Thursday after school.\nDaily homework check by the form teacher.\nStudy time at home 1 hour every evening; parents sign the homework diary."} />
              <div className="row"><span className="grow" /><button onClick={() => setPlan(null)}>Cancel</button><button className="primary" disabled={busy} onClick={() => save({ plan })}>Save plan</button></div>
              <small className="muted">Saving tells the parents the plan is ready (they will be asked to acknowledge it again).</small>
            </div>}
        <div className="row wrap pb-review">
          <Field label="Review on"><input type="date" value={c.review_on ?? ""} onChange={(e) => e.target.value && save({ review_on: e.target.value })} /></Field>
          {c.can_lead && <Field label="Status"><select value={c.status} disabled={busy} onChange={(e) => save({ status: e.target.value })}>{Object.entries(c.statuses).map(([k, v]) => <option key={k} value={k}>{v}</option>)}</select></Field>}
        </div>
      </section>
      <section className="card editor">
        <div className="row wrap"><h3 className="grow with-glyph"><Glyph icon="clipboard-list" hue="blue" size={30} />Actions <small className="muted">{c.actions_done}/{c.actions_total} done</small></h3>
          <button className="ghost small with-icon" onClick={() => setModal("action")}><Icon name="plus" size={14} />Add an action</button></div>
        {c.actions.length === 0 && <Empty icon="clipboard-list">Who does what, by when. For example: “Extra Maths lessons — Mr Obi — every Tuesday”.</Empty>}
        <ul className="pb-actions">{c.actions.map((a) => (
          <li key={a.id} className={a.done ? "done" : ""}>
            <button className="pb-tick" aria-label={a.done ? `Mark not done: ${a.what}` : `Mark done: ${a.what}`} disabled={busy} onClick={() => run(async () => setC(await pb.done(c.id, a.id)))}>{a.done ? <Icon name="check" size={14} /> : null}</button>
            <span className="grow"><b>{a.what}</b><small className="block muted">{[a.who, a.due ? `by ${day(a.due)}` : null, a.by ? `added by ${a.by}` : null].filter(Boolean).join(" · ")}</small></span>
          </li>))}</ul>
      </section>
      <section className="card editor">
        <div className="row wrap"><h3 className="grow with-glyph"><Glyph icon="message" hue="teal" size={30} />Meetings</h3>
          <button className="ghost small with-icon" onClick={() => setModal("meeting")}><Icon name="plus" size={14} />Record a meeting</button></div>
        {c.meetings.length === 0 && <Empty icon="message">Meet the student and the parents early. Write down what was agreed.</Empty>}
        <ul className="pb-meetings">{[...c.meetings].reverse().map((m) => <li key={m.id}><b>{day(m.on)} · with {m.with}</b><p>{m.notes}</p><small className="muted">Written by {m.by}</small></li>)}</ul>
      </section>
      <section className="card editor">
        <h3 className="with-glyph"><Glyph icon="users" hue="indigo" size={30} />Who is helping ({c.team.length})</h3>
        <p className="small muted">Everyone here was told when the case opened.</p>
        <ul className="pb-team">{c.team.map((m) => <li key={m.id}><Avatar name={m.name} size={30} /><span><b>{m.name}</b><small className="block muted">{m.role}</small></span></li>)}</ul>
      </section>
      <section className="card editor">
        <h3 className="with-glyph"><Glyph icon="history" hue="slate" size={30} />History</h3>
        <ol className="as-history">{[...c.history].reverse().map((h, i) => <li key={i}>{h.action}<small className="muted block">{h.by} · {new Date(h.at).toLocaleString("en-GB", { dateStyle: "medium", timeStyle: "short" })}</small></li>)}</ol>
      </section>
      {modal === "action" && <ActionBox onClose={() => setModal(null)} onGo={async (b) => { setC(await pb.act(c.id, b)); setModal(null); }} team={c.team} />}
      {modal === "meeting" && <MeetingBox onClose={() => setModal(null)} onGo={async (b) => { setC(await pb.meet(c.id, b)); setModal(null); }} />}
      {modal === "letter" && <PrintSheet title="Letter to parents" note="Edit any text before printing" onClose={() => setModal(null)}><Letter c={c} /></PrintSheet>}
    </Layout>
  );
}

function ActionBox({ onClose, onGo, team }: { onClose: () => void; onGo: (b: { what: string; who: string | null; due: string | null }) => Promise<void>; team: Case["team"] }) {
  const [f, setF] = useState({ what: "", who: "", due: "" });
  const [busy, err, run] = useBusy();
  return (
    <Modal title="Add an action" onClose={onClose}>
      <div className="stack">
        <Field label="What will be done"><input value={f.what} maxLength={300} autoFocus onChange={(e) => setF({ ...f, what: e.target.value })} placeholder="e.g. Extra Mathematics lessons after school, Tue and Thu" /></Field>
        <Field label="Who"><input list="pb-team" value={f.who} maxLength={100} onChange={(e) => setF({ ...f, who: e.target.value })} placeholder="e.g. Maths teacher, Parents, Student" /></Field>
        <datalist id="pb-team">{["Student", "Parents", ...team.map((m) => `${m.name} (${m.role})`)].map((x) => <option key={x} value={x} />)}</datalist>
        <Field label="By (optional)"><input type="date" value={f.due} onChange={(e) => setF({ ...f, due: e.target.value })} /></Field>
        {err && <p className="error">{err}</p>}
        <div className="row"><span className="grow" /><button onClick={onClose}>Cancel</button>
          <button className="primary" disabled={busy || f.what.trim().length < 3} onClick={() => run(() => onGo({ what: f.what, who: f.who || null, due: f.due || null }))}>Add</button></div>
      </div>
    </Modal>
  );
}

function MeetingBox({ onClose, onGo }: { onClose: () => void; onGo: (b: { on: string; with_who: string; notes: string }) => Promise<void> }) {
  const [f, setF] = useState({ on: new Date().toISOString().slice(0, 10), with_who: "", notes: "" });
  const [busy, err, run] = useBusy();
  return (
    <Modal title="Record a meeting" onClose={onClose}>
      <div className="stack">
        <Field label="Date"><input type="date" value={f.on} onChange={(e) => setF({ ...f, on: e.target.value })} /></Field>
        <Field label="With"><input value={f.with_who} maxLength={200} onChange={(e) => setF({ ...f, with_who: e.target.value })} placeholder="e.g. Student and mother, form teacher, VP academics" /></Field>
        <Field label="What was agreed"><textarea rows={5} value={f.notes} maxLength={3000} onChange={(e) => setF({ ...f, notes: e.target.value })} /></Field>
        <small className="muted">Meeting notes stay with staff. Parents see only the date and who was there.</small>
        {err && <p className="error">{err}</p>}
        <div className="row"><span className="grow" /><button onClick={onClose}>Cancel</button>
          <button className="primary" disabled={busy || f.with_who.trim().length < 2 || f.notes.trim().length < 3} onClick={() => run(() => onGo(f))}>Save</button></div>
      </div>
    </Modal>
  );
}

function Letter({ c }: { c: Case }) {
  const lead = c.team.find((m) => m.role === "Principal") ?? c.team.find((m) => m.role === "Vice principal");
  const form = c.team.find((m) => m.role === "Form teacher");
  return (
    <article className="letter">
      <header className="lt-head">{c.school.logo && <img src={c.school.logo} alt="" />}<div><h1>{c.school.name}</h1>{c.school.motto && <em>{c.school.motto}</em>}<small>{[c.school.address, c.school.phone].filter(Boolean).join(" · ")}</small></div></header>
      <div className="lt-meta"><span>Ref: PROB/{c.id.slice(0, 6).toUpperCase()}</span><span>{day(new Date().toISOString())}</span></div>
      <p contentEditable suppressContentEditableWarning>Dear Parent / Guardian of <b>{c.student.name}</b> ({c.student.class_name}),</p>
      <h2>Academic probation: {c.term.name} {c.term.session}</h2>
      <p contentEditable suppressContentEditableWarning>We write to let you know that {c.student.first_name} has been placed on academic probation. This is not a punishment. It means the school, {c.student.first_name} and you need to work together now, before the end of term, so that {c.student.first_name} can catch up.</p>
      <p contentEditable suppressContentEditableWarning><b>Why:</b> {c.reasons.join("; ")}. The weakest subjects are {c.weak.slice(0, 4).map((w) => `${w.subject} (${pct(w.pct)})`).join(", ")}.</p>
      {c.plan && <><p><b>Our plan:</b></p><p className="pb-plan" contentEditable suppressContentEditableWarning>{c.plan}</p></>}
      {c.actions.length > 0 && <ul>{c.actions.map((a) => <li key={a.id}>{a.what}{a.who ? ` — ${a.who}` : ""}{a.due ? ` (by ${day(a.due)})` : ""}</li>)}</ul>}
      <p contentEditable suppressContentEditableWarning>Please meet {form ? `the form teacher, ${form.name},` : "the form teacher"} {c.review_on ? `before our review on ${day(c.review_on)}` : "within the next week"}, and sign and return the slip below. You can also acknowledge this plan in the school app.</p>
      <div className="lt-sign"><span className="lt-line" /><b>{lead?.name ?? "The Principal"}</b><small>{lead?.role ?? "Principal"}</small></div>
      <div className="pb-slip">
        <p>✂ - - - - - - - - - - - - - - - - - - - - - - - - - - - - - - - - - - - - - - -</p>
        <p>I have read the probation letter for <b>{c.student.name}</b> ({c.student.class_name}) and will support the plan.</p>
        <p>Parent's name: ______________________ Signature: ______________ Date: __________</p>
      </div>
    </article>
  );
}

// ---------- Small pieces for other pages ----------

/** Staff home: cases this person is helping with. */
export function ProbationCard() {
  const [d, setD] = useState<Awaited<ReturnType<typeof pb.mine>> | null>(null);
  useEffect(() => { pb.mine().then(setD).catch(() => {}); }, []);
  if (!d || !d.total) return null;
  return (
    <section className="card editor portal-card" style={hue("orange")}>
      <div className="card-head"><h2 className="with-glyph"><Glyph icon="life-buoy" hue="orange" size={34} />Students on probation</h2>
        {d.schools.map((s) => <a key={s.id} className="text-link small" href={`#/probation-list/${s.id}`}>See all{d.schools.length > 1 ? ` (${s.name})` : ""}</a>)}</div>
      <p className="small muted">{d.total} need help{d.no_plan ? `, ${d.no_plan} with no plan yet` : ""}.</p>
      <ul className="as-mini-sheets">{d.cases.map((c) => (
        <li key={c.id}><a href={`#/probation/${c.id}`}><span className="grow"><b>{c.student.name}</b> <small className="muted">{c.student.class_name} · {pct(c.average)} · {c.status_label}</small></span><Icon name="arrow-right" size={15} /></a></li>))}</ul>
    </section>
  );
}

/** A banner on a student's profile while they are on probation. */
export function ProbationBanner({ studentId }: { studentId: string }) {
  const [d, setD] = useState<Row[]>([]);
  useEffect(() => { pb.student(studentId).then(setD).catch(() => setD([])); }, [studentId]);
  const live = d.filter((c) => ["open", "plan", "review"].includes(c.status));
  if (!live.length) return null;
  const c = live[0];
  return (
    <a className="pb-banner" href={`#/probation/${c.id}`}>
      <Glyph icon="life-buoy" hue="orange" size={38} />
      <span className="grow"><b>On academic probation · {c.term.name}</b><small className="block">{c.reasons.join(" · ")}</small></span>
      <span className="hue-chip" style={hue(STATUS_HUE[c.status])}>{c.status_label}</span>
    </a>
  );
}

/** Families: the plan, what is being done, and the parent's acknowledgement. */
export function FamilyProbation({ studentId, onCount }: { studentId: string; onCount?: (n: number) => void }) {
  const [d, setD] = useState<{ relation: string; cases: FamilyCase[] } | null>(null);
  const [note, setNote] = useState("");
  const [busy, err, run] = useBusy();
  useEffect(() => { pb.family(studentId).then((x) => { setD(x); onCount?.(x.cases.length); }).catch(() => setD(null)); }, [studentId]); // eslint-disable-line react-hooks/exhaustive-deps
  if (!d || !d.cases.length) return null;
  const self = d.relation === "self";
  return (
    <>
      {d.cases.map((c) => {
        const live = ["open", "plan", "review"].includes(c.status);
        return (
          <section key={c.id} className={`card editor pb-family${live ? " live" : ""}`} style={hue(STATUS_HUE[c.status])}>
            <h3 className="with-glyph"><Glyph icon="life-buoy" hue={live ? "orange" : "green"} size={32} />{live ? (self ? "You are on academic probation" : `${c.student.first_name} is on academic probation`) : `Probation ${c.status_label.toLowerCase()}`} <small className="muted">{c.term.name}</small></h3>
            <p className="small">{self ? "This means you need extra help now, and the school, your parents and you will work together. You can do this." : "This is not a punishment. It means the school, your child and you need to work together now."}</p>
            <ul className="pb-why">{c.reasons.map((r) => <li key={r}>{r}</li>)}</ul>
            <WeakBars weak={c.weak} />
            <h4>The plan</h4>
            {c.plan ? <p className="pb-plan">{c.plan}</p> : <p className="muted small">The school is writing the plan. You will be told when it is ready.</p>}
            {c.actions.length > 0 && <ul className="pb-actions">{c.actions.map((a, i) => <li key={i} className={a.done ? "done" : ""}><span className="pb-tick">{a.done ? <Icon name="check" size={14} /> : null}</span><span className="grow"><b>{a.what}</b><small className="block muted">{[a.who, a.due ? `by ${day(a.due)}` : null].filter(Boolean).join(" · ")}</small></span></li>)}</ul>}
            {c.review_on && <p className="small"><b>Review:</b> {day(c.review_on)}</p>}
            {c.contacts.length > 0 && <p className="small muted">Talk to: {c.contacts.map((m) => `${m.name} (${m.role})`).join(", ")}</p>}
            {c.acknowledged
              ? <p className="pb-ack"><Icon name="circle-check" size={16} />Acknowledged by {c.acknowledged_by} on {day(c.acknowledged)}{c.parent_note ? `: “${c.parent_note}”` : ""}</p>
              : !self && c.plan && live && <div className="stack pb-ack-box">
                  <Field label="A note for the school (optional)"><textarea rows={2} value={note} maxLength={1000} onChange={(e) => setNote(e.target.value)} placeholder="e.g. We will check homework every night. Can we meet on Friday?" /></Field>
                  {err && <p className="error">{err}</p>}
                  <button className="primary with-icon" disabled={busy} onClick={() => run(async () => { setD(await pb.ack(studentId, c.id, note)); setNote(""); })}><Icon name="check" size={15} />I have read the plan and will support it</button>
                </div>}
          </section>
        );
      })}
    </>
  );
}
