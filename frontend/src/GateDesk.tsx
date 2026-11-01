// The gate: visitors in and out, and students leaving and returning on exit passes.
import { useCallback, useEffect, useState, type FormEvent } from "react";
import { InsightList, useBusy } from "./GrowthBits";
import { StudentPicker, useOpsMeta } from "./Helpdesk";
import Icon from "./Icon";
import { StudentLink } from "./StudentLink";
import { dayTime, fromLocalInput, hhmm, localInput, ops, PASS_STATUS, VISITOR_LOOK, type Gate, type Pass, type PassIn, type StudentCard, type Visitor, type VisitorIn } from "./opsApi";
import { Avatar, Empty, Field, Glyph, hue, Modal } from "./ui";

export function VisitorForm({ schoolId, onClose, onDone }: { schoolId: string; onClose: () => void; onDone: () => void }) {
  const meta = useOpsMeta();
  const [f, setF] = useState<VisitorIn>({ kind: "parent", name: "", phone: "", organisation: "", purpose: "", to_see: "", student_id: null, badge: "", vehicle: "", people: 1, note: "" });
  const [student, setStudent] = useState<StudentCard | null>(null);
  const [busy, error, run] = useBusy();
  const purposeIdeas: Record<string, string[]> = { parent: ["Visiting my child", "Bringing provisions", "Meeting the principal", "Paying fees"], visitor: ["See the principal", "Job interview", "Meeting"],
    contractor: ["Generator servicing", "Repairs", "Building work"], delivery: ["Food supplies", "Books", "Diesel"], official: ["Inspection", "Ministry visit", "Exam body"] };
  function submit(e: FormEvent) {
    e.preventDefault();
    const clean = Object.fromEntries(Object.entries(f).map(([k, v]) => [k, v === "" ? null : v])) as unknown as VisitorIn;
    run(async () => { await ops.visitorIn(schoolId, { ...clean, student_id: student?.id ?? null }); onDone(); });
  }
  return (
    <Modal title="Visitor coming in" onClose={onClose}>
      <form className="stack" onSubmit={submit}>
        <div className="kind-pick">
          {meta && Object.entries(meta.visitor_kinds).map(([k, l]) => { const lk = VISITOR_LOOK[k]; return (
            <button key={k} type="button" className={`mark-choice${f.kind === k ? " on" : ""}`} style={hue(lk.hue)} onClick={() => setF({ ...f, kind: k })}>
              <Glyph icon={lk.icon} hue={lk.hue} size={28} soft={f.kind !== k} />{l}</button>); })}
        </div>
        <div className="row wrap">
          <Field label="Full name"><input required minLength={2} value={f.name} onChange={(e) => setF({ ...f, name: e.target.value })} autoFocus /></Field>
          <Field label="Phone"><input inputMode="tel" value={f.phone ?? ""} onChange={(e) => setF({ ...f, phone: e.target.value })} /></Field>
        </div>
        {f.kind === "parent" && <StudentPicker schoolId={schoolId} value={student} onPick={setStudent} label="Whose parent?" />}
        {["contractor", "delivery", "official"].includes(f.kind) && <Field label="Company or office"><input value={f.organisation ?? ""} onChange={(e) => setF({ ...f, organisation: e.target.value })} /></Field>}
        <Field label="Purpose">
          <input required minLength={2} value={f.purpose} onChange={(e) => setF({ ...f, purpose: e.target.value })} />
          <span className="idea-chips">{purposeIdeas[f.kind]?.map((p) => <button key={p} type="button" className="chip" onClick={() => setF({ ...f, purpose: p })}>{p}</button>)}</span>
        </Field>
        <div className="row wrap">
          <Field label="To see"><input value={f.to_see ?? ""} placeholder="e.g. Principal, Bursar" onChange={(e) => setF({ ...f, to_see: e.target.value })} /></Field>
          <Field label="Badge no."><input value={f.badge ?? ""} onChange={(e) => setF({ ...f, badge: e.target.value })} /></Field>
          <Field label="Vehicle plate"><input value={f.vehicle ?? ""} onChange={(e) => setF({ ...f, vehicle: e.target.value.toUpperCase() })} /></Field>
          <Field label="How many people"><input type="number" min={1} max={60} value={f.people} onChange={(e) => setF({ ...f, people: Number(e.target.value) })} /></Field>
        </div>
        {error && <p className="error">{error}</p>}
        <div className="row"><span className="grow" /><button type="button" onClick={onClose}>Cancel</button><button className="primary with-icon" disabled={busy}><Icon name="log-in" size={16} />Sign in</button></div>
      </form>
    </Modal>
  );
}

export function PassForm({ schoolId, onClose, onDone }: { schoolId: string; onClose: () => void; onDone: (p: Pass) => void }) {
  const meta = useOpsMeta();
  const [student, setStudent] = useState<StudentCard | null>(null);
  const now = new Date();
  const [f, setF] = useState({ kind: "home", reason: "", leave_at: localInput(now), return_by: localInput(new Date(now.getTime() + 4 * 3600000)), escort_name: "", escort_phone: "", escort_relation: "Father" });
  const [noReturn, setNoReturn] = useState(false);
  const [busy, error, run] = useBusy();
  function submit(e: FormEvent) {
    e.preventDefault();
    if (!student) return;
    const body: PassIn = { student_id: student.id, kind: f.kind, reason: f.reason, leave_at: fromLocalInput(f.leave_at), return_by: noReturn ? null : fromLocalInput(f.return_by),
      escort_name: f.escort_name || null, escort_phone: f.escort_phone || null, escort_relation: f.escort_relation || null };
    run(async () => onDone(await ops.requestPass(schoolId, body)));
  }
  return (
    <Modal title="Exit pass for a student" onClose={onClose}>
      <form className="stack" onSubmit={submit}>
        <StudentPicker schoolId={schoolId} value={student} onPick={setStudent} />
        <div className="kind-pick">{meta && Object.entries(meta.pass_kinds).map(([k, l]) => (
          <button key={k} type="button" className={`chip pick${f.kind === k ? " on" : ""}`} onClick={() => setF({ ...f, kind: k })}>{l}</button>))}</div>
        <Field label="Reason"><input required minLength={3} maxLength={300} value={f.reason} onChange={(e) => setF({ ...f, reason: e.target.value })} placeholder="e.g. Dental appointment at Teme Clinic" /></Field>
        <div className="row wrap">
          <Field label="Leaves"><input type="datetime-local" required value={f.leave_at} onChange={(e) => setF({ ...f, leave_at: e.target.value })} /></Field>
          {!noReturn && <Field label="Back by"><input type="datetime-local" required value={f.return_by} onChange={(e) => setF({ ...f, return_by: e.target.value })} /></Field>}
        </div>
        <label className="check"><input type="checkbox" checked={noReturn} onChange={(e) => setNoReturn(e.target.checked)} />Not coming back this term (e.g. withdrawn, end of term)</label>
        <div className="row wrap">
          <Field label="Picked up by"><input value={f.escort_name} onChange={(e) => setF({ ...f, escort_name: e.target.value })} placeholder="Name" /></Field>
          <Field label="Relationship"><input value={f.escort_relation} onChange={(e) => setF({ ...f, escort_relation: e.target.value })} /></Field>
          <Field label="Their phone"><input inputMode="tel" value={f.escort_phone} onChange={(e) => setF({ ...f, escort_phone: e.target.value })} /></Field>
        </div>
        {error && <p className="error">{error}</p>}
        <div className="row"><span className="grow" /><button type="button" onClick={onClose}>Cancel</button><button className="primary" disabled={busy || !student}>Ask for the pass</button></div>
      </form>
    </Modal>
  );
}

export function PassCard({ p, onAct, big = false }: { p: Pass; onAct: (action: string) => void; big?: boolean }) {
  const st = PASS_STATUS[p.status];
  return (
    <article className={`pass-card${p.late ? " late" : ""}${big ? " big" : ""}`} style={hue(p.late ? "red" : st.hue)}>
      <div className="pass-top">
        <Avatar name={p.student.name} size={big ? 52 : 40} />
        <span className="pass-who"><strong><StudentLink id={p.student.id} name={p.student.name} /></strong><span className="muted small">{p.student.class_name} · {p.student.admission_no}{p.student.boarder ? " · boarder" : ""}</span></span>
        <span className="pass-code" title="Pass code">{p.code}</span>
      </div>
      <div className="chips">
        <span className="hue-chip" style={hue(p.late ? "red" : st.hue)}><Icon name={p.late ? "timer" : st.icon} size={12} />{p.late ? "Late back" : st.label}</span>
        <span className="hue-chip" style={hue("slate")}>{p.kind_label}</span>
        {p.medical_note && <span className="hue-chip" style={hue("rose")} title="Has allergies or a health condition on record"><Icon name="heart-pulse" size={12} />Health note</span>}
      </div>
      <p className="small">{p.reason}</p>
      <p className="small muted">
        Leaves {dayTime(p.leave_at)}{p.return_by && <> · back by {dayTime(p.return_by)}</>}
        {p.left_at && <> · went out {hhmm(p.left_at)}</>}{p.returned_at && <> · back {hhmm(p.returned_at)}</>}
      </p>
      {(p.escort_name || p.guardians.length > 0) && (
        <p className="small escort"><Icon name="users" size={13} />
          {p.escort_name ? <>With {p.escort_name}{p.escort_relation && ` (${p.escort_relation})`}{p.escort_phone && ` · ${p.escort_phone}`}</> : "No escort named"}
          {p.guardians.length > 0 && <span className="muted"> · Allowed to collect: {p.guardians.map((g) => `${g.name} (${g.relation})`).join(", ")}</span>}
        </p>
      )}
      <p className="muted small">Asked by {p.requested_by}{p.approved_by && ` · approved by ${p.approved_by}`}{p.decision_note && ` · “${p.decision_note}”`}</p>
      <div className="row wrap pass-actions">
        {p.can_decide && <><button className="ok-button" onClick={() => onAct("approve")}><Icon name="check" size={15} /> Approve</button><button onClick={() => onAct("decline")}>Decline</button></>}
        {p.can_gate && p.status === "approved" && <button className="primary with-icon" onClick={() => onAct("out")}><Icon name="log-out" size={16} />Let out now</button>}
        {p.can_gate && p.status === "out" && <button className="primary with-icon" onClick={() => onAct("in")}><Icon name="log-in" size={16} />Back in</button>}
        {p.can_cancel && <button className="text-link" onClick={() => onAct("cancel")}>Cancel pass</button>}
      </div>
    </article>
  );
}

export function GateBoard({ schoolId, big = false }: { schoolId: string; big?: boolean }) {
  const [g, setG] = useState<Gate | null>(null);
  const [modal, setModal] = useState<null | "visitor" | "pass" | "code" | "history">(null);
  const [code, setCode] = useState("");
  const [found, setFound] = useState<Pass | null>(null);
  const [codeErr, setCodeErr] = useState("");
  const load = useCallback(() => { ops.gate(schoolId).then(setG).catch(() => {}); }, [schoolId]);
  useEffect(() => { load(); const t = setInterval(load, 30000); return () => clearInterval(t); }, [load]);
  const act = async (p: Pass, a: string) => { const x = await ops.passAction(p.id, a); if (found?.id === p.id) setFound(x); load(); };
  if (!g) return <p className="muted">Loading…</p>;
  const inside = g.visitors.filter((v) => !v.time_out);
  const out = g.passes.filter((p) => p.status === "out");
  const leaving = g.passes.filter((p) => p.status === "approved");
  return (
    <section className={`gate stack${big ? " big" : ""}`}>
      <div className="gate-actions">
        <button className="gate-btn" style={hue("blue")} onClick={() => setModal("visitor")}><Glyph icon="log-in" hue="blue" size={big ? 56 : 44} /><span><strong>Visitor in</strong><small>Sign a visitor into the book</small></span></button>
        <button className="gate-btn" style={hue("violet")} onClick={() => { setModal("code"); setFound(null); setCode(""); }}><Glyph icon="scan" hue="violet" size={big ? 56 : 44} /><span><strong>Check a pass</strong><small>Type the student's pass code</small></span></button>
        <button className="gate-btn" style={hue("teal")} onClick={() => setModal("pass")}><Glyph icon="clipboard" hue="teal" size={big ? 56 : 44} /><span><strong>New exit pass</strong><small>Asked for by the house or office</small></span></button>
        <button className="gate-btn" style={hue("slate")} onClick={() => setModal("history")}><Glyph icon="search" hue="slate" size={big ? 56 : 44} /><span><strong>Visitors' book</strong><small>Search past visitors</small></span></button>
      </div>
      <div className="stat-strip">
        <div className="stat-tile" style={hue("blue")}><Glyph icon="users" hue="blue" size={44} /><div className="stat-text"><strong>{g.inside}</strong><span>Visitors inside</span><span className="stat-note">{g.visitors.length} today</span></div></div>
        <div className="stat-tile" style={hue("violet")}><Glyph icon="log-out" hue="violet" size={44} /><div className="stat-text"><strong>{g.out}</strong><span>Students out</span><span className="stat-note">{out.filter((p) => p.late).length} late back</span></div></div>
        <div className="stat-tile" style={hue("green")}><Glyph icon="circle-check" hue="green" size={44} /><div className="stat-text"><strong>{g.leaving}</strong><span>Approved to leave</span><span className="stat-note">today</span></div></div>
      </div>
      {g.insights.length > 0 && <InsightList items={g.insights} schoolId={schoolId} />}
      <div className="gate-cols">
        <div className="gate-col">
          <h3 className="with-glyph"><Glyph icon="users" hue="blue" size={30} />Visitors inside now <span className="count">{inside.length}</span></h3>
          {inside.length === 0 && <p className="muted small">Nobody inside.</p>}
          {inside.map((v) => <VisitorRow key={v.id} v={v} onOut={async () => { await ops.visitorOut(v.id); load(); }} />)}
        </div>
        <div className="gate-col">
          <h3 className="with-glyph"><Glyph icon="log-out" hue="violet" size={30} />Students out <span className="count">{out.length}</span></h3>
          {out.length === 0 && <p className="muted small">All students are in.</p>}
          {out.map((p) => <PassCard key={p.id} p={p} big={big} onAct={(a) => act(p, a)} />)}
          <h3 className="with-glyph"><Glyph icon="circle-check" hue="green" size={30} />Approved to leave <span className="count">{leaving.length}</span></h3>
          {leaving.length === 0 && <p className="muted small">No one is due to leave.</p>}
          {leaving.map((p) => <PassCard key={p.id} p={p} big={big} onAct={(a) => act(p, a)} />)}
        </div>
      </div>
      <details className="gate-log">
        <summary>Today's visitors' book ({g.visitors.length})</summary>
        {g.visitors.map((v) => <VisitorRow key={v.id} v={v} onOut={async () => { await ops.visitorOut(v.id); load(); }} />)}
      </details>
      {modal === "visitor" && <VisitorForm schoolId={schoolId} onClose={() => setModal(null)} onDone={() => { setModal(null); load(); }} />}
      {modal === "pass" && <PassForm schoolId={schoolId} onClose={() => setModal(null)} onDone={() => { setModal(null); load(); }} />}
      {modal === "history" && <VisitorSearch schoolId={schoolId} onClose={() => setModal(null)} />}
      {modal === "code" && (
        <Modal title="Check an exit pass" onClose={() => setModal(null)}>
          <form className="row" onSubmit={async (e) => { e.preventDefault(); setCodeErr(""); try { setFound(await ops.passByCode(schoolId, code)); } catch { setFound(null); setCodeErr("No pass with that code. Send the student back to the boarding house or office."); } }}>
            <input className="code-input" value={code} onChange={(e) => setCode(e.target.value.toUpperCase())} placeholder="e.g. 4F2A9C" maxLength={8} autoFocus />
            <button className="primary">Check</button>
          </form>
          {codeErr && <p className="day-banner" style={hue("red")}><Icon name="circle-x" size={18} />{codeErr}</p>}
          {found && <PassCard p={found} big onAct={(a) => act(found, a)} />}
        </Modal>
      )}
    </section>
  );
}

function VisitorRow({ v, onOut }: { v: Visitor; onOut: () => void }) {
  const lk = VISITOR_LOOK[v.kind] ?? VISITOR_LOOK.visitor;
  return (
    <div className={`visitor-row${v.time_out ? " gone" : ""}`} style={hue(lk.hue)}>
      <Glyph icon={lk.icon} hue={lk.hue} size={36} soft={!!v.time_out} />
      <span className="visitor-main"><strong>{v.name}{v.people > 1 && ` +${v.people - 1}`}</strong>
        <span className="muted small">{v.kind_label}{v.organisation && ` · ${v.organisation}`} · {v.purpose}{v.student && ` · ${v.student.name} (${v.student.class_name})`}{v.to_see && ` · to see ${v.to_see}`}</span>
        <span className="muted small">{v.phone}{v.vehicle && ` · ${v.vehicle}`}{v.badge && ` · badge ${v.badge}`}</span></span>
      <span className="visitor-times"><b>{hhmm(v.time_in)}</b>{v.time_out ? <span>→ {hhmm(v.time_out)}</span> : <button className="small primary" onClick={onOut}>Out</button>}</span>
    </div>
  );
}

function VisitorSearch({ schoolId, onClose }: { schoolId: string; onClose: () => void }) {
  const [q, setQ] = useState("");
  const [list, setList] = useState<Visitor[]>([]);
  useEffect(() => { const t = setTimeout(() => { if (q.trim().length >= 2) ops.visitors(schoolId, q).then(setList).catch(() => {}); }, 250); return () => clearTimeout(t); }, [q, schoolId]);
  return (
    <Modal title="Visitors' book" onClose={onClose}>
      <input placeholder="Search a name, phone, company or plate number…" value={q} onChange={(e) => setQ(e.target.value)} autoFocus />
      {list.map((v) => <div key={v.id} className="visitor-row gone"><span className="visitor-main"><strong>{v.name}</strong><span className="muted small">{v.purpose} · {dayTime(v.time_in)}{v.phone && ` · ${v.phone}`}</span></span></div>)}
      {q.length >= 2 && list.length === 0 && <Empty icon="search">No one found.</Empty>}
    </Modal>
  );
}

/** For class teachers, house parents and the principal: ask for and approve passes. */
export function PassesPanel({ schoolId, canApprove, onClose }: { schoolId: string; canApprove: boolean; onClose: () => void }) {
  const [list, setList] = useState<Pass[]>([]);
  const [asking, setAsking] = useState(false);
  const load = useCallback(() => { ops.passes(schoolId, canApprove ? "open" : "mine").then(setList).catch(() => {}); }, [schoolId, canApprove]);
  useEffect(load, [load]);
  return (
    <Modal title="Exit passes" onClose={onClose}>
      <div className="row"><span className="muted small grow">{canApprove ? "Open passes for the whole school." : "Passes you asked for."}</span>
        <button className="primary with-icon" onClick={() => setAsking(true)}><Icon name="plus" size={15} />New pass</button></div>
      {list.length === 0 && <Empty icon="clipboard">No open passes.</Empty>}
      <div className="stack">{list.map((p) => <PassCard key={p.id} p={p} onAct={async (a) => { await ops.passAction(p.id, a); load(); }} />)}</div>
      {asking && <PassForm schoolId={schoolId} onClose={() => setAsking(false)} onDone={() => { setAsking(false); load(); }} />}
    </Modal>
  );
}
