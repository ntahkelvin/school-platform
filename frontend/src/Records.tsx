// A student's academic record: this term, my subjects and teachers, every term so far, my years at school (and before),
// and choosing subjects for next year. Scores and report cards join the same page in the next stage.
import { useEffect, useState } from "react";
import { api, errorText } from "./api";
import { useBusy } from "./GrowthBits";
import Icon from "./Icon";
import { subjectLook } from "./look";
import { gradeHue } from "./Assessment";
import { StudentInsights } from "./Analysis";
import { Avatar, Field, Glyph, hue, Modal } from "./ui";

interface TermSum { days: number; attendance: number | null; absent: number; points: number; books: number; borrowed: number; awards: string[] }
interface Year { id: string; session: string | null; class_name: string | null; level: string | null; school_name: string | null; form_teacher: string | null; started_on: string | null;
  ended_on: string | null; outcome: string; outcome_label: string; subjects: { name: string; teacher: string | null }[]; note: string | null }
export interface ChoiceWindow { id: string; title: string; chooser_level: string; for_level: string; min: number; max: number; closes_on: string | null; is_open: boolean; note: string | null;
  subjects: { id: string; name: string }[]; mine?: { subject_ids: string[]; status: string; approved: string[]; note: string | null; at: string } | null }
export interface Rec {
  student: { id: string; name: string; first_name: string; admission_no: string; admitted_on: string | null; entry_class: string | null; previous_school: string | null };
  school: { name: string }; session: string; sessions_set: boolean;
  now: { term: string; session: string; week: number; weeks: number; days_left: number; ends_on: string; progress: number } | null;
  class: { id: string; name: string; level: string; form_teacher: string | null } | null; house: { name: string; colour: string | null } | null;
  subjects: { name: string; teacher: string | null; elective: boolean; per_week: number | null }[]; clubs: { name: string; role: string | null }[];
  terms: { name: string; number: number; starts_on: string | null; ends_on: string | null; state: "now" | "done" | "coming"; summary?: TermSum;
    result?: { average: number | null; position: string | null; out_of: number; grade: string | null } | null }[];
  years: Year[]; results: unknown[]; can_edit: boolean; choices?: ChoiceWindow[];
}
export const rapi = {
  family: (sid: string) => api.raw<Rec>("GET", `/api/me/children/${sid}/record`),
  staff: (sid: string) => api.raw<Rec>("GET", `/api/students/${sid}/record`),
  choose: (sid: string, wid: string, subject_ids: string[]) => api.raw<ChoiceWindow[]>("PUT", `/api/me/children/${sid}/choices/${wid}`, { subject_ids }),
  addPrev: (sid: string, b: unknown) => api.raw<Rec>("POST", `/api/students/${sid}/record/previous`, b),
  delPrev: (id: string) => api.raw("DELETE", `/api/enrolments/${id}`),
};
const nice = (d: string) => new Date(`${d}T12:00:00`).toLocaleDateString("en-GB", { day: "numeric", month: "short", year: "numeric" });
const OUT_HUE: Record<string, string> = { current: "blue", promoted: "green", repeated: "amber", graduated: "violet", left: "slate", previous: "teal" };
const OUT_ICON: Record<string, string> = { current: "sparkle", promoted: "trending", repeated: "refresh", graduated: "graduation-cap", left: "log-out", previous: "school" };

export default function RecordPage({ studentId, who }: { studentId: string; who: "self" | "parent" | "staff" }) {
  const [r, setR] = useState<Rec | null>(null);
  const [error, setError] = useState("");
  const [adding, setAdding] = useState(false);
  const [busy, err, run] = useBusy();
  const load = () => (who === "staff" ? rapi.staff(studentId) : rapi.family(studentId)).then(setR).catch((e) => setError(errorText(e)));
  useEffect(() => { void load(); }, [studentId]); // eslint-disable-line react-hooks/exhaustive-deps
  if (error) return <p className="error">{error}</p>;
  if (!r) return <div className="skeleton"><span /><span /><span /></div>;
  const me = who === "self";
  const open = (r.choices ?? []).filter((w) => w.is_open || w.mine);
  const years = [...r.years].reverse();
  return (
    <div className="stack rec">
      {open.map((w) => <ChooseCard key={w.id} w={w} sid={studentId} self={me} name={r.student.first_name} onDone={(c) => setR({ ...r, choices: c })} />)}

      <section className="rec-now" style={hue("indigo")}>
        <span className="hero-pattern" aria-hidden="true" />
        <div className="rec-now-main">
          <small>{r.session} session</small>
          <h2>{r.now ? r.now.term : "This term"}{r.class && <> · {r.class.name}</>}</h2>
          {r.now ? <>
            <div className="rec-bar" aria-label={`Week ${r.now.week} of ${r.now.weeks}`}><span style={{ width: `${Math.min(100, r.now.progress)}%` }} /></div>
            <p>Week <b>{r.now.week}</b> of {r.now.weeks} · {r.now.days_left === 0 ? "last day of term!" : <><b>{r.now.days_left}</b> day{r.now.days_left === 1 ? "" : "s"} to the holiday</>}</p>
          </> : <p className="small">{who === "staff" ? "Set the term dates under Academics so everyone can see how far into the term they are." : "Term dates will show here when the school sets them."}</p>}
        </div>
        <ul className="rec-now-facts">
          {r.class?.form_teacher && <li><Icon name="user" size={15} /><span>Form teacher<b>{r.class.form_teacher}</b></span></li>}
          <li><Icon name="presentation" size={15} /><span>Subjects<b>{r.subjects.length}</b></span></li>
          {r.house && <li><Icon name="houses" size={15} /><span>House<b>{r.house.name}</b></span></li>}
          {r.student.admitted_on && <li><Icon name="calendar-check" size={15} /><span>Joined<b>{nice(r.student.admitted_on)}</b></span></li>}
        </ul>
      </section>

      <StudentInsights studentId={studentId} family={who !== "staff"} title={me ? "How I'm doing" : `How ${r.student.first_name} is doing`} />

      <section className="card editor">
        <h3 className="with-glyph"><Glyph icon="presentation" hue="fuchsia" size={30} />{me ? "My subjects and teachers" : "Subjects and teachers"}</h3>
        {r.subjects.length === 0 ? <p className="muted">No subjects yet. {who === "staff" ? "Add subjects to the class under Academics." : ""}</p> : (
          <div className="rec-subjects">
            {r.subjects.map((s) => { const l = subjectLook(s.name); return (
              <div key={s.name} className="rec-subject" style={hue(l.hue)}>
                <Glyph icon={l.icon} hue={l.hue} size={38} />
                <span className="grow"><b>{s.name}</b><small>{s.teacher ?? "Teacher not set yet"}</small></span>
                <span className="rec-subject-tags">
                  {s.elective && <span className="hue-chip" style={hue("violet")}>Chosen</span>}
                  {s.per_week ? <span className="rec-per-week" title="Lessons a week">{s.per_week}<small>/wk</small></span> : null}
                </span>
              </div>); })}
          </div>
        )}
      </section>

      <section className="card editor">
        <h3 className="with-glyph"><Glyph icon="calendar-range" hue="teal" size={30} />{r.session} term by term</h3>
        <div className="rec-terms">
          {r.terms.map((t) => (
            <div key={t.number} className={`rec-term ${t.state}`}>
              <div className="row"><b className="grow">{t.name}</b><span className="hue-chip" style={hue(t.state === "now" ? "blue" : t.state === "done" ? "green" : "slate")}>{t.state === "now" ? "Now" : t.state === "done" ? "Done" : "Coming"}</span></div>
              {t.starts_on && <small className="muted">{nice(t.starts_on)}{t.ends_on ? ` – ${nice(t.ends_on)}` : ""}</small>}
              {t.summary ? (
                <ul className="rec-term-stats">
                  <li style={hue(t.summary.attendance == null ? "slate" : t.summary.attendance >= 90 ? "green" : t.summary.attendance >= 80 ? "amber" : "red")}><b>{t.summary.attendance == null ? "–" : `${t.summary.attendance}%`}</b><small>attendance</small></li>
                  <li style={hue(t.summary.points >= 0 ? "amber" : "red")}><b>{t.summary.points > 0 ? `+${t.summary.points}` : t.summary.points}</b><small>merit points</small></li>
                  <li style={hue("violet")}><b>{t.summary.books}</b><small>books read</small></li>
                  <li style={hue("sky")}><b>{t.summary.awards.length}</b><small>award{t.summary.awards.length === 1 ? "" : "s"}</small></li>
                </ul>
              ) : <p className="small muted">Starts {t.starts_on ? nice(t.starts_on) : "later"}.</p>}
              {t.summary?.awards.length ? <p className="small">🏅 {t.summary.awards.join(", ")}</p> : null}
              {t.result ? <p className="rec-result" style={hue(gradeHue(t.result.grade))}><Icon name="award" size={15} /><b>{t.result.average}%</b> average{t.result.position ? <> · <b>{t.result.position}</b> of {t.result.out_of}</> : null}{t.result.grade ? ` · ${t.result.grade}` : ""}</p>
                : t.state !== "coming" && <p className="rec-results-soon"><Icon name="chart" size={14} />{t.state === "done" ? "Report card not published yet" : "The report card shows here at the end of term"}</p>}
            </div>
          ))}
        </div>
      </section>

      <section className="card editor">
        <div className="row wrap"><h3 className="with-glyph grow"><Glyph icon="history" hue="orange" size={30} />{me ? "My school journey" : "School journey"}</h3>
          {r.can_edit && <button className="small-btn with-icon" onClick={() => setAdding(true)}><Icon name="plus" size={13} />Add a school before this one</button>}</div>
        {err && <p className="error">{err}</p>}
        <ol className="rec-journey">
          {years.map((y) => (
            <li key={y.id} style={hue((OUT_HUE[y.outcome] ?? "slate") as never)}>
              <span className="rec-dot"><Icon name={OUT_ICON[y.outcome] ?? "school"} size={15} /></span>
              <div className="rec-year">
                <div className="row wrap">
                  <b className="grow">{y.class_name ?? y.level ?? "Class not recorded"}{y.school_name ? ` · ${y.school_name}` : ""}</b>
                  <span className="hue-chip" style={hue((OUT_HUE[y.outcome] ?? "slate") as never)}>{y.outcome_label}</span>
                  {r.can_edit && y.outcome === "previous" && <button className="icon-btn" title="Remove" disabled={busy} onClick={() => run(async () => { await rapi.delPrev(y.id); await load(); })}><Icon name="trash" size={14} /></button>}
                </div>
                <small className="muted">{[y.session && `${y.session} session`, y.form_teacher && `Form teacher: ${y.form_teacher}`, y.ended_on && y.outcome !== "previous" && `until ${nice(y.ended_on)}`].filter(Boolean).join(" · ")}</small>
                {y.note && <p className="small">{y.note}</p>}
                {y.subjects.length > 0 && <details className="rec-year-subjects"><summary>{y.subjects.length} subjects</summary>
                  <ul>{y.subjects.map((s) => <li key={s.name}>{s.name}{s.teacher && <small className="muted"> · {s.teacher}</small>}</li>)}</ul></details>}
              </div>
            </li>
          ))}
          {r.student.previous_school && !r.years.some((y) => y.outcome === "previous") && (
            <li style={hue("teal")}><span className="rec-dot"><Icon name="school" size={15} /></span>
              <div className="rec-year"><b>{r.student.previous_school}</b><small className="muted block">Before joining {r.school.name}{r.student.entry_class ? ` (joined in ${r.student.entry_class})` : ""}</small></div></li>
          )}
        </ol>
      </section>
      {adding && <PrevForm sid={studentId} onClose={() => setAdding(false)} onDone={(x) => { setR(x); setAdding(false); }} />}
    </div>
  );
}

function PrevForm({ sid, onClose, onDone }: { sid: string; onClose: () => void; onDone: (r: Rec) => void }) {
  const [f, setF] = useState({ school_name: "", session_label: "", class_name: "", note: "" });
  const [busy, error, run] = useBusy();
  return (
    <Modal title="A school before this one" onClose={onClose}>
      <div className="stack">
        <Field label="School name"><input value={f.school_name} maxLength={150} onChange={(e) => setF({ ...f, school_name: e.target.value })} placeholder="e.g. Sunshine Nursery and Primary School" /></Field>
        <div className="form-grid">
          <Field label="Session"><input value={f.session_label} maxLength={20} onChange={(e) => setF({ ...f, session_label: e.target.value })} placeholder="2024/2025" /></Field>
          <Field label="Class"><input value={f.class_name} maxLength={40} onChange={(e) => setF({ ...f, class_name: e.target.value })} placeholder="Primary 6" /></Field>
        </div>
        <Field label="Note (optional)"><input value={f.note} maxLength={300} onChange={(e) => setF({ ...f, note: e.target.value })} placeholder="e.g. Common Entrance score 312" /></Field>
        {error && <p className="error">{error}</p>}
        <div className="row"><span className="grow" /><button onClick={onClose}>Cancel</button>
          <button className="primary" disabled={busy || f.school_name.trim().length < 2} onClick={() => run(async () => onDone(await rapi.addPrev(sid, {
            school_name: f.school_name, session_label: f.session_label || null, class_name: f.class_name || null, note: f.note || null }))) }>Add</button></div>
      </div>
    </Modal>
  );
}

// ---------- Choosing subjects (student or parent) ----------

function ChooseCard({ w, sid, self, name, onDone }: { w: ChoiceWindow; sid: string; self: boolean; name: string; onDone: (c: ChoiceWindow[]) => void }) {
  const [pick, setPick] = useState<string[]>(w.mine?.subject_ids ?? []);
  const [editing, setEditing] = useState(!w.mine);
  const [busy, error, run] = useBusy();
  const names = Object.fromEntries(w.subjects.map((s) => [s.id, s.name]));
  const toggle = (id: string) => setPick(pick.includes(id) ? pick.filter((x) => x !== id) : pick.length < w.max ? [...pick, id] : pick);
  const move = (i: number, d: number) => { const p = [...pick]; [p[i], p[i + d]] = [p[i + d], p[i]]; setPick(p); };
  const approved = w.mine?.status === "approved";
  return (
    <section className={`rec-choose${approved ? " done" : ""}`} style={hue(approved ? "green" : "fuchsia")}>
      <div className="row wrap"><Glyph icon={approved ? "circle-check" : "book-text"} hue={approved ? "green" : "fuchsia"} size={40} />
        <span className="grow"><b>{w.title}</b><small className="block">{self ? "Choose your" : `Choose ${name}'s`} subjects for {w.for_level}: {w.min === w.max ? w.min : `${w.min} to ${w.max}`}, best first.{w.closes_on ? ` Closes ${nice(w.closes_on)}.` : ""}</small></span></div>
      {w.note && <p className="small">{w.note}</p>}
      {approved ? (
        <p><b>Approved:</b> {w.mine!.approved.join(", ")}{w.mine!.note && <span className="muted"> · “{w.mine!.note}”</span>}</p>
      ) : !editing && w.mine ? (
        <div className="row wrap"><span className="grow">Sent: {w.mine.subject_ids.map((i, n) => <span key={i} className="rec-pick-chip"><b>{n + 1}</b>{names[i]}</span>)}
          <small className="muted block">Waiting for the school to approve.</small></span>
          {w.is_open && <button className="small-btn" onClick={() => setEditing(true)}>Change</button>}</div>
      ) : (
        <>
          <div className="rec-pick-grid">
            {w.subjects.map((s) => { const n = pick.indexOf(s.id); const l = subjectLook(s.name); return (
              <button key={s.id} className={`rec-pick${n >= 0 ? " on" : ""}`} style={hue(l.hue)} aria-pressed={n >= 0} onClick={() => toggle(s.id)} disabled={n < 0 && pick.length >= w.max}>
                <Glyph icon={l.icon} hue={l.hue} size={28} /><span>{s.name}</span>{n >= 0 && <b className="rec-pick-n">{n + 1}</b>}</button>); })}
          </div>
          {pick.length > 1 && <ol className="rec-order">{pick.map((id, i) => (
            <li key={id}><b>{i + 1}</b><span className="grow">{names[id]}</span>
              <button className="icon-btn" aria-label="Up" disabled={i === 0} onClick={() => move(i, -1)}><Icon name="chevron-up" size={14} /></button>
              <button className="icon-btn" aria-label="Down" disabled={i === pick.length - 1} onClick={() => move(i, 1)}><Icon name="chevron-down" size={14} /></button></li>))}</ol>}
          {error && <p className="error">{error}</p>}
          <div className="row"><small className="muted grow">{pick.length} of {w.max} chosen{pick.length < w.min ? ` · choose at least ${w.min}` : ""}</small>
            {w.mine && <button onClick={() => { setPick(w.mine!.subject_ids); setEditing(false); }}>Cancel</button>}
            <button className="primary with-icon" disabled={busy || pick.length < w.min} onClick={() => run(async () => { onDone(await rapi.choose(sid, w.id, pick)); setEditing(false); })}><Icon name="send" size={14} />Send my choices</button></div>
        </>
      )}
    </section>
  );
}

// ---------- Subject choices (staff, on the Students page) ----------

interface WinRow extends ChoiceWindow { students: number; sent: number; approved: number }
interface WinDetail extends ChoiceWindow { sent: number; demand: { id: string; name: string; students: number; first: number }[];
  students: { id: string; name: string; class_name: string | null; thumb: string | null; choice: { id: string; subjects: string[]; subject_ids: string[]; status: string; approved: string[]; note: string | null } | null }[] }

export function SubjectChoicesPanel({ schoolId }: { schoolId: string }) {
  const [d, setD] = useState<{ windows: WinRow[]; subjects: { id: string; name: string }[]; levels: string[] } | null>(null);
  const [form, setForm] = useState<WinRow | "new" | null>(null);
  const [open, setOpen] = useState<string | null>(null);
  const load = () => api.raw<typeof d>("GET", `/api/schools/${schoolId}/subject-choices`).then(setD).catch(() => {});
  useEffect(() => { void load(); }, [schoolId]); // eslint-disable-line react-hooks/exhaustive-deps
  if (!d) return <div className="skeleton"><span /><span /></div>;
  return (
    <section className="stack">
      <div className="row wrap"><p className="muted grow">Let students choose their subjects for next year (for example JSS 3 choosing SS 1 subjects). They choose on their portal, best first; you see how many want each subject and approve. Approved subjects are added when they move up.</p>
        <button className="primary with-icon" onClick={() => setForm("new")}><Icon name="plus" size={15} />New subject choices</button></div>
      {d.windows.length === 0 ? <div className="adm-empty"><span>📚</span><p><b>No subject choices yet.</b></p></div> : (
        <div className="rec-windows">
          {d.windows.map((w) => (
            <button key={w.id} className="rec-window" onClick={() => setOpen(w.id)}>
              <div className="row"><b className="grow">{w.title}</b><span className="hue-chip" style={hue(w.is_open ? "green" : "slate")}>{w.is_open ? "Open" : "Closed"}</span></div>
              <small className="muted">{w.chooser_level} choosing for {w.for_level} · {w.min}–{w.max} of {w.subjects.length} subjects{w.closes_on ? ` · closes ${nice(w.closes_on)}` : ""}</small>
              <div className="rec-bar two"><span style={{ width: `${w.students ? (100 * w.sent) / w.students : 0}%` }} /><i style={{ width: `${w.students ? (100 * w.approved) / w.students : 0}%` }} /></div>
              <small><b>{w.sent}</b> of {w.students} have chosen · <b>{w.approved}</b> approved</small>
            </button>
          ))}
        </div>
      )}
      {form && <WindowForm schoolId={schoolId} w={form === "new" ? null : form} subjects={d.subjects} levels={d.levels} onClose={() => setForm(null)} onDone={() => { setForm(null); void load(); }} />}
      {open && <WindowDetail id={open} onClose={() => { setOpen(null); void load(); }} onEdit={() => { setForm(d.windows.find((w) => w.id === open) ?? null); setOpen(null); }} />}
    </section>
  );
}

function WindowForm({ schoolId, w, subjects, levels, onClose, onDone }: { schoolId: string; w: WinRow | null; subjects: { id: string; name: string }[]; levels: string[]; onClose: () => void; onDone: () => void }) {
  const [f, setF] = useState({ title: w?.title ?? "", chooser_level: w?.chooser_level ?? levels[0] ?? "", for_level: w?.for_level ?? levels[1] ?? "", subject_ids: w?.subjects.map((s) => s.id) ?? [] as string[],
    min_choices: w?.min ?? 3, max_choices: w?.max ?? 4, closes_on: w?.closes_on ?? "", is_open: w?.is_open ?? true, note: w?.note ?? "" });
  const [busy, error, run] = useBusy();
  const tick = (id: string) => setF({ ...f, subject_ids: f.subject_ids.includes(id) ? f.subject_ids.filter((x) => x !== id) : [...f.subject_ids, id] });
  return (
    <Modal wide title={w ? "Change subject choices" : "New subject choices"} onClose={onClose}>
      <div className="stack">
        <Field label="Title"><input value={f.title} maxLength={120} onChange={(e) => setF({ ...f, title: e.target.value })} placeholder="e.g. SS 1 elective subjects" /></Field>
        <div className="form-grid">
          <Field label="Who chooses"><select value={f.chooser_level} onChange={(e) => setF({ ...f, chooser_level: e.target.value })}>{levels.map((l) => <option key={l}>{l}</option>)}</select></Field>
          <Field label="Subjects for"><select value={f.for_level} onChange={(e) => setF({ ...f, for_level: e.target.value })}>{levels.map((l) => <option key={l}>{l}</option>)}</select></Field>
          <Field label="Choose at least"><input type="number" min={1} max={10} value={f.min_choices} onChange={(e) => setF({ ...f, min_choices: +e.target.value })} /></Field>
          <Field label="Choose at most"><input type="number" min={1} max={12} value={f.max_choices} onChange={(e) => setF({ ...f, max_choices: +e.target.value })} /></Field>
          <Field label="Closes on (optional)"><input type="date" value={f.closes_on} onChange={(e) => setF({ ...f, closes_on: e.target.value })} /></Field>
        </div>
        <Field label={<>Subjects they can choose from <small className="muted">({f.subject_ids.length} ticked)</small></>}>
          <div className="rec-tick-grid">{subjects.map((s) => <label key={s.id} className={`check-pill${f.subject_ids.includes(s.id) ? " on" : ""}`}><input type="checkbox" checked={f.subject_ids.includes(s.id)} onChange={() => tick(s.id)} />{s.name}</label>)}</div>
        </Field>
        <Field label="Note for students and parents (optional)"><textarea rows={2} maxLength={600} value={f.note} onChange={(e) => setF({ ...f, note: e.target.value })} placeholder="e.g. Science students should pick Physics, Chemistry and Biology." /></Field>
        {w && <label className="row"><input type="checkbox" checked={f.is_open} onChange={(e) => setF({ ...f, is_open: e.target.checked })} />Open for choosing</label>}
        {!w && <p className="small muted">Students in {f.chooser_level} and their parents will get a notice.</p>}
        {error && <p className="error">{error}</p>}
        <div className="row"><span className="grow" /><button onClick={onClose}>Cancel</button>
          <button className="primary" disabled={busy || f.title.trim().length < 3 || f.subject_ids.length < 2} onClick={() => run(async () => {
            const b = { ...f, closes_on: f.closes_on || null, note: f.note || null };
            await (w ? api.raw("PUT", `/api/subject-choice-windows/${w.id}`, b) : api.raw("POST", `/api/schools/${schoolId}/subject-choices`, b)); onDone(); })}>{w ? "Save" : "Open for choosing"}</button></div>
      </div>
    </Modal>
  );
}

function WindowDetail({ id, onClose, onEdit }: { id: string; onClose: () => void; onEdit: () => void }) {
  const [d, setD] = useState<WinDetail | null>(null);
  const [ap, setAp] = useState<WinDetail["students"][number] | null>(null);
  const [busy, error, run] = useBusy();
  const load = () => api.raw<WinDetail>("GET", `/api/subject-choice-windows/${id}`).then(setD).catch(() => {});
  useEffect(() => { void load(); }, [id]); // eslint-disable-line react-hooks/exhaustive-deps
  const top = d ? Math.max(1, ...d.demand.map((x) => x.students)) : 1;
  const waiting = d ? d.students.filter((s) => s.choice?.status === "sent").length : 0;
  return (
    <Modal wide title={d?.title ?? "Subject choices"} onClose={onClose}>
      {!d ? <div className="skeleton"><span /><span /></div> : (
        <div className="stack">
          <div className="row wrap"><span className="grow muted">{d.chooser_level} choosing for {d.for_level} · {d.sent} of {d.students.length} have chosen</span>
            <button className="small-btn with-icon" onClick={onEdit}><Icon name="edit" size={13} />Change</button>
            {waiting > 0 && <button className="small-btn primary with-icon" disabled={busy} onClick={() => run(async () => { await api.raw("POST", `/api/subject-choice-windows/${id}/approve-all`); await load(); })}><Icon name="check" size={13} />Approve all {waiting} as chosen</button>}</div>
          {error && <p className="error">{error}</p>}
          <h4>How many want each subject</h4>
          <ul className="rec-demand">{d.demand.map((x) => { const l = subjectLook(x.name); return (
            <li key={x.id} style={hue(l.hue)}><span className="rec-demand-name">{x.name}</span><span className="rec-demand-bar"><span style={{ width: `${(100 * x.students) / top}%` }} /></span>
              <b>{x.students}</b><small className="muted">{x.first ? `${x.first} first choice` : ""}</small></li>); })}</ul>
          <h4>Students</h4>
          <ul className="rec-choosers">{d.students.map((s) => (
            <li key={s.id}>
              {s.thumb ? <img className="mini-face" src={s.thumb} alt="" /> : <Avatar name={s.name} size={32} />}
              <span className="grow"><b>{s.name}</b><small className="muted block">{s.class_name}</small></span>
              <span className="rec-chooser-picks">{s.choice ? (s.choice.status === "approved"
                ? <><span className="hue-chip" style={hue("green")}>Approved</span><small>{s.choice.approved.map((i) => d.subjects.find((x) => x.id === i)?.name).join(", ")}</small></>
                : <>{s.choice.subjects.map((n, i) => <span key={n} className="rec-pick-chip"><b>{i + 1}</b>{n}</span>)}</>) : <small className="muted">Not chosen yet</small>}</span>
              {s.choice && <button className="small-btn" onClick={() => setAp(s)}>{s.choice.status === "approved" ? "Change" : "Approve"}</button>}
            </li>))}</ul>
        </div>
      )}
      {ap && d && <ApproveForm w={d} s={ap} onClose={() => setAp(null)} onDone={() => { setAp(null); void load(); }} />}
    </Modal>
  );
}

function ApproveForm({ w, s, onClose, onDone }: { w: WinDetail; s: WinDetail["students"][number]; onClose: () => void; onDone: () => void }) {
  const c = s.choice!;
  const [ids, setIds] = useState<string[]>(c.status === "approved" ? c.approved : c.subject_ids);
  const [note, setNote] = useState(c.note ?? "");
  const [busy, error, run] = useBusy();
  return (
    <Modal title={`Approve subjects for ${s.name}`} onClose={onClose}>
      <div className="stack">
        <p className="small muted">They chose (best first): {c.subjects.join(", ")}. Untick any that can't be offered or tick another.</p>
        <div className="rec-tick-grid">{w.subjects.map((x) => <label key={x.id} className={`check-pill${ids.includes(x.id) ? " on" : ""}`}>
          <input type="checkbox" checked={ids.includes(x.id)} onChange={() => setIds(ids.includes(x.id) ? ids.filter((i) => i !== x.id) : [...ids, x.id])} />{x.name}
          {c.subject_ids.includes(x.id) && <b className="rec-pick-n small">{c.subject_ids.indexOf(x.id) + 1}</b>}</label>)}</div>
        <Field label="Note to the student (optional)"><input maxLength={300} value={note} onChange={(e) => setNote(e.target.value)} placeholder="e.g. Further Maths is full, so we gave you Economics" /></Field>
        {error && <p className="error">{error}</p>}
        <div className="row"><span className="grow" /><button onClick={onClose}>Cancel</button>
          <button className="primary" disabled={busy || ids.length === 0} onClick={() => run(async () => { await api.raw("POST", `/api/subject-choices/${c.id}/approve`, { subject_ids: ids, note: note || null }); onDone(); })}>Approve</button></div>
      </div>
    </Modal>
  );
}
