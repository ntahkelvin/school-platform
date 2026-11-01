// Incident reports: anyone can report; the principal (or the person given it) follows it up to the end.
import { useCallback, useEffect, useState, type FormEvent } from "react";
import { useBusy } from "./GrowthBits";
import { grow } from "./growthApi";
import { StudentPicker, useOpsMeta } from "./Helpdesk";
import Icon from "./Icon";
import { dayTime, fromLocalInput, INC_LOOK, INC_STATUS, localInput, ops, SEVERITY, type Incident, type StudentCard } from "./opsApi";
import { Avatar, Empty, Field, Glyph, hue, Modal } from "./ui";

export function IncidentForm({ schoolId, onClose, onDone }: { schoolId: string; onClose: () => void; onDone: () => void }) {
  const meta = useOpsMeta();
  const [f, setF] = useState({ kind: "", severity: "minor", occurred_at: localInput(new Date()), location: "", summary: "", description: "", others: "", action_taken: "" });
  const [students, setStudents] = useState<StudentCard[]>([]);
  const [busy, error, run] = useBusy();
  function submit(e: FormEvent) {
    e.preventDefault();
    run(async () => {
      await ops.report(schoolId, { ...f, occurred_at: fromLocalInput(f.occurred_at), location: f.location || null, description: f.description || null,
        others: f.others || null, action_taken: f.action_taken || null, student_ids: students.map((s) => s.id), staff_ids: [] });
      onDone();
    });
  }
  return (
    <Modal title="Report an incident" onClose={onClose}>
      <form className="stack" onSubmit={submit}>
        <div className="cat-grid small-tiles">
          {meta && Object.entries(meta.incident_kinds).map(([k, l]) => { const lk = INC_LOOK[k] ?? INC_LOOK.other; return (
            <button key={k} type="button" className={`cat-tile${f.kind === k ? " on" : ""}`} style={hue(lk.hue)} onClick={() => setF({ ...f, kind: k })}>
              <Glyph icon={lk.icon} hue={lk.hue} size={30} soft={f.kind !== k} /><strong>{l}</strong></button>); })}
        </div>
        <div className="row wrap">
          <Field label="How serious?">
            <div className="segmented small-seg">{(["minor", "serious", "critical"] as const).map((s) => (
              <button key={s} type="button" className={f.severity === s ? "on" : ""} onClick={() => setF({ ...f, severity: s })}>{SEVERITY[s].label}</button>))}</div>
          </Field>
          <Field label="When"><input type="datetime-local" required value={f.occurred_at} onChange={(e) => setF({ ...f, occurred_at: e.target.value })} /></Field>
          <Field label="Where"><input value={f.location} onChange={(e) => setF({ ...f, location: e.target.value })} placeholder="e.g. Dining hall" /></Field>
        </div>
        <Field label="What happened, in one line"><input required minLength={3} maxLength={200} value={f.summary} onChange={(e) => setF({ ...f, summary: e.target.value })} /></Field>
        <Field label="Full account (optional)"><textarea rows={3} value={f.description} onChange={(e) => setF({ ...f, description: e.target.value })} /></Field>
        <div>
          <span className="field-label">Students involved</span>
          <div className="chips">{students.map((s) => <span key={s.id} className="chip">{s.name} ({s.class_name})<button type="button" className="chip-x" onClick={() => setStudents(students.filter((x) => x.id !== s.id))}>×</button></span>)}</div>
          <StudentPicker schoolId={schoolId} value={null} label="Add a student" onPick={(s) => s && !students.some((x) => x.id === s.id) && setStudents([...students, s])} />
        </div>
        <Field label="Others involved (optional)"><input value={f.others} onChange={(e) => setF({ ...f, others: e.target.value })} placeholder="e.g. a visitor, a staff member" /></Field>
        <Field label="What you did straight away (optional)"><textarea rows={2} value={f.action_taken} onChange={(e) => setF({ ...f, action_taken: e.target.value })} /></Field>
        {f.kind === "bullying" && <p className="day-banner" style={hue("violet")}><Icon name="shield-check" size={16} />Only the principal and the person following it up see bullying reports.</p>}
        {error && <p className="error">{error}</p>}
        <div className="row"><span className="grow" /><button type="button" onClick={onClose}>Cancel</button><button className="primary" disabled={busy || !f.kind}>Send report</button></div>
      </form>
    </Modal>
  );
}

function IncidentView({ i: initial, staff, onClose, onChanged }: { i: Incident; staff: { user_id: string; name: string | null }[]; onClose: () => void; onChanged: () => void }) {
  const [i, setI] = useState(initial);
  const [note, setNote] = useState("");
  const [outcome, setOutcome] = useState(initial.outcome ?? "");
  const [busy, error, run] = useBusy();
  const upd = (body: Parameters<typeof ops.updateIncident>[1]) => run(async () => { setI(await ops.updateIncident(i.id, body)); setNote(""); onChanged(); });
  const lk = INC_LOOK[i.kind] ?? INC_LOOK.other;
  return (
    <Modal title={`Incident #${i.number}`} onClose={onClose}>
      <div className="ticket-head" style={hue(lk.hue)}>
        <Glyph icon={lk.icon} hue={lk.hue} size={44} />
        <div className="grow"><h3>{i.summary}</h3><p className="muted small">{i.kind_label} · {dayTime(i.occurred_at)}{i.location && ` · ${i.location}`}</p></div>
      </div>
      <div className="chips">
        <span className="hue-chip" style={hue(SEVERITY[i.severity].hue)}>{SEVERITY[i.severity].label}</span>
        <span className="hue-chip" style={hue(INC_STATUS[i.status].hue)}>{INC_STATUS[i.status].label}</span>
        <span className="hue-chip" style={hue(i.parents_informed ? "green" : "slate")}><Icon name="phone" size={12} />{i.parents_informed ? "Parents told" : "Parents not told yet"}</span>
      </div>
      {i.students.length > 0 && <div className="chips">{i.students.map((s) => <span key={s.id} className="who-inline chip"><Avatar name={s.name} size={20} />{s.name} · {s.class_name}</span>)}</div>}
      {i.description && <div className="note-section"><h4>Account</h4><p>{i.description}</p></div>}
      {i.others && <p className="small"><b>Others:</b> {i.others}</p>}
      {i.action_taken && <div className="note-section"><h4>Action taken</h4><p>{i.action_taken}</p></div>}
      {i.outcome && <div className="note-section"><h4>Outcome</h4><p>{i.outcome}</p></div>}
      <p className="muted small">Reported by {i.reported_by?.name}{i.assigned_to && ` · followed up by ${i.assigned_to.name}`}</p>
      <ol className="ticket-log">{i.notes.map((n, k) => <li key={k}><span className="log-dot" /><span><strong>{n.name}</strong> {n.text}<span className="muted small"> · {dayTime(n.at)}</span></span></li>)}</ol>
      {i.can_manage && i.status !== "closed" && (
        <div className="stack incident-manage">
          <div className="row wrap">
            <select value={i.assigned_to?.user_id ?? ""} onChange={(e) => upd({ assigned_to_id: e.target.value || null })} aria-label="Who follows it up">
              <option value="">Who follows it up…</option>{staff.map((s) => <option key={s.user_id} value={s.user_id}>{s.name}</option>)}
            </select>
            {i.status === "open" && <button onClick={() => upd({ status: "investigating" })}>Start looking into it</button>}
            {!i.parents_informed && <button onClick={() => upd({ parents_informed: true })}><Icon name="phone" size={14} /> Parents told</button>}
          </div>
          <Field label="Outcome"><textarea rows={2} value={outcome} onChange={(e) => setOutcome(e.target.value)} placeholder="What was decided and done" /></Field>
          <div className="row"><span className="grow" /><button className="primary" disabled={busy || !outcome.trim()} onClick={() => upd({ status: "closed", outcome })}>Close with this outcome</button></div>
        </div>
      )}
      {i.status !== "closed" && (
        <form className="row" onSubmit={(e) => { e.preventDefault(); if (note.trim()) upd({ note }); }}>
          <input value={note} onChange={(e) => setNote(e.target.value)} placeholder="Add a note" /><button disabled={busy || !note.trim()}>Add</button>
        </form>
      )}
      {error && <p className="error">{error}</p>}
    </Modal>
  );
}

export function IncidentsBoard({ schoolId }: { schoolId: string }) {
  const [list, setList] = useState<Incident[] | null>(null);
  const [open, setOpen] = useState<Incident | null>(null);
  const [reporting, setReporting] = useState(false);
  const [show, setShow] = useState("open");
  const [staff, setStaff] = useState<{ user_id: string; name: string | null }[]>([]);
  const load = useCallback(() => { ops.incidents(schoolId).then(setList).catch(() => setList([])); }, [schoolId]);
  useEffect(() => { load(); grow.people(schoolId).then((r) => setStaff(r.people.map((p) => ({ user_id: p.user_id, name: p.name })))).catch(() => {}); }, [load, schoolId]);
  const rows = (list ?? []).filter((i) => show === "all" || (show === "open" ? i.status !== "closed" : i.status === "closed"));
  return (
    <section className="stack">
      <div className="day-toolbar">
        <div className="segmented small-seg">
          {[["open", "Open"], ["closed", "Closed"], ["all", "All"]].map(([k, l]) => <button key={k} className={show === k ? "on" : ""} onClick={() => setShow(k)}>{l} ({(list ?? []).filter((i) => k === "all" || (k === "open" ? i.status !== "closed" : i.status === "closed")).length})</button>)}
        </div>
        <span className="grow" />
        <button className="primary with-icon" onClick={() => setReporting(true)}><Icon name="plus" size={16} />Report an incident</button>
      </div>
      {list && rows.length === 0 && <Empty icon="shield-check">No incidents here.</Empty>}
      <div className="incident-list">
        {rows.map((i) => { const lk = INC_LOOK[i.kind] ?? INC_LOOK.other; return (
          <button key={i.id} className={`incident-card s-${i.severity}`} style={hue(SEVERITY[i.severity].hue)} onClick={() => setOpen(i)}>
            <Glyph icon={lk.icon} hue={lk.hue} size={42} />
            <span className="grow incident-main"><strong>{i.summary}</strong>
              <span className="muted small">#{i.number} · {i.kind_label} · {dayTime(i.occurred_at)}{i.location && ` · ${i.location}`}</span>
              {i.students.length > 0 && <span className="small">{i.students.map((s) => s.name).join(", ")}</span>}</span>
            <span className="incident-chips">
              <span className="hue-chip" style={hue(SEVERITY[i.severity].hue)}>{SEVERITY[i.severity].label}</span>
              <span className="hue-chip" style={hue(INC_STATUS[i.status].hue)}>{INC_STATUS[i.status].label}</span>
            </span>
          </button>); })}
      </div>
      {open && <IncidentView i={open} staff={staff} onClose={() => setOpen(null)} onChanged={load} />}
      {reporting && <IncidentForm schoolId={schoolId} onClose={() => setReporting(false)} onDone={() => { setReporting(false); load(); }} />}
    </section>
  );
}
