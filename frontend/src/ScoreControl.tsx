// Checking and releasing scores: the heads' "To check" list, the principal's control room (deadlines, opening tests again,
// publishing each test, padlocks, settings) and the scores families see once a test is published.
import { useEffect, useState } from "react";
import { api, errorText, type Me } from "./api";
import { gradeHue } from "./Assessment";
import { useBusy } from "./GrowthBits";
import Icon from "./Icon";
import Layout from "./Layout";
import { subjectLook } from "./look";
import { href } from "./router";
import { Field, Glyph, hue, Modal, Stat } from "./ui";

interface ToCheck { scope: string; component: string; term_id: string; term: string; title: string; subject: string; group: string; teacher: string | null; students: number;
  average: number | null; handed_in_at: string | null; stage: number; stages: number; warnings: { level: string; text: string }[] }
interface Cell { sheets: number; draft: number; submitted: number; returned: number; approved: number; ready: boolean; published: boolean; locked: boolean; release_id: string | null; published_at: string | null }
interface Control {
  term: { id: string; name: string; session: string; terms: { id: string; name: string }[] }; settings: { checks: number; confirm_days: number };
  components: { component: string; closes_at: string | null; closed: boolean; openings: { id: string; teacher: string; teacher_id: string | null; until: string; reason: string | null; by: string | null }[] }[];
  classes: { id: string; name: string; level: string; students: number; tests: Record<string, Cell> }[]; can_publish: boolean; teachers: { id: string; name: string }[];
}
interface FamTerm { term_id: string; term: string; session: string; tests: { name: string; published_at: string; max: number | null }[];
  subjects: { subject: string; scores: Record<string, { score: number | null; max: number | null; absent: boolean }> }[] }

const capi = {
  toCheck: () => api.raw<ToCheck[]>("GET", "/api/me/to-check"),
  control: (sid: string, t?: string | null) => api.raw<Control>("GET", `/api/schools/${sid}/score-control${t ? `?term_id=${t}` : ""}`),
  settings: (sid: string, b: unknown) => api.raw("PUT", `/api/schools/${sid}/result-settings`, b),
  deadline: (sid: string, b: unknown) => api.raw("PUT", `/api/schools/${sid}/score-deadlines`, b),
  open: (sid: string, b: unknown) => api.raw("POST", `/api/schools/${sid}/score-openings`, b),
  shut: (id: string) => api.raw("DELETE", `/api/score-openings/${id}`),
  publish: (sid: string, b: unknown) => api.raw<{ published: number }>("POST", `/api/schools/${sid}/score-releases`, b),
  unlock: (rid: string, b: unknown) => api.raw("POST", `/api/score-releases/${rid}/unlock`, b),
  lock: (rid: string) => api.raw("POST", `/api/score-releases/${rid}/lock`),
  family: (sid: string) => api.raw<{ terms: FamTerm[] }>("GET", `/api/me/children/${sid}/scores`),
};
const when = (iso: string) => new Date(iso).toLocaleString("en-GB", { weekday: "short", day: "numeric", month: "short", hour: "2-digit", minute: "2-digit" });
const ago = (iso: string) => { const h = Math.round((Date.now() - new Date(iso).getTime()) / 3600000); return h < 1 ? "just now" : h < 24 ? `${h} h ago` : `${Math.round(h / 24)} days ago`; };
// <input type="datetime-local"> works in local time; the server keeps UTC.
const toLocal = (iso: string | null) => { if (!iso) return ""; const d = new Date(iso); return new Date(d.getTime() - d.getTimezoneOffset() * 60000).toISOString().slice(0, 16); };
const fromLocal = (v: string) => (v ? new Date(v).toISOString() : null);

// ---------- Heads of unit and HODs ----------

export function ToCheckCard() {
  const [d, setD] = useState<ToCheck[] | null>(null);
  useEffect(() => { capi.toCheck().then(setD).catch(() => setD([])); }, []);
  if (!d || d.length === 0) return null;
  const flagged = d.filter((x) => x.warnings.length).length;
  return (
    <section className="card editor portal-card" style={hue("amber")}>
      <div className="card-head"><h2 className="with-glyph"><Glyph icon="clipboard-list" hue="amber" size={34} />Scores to check</h2><span className="grow" />
        <a className="small-btn with-icon" href="#/check"><Icon name="arrow-right" size={13} />Open</a></div>
      <p><b className="as-big-n">{d.length}</b> test{d.length === 1 ? "" : "s"} handed in and waiting for you{flagged ? <> · <span style={{ color: "#d97706" }}>{flagged} with something to look at</span></> : null}.</p>
      <ul className="as-mini-sheets">{d.slice(0, 4).map((x) => <li key={x.scope + x.component}><a href={href({ page: "sheet", scope: x.scope })} style={hue(subjectLook(x.subject).hue)}>
        <span className="grow"><b>{x.component}</b> {x.title}</span>{x.warnings.length > 0 && <span className="hue-chip" style={hue("amber")}>⚠ {x.warnings.length}</span>}</a></li>)}</ul>
    </section>
  );
}

export function CheckPage({ me, onLogout }: { me: Me; onLogout: () => void }) {
  const [d, setD] = useState<ToCheck[] | null>(null);
  const [error, setError] = useState("");
  useEffect(() => { capi.toCheck().then(setD).catch((e) => setError(errorText(e))); }, []);
  return (
    <Layout wide me={me} onLogout={onLogout} crumbs={[{ label: "Home", href: "#/" }, { label: "Scores to check" }]}>
      <header className="class-hero as-hero" style={hue("amber")}>
        <span className="hero-pattern" aria-hidden="true" />
        <Glyph icon="clipboard-list" hue="amber" size={56} />
        <div className="grow"><h1>Scores to check</h1><p>Tests handed in by teachers in your unit or department. Open one, look at the marks, then approve it or send it back.</p></div>
      </header>
      {error && <p className="error">{error}</p>}
      {!d ? <div className="skeleton"><span /><span /></div> : d.length === 0 ? <div className="adm-empty"><span>🎉</span><p><b>Nothing waiting for you.</b></p><p className="muted small">When a teacher hands in a test, it shows here and on your home page.</p></div> : (
        <div className="as-check-list">{d.map((x) => { const l = subjectLook(x.subject); return (
          <a key={x.scope + x.component} className="as-check-item" href={href({ page: "sheet", scope: x.scope })} style={hue(l.hue)}>
            <div className="row"><Glyph icon={l.icon} hue={l.hue} size={40} />
              <span className="grow"><b>{x.component} · {x.subject}</b><small className="block muted">{x.group} · {x.teacher ?? "No teacher"} · {x.students} students{x.handed_in_at ? ` · handed in ${ago(x.handed_in_at)}` : ""}</small></span>
              <span className="as-check-avg"><b>{x.average == null ? "–" : `${Math.round(x.average)}%`}</b><small>average</small></span></div>
            {x.stages > 1 && <small className="muted">Check {x.stage} of {x.stages}</small>}
            <ul className="as-warn">{x.warnings.length ? x.warnings.map((w, i) => <li key={i} className={w.level}>⚠ {w.text}</li>) : <li className="green">✔ Nothing unusual</li>}</ul>
          </a>); })}</div>
      )}
    </Layout>
  );
}

// ---------- The principal's control room ----------

export function ControlRoom({ schoolId }: { schoolId: string }) {
  const [d, setD] = useState<Control | null>(null);
  const [term, setTerm] = useState<string | null>(null);
  const [error, setError] = useState("");
  const [pick, setPick] = useState<Record<string, string[]>>({});       // component -> class ids to publish
  const [modal, setModal] = useState<null | { open: string } | { unlock: { rid: string; cls: string; comp: string } }>(null);
  const [busy, err, run] = useBusy();
  const load = () => capi.control(schoolId, term).then((x) => { setD(x); setPick({}); }).catch((e) => setError(errorText(e)));
  useEffect(() => { void load(); }, [schoolId, term]); // eslint-disable-line react-hooks/exhaustive-deps
  if (error) return <p className="error">{error}</p>;
  if (!d) return <div className="skeleton"><span /><span /></div>;
  const comps = d.components.map((c) => c.component);
  const all = d.classes.flatMap((c) => comps.map((k) => c.tests[k]).filter(Boolean));
  const sheets = all.reduce((n, x) => n + x.sheets, 0), approved = all.reduce((n, x) => n + x.approved, 0), waiting = all.reduce((n, x) => n + x.submitted, 0);
  const toggle = (comp: string, cid: string) => setPick((p) => ({ ...p, [comp]: (p[comp] ?? []).includes(cid) ? (p[comp] ?? []).filter((x) => x !== cid) : [...(p[comp] ?? []), cid] }));
  return (
    <section className="stack">
      <div className="row wrap"><p className="muted grow">Deadlines for each test, who is waiting for what, and publishing. A published test carries a padlock 🔒: nobody can change those marks until you take it off.</p>
        <label className="term-pick"><Icon name="calendar-range" size={15} /><select value={d.term.id} onChange={(e) => setTerm(e.target.value)}>{d.term.terms.map((t) => <option key={t.id} value={t.id}>{t.name} {d.term.session}</option>)}</select></label></div>
      {err && <p className="error">{err}</p>}
      <div className="stat-strip">
        <Stat icon="circle-check" hue="green" value={`${sheets ? Math.round((100 * approved) / sheets) : 0}%`} label="tests approved" note={`${approved} of ${sheets} sheets`} />
        <Stat icon="hourglass" hue="amber" value={waiting} label="waiting for a head" />
        <Stat icon="lock" hue="indigo" value={all.filter((x) => x.locked).length} label="class tests published" />
      </div>

      <section className="card editor">
        <h3 className="with-glyph"><Glyph icon="clock" hue="blue" size={30} />Deadlines</h3>
        <p className="small muted">After the deadline the test closes by itself. Teachers can't type until you open it again, for one teacher or for everyone.</p>
        <div className="as-deadlines">{d.components.map((c) => (
          <div key={c.component} className={`as-deadline${c.closed ? " closed" : ""}`}>
            <div className="row"><b className="grow">{c.closed ? "🔒 " : ""}{c.component}</b><span className="hue-chip" style={hue(c.closed ? "slate" : c.closes_at ? "green" : "sky")}>{c.closed ? "Closed" : c.closes_at ? "Open" : "No deadline"}</span></div>
            <label className="small">Closes<input type="datetime-local" disabled={!d.can_publish || busy} defaultValue={toLocal(c.closes_at)} key={c.closes_at ?? "none"}
              onBlur={(e) => { if (fromLocal(e.target.value) !== (c.closes_at ? new Date(c.closes_at).toISOString() : null)) void run(async () => { await capi.deadline(schoolId, { term_id: d.term.id, component: c.component, closes_at: fromLocal(e.target.value) }); await load(); }); }} /></label>
            {c.openings.map((o) => <div key={o.id} className="as-opening"><Icon name="key" size={13} /><span className="grow"><b>{o.teacher}</b> until {when(o.until)}{o.reason ? <small className="block muted">{o.reason}</small> : null}</span>
              {d.can_publish && <button className="icon-btn" title="Close it again" onClick={() => run(async () => { await capi.shut(o.id); await load(); })}><Icon name="close" size={14} /></button>}</div>)}
            {d.can_publish && c.closed && <button className="small-btn with-icon" onClick={() => setModal({ open: c.component })}><Icon name="key" size={13} />Open again</button>}
          </div>))}</div>
      </section>

      <section className="card editor">
        <div className="row wrap"><h3 className="grow with-glyph"><Glyph icon="send" hue="fuchsia" size={30} />Publish to families</h3>
          {d.can_publish && Object.entries(pick).filter(([, v]) => v.length).map(([comp, ids]) => (
            <button key={comp} className="primary with-icon" disabled={busy} onClick={() => run(async () => { const x = await capi.publish(schoolId, { term_id: d.term.id, component: comp, class_ids: ids }); await load(); alertSoft(`${comp} published for ${x.published} class${x.published === 1 ? "" : "es"}`); })}>
              <Icon name="send" size={14} />Publish {comp} for {ids.length} class{ids.length === 1 ? "" : "es"}</button>))}</div>
        <p className="small muted">Tick the classes whose test is fully approved, then publish. Students and parents get a notice and see the marks; the test is locked. Tap 🔒 to take the padlock off for a correction.</p>
        <div className="as-sheet-wrap">
          <table className="as-matrix">
            <thead><tr><th className="name">Class</th>{comps.map((k) => <th key={k}>{k}</th>)}</tr></thead>
            <tbody>{d.classes.map((c) => (
              <tr key={c.id}><td className="name"><a href={href({ page: "results", id: c.id })}><b>{c.name}</b></a><small className="muted block">{c.students} students</small></td>
                {comps.map((k) => { const x = c.tests[k]; if (!x) return <td key={k} />; const pct = x.sheets ? Math.round((100 * x.approved) / x.sheets) : 0; const on = (pick[k] ?? []).includes(c.id); return (
                  <td key={k} className={`as-mcell${x.locked ? " locked" : x.published ? " open" : x.ready ? " ready" : ""}`}>
                    <div className="row">
                      {x.locked ? <button className="as-lock" title="Published and locked. Take the padlock off" disabled={!d.can_publish} onClick={() => setModal({ unlock: { rid: x.release_id!, cls: c.id, comp: k } })}>🔒</button>
                        : x.published ? <button className="as-lock open" title="Padlock off for corrections. Publish again when they are approved" disabled={!d.can_publish || busy} onClick={() => run(async () => { await capi.lock(x.release_id!); await load(); })}>🔓</button>
                        : d.can_publish && <input type="checkbox" aria-label={`Publish ${k} for ${c.name}`} checked={on} disabled={!x.ready && !x.published} onChange={() => toggle(k, c.id)} />}
                      <span className="as-bar"><span style={{ width: `${pct}%` }} /></span></div>
                    <small>{x.locked ? "Published" : x.ready ? (x.published ? "Ready to publish again" : "Ready to publish") : `${x.approved}/${x.sheets} approved`}</small>
                    {!x.locked && (x.submitted > 0 || x.returned > 0) && <small className="as-mini-counts">{x.submitted > 0 && <span className="am">{x.submitted} checking</span>}{x.returned > 0 && <span className="rd">{x.returned} sent back</span>}</small>}
                    {x.published && !x.locked && x.ready && d.can_publish && <label className="small"><input type="checkbox" checked={on} onChange={() => toggle(k, c.id)} /> publish again</label>}
                  </td>); })}</tr>))}</tbody>
          </table>
        </div>
      </section>

      <SettingsCard schoolId={schoolId} d={d} onDone={load} />
      {modal && "open" in modal && <OpenAgain schoolId={schoolId} d={d} comp={modal.open} onClose={() => setModal(null)} onDone={() => { setModal(null); void load(); }} />}
      {modal && "unlock" in modal && <Unlock {...modal.unlock} termId={d.term.id} onClose={() => setModal(null)} onDone={() => { setModal(null); void load(); }} />}
    </section>
  );
}

function alertSoft(text: string) {
  const el = document.createElement("div");
  el.className = "as-toast";
  el.textContent = `✔ ${text}`;
  document.body.appendChild(el);
  window.setTimeout(() => el.remove(), 3200);
}

function SettingsCard({ schoolId, d, onDone }: { schoolId: string; d: Control; onDone: () => void }) {
  const [busy, error, run] = useBusy();
  const save = (b: Partial<Control["settings"]>) => run(async () => { await capi.settings(schoolId, { ...d.settings, ...b }); onDone(); });
  return (
    <section className="card editor">
      <h3 className="with-glyph"><Glyph icon="settings" hue="slate" size={30} />How scores are checked</h3>
      <div className="as-set">
        <div><b>Checks before approval</b><small className="muted block">Who looks at a test after the teacher hands it in. Nobody checks their own marks.</small>
          <div className="segmented">
            <button className={d.settings.checks === 1 ? "on" : ""} disabled={!d.can_publish || busy} onClick={() => save({ checks: 1 })}>One: unit head (or HOD)</button>
            <button className={d.settings.checks === 2 ? "on" : ""} disabled={!d.can_publish || busy} onClick={() => save({ checks: 2 })}>Two: unit head, then HOD</button></div></div>
        <div><b>Days students have to confirm</b><small className="muted block">Used in the next stage: students check approved marks against their scripts.</small>
          <select value={d.settings.confirm_days} disabled={!d.can_publish || busy} onChange={(e) => save({ confirm_days: +e.target.value })}>{[2, 3, 4, 5, 7, 10, 14].map((n) => <option key={n} value={n}>{n} school days</option>)}</select></div>
      </div>
      {error && <p className="error">{error}</p>}
    </section>
  );
}

function OpenAgain({ schoolId, d, comp, onClose, onDone }: { schoolId: string; d: Control; comp: string; onClose: () => void; onDone: () => void }) {
  const soon = toLocal(new Date(Date.now() + 2 * 86400000).toISOString());
  const [f, setF] = useState({ teacher_id: "", until: soon, reason: "" });
  const [busy, error, run] = useBusy();
  return (
    <Modal title={`Open ${comp} again`} onClose={onClose}>
      <div className="stack">
        <Field label="For"><select value={f.teacher_id} onChange={(e) => setF({ ...f, teacher_id: e.target.value })}><option value="">Every teacher</option>{d.teachers.map((t) => <option key={t.id} value={t.id}>{t.name}</option>)}</select></Field>
        <Field label="Until"><input type="datetime-local" value={f.until} onChange={(e) => setF({ ...f, until: e.target.value })} /></Field>
        <Field label="Why (optional)"><input value={f.reason} maxLength={300} onChange={(e) => setF({ ...f, reason: e.target.value })} placeholder="e.g. Was on leave when CA1 closed" /></Field>
        <p className="small muted">Published and locked classes stay locked. This only lets typing happen again on tests that are not handed in yet.</p>
        {error && <p className="error">{error}</p>}
        <div className="row"><span className="grow" /><button onClick={onClose}>Cancel</button>
          <button className="primary" disabled={busy || !f.until} onClick={() => run(async () => { await capi.open(schoolId, { term_id: d.term.id, component: comp, teacher_id: f.teacher_id || null, until: fromLocal(f.until), reason: f.reason || null }); onDone(); })}>Open it</button></div>
      </div>
    </Modal>
  );
}

function Unlock({ rid, cls, comp, termId, onClose, onDone }: { rid: string; cls: string; comp: string; termId: string; onClose: () => void; onDone: () => void }) {
  const [subs, setSubs] = useState<{ id: string; name: string; teacher: string | null }[]>([]);
  const [pick, setPick] = useState<string[]>([]);
  const [note, setNote] = useState("");
  const [busy, error, run] = useBusy();
  useEffect(() => { api.raw<{ subjects: { id: string; name: string; teacher: string | null }[] }>("GET", `/api/classes/${cls}/results?term_id=${termId}`).then((x) => setSubs(x.subjects)).catch(() => {}); }, [cls, termId]);
  return (
    <Modal title={`Take the padlock off ${comp}`} onClose={onClose}>
      <div className="stack">
        <p className="small">Families keep seeing the published marks until you publish again. The subjects you choose go back to their teachers to correct; the others stay approved.</p>
        <Field label="Which subjects need a correction?"><div className="rec-tick-grid">{subs.map((s) => <label key={s.id} className={`check-pill${pick.includes(s.id) ? " on" : ""}`}><input type="checkbox" checked={pick.includes(s.id)} onChange={() => setPick(pick.includes(s.id) ? pick.filter((x) => x !== s.id) : [...pick, s.id])} />{s.name}</label>)}</div></Field>
        <Field label="Why (the teachers see this)"><input value={note} maxLength={300} onChange={(e) => setNote(e.target.value)} placeholder="e.g. Ada's script shows 18, not 13" /></Field>
        {error && <p className="error">{error}</p>}
        <div className="row"><span className="grow" /><button onClick={onClose}>Cancel</button>
          <button className="primary" disabled={busy || note.trim().length < 3 || !pick.length} onClick={() => run(async () => { await capi.unlock(rid, { note, subject_ids: pick }); onDone(); })}>Take the padlock off</button></div>
      </div>
    </Modal>
  );
}

// ---------- Families: published tests ----------

export function FamilyScores({ studentId }: { studentId: string }) {
  const [d, setD] = useState<FamTerm[] | null>(null);
  useEffect(() => { capi.family(studentId).then((x) => setD(x.terms)).catch(() => setD([])); }, [studentId]);
  if (!d || d.length === 0) return null;
  return (
    <>{d.map((t) => (
      <section key={t.term_id} className="card editor">
        <h3 className="with-glyph"><Glyph icon="chart" hue="fuchsia" size={30} />{t.term} {t.session}: scores so far</h3>
        <p className="small muted">{t.tests.map((x) => `${x.name} published ${new Date(x.published_at).toLocaleDateString("en-GB", { day: "numeric", month: "short" })}`).join(" · ")}</p>
        <div className="as-sheet-wrap"><table className="as-fam">
          <thead><tr><th className="l">Subject</th>{t.tests.map((x) => <th key={x.name}>{x.name}{x.max ? <small>/{x.max}</small> : null}</th>)}</tr></thead>
          <tbody>{t.subjects.map((s) => (
            <tr key={s.subject}><td className="l">{s.subject}</td>{t.tests.map((x) => { const v = s.scores[x.name]; const pc = v?.score != null && v.max ? (100 * v.score) / v.max : null; return (
              <td key={x.name}>{!v ? "" : v.absent ? <span className="muted">ABS</span> : <span className="as-cell" style={hue(gradeHue(pc == null ? null : pc >= 75 ? "A" : pc >= 60 ? "B" : pc >= 50 ? "C" : pc >= 40 ? "D" : "F"))}>{v.score ?? "–"}</span>}</td>); })}</tr>))}</tbody>
        </table></div>
      </section>))}</>
  );
}
