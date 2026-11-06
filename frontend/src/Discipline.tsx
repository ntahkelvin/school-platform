// Discipline: staff report → (house master) → POD → principal decides → actions → closed.
// The ladder (demerit points → detention → discipline probation) opens cases by itself. Families see what the school allows.
import { useEffect, useState } from "react";
import { api, errorText, type Me } from "./api";
import { useBusy } from "./GrowthBits";
import { StudentPicker } from "./Helpdesk";
import Icon from "./Icon";
import Layout from "./Layout";
import type { StudentCard } from "./opsApi";
import { PrintSheet } from "./Scanner";
import { Avatar, Empty, Field, Glyph, hue, Modal, Stat } from "./ui";

interface Offence { key: string; name: string; level: "minor" | "major" | "severe"; points: number; boarding: boolean }
interface Settings {
  pods: { id: string; name: string }[]; pods_chosen: boolean; offences: Offence[]; punishments: { key: string; name: string }[];
  ladder: { detention: number; probation: number }; parents_see: "all" | "serious" | "letters"; boarding_first: boolean; pod_settles_minor: boolean;
  kinds: Record<string, string>; stages: Record<string, string>; can_change: boolean; can_run: boolean; can_decide: boolean; is_pod: boolean;
}
interface Action { id: string; kind: string; label: string; name: string | null; points: number | null; on: string | null; until: string | null; at: string | null; note: string | null; in_school: boolean | null; done: string | null }
interface Row {
  id: string; number: number; status: string; stage: string; level: string; offence: string; offence_name: string; occurred_at: string; place: string | null;
  student: { id: string; name: string; first_name: string; thumb: string | null; class_name: string | null; admission_no: string } | null; about: string | null;
  reported_at: string | null; reporter_kind: string; reporter: string | null; decision: string | null; actions: Action[]; group: string | null; role: string | null;
}
interface Case extends Row {
  details: string | null; statements?: { id: string; who: string; text: string; at: string; by: string }[]; recommendation?: string | null;
  history: { at: string; by: string; action: string }[]; decided_by?: string | null; decided_at?: string | null; parent_seen_at?: string | null; parent_reply?: string | null;
  others?: { id: string; number: number; student: string | null; status: string }[]; earlier?: { id: string; number: number; offence_name: string; status: string; at: string; actions: string[] }[];
  demerits_this_term?: number | null; house_master?: string | null;
  settings: { punishments: { key: string; name: string }[]; kinds: Record<string, string>; parents_see: string; pod_settles_minor: boolean };
  can: { statement: boolean; forward_pod: boolean; forward_principal: boolean; dismiss: boolean; decide: boolean; pod_only_minor: boolean; link: boolean; act: boolean; close: boolean };
  school: { id: string; name: string; logo: string | null; address: string | null; phone: string | null; motto: string | null };
}
type View = "inbox" | "open" | "decided" | "all" | "detention" | "active" | "rules";
interface ListOut { view: string; cases?: Row[]; items?: { action: Action; case: Row }[]; counts: Record<string, number>; can_run: boolean; is_pod?: boolean; can_decide?: boolean; pods?: string[]; today?: string }
export interface FamilyCase { id: string; number: number; offence_name: string; level: string; occurred_at: string; decision: string | null; decided_at: string | null;
  actions: { kind: string; label: string; text: string; done: boolean }[]; seen_at: string | null; reply: string | null }

const dp = {
  settings: (sid: string) => api.raw<Settings>("GET", `/api/schools/${sid}/discipline/settings`),
  save: (sid: string, b: Partial<{ pod_user_ids: string[]; offences: Offence[]; punishments: { key?: string; name: string }[]; ladder: Settings["ladder"]; parents_see: string; boarding_first: boolean; pod_settles_minor: boolean }>) =>
    api.raw<Settings>("PUT", `/api/schools/${sid}/discipline/settings`, b),
  list: (sid: string, view: View) => api.raw<ListOut>("GET", `/api/schools/${sid}/discipline?view=${view}`),
  report: (sid: string, b: { student_ids: string[]; offence: string; occurred_at: string | null; place: string | null; details: string }) =>
    api.raw<{ cases: Row[] }>("POST", `/api/schools/${sid}/discipline/reports`, b),
  one: (id: string) => api.raw<Case>("GET", `/api/discipline/${id}`),
  statement: (id: string, b: { who: string; text: string }) => api.raw<Case>("POST", `/api/discipline/${id}/statements`, b),
  forward: (id: string, b: { to: "pod" | "principal"; recommendation: string | null }) => api.raw<Case>("POST", `/api/discipline/${id}/forward`, b),
  dismiss: (id: string, reason: string) => api.raw<Case>("POST", `/api/discipline/${id}/dismiss`, { reason }),
  link: (id: string, b: { student_ids: string[]; offence: string }) => api.raw<{ cases: string[] }>("POST", `/api/discipline/${id}/link`, b),
  decide: (id: string, b: { decision: string; actions: Partial<Action>[] }) => api.raw<Case>("POST", `/api/discipline/${id}/decide`, b),
  done: (id: string, aid: string) => api.raw<Case>("POST", `/api/discipline/${id}/actions/${aid}/done`),
  close: (id: string) => api.raw<Case>("POST", `/api/discipline/${id}/close`),
  student: (sid: string) => api.raw<{ cases: Row[]; active: (Action & { case_id: string })[]; demerits_this_term: number; ladder: Settings["ladder"] }>("GET", `/api/students/${sid}/discipline`),
  mine: () => api.raw<{ school: { id: string; name: string }; waiting: number; cases: Row[] }[]>("GET", "/api/me/discipline"),
  family: (sid: string) => api.raw<{ relation: string; cases: FamilyCase[]; demerits_this_term: number; ladder: Settings["ladder"] }>("GET", `/api/me/children/${sid}/discipline`),
  seen: (sid: string, cid: string, reply: string) => api.raw<{ relation: string; cases: FamilyCase[] }>("POST", `/api/me/children/${sid}/discipline/${cid}/seen`, { reply: reply || null }),
  tip: (sid: string, b: { about: string; what: string; place: string | null }) => api.raw<{ message: string }>("POST", `/api/me/children/${sid}/discipline-tip`, b),
};

const LEVEL_HUE: Record<string, string> = { minor: "amber", major: "orange", severe: "red" };
const STAGE_HUE: Record<string, string> = { tip: "violet", house: "teal", pod: "blue", principal: "indigo", decided: "green", closed: "slate", dismissed: "slate" };
const KIND_ICON: Record<string, string> = { counselling: "message", warning: "alert-triangle", punishment: "hammer", demerit: "thumbs-up", detention: "clock",
  invite_parents: "users", probation: "life-buoy", suspension: "home", expulsion: "x" };
const FLOW = ["pod", "principal", "decided", "closed"];
const day = (iso: string | null | undefined) => (iso ? new Date(iso.length === 10 ? iso + "T12:00:00" : iso).toLocaleDateString("en-GB", { weekday: "short", day: "numeric", month: "short" }) : "");
const when = (iso: string) => new Date(iso).toLocaleString("en-GB", { day: "numeric", month: "short", hour: "2-digit", minute: "2-digit" });
const actText = (a: Action) => {
  if (a.kind === "punishment") return a.name ?? "Punishment";
  if (a.kind === "demerit") return `${a.points} demerit points`;
  if (a.kind === "detention") return `Detention ${day(a.on)}${a.at ? ` at ${a.at}` : ""}`;
  if (a.kind === "invite_parents") return `Parents invited ${day(a.on)}${a.at ? ` at ${a.at}` : ""}`;
  if (a.kind === "probation" || a.kind === "suspension") return `${a.label}${a.in_school ? " (in school)" : ""}: ${day(a.on)} to ${day(a.until)}`;
  return a.label + (a.name ? `: ${a.name}` : "");
};

// ---------- Report a student ----------

export function ReportBox({ schoolId, student, onClose, onDone }: { schoolId: string; student?: StudentCard | null; onClose: () => void; onDone?: () => void }) {
  const [st, setSt] = useState<Settings | null>(null);
  const [kids, setKids] = useState<StudentCard[]>(student ? [student] : []);
  const [f, setF] = useState({ offence: "", place: "", details: "", at: "" });
  const [ok, setOk] = useState("");
  const [busy, err, run] = useBusy();
  useEffect(() => { dp.settings(schoolId).then(setSt).catch(() => {}); }, [schoolId]);
  const off = st?.offences.find((o) => o.key === f.offence);
  const levels: Offence["level"][] = ["minor", "major", "severe"];
  if (ok) return <Modal title="Report sent" onClose={onClose}><div className="stack"><p className="dc-ok"><Icon name="circle-check" size={18} />{ok}</p><button className="primary" onClick={onClose}>Done</button></div></Modal>;
  return (
    <Modal title="Report a student's behaviour" onClose={onClose}>
      <div className="stack">
        <div><span className="field-label">Who</span>
          <div className="chips">{kids.map((s) => <span key={s.id} className="chip">{s.name} ({s.class_name})<button type="button" className="chip-x" aria-label={`Remove ${s.name}`} onClick={() => setKids(kids.filter((x) => x.id !== s.id))}>×</button></span>)}</div>
          <StudentPicker schoolId={schoolId} value={null} label={kids.length ? "Add another student (same incident)" : "Find the student"} onPick={(s) => s && !kids.some((x) => x.id === s.id) && setKids([...kids, s])} /></div>
        <Field label="What did they do?">
          <select value={f.offence} onChange={(e) => setF({ ...f, offence: e.target.value })}>
            <option value="">Choose…</option>
            {levels.map((lv) => <optgroup key={lv} label={lv[0].toUpperCase() + lv.slice(1)}>{st?.offences.filter((o) => o.level === lv).map((o) => <option key={o.key} value={o.key}>{o.name}{o.boarding ? " (boarding)" : ""}</option>)}</optgroup>)}
          </select>
        </Field>
        {off && <p className="small muted">{off.level === "severe" ? "Severe: the principal is told at once." : off.boarding && st?.boarding_first ? "Boarding: it goes to the house master first, then the POD." : "It goes to the principal of discipline (POD)."}</p>}
        <div className="form-grid">
          <Field label="Where (optional)"><input value={f.place} maxLength={120} onChange={(e) => setF({ ...f, place: e.target.value })} placeholder="e.g. JSS 2 block, dining hall" /></Field>
          <Field label="When"><input type="datetime-local" value={f.at} onChange={(e) => setF({ ...f, at: e.target.value })} /></Field>
        </div>
        <Field label="What happened"><textarea rows={4} maxLength={4000} value={f.details} onChange={(e) => setF({ ...f, details: e.target.value })} placeholder="Just the facts: what you saw or were told, and who else was there." /></Field>
        {err && <p className="error">{err}</p>}
        <div className="row"><span className="grow" /><button onClick={onClose}>Cancel</button>
          <button className="primary" disabled={busy || !kids.length || !f.offence || f.details.trim().length < 5} onClick={() => run(async () => {
            const r = await dp.report(schoolId, { student_ids: kids.map((k) => k.id), offence: f.offence, place: f.place || null, details: f.details, occurred_at: f.at ? new Date(f.at).toISOString() : null });
            setOk(`Report${r.cases.length > 1 ? "s" : ""} ${r.cases.map((c) => `#${c.number}`).join(", ")} sent to ${r.cases[0].status === "house" ? "the house master" : "the POD"}. You will be told what is decided.`);
            onDone?.();
          })}>Send report</button></div>
      </div>
    </Modal>
  );
}

// ---------- The discipline page ----------

export function DisciplinePage({ me, onLogout, schoolId }: { me: Me; onLogout: () => void; schoolId: string }) {
  const [st, setSt] = useState<Settings | null>(null);
  const [view, setView] = useState<View>("inbox");
  const [d, setD] = useState<ListOut | null>(null);
  const [error, setError] = useState("");
  const [report, setReport] = useState(false);
  const load = (v: View = view) => v === "rules" ? Promise.resolve() : dp.list(schoolId, v).then(setD).catch((e) => setError(errorText(e)));
  useEffect(() => { dp.settings(schoolId).then((s) => { setSt(s); if (!s.can_run) setView("all"); }).catch((e) => setError(errorText(e))); }, [schoolId]);
  useEffect(() => { void load(view); }, [view, schoolId]); // eslint-disable-line react-hooks/exhaustive-deps
  const crumbs = [{ label: "Home", href: "#/" }, { label: "Discipline" }];
  if (error) return <Layout me={me} onLogout={onLogout} crumbs={crumbs}><p className="error">{error}</p></Layout>;
  if (!st || !d) return <Layout me={me} onLogout={onLogout} crumbs={crumbs}><div className="skeleton"><span /><span /><span /></div></Layout>;
  const tabs: [View, string, string][] = st.can_run
    ? [["inbox", "Waiting for me", "inbox"], ["open", "Open", "folder"], ["decided", "Decided", "gavel"], ["detention", "Detention", "clock"], ["active", "Suspended / on probation", "life-buoy"], ["all", "All", "list"],
       ...(st.can_change ? [["rules", "Rules", "settings"] as [View, string, string]] : [])]
    : [["all", "My reports and my class", "list"]];
  return (
    <Layout wide me={me} onLogout={onLogout} crumbs={crumbs}>
      <header className="class-hero dc-hero" style={hue("indigo")}>
        <span className="hero-pattern" aria-hidden="true" />
        <Glyph icon="gavel" hue="indigo" size={56} />
        <div className="grow"><h1>Discipline</h1>
          <p>Reports go to the principal of discipline ({st.pods.map((p) => p.name).join(", ") || "not chosen yet"}), who sends cases to the principal to decide.</p></div>
        <div className="class-hero-actions"><button className="on-band with-icon" onClick={() => setReport(true)}><Icon name="plus" size={15} />Report a student</button></div>
      </header>
      {st.can_run && <div className="stat-strip">
        <Stat icon="inbox" hue="indigo" value={d.counts.inbox ?? 0} label="waiting for you" note={st.is_pod ? "You are the POD" : st.can_decide ? "You decide" : undefined} />
        <Stat icon="folder" hue="blue" value={d.counts.open ?? 0} label="open cases" />
        <Stat icon="gavel" hue="green" value={d.counts.decided ?? 0} label="decided, being carried out" />
        <Stat icon="list" hue="slate" value={d.counts.all ?? 0} label="all cases" />
      </div>}
      <nav className="segmented wrap-seg dc-tabs">{tabs.map(([k, label, icon]) => <button key={k} className={view === k ? "on" : ""} onClick={() => setView(k)}><Icon name={icon} size={15} />{label}{k === "inbox" && d.counts.inbox ? <b className="dc-badge">{d.counts.inbox}</b> : null}</button>)}</nav>
      {view === "rules" ? <RulesCard schoolId={schoolId} st={st} onSaved={setSt} />
        : d.items ? <ActionList view={view} items={d.items} />
        : <section className="card editor">
            {!d.cases?.length && <Empty icon="circle-check">{view === "inbox" ? "Nothing is waiting for you." : "No cases here."}</Empty>}
            <ul className="dc-list">{d.cases?.map((c) => <CaseRow key={c.id} c={c} />)}</ul>
          </section>}
      {report && <ReportBox schoolId={schoolId} onClose={() => setReport(false)} onDone={() => void load()} />}
    </Layout>
  );
}

function CaseRow({ c }: { c: Row }) {
  return (
    <li><a href={`#/discipline-case/${c.id}`} style={hue(LEVEL_HUE[c.level] ?? "slate")}>
      {c.student ? (c.student.thumb ? <img className="mini-face" src={c.student.thumb} alt="" /> : <Avatar name={c.student.name} size={40} />) : <Glyph icon="message" hue="violet" size={40} />}
      <span className="grow"><b>{c.student?.name ?? `About: ${c.about}`}</b> <small className="muted">{c.student?.class_name}</small>
        <small className="block"><b className="dc-off">#{c.number} · {c.offence_name}</b> <span className="muted">· {day(c.occurred_at)}{c.reporter ? ` · reported by ${c.reporter}` : c.reporter_kind === "system" ? " · opened by the ladder" : ""}</span></small>
        {c.actions.length > 0 && <small className="block muted">{c.actions.map(actText).join(" · ")}</small>}</span>
      <span className="dc-side"><span className="hue-chip" style={hue(STAGE_HUE[c.status])}>{c.stage}</span><small className="muted">{c.level}</small></span>
    </a></li>
  );
}

function ActionList({ view, items }: { view: View; items: { action: Action; case: Row }[] }) {
  const today = new Date().toISOString().slice(0, 10);
  if (!items.length) return <section className="card editor"><Empty icon="circle-check">{view === "detention" ? "No detention in the last week or coming up." : "Nobody is suspended or on discipline probation now."}</Empty></section>;
  return (
    <section className="card editor">
      <h3>{view === "detention" ? "Detention" : "Suspended or on discipline probation now"}</h3>
      <ul className="dc-list">{items.map(({ action: a, case: c }) => (
        <li key={a.id}><a href={`#/discipline-case/${c.id}`} style={hue(a.kind === "suspension" ? "red" : a.kind === "probation" ? "orange" : a.on === today ? "indigo" : "slate")}>
          {c.student?.thumb ? <img className="mini-face" src={c.student.thumb} alt="" /> : <Avatar name={c.student?.name ?? "?"} size={40} />}
          <span className="grow"><b>{c.student?.name}</b> <small className="muted">{c.student?.class_name}</small><small className="block">{actText(a)}</small><small className="block muted">#{c.number} · {c.offence_name}</small></span>
          <span className="dc-side">{a.done ? <span className="hue-chip" style={hue("green")}>{a.kind === "detention" ? "Served" : "Ended"}</span> : a.on === today ? <span className="hue-chip" style={hue("indigo")}>Today</span> : <small className="muted">{day(a.on)}</small>}</span>
        </a></li>))}</ul>
    </section>
  );
}

// ---------- Rules ----------

function RulesCard({ schoolId, st, onSaved }: { schoolId: string; st: Settings; onSaved: (s: Settings) => void }) {
  const [staff, setStaff] = useState<{ user_id: string; name: string }[]>([]);
  const [pod, setPod] = useState<string[]>(st.pods_chosen ? st.pods.map((p) => p.id) : []);
  const [lad, setLad] = useState({ detention: String(st.ladder.detention ?? ""), probation: String(st.ladder.probation ?? "") });
  const [offs, setOffs] = useState<Offence[]>(st.offences);
  const [pun, setPun] = useState(st.punishments.map((p) => p.name).join("\n"));
  const [msg, setMsg] = useState("");
  const [busy, err, run] = useBusy();
  useEffect(() => { api.raw<{ user_id: string; full_name?: string; name?: string; kind?: string }[]>("GET", `/api/schools/${schoolId}/logins`).then((r) => setStaff(r.filter((x) => !x.kind || x.kind === "staff").map((x) => ({ user_id: x.user_id, name: x.full_name ?? x.name ?? "" })).sort((a, b) => a.name.localeCompare(b.name)))).catch(() => {}); }, [schoolId]);
  const save = (b: Parameters<typeof dp.save>[1], what: string) => run(async () => { onSaved(await dp.save(schoolId, b)); setMsg(`${what} saved.`); });
  return (
    <div className="dc-rules">
      {(msg || err) && <p className={err ? "error" : "pb-msg"}>{err || msg}</p>}
      <section className="card editor">
        <h3 className="with-glyph"><Glyph icon="shield" hue="indigo" size={30} />Principal of discipline (POD)</h3>
        <p className="small muted">Every report goes to them. {st.pods_chosen ? "" : "Not chosen yet: the vice principals get the reports for now."}</p>
        <div className="chips">{pod.map((id) => <span key={id} className="chip">{staff.find((s) => s.user_id === id)?.name ?? st.pods.find((p) => p.id === id)?.name ?? "…"}<button className="chip-x" aria-label="Remove" onClick={() => setPod(pod.filter((x) => x !== id))}>×</button></span>)}</div>
        <div className="row wrap"><select aria-label="Add a POD" value="" onChange={(e) => e.target.value && !pod.includes(e.target.value) && setPod([...pod, e.target.value])}>
          <option value="">Add a staff member…</option>{staff.map((s) => <option key={s.user_id} value={s.user_id}>{s.name}</option>)}</select>
          <button className="primary small" disabled={busy} onClick={() => save({ pod_user_ids: pod }, "POD")}>Save</button></div>
      </section>
      <section className="card editor">
        <h3 className="with-glyph"><Glyph icon="trending" hue="orange" size={30} />The ladder</h3>
        <p className="small muted">Demerit points this term. Crossing a line opens a case by itself.</p>
        <div className="pb-rules">
          <label>Detention at <span className="pct-input"><input aria-label="Detention at" inputMode="numeric" value={lad.detention} onChange={(e) => setLad({ ...lad, detention: e.target.value })} /> points</span> (goes to the POD)</label>
          <label>Discipline probation at <span className="pct-input"><input aria-label="Probation at" inputMode="numeric" value={lad.probation} onChange={(e) => setLad({ ...lad, probation: e.target.value })} /> points</span> (goes to the principal)</label>
          <button className="primary small" disabled={busy} onClick={() => save({ ladder: { detention: Number(lad.detention) || 0, probation: Number(lad.probation) || 0 } }, "Ladder")}>Save the ladder</button>
        </div>
      </section>
      <section className="card editor">
        <h3 className="with-glyph"><Glyph icon="users" hue="teal" size={30} />Who decides, who sees</h3>
        <div className="pb-choices">
          {([["all", "Parents see every decision", "What the principal decided and every action."], ["serious", "Only serious ones", "Detention, invitations, probation, suspension, expulsion."], ["letters", "Only letters", "Invitations to school, suspension, expulsion."]] as const).map(([k, t, n]) => (
            <button key={k} className={`pb-choice${st.parents_see === k ? " on" : ""}`} disabled={busy} onClick={() => save({ parents_see: k }, "Who sees")}><b>{t}</b><small>{n}</small></button>))}
        </div>
        <p className="small muted">Families never see who reported, statements, or the POD's notes. Cases still open are never shown.</p>
        <label className="check-row"><input type="checkbox" checked={st.boarding_first} disabled={busy} onChange={(e) => save({ boarding_first: e.target.checked }, "Boarding")} /> Boarding offences go to the house master first</label>
        <label className="check-row"><input type="checkbox" checked={st.pod_settles_minor} disabled={busy} onChange={(e) => save({ pod_settles_minor: e.target.checked }, "POD")} /> The POD may deal with minor offences (counselling, warning, punishment, demerits) without the principal</label>
      </section>
      <section className="card editor">
        <h3 className="with-glyph"><Glyph icon="list" hue="red" size={30} />Offences</h3>
        <div className="table-wrap plain"><table className="edit-table dc-off-table">
          <thead><tr><th>Offence</th><th>Level</th><th>Points</th><th>Boarding</th><th /></tr></thead>
          <tbody>{offs.map((o, i) => (
            <tr key={o.key + i}>
              <td><input aria-label="Offence" value={o.name} onChange={(e) => setOffs(offs.map((x, j) => (j === i ? { ...x, name: e.target.value } : x)))} /></td>
              <td><select aria-label="Level" value={o.level} onChange={(e) => setOffs(offs.map((x, j) => (j === i ? { ...x, level: e.target.value as Offence["level"] } : x)))}><option value="minor">Minor</option><option value="major">Major</option><option value="severe">Severe</option></select></td>
              <td><input aria-label="Points" inputMode="numeric" className="dc-pts" value={o.points} onChange={(e) => setOffs(offs.map((x, j) => (j === i ? { ...x, points: Number(e.target.value) || 0 } : x)))} /></td>
              <td><input type="checkbox" aria-label="Boarding offence" checked={o.boarding} onChange={(e) => setOffs(offs.map((x, j) => (j === i ? { ...x, boarding: e.target.checked } : x)))} /></td>
              <td><button className="ghost" aria-label={`Remove ${o.name}`} onClick={() => setOffs(offs.filter((_, j) => j !== i))}>✕</button></td>
            </tr>))}</tbody>
        </table></div>
        <div className="row"><button onClick={() => setOffs([...offs, { key: "", name: "", level: "minor", points: 1, boarding: false }])}>Add an offence</button><span className="grow" />
          <button className="primary" disabled={busy || offs.some((o) => o.name.trim().length < 2)} onClick={() => save({ offences: offs.map((o) => ({ ...o, key: o.key || "" })) as Offence[] }, "Offences")}>Save offences</button></div>
      </section>
      <section className="card editor">
        <h3 className="with-glyph"><Glyph icon="hammer" hue="amber" size={30} />Punishments the school uses</h3>
        <p className="small muted">One per line. The principal picks from these.</p>
        <textarea rows={6} aria-label="Punishments" value={pun} onChange={(e) => setPun(e.target.value)} />
        <div className="row"><span className="grow" /><button className="primary" disabled={busy} onClick={() => save({ punishments: pun.split("\n").map((x) => x.trim()).filter((x) => x.length >= 2).map((name) => ({ key: st.punishments.find((p) => p.name === name)?.key, name })) }, "Punishments")}>Save punishments</button></div>
      </section>
    </div>
  );
}

// ---------- One case ----------

export function DisciplineCasePage({ me, onLogout, caseId }: { me: Me; onLogout: () => void; caseId: string }) {
  const [c, setC] = useState<Case | null>(null);
  const [error, setError] = useState("");
  const [modal, setModal] = useState<null | "statement" | "forward" | "dismiss" | "decide" | "link" | "letter">(null);
  const [busy, err, run] = useBusy();
  useEffect(() => { dp.one(caseId).then(setC).catch((e) => setError(errorText(e))); }, [caseId]);
  const crumbs = [{ label: "Home", href: "#/" }, ...(c ? [{ label: "Discipline", href: `#/discipline/${c.school.id}` }] : []), { label: c ? `#${c.number}` : "Case" }];
  if (error) return <Layout me={me} onLogout={onLogout} crumbs={crumbs}><p className="error">{error}</p></Layout>;
  if (!c) return <Layout me={me} onLogout={onLogout} crumbs={crumbs}><div className="skeleton"><span /><span /><span /></div></Layout>;
  const inner = c.role === "run" || c.role === "house";
  const steps = c.status === "house" || c.history.some((h) => h.action.includes("house master")) ? ["house", ...FLOW] : FLOW;
  const at = c.status === "dismissed" ? -1 : steps.indexOf(c.status);
  const invite = c.actions.find((a) => a.kind === "invite_parents");
  return (
    <Layout me={me} onLogout={onLogout} crumbs={crumbs}>
      <header className="class-hero dc-hero" style={hue(LEVEL_HUE[c.level] ?? "indigo")}>
        <span className="hero-pattern" aria-hidden="true" />
        {c.student?.thumb ? <img className="hero-face" src={c.student.thumb} alt="" /> : <Glyph icon="gavel" hue="indigo" size={56} />}
        <div className="grow"><h1>{c.student?.name ?? "A student's tip"} <small>{c.student?.class_name}</small></h1>
          <p>#{c.number} · {c.offence_name} · {c.level} · {when(c.occurred_at)}{c.place ? ` · ${c.place}` : ""}</p></div>
        <div className="class-hero-actions">
          {c.student && inner && <a className="on-band with-icon button-like" href={`#/student/${c.student.id}`}><Icon name="user" size={15} />Profile</a>}
          {invite && inner && <button className="on-band with-icon" onClick={() => setModal("letter")}><Icon name="printer" size={15} />Letter to parents</button>}
        </div>
      </header>
      {err && <p className="error">{err}</p>}
      {c.status === "dismissed"
        ? <p className="dc-dropped"><Icon name="x" size={16} />Dropped: {c.decision}</p>
        : c.status !== "tip" && <ol className="pb-steps dc-steps" style={{ gridTemplateColumns: `repeat(${steps.length}, 1fr)` }}>{steps.map((k, i) => <li key={k} className={i < at ? "done" : i === at ? "now" : ""}><b>{i + 1}</b><span>{({ house: "House master", pod: "POD", principal: "Principal", decided: "Decided", closed: "Closed" } as Record<string, string>)[k]}</span></li>)}</ol>}
      {inner && <div className="dc-do">
        {c.can.statement && <button className="with-icon" onClick={() => setModal("statement")}><Icon name="message" size={15} />Take a statement</button>}
        {c.can.forward_pod && <button className="primary with-icon" onClick={() => setModal("forward")}><Icon name="arrow-right" size={15} />Pass to the POD</button>}
        {c.can.link && <button className="primary with-icon" onClick={() => setModal("link")}><Icon name="users" size={15} />Open cases for the students</button>}
        {c.can.forward_principal && <button className="primary with-icon" onClick={() => setModal("forward")}><Icon name="send" size={15} />Send to the principal</button>}
        {c.can.decide && <button className="primary with-icon dc-decide" onClick={() => setModal("decide")}><Icon name="gavel" size={15} />{c.can.pod_only_minor ? "Deal with it (minor)" : "Decide"}</button>}
        {c.can.dismiss && <button className="ghost with-icon" onClick={() => setModal("dismiss")}><Icon name="x" size={15} />Drop it</button>}
        {c.can.close && <button className="ghost with-icon" disabled={busy} onClick={() => run(async () => setC(await dp.close(c.id)))}><Icon name="check" size={15} />Close the case</button>}
      </div>}
      <section className="card editor">
        <h3 className="with-glyph"><Glyph icon="file-text" hue="blue" size={30} />{c.status === "tip" ? "What the student said" : "The report"}</h3>
        {c.about && <p><b>About:</b> {c.about}</p>}
        {c.details ? <p className="dc-text">{c.details}</p> : <p className="muted small">Only the POD and the principal see the details.</p>}
        <p className="small muted">{c.reporter_kind === "student" ? "Told by a student, in confidence." : c.reporter_kind === "system" ? "Opened by the ladder (demerit points)." : c.reporter ? `Reported by ${c.reporter} on ${when(c.reported_at ?? c.occurred_at)}` : ""}
          {c.demerits_this_term != null && ` · ${c.demerits_this_term} demerit points this term`}{c.house_master ? ` · House master: ${c.house_master}` : ""}</p>
        {c.others && c.others.length > 0 && <p className="small">Same report: {c.others.map((o) => <a key={o.id} className="text-link" href={`#/discipline-case/${o.id}`}>#{o.number} {o.student}</a>).reduce((a: React.ReactNode[], x, i) => (i ? [...a, ", ", x] : [x]), [])}</p>}
      </section>
      {inner && (c.statements?.length ?? 0) > 0 && <section className="card editor">
        <h3 className="with-glyph"><Glyph icon="message" hue="teal" size={30} />Statements</h3>
        <ul className="pb-meetings">{c.statements!.map((s) => <li key={s.id}><b>{s.who}</b><p>“{s.text}”</p><small className="muted">Taken by {s.by} · {when(s.at)}</small></li>)}</ul>
      </section>}
      {inner && c.recommendation && <section className="card editor dc-rec"><h3 className="with-glyph"><Glyph icon="send" hue="indigo" size={30} />POD's recommendation</h3><p className="dc-text">{c.recommendation}</p></section>}
      {(c.status === "decided" || c.status === "closed") && <section className="card editor dc-decision">
        <h3 className="with-glyph"><Glyph icon="gavel" hue="green" size={30} />Decision</h3>
        {c.decision && <p className="dc-text">{c.decision}</p>}
        <ul className="pb-actions">{c.actions.map((a) => (
          <li key={a.id} className={a.done ? "done" : ""}>
            {c.can.act ? <button className="pb-tick" aria-label={a.done ? `Not done: ${actText(a)}` : `Done: ${actText(a)}`} disabled={busy} onClick={() => run(async () => setC(await dp.done(c.id, a.id)))}>{a.done ? <Icon name="check" size={14} /> : null}</button>
              : <span className="pb-tick">{a.done ? <Icon name="check" size={14} /> : null}</span>}
            <Glyph icon={KIND_ICON[a.kind] ?? "check"} hue={a.kind === "suspension" || a.kind === "expulsion" ? "red" : a.kind === "probation" ? "orange" : "indigo"} size={28} soft />
            <span className="grow"><b>{actText(a)}</b>{a.note && <small className="block muted">{a.note}</small>}</span>
          </li>))}</ul>
        {inner && <p className="small muted">Decided by {c.decided_by} · {c.decided_at ? when(c.decided_at) : ""}. {c.parent_seen_at ? `Parent read it ${when(c.parent_seen_at)}${c.parent_reply ? `: “${c.parent_reply}”` : "."}` : "Parents have not read it yet."}</p>}
      </section>}
      {inner && (c.earlier?.length ?? 0) > 0 && <section className="card editor">
        <h3 className="with-glyph"><Glyph icon="history" hue="slate" size={30} />Earlier cases</h3>
        <ul className="dc-earlier">{c.earlier!.map((e) => <li key={e.id}><a href={`#/discipline-case/${e.id}`}>#{e.number} {e.offence_name}</a> <small className="muted">· {day(e.at)} · {e.actions.join(", ") || e.status}</small></li>)}</ul>
      </section>}
      {inner && <section className="card editor">
        <h3 className="with-glyph"><Glyph icon="history" hue="slate" size={30} />History</h3>
        <ol className="as-history">{[...c.history].reverse().map((h, i) => <li key={i}>{h.action}<small className="muted block">{h.by} · {when(h.at)}</small></li>)}</ol>
      </section>}
      {modal === "statement" && <TextBox title="Take a statement" who whoLabel="Whose words" whoPh="e.g. the student, class captain, Mr Okon" label="What they said" onClose={() => setModal(null)} onGo={async (t, w) => { setC(await dp.statement(c.id, { who: w!, text: t })); setModal(null); }} />}
      {modal === "forward" && <TextBox title={c.status === "house" ? "Pass to the POD" : "Send to the principal"} label={c.status === "house" ? "What you found (optional)" : "What you found and what you recommend"}
        optional={c.status === "house"} ph={c.status === "house" ? "" : "e.g. Both students fought. I recommend 5 demerit points each, manual work for three days and counselling."}
        onClose={() => setModal(null)} onGo={async (t) => { setC(await dp.forward(c.id, { to: c.status === "house" ? "pod" : "principal", recommendation: t || null })); setModal(null); }} />}
      {modal === "dismiss" && <TextBox title="Drop this case" label="Why" ph="e.g. Not proven; the window was already broken." onClose={() => setModal(null)} onGo={async (t) => { setC(await dp.dismiss(c.id, t)); setModal(null); }} />}
      {modal === "link" && <LinkBox c={c} onClose={() => setModal(null)} />}
      {modal === "decide" && <DecideBox c={c} onClose={() => setModal(null)} onDone={(x) => { setC(x); setModal(null); }} />}
      {modal === "letter" && invite && <PrintSheet title="Invitation to parents" note="Click any paragraph to change it" onClose={() => setModal(null)}><InviteLetter c={c} a={invite} /></PrintSheet>}
    </Layout>
  );
}

function TextBox({ title, label, ph, who, whoLabel, whoPh, optional, onClose, onGo }: { title: string; label: string; ph?: string; who?: boolean; whoLabel?: string; whoPh?: string; optional?: boolean; onClose: () => void; onGo: (t: string, w?: string) => Promise<void> }) {
  const [t, setT] = useState("");
  const [w, setW] = useState("");
  const [busy, err, run] = useBusy();
  return (
    <Modal title={title} onClose={onClose}>
      <div className="stack">
        {who && <Field label={whoLabel ?? "Who"}><input value={w} maxLength={120} autoFocus onChange={(e) => setW(e.target.value)} placeholder={whoPh} /></Field>}
        <Field label={label}><textarea rows={5} maxLength={4000} value={t} autoFocus={!who} onChange={(e) => setT(e.target.value)} placeholder={ph} /></Field>
        {err && <p className="error">{err}</p>}
        <div className="row"><span className="grow" /><button onClick={onClose}>Cancel</button>
          <button className="primary" disabled={busy || (!optional && t.trim().length < 3) || (who && w.trim().length < 2)} onClick={() => run(() => onGo(t.trim(), w.trim()))}>Save</button></div>
      </div>
    </Modal>
  );
}

function LinkBox({ c, onClose }: { c: Case; onClose: () => void }) {
  const [kids, setKids] = useState<StudentCard[]>([]);
  const [st, setSt] = useState<Settings | null>(null);
  const [off, setOff] = useState("");
  const [busy, err, run] = useBusy();
  useEffect(() => { dp.settings(c.school.id).then(setSt).catch(() => {}); }, [c.school.id]);
  return (
    <Modal title="Open cases from this tip" onClose={onClose}>
      <div className="stack">
        <p className="small muted">The student who told stays hidden. Each case shows you as the reporter.</p>
        <div className="chips">{kids.map((s) => <span key={s.id} className="chip">{s.name} ({s.class_name})<button className="chip-x" aria-label="Remove" onClick={() => setKids(kids.filter((x) => x.id !== s.id))}>×</button></span>)}</div>
        <StudentPicker schoolId={c.school.id} value={null} label="Add a student" onPick={(s) => s && !kids.some((x) => x.id === s.id) && setKids([...kids, s])} />
        <Field label="Offence"><select value={off} onChange={(e) => setOff(e.target.value)}><option value="">Choose…</option>{st?.offences.map((o) => <option key={o.key} value={o.key}>{o.name}</option>)}</select></Field>
        {err && <p className="error">{err}</p>}
        <div className="row"><span className="grow" /><button onClick={onClose}>Cancel</button>
          <button className="primary" disabled={busy || !kids.length || !off} onClick={() => run(async () => { const r = await dp.link(c.id, { student_ids: kids.map((k) => k.id), offence: off }); location.hash = `#/discipline-case/${r.cases[0]}`; })}>Open {kids.length || ""} case{kids.length === 1 ? "" : "s"}</button></div>
      </div>
    </Modal>
  );
}

type Draft = { kind: string; name: string; points: string; on: string; until: string; at: string; note: string; in_school: boolean };
const blank = (kind: string): Draft => ({ kind, name: "", points: kind === "demerit" ? "3" : "", on: "", until: "", at: kind === "detention" ? "14:15" : kind === "invite_parents" ? "10:00" : "", note: "", in_school: false });

function DecideBox({ c, onClose, onDone }: { c: Case; onClose: () => void; onDone: (c: Case) => void }) {
  const [decision, setDecision] = useState("");
  const [acts, setActs] = useState<Draft[]>([]);
  const [busy, err, run] = useBusy();
  const kinds = Object.entries(c.settings.kinds).filter(([k]) => !c.can.pod_only_minor || ["counselling", "warning", "punishment", "demerit"].includes(k));
  const set = (i: number, p: Partial<Draft>) => setActs(acts.map((a, j) => (j === i ? { ...a, ...p } : a)));
  return (
    <Modal title={c.can.pod_only_minor ? "Deal with a minor offence" : "Decide"} onClose={onClose}>
      <div className="stack">
        {c.recommendation && <p className="dc-rec-mini"><b>POD recommends:</b> {c.recommendation}</p>}
        <div><span className="field-label">What will be done (tap to add)</span>
          <div className="dc-kinds">{kinds.map(([k, label]) => <button key={k} type="button" className="dc-kind" style={hue(k === "suspension" || k === "expulsion" ? "red" : k === "probation" ? "orange" : "indigo")} onClick={() => setActs([...acts, blank(k)])}><Icon name={KIND_ICON[k] ?? "plus"} size={15} />{label}</button>)}</div></div>
        {acts.map((a, i) => (
          <div key={i} className="dc-act">
            <div className="row"><b className="grow">{c.settings.kinds[a.kind]}</b><button className="ghost" aria-label="Remove" onClick={() => setActs(acts.filter((_, j) => j !== i))}>✕</button></div>
            {a.kind === "punishment" && <select aria-label="Punishment" value={a.name} onChange={(e) => set(i, { name: e.target.value })}><option value="">Choose…</option>{c.settings.punishments.map((p) => <option key={p.key}>{p.name}</option>)}</select>}
            {a.kind === "counselling" && <input aria-label="Counselling with" value={a.name} placeholder="With whom, how often (optional)" onChange={(e) => set(i, { name: e.target.value })} />}
            {a.kind === "demerit" && <label className="pct-input">Points <input aria-label="Demerit points" inputMode="numeric" value={a.points} onChange={(e) => set(i, { points: e.target.value })} /></label>}
            {["detention", "invite_parents", "probation", "suspension"].includes(a.kind) && <div className="row wrap">
              <label className="dc-date">{a.kind === "probation" || a.kind === "suspension" ? "From" : "Day"} <input type="date" aria-label="Day" value={a.on} onChange={(e) => set(i, { on: e.target.value })} /></label>
              {(a.kind === "probation" || a.kind === "suspension") ? <label className="dc-date">To <input type="date" aria-label="Until" value={a.until} onChange={(e) => set(i, { until: e.target.value })} /></label>
                : <label className="dc-date">Time <input type="time" aria-label="Time" value={a.at} onChange={(e) => set(i, { at: e.target.value })} /></label>}
              {a.kind === "suspension" && <label className="check-row"><input type="checkbox" checked={a.in_school} onChange={(e) => set(i, { in_school: e.target.checked })} /> In school</label>}
            </div>}
            {a.kind !== "demerit" && <input aria-label="Note" value={a.note} maxLength={500} placeholder="Note (optional)" onChange={(e) => set(i, { note: e.target.value })} />}
          </div>))}
        <Field label="The decision, in words"><textarea rows={3} value={decision} maxLength={3000} onChange={(e) => setDecision(e.target.value)} placeholder="e.g. Both students: 5 demerit points, manual work for three days, and counselling." /></Field>
        <p className="small muted">Saving tells the POD, the form teacher and whoever reported it. Parents are told {c.settings.parents_see === "all" ? "everything you decide" : c.settings.parents_see === "serious" ? "only the serious actions" : "only invitations, suspension and expulsion"}.</p>
        {err && <p className="error">{err}</p>}
        <div className="row"><span className="grow" /><button onClick={onClose}>Cancel</button>
          <button className="primary" disabled={busy || !acts.length || decision.trim().length < 3} onClick={() => run(async () => onDone(await dp.decide(c.id, { decision, actions: acts.map((a) => ({
            kind: a.kind, name: a.name || null, points: a.points ? Number(a.points) : null, on: a.on || null, until: a.until || null, at: a.at || null, note: a.note || null, in_school: a.kind === "suspension" ? a.in_school : null,
          })) })))}>Save the decision</button></div>
      </div>
    </Modal>
  );
}

function InviteLetter({ c, a }: { c: Case; a: Action }) {
  return (
    <article className="letter">
      <header className="lt-head">{c.school.logo && <img src={c.school.logo} alt="" />}<div><h1>{c.school.name}</h1>{c.school.motto && <em>{c.school.motto}</em>}<small>{[c.school.address, c.school.phone].filter(Boolean).join(" · ")}</small></div></header>
      <div className="lt-meta"><span>Ref: DISC/{c.number}</span><span>{new Date().toLocaleDateString("en-GB", { day: "numeric", month: "long", year: "numeric" })}</span></div>
      <p contentEditable suppressContentEditableWarning>Dear Parent / Guardian of <b>{c.student?.name}</b> ({c.student?.class_name}),</p>
      <h2>Invitation to the school</h2>
      <p contentEditable suppressContentEditableWarning>You are invited to see the Principal of Discipline on <b>{day(a.on)}</b>{a.at ? <> at <b>{a.at}</b></> : null} about {c.student?.first_name}'s conduct: {c.offence_name.toLowerCase()} on {day(c.occurred_at)}.</p>
      {c.decision && <p contentEditable suppressContentEditableWarning><b>What the school decided:</b> {c.decision}</p>}
      {a.note && <p contentEditable suppressContentEditableWarning>{a.note}</p>}
      <p contentEditable suppressContentEditableWarning>We want to work with you so that {c.student?.first_name} does well. Please come with this letter.</p>
      <div className="lt-sign"><span className="lt-line" /><b>Principal of Discipline</b><small>for the Principal</small></div>
    </article>
  );
}

// ---------- Pieces for other pages ----------

/** Staff home: cases waiting for me, and a button to report. */
export function DisciplineCard({ schoolId }: { schoolId?: string }) {
  const [d, setD] = useState<Awaited<ReturnType<typeof dp.mine>> | null>(null);
  const [report, setReport] = useState(false);
  useEffect(() => { dp.mine().then(setD).catch(() => setD([])); }, []);
  if (!d) return null;
  const sid = d[0]?.school.id ?? schoolId;
  if (!d.length && !sid) return null;
  return (
    <section className="card editor portal-card" style={hue("indigo")}>
      <div className="card-head"><h2 className="with-glyph"><Glyph icon="gavel" hue="indigo" size={34} />Discipline</h2>
        <div className="row">{sid && <button className="ghost small with-icon" onClick={() => setReport(true)}><Icon name="plus" size={14} />Report a student</button>}
          {sid && <a className="text-link small" href={`#/discipline/${sid}`}>Open</a>}</div></div>
      {d.length ? d.map((x) => <div key={x.school.id}>
        <p className="small muted">{x.waiting} waiting for you{d.length > 1 ? ` at ${x.school.name}` : ""}.</p>
        <ul className="as-mini-sheets">{x.cases.map((c) => <li key={c.id}><a href={`#/discipline-case/${c.id}`}><span className="grow"><b>{c.student?.name ?? `Tip: ${c.about}`}</b> <small className="muted">#{c.number} · {c.offence_name} · {c.stage}</small></span><Icon name="arrow-right" size={15} /></a></li>)}</ul>
      </div>) : <p className="small muted">Saw something? Report it here: it goes to the principal of discipline.</p>}
      {report && sid && <ReportBox schoolId={sid} onClose={() => setReport(false)} />}
    </section>
  );
}

/** Student profile: suspended or on discipline probation now, the points, and the cases this person may open. */
export function DisciplineStrip({ studentId, schoolId, student }: { studentId: string; schoolId: string; student: StudentCard }) {
  const [d, setD] = useState<Awaited<ReturnType<typeof dp.student>> | null>(null);
  const [report, setReport] = useState(false);
  useEffect(() => { dp.student(studentId).then(setD).catch(() => setD(null)); }, [studentId]);
  if (!d) return null;
  return (
    <>
      {d.active.map((a) => (
        <a key={a.id} className="pb-banner dc-banner" href={`#/discipline-case/${a.case_id}`} style={hue(a.kind === "suspension" ? "red" : "orange")}>
          <Glyph icon={a.kind === "suspension" ? "home" : "gavel"} hue={a.kind === "suspension" ? "red" : "orange"} size={38} />
          <span className="grow"><b>{a.kind === "suspension" ? `Suspended${a.in_school ? " (in school)" : ""}` : "On discipline probation"} until {day(a.until)}</b><small className="block">From {day(a.on)}</small></span>
        </a>))}
      <div className="dc-strip">
        <span className="small"><b>{d.demerits_this_term}</b> demerit point{d.demerits_this_term === 1 ? "" : "s"} this term{d.ladder.detention ? ` · detention at ${d.ladder.detention}` : ""}{d.ladder.probation ? `, probation at ${d.ladder.probation}` : ""}</span>
        {d.cases.length > 0 && <span className="small muted"> · {d.cases.length} discipline case{d.cases.length > 1 ? "s" : ""}: {d.cases.slice(0, 3).map((c) => <a key={c.id} className="text-link" href={`#/discipline-case/${c.id}`}>#{c.number} {c.offence_name}</a>).reduce((acc: React.ReactNode[], x, i) => (i ? [...acc, ", ", x] : [x]), [])}</span>}
        <span className="grow" /><button className="ghost small with-icon" onClick={() => setReport(true)}><Icon name="gavel" size={14} />Report</button>
      </div>
      {report && <ReportBox schoolId={schoolId} student={student} onClose={() => setReport(false)} onDone={() => dp.student(studentId).then(setD)} />}
    </>
  );
}

/** Families: what the school decided (as the school allows), and the parent's reply. */
export function FamilyDiscipline({ studentId }: { studentId: string }) {
  const [d, setD] = useState<Awaited<ReturnType<typeof dp.family>> | null>(null);
  const [reply, setReply] = useState<Record<string, string>>({});
  const [busy, err, run] = useBusy();
  useEffect(() => { dp.family(studentId).then(setD).catch(() => setD(null)); }, [studentId]);
  if (!d || !d.cases.length) return null;
  const self = d.relation === "self";
  const fresh = d.cases.filter((c) => !c.seen_at || c.actions.some((a) => !a.done));
  const show = (fresh.length ? fresh : d.cases).slice(0, 3);
  return (
    <section className="card editor dc-family" style={hue("indigo")}>
      <h3 className="with-glyph"><Glyph icon="gavel" hue="indigo" size={32} />{self ? "Your conduct" : "Conduct: messages from the school"}</h3>
      <p className="small muted">{d.demerits_this_term} demerit point{d.demerits_this_term === 1 ? "" : "s"} this term{d.ladder.detention ? ` (detention at ${d.ladder.detention}, discipline probation at ${d.ladder.probation})` : ""}.</p>
      {show.map((c) => (
        <div key={c.id} className="dc-fcase">
          <b>{c.offence_name}</b> <small className="muted">· {day(c.occurred_at)}</small>
          {c.decision && <p className="dc-text">{c.decision}</p>}
          <ul className="pb-actions">{c.actions.map((a, i) => <li key={i} className={a.done ? "done" : ""}><span className="pb-tick">{a.done ? <Icon name="check" size={14} /> : null}</span><Glyph icon={KIND_ICON[a.kind] ?? "check"} hue={a.kind === "suspension" ? "red" : "indigo"} size={26} soft /><span className="grow"><b>{a.text}</b></span></li>)}</ul>
          {c.seen_at ? <p className="pb-ack"><Icon name="circle-check" size={16} />Read {day(c.seen_at)}{c.reply ? `: “${c.reply}”` : ""}</p>
            : !self && <div className="stack pb-ack-box">
                <Field label="A reply to the school (optional)"><textarea rows={2} maxLength={1000} value={reply[c.id] ?? ""} onChange={(e) => setReply({ ...reply, [c.id]: e.target.value })} placeholder="e.g. I will come on the day. We have spoken to him at home." /></Field>
                {err && <p className="error">{err}</p>}
                <button className="primary with-icon" disabled={busy} onClick={() => run(async () => { const r = await dp.seen(studentId, c.id, reply[c.id] ?? ""); setD({ ...d, cases: r.cases }); })}><Icon name="check" size={15} />I have read this</button>
              </div>}
        </div>))}
    </section>
  );
}

/** Students: tell the POD something, in confidence. */
export function TipBox({ studentId, onClose }: { studentId: string; onClose: () => void }) {
  const [f, setF] = useState({ about: "", what: "", place: "" });
  const [ok, setOk] = useState("");
  const [busy, err, run] = useBusy();
  return (
    <Modal title="Tell the principal of discipline" onClose={onClose}>
      {ok ? <div className="stack"><p className="dc-ok"><Icon name="circle-check" size={18} />{ok}</p><button className="primary" onClick={onClose}>Done</button></div>
        : <div className="stack">
            <p className="small">Saw someone break a school rule, or something that is not right? Only the POD and the principal will know you told them. If you are not safe or are being hurt, use <b>Talk to someone</b> instead.</p>
            <Field label="Who is it about"><input value={f.about} maxLength={200} onChange={(e) => setF({ ...f, about: e.target.value })} placeholder="Names, class, or a description" /></Field>
            <Field label="What happened"><textarea rows={4} maxLength={3000} value={f.what} onChange={(e) => setF({ ...f, what: e.target.value })} /></Field>
            <Field label="Where (optional)"><input value={f.place} maxLength={120} onChange={(e) => setF({ ...f, place: e.target.value })} /></Field>
            {err && <p className="error">{err}</p>}
            <div className="row"><span className="grow" /><button onClick={onClose}>Cancel</button>
              <button className="primary" disabled={busy || f.about.trim().length < 2 || f.what.trim().length < 5} onClick={() => run(async () => setOk((await dp.tip(studentId, { about: f.about, what: f.what, place: f.place || null })).message))}>Send</button></div>
          </div>}
    </Modal>
  );
}

/** The Discipline tab on the school page: the numbers, what is waiting, and the way in. */
export function DisciplineTab({ schoolId }: { schoolId: string }) {
  const [d, setD] = useState<ListOut | null>(null);
  const [act, setAct] = useState<ListOut | null>(null);
  const [report, setReport] = useState(false);
  const [error, setError] = useState("");
  useEffect(() => {
    dp.list(schoolId, "inbox").then(setD).catch((e) => setError(errorText(e)));
    dp.list(schoolId, "active").then(setAct).catch(() => {});
  }, [schoolId]);
  if (error) return <p className="error">{error}</p>;
  if (!d) return <div className="skeleton"><span /><span /></div>;
  return (
    <div className="stack">
      <div className="row wrap"><a className="button primary-link with-icon" href={`#/discipline/${schoolId}`}><Icon name="gavel" size={16} />Open discipline</a>
        <button className="with-icon" onClick={() => setReport(true)}><Icon name="plus" size={15} />Report a student</button></div>
      <div className="stat-strip">
        <Stat icon="inbox" hue="indigo" value={d.counts.inbox ?? 0} label="waiting for you" />
        <Stat icon="folder" hue="blue" value={d.counts.open ?? 0} label="open cases" note={d.pods?.length ? `POD: ${d.pods.join(", ")}` : undefined} />
        <Stat icon="home" hue="red" value={act?.items?.filter((i) => i.action.kind === "suspension").length ?? 0} label="suspended now" />
        <Stat icon="life-buoy" hue="orange" value={act?.items?.filter((i) => i.action.kind === "probation").length ?? 0} label="on discipline probation" />
      </div>
      <section className="card editor">
        <h3>Waiting for you</h3>
        {!d.cases?.length && <Empty icon="circle-check">Nothing is waiting for you.</Empty>}
        <ul className="dc-list">{d.cases?.slice(0, 8).map((c) => <CaseRow key={c.id} c={c} />)}</ul>
      </section>
      {report && <ReportBox schoolId={schoolId} onClose={() => setReport(false)} onDone={() => dp.list(schoolId, "inbox").then(setD)} />}
    </div>
  );
}
