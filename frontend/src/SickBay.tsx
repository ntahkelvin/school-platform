// The sick bay: today's visits, students lying in, follow-ups, medicine stock, health records and early warnings.
import { useCallback, useEffect, useState, type FormEvent } from "react";
import { InsightList, useBusy } from "./GrowthBits";
import { StudentPicker, useOpsMeta } from "./Helpdesk";
import Icon from "./Icon";
import { niceDate } from "./dayApi";
import { dayTime, hhmm, ops, OUTCOME_LOOK, type Clinic, type Health, type Stock, type StudentCard, type Visit, type VisitIn } from "./opsApi";
import { Avatar, Empty, Field, Glyph, hue, Modal } from "./ui";

export function VisitForm({ schoolId, stock, student: initial, onClose, onDone }: { schoolId: string; stock: Stock[]; student?: StudentCard | null; onClose: () => void; onDone: () => void }) {
  const meta = useOpsMeta();
  const [student, setStudent] = useState<StudentCard | null>(initial ?? null);
  const [health, setHealth] = useState<Health | null>(null);
  const [f, setF] = useState<VisitIn>({ student_id: null, staff_user_id: null, complaint: "", symptoms: [], temperature: null, treatment: "", medicines: [], outcome: "class", parent_informed: false, follow_up_on: null });
  const [busy, error, run] = useBusy();
  useEffect(() => { setHealth(null); if (student) ops.health(student.id).then((h) => setHealth(h.health)).catch(() => {}); }, [student]);
  const toggle = (s: string) => setF({ ...f, symptoms: f.symptoms.includes(s) ? f.symptoms.filter((x) => x !== s) : [...f.symptoms, s] });
  const fever = f.temperature != null && f.temperature >= 37.5;
  function submit(e: FormEvent) {
    e.preventDefault();
    run(async () => { await ops.addVisit(schoolId, { ...f, student_id: student?.id ?? null, complaint: f.complaint || f.symptoms.join(", "), treatment: f.treatment || null }); onDone(); });
  }
  return (
    <Modal title="Sick bay visit" onClose={onClose}>
      <form className="stack" onSubmit={submit}>
        <StudentPicker schoolId={schoolId} value={student} onPick={setStudent} />
        {health && (health.allergies || health.conditions || health.genotype) && (
          <p className="day-banner" style={hue("rose")}><Icon name="heart-pulse" size={18} />
            {health.genotype && <b>Genotype {health.genotype}</b>}{health.blood_group && <> · {health.blood_group}</>}
            {health.allergies && <> · <b>Allergic to {health.allergies}</b></>}{health.conditions && <> · {health.conditions}</>}{health.medications && <> · takes {health.medications}</>}</p>
        )}
        <div><span className="field-label">Symptoms</span>
          <div className="chips">{meta?.symptoms.map((s) => <label key={s} className={`chip pick${f.symptoms.includes(s) ? " on" : ""}`}><input type="checkbox" checked={f.symptoms.includes(s)} onChange={() => toggle(s)} />{s}</label>)}</div></div>
        <div className="row wrap">
          <Field label="Complaint in their words"><input maxLength={200} value={f.complaint} onChange={(e) => setF({ ...f, complaint: e.target.value })} placeholder="e.g. Headache since morning" /></Field>
          <Field label="Temperature °C"><input type="number" step={0.1} min={30} max={45} value={f.temperature ?? ""} className={fever ? "hot" : ""}
            onChange={(e) => setF({ ...f, temperature: e.target.value ? Number(e.target.value) : null })} /></Field>
        </div>
        {fever && <p className="day-banner" style={hue("red")}><Icon name="flame" size={16} />Fever. Consider a malaria test (RDT) and keep them under watch.</p>}
        <Field label="Treatment and advice"><textarea rows={2} value={f.treatment ?? ""} onChange={(e) => setF({ ...f, treatment: e.target.value })} /></Field>
        <div className="meds">
          <span className="field-label">Medicine given</span>
          {f.medicines.map((m, i) => (
            <div key={i} className="med-row">
              <select value={m.stock_id ?? ""} onChange={(e) => { const s = stock.find((x) => x.id === e.target.value); setF({ ...f, medicines: f.medicines.map((x, j) => j === i ? { ...x, stock_id: s?.id ?? null, name: s?.name ?? x.name } : x) }); }}>
                <option value="">Choose from stock…</option>{stock.map((s) => <option key={s.id} value={s.id} disabled={s.quantity <= 0 || s.expired}>{s.name} ({s.quantity} {s.unit}{s.expired ? ", expired" : ""})</option>)}
              </select>
              <input type="number" min={0.5} step={0.5} value={m.quantity} aria-label="Quantity" onChange={(e) => setF({ ...f, medicines: f.medicines.map((x, j) => j === i ? { ...x, quantity: Number(e.target.value) } : x) })} />
              <input placeholder="Dose, e.g. 2 tabs 3 times" value={m.dose ?? ""} onChange={(e) => setF({ ...f, medicines: f.medicines.map((x, j) => j === i ? { ...x, dose: e.target.value } : x) })} />
              <button type="button" className="chip-x" aria-label="Remove" onClick={() => setF({ ...f, medicines: f.medicines.filter((_, j) => j !== i) })}><Icon name="close" size={14} /></button>
            </div>
          ))}
          <button type="button" className="with-icon small" onClick={() => setF({ ...f, medicines: [...f.medicines, { stock_id: null, name: "", quantity: 1, dose: "" }] })}><Icon name="plus" size={14} />Add medicine</button>
        </div>
        <div><span className="field-label">What next?</span>
          <div className="kind-pick">{meta && Object.entries(meta.outcomes).map(([k, l]) => { const lk = OUTCOME_LOOK[k]; return (
            <button key={k} type="button" className={`mark-choice${f.outcome === k ? " on" : ""}`} style={hue(lk.hue)} onClick={() => setF({ ...f, outcome: k })}>
              <Glyph icon={lk.icon} hue={lk.hue} size={28} soft={f.outcome !== k} />{l}</button>); })}</div></div>
        <div className="row wrap">
          <label className="check"><input type="checkbox" checked={f.parent_informed} onChange={(e) => setF({ ...f, parent_informed: e.target.checked })} />Parent has been told</label>
          <Field label="Check again on (optional)"><input type="date" value={f.follow_up_on ?? ""} onChange={(e) => setF({ ...f, follow_up_on: e.target.value || null })} /></Field>
        </div>
        {error && <p className="error">{error}</p>}
        <div className="row"><span className="grow" /><button type="button" onClick={onClose}>Cancel</button><button className="primary" disabled={busy || !student}>Save visit</button></div>
      </form>
    </Modal>
  );
}

export function HealthModal({ studentId, onClose }: { studentId: string; onClose: () => void }) {
  const [d, setD] = useState<{ student: StudentCard; health: Health | null; can_edit: boolean; visits: Visit[] } | null>(null);
  const [h, setH] = useState<Health>({ blood_group: null, genotype: null, allergies: null, conditions: null, medications: null, hospital: null, diet: null, notes: null });
  const [editing, setEditing] = useState(false);
  const [busy, error, run] = useBusy();
  useEffect(() => { ops.health(studentId).then((x) => { setD(x); if (x.health) setH(x.health); }).catch(() => {}); }, [studentId]);
  if (!d) return <Modal title="Health record" onClose={onClose}><p className="muted">Loading…</p></Modal>;
  const set = (k: keyof Health, v: string) => setH({ ...h, [k]: v || null });
  return (
    <Modal title={`Health: ${d.student.name}`} onClose={onClose}>
      {!editing ? (
        <>
          <div className="health-grid">
            {([["blood_group", "Blood group", "heart-pulse"], ["genotype", "Genotype", "dna"], ["allergies", "Allergies", "circle-x"], ["conditions", "Conditions", "stethoscope"],
              ["medications", "Regular medicine", "clipboard"], ["hospital", "Family hospital", "landmark"], ["diet", "Special diet (kitchen sees this)", "utensils"]] as const).map(([k, l, ic]) => (
              <div key={k} className={`health-item${d.health?.[k] ? "" : " empty"}`}><Icon name={ic} size={16} /><span><small>{l}</small><strong>{d.health?.[k] ?? "Not recorded"}</strong></span></div>
            ))}
          </div>
          {d.health?.notes && <div className="note-section"><h4>Nurse's notes</h4><p>{d.health.notes}</p></div>}
          {d.can_edit && <div className="row"><span className="grow" /><button className="primary with-icon" onClick={() => setEditing(true)}><Icon name="edit" size={15} />Edit</button></div>}
          {d.visits.length > 0 && <>
            <h4 className="goals-title"><Icon name="history" size={16} />Sick bay visits</h4>
            <ul className="visit-history">{d.visits.map((v) => <li key={v.id}><span className="date-chip">{niceDate(v.seen_at.slice(0, 10), { day: "numeric", month: "short" })}</span>
              <span>{v.complaint}{v.temperature && ` · ${v.temperature}°C`} · <b>{v.outcome_label}</b></span></li>)}</ul></>}
        </>
      ) : (
        <form className="stack" onSubmit={(e) => { e.preventDefault(); run(async () => { const x = await ops.saveHealth(studentId, h); setD(x); setEditing(false); }); }}>
          <div className="row wrap">
            <Field label="Blood group"><select value={h.blood_group ?? ""} onChange={(e) => set("blood_group", e.target.value)}><option value="">Not known</option>{["O+", "O-", "A+", "A-", "B+", "B-", "AB+", "AB-"].map((x) => <option key={x}>{x}</option>)}</select></Field>
            <Field label="Genotype"><select value={h.genotype ?? ""} onChange={(e) => set("genotype", e.target.value)}><option value="">Not known</option>{["AA", "AS", "AC", "SS", "SC"].map((x) => <option key={x}>{x}</option>)}</select></Field>
          </div>
          <Field label="Allergies"><input value={h.allergies ?? ""} onChange={(e) => set("allergies", e.target.value)} placeholder="e.g. Penicillin, groundnuts" /></Field>
          <Field label="Conditions"><input value={h.conditions ?? ""} onChange={(e) => set("conditions", e.target.value)} placeholder="e.g. Asthma, sickle cell" /></Field>
          <Field label="Regular medicine"><input value={h.medications ?? ""} onChange={(e) => set("medications", e.target.value)} /></Field>
          <Field label="Family hospital or doctor"><input value={h.hospital ?? ""} onChange={(e) => set("hospital", e.target.value)} /></Field>
          <Field label="Special diet" hint="The kitchen sees this and the allergies, nothing else"><input value={h.diet ?? ""} onChange={(e) => set("diet", e.target.value)} placeholder="e.g. No pork, no groundnuts, soft food" /></Field>
          <Field label="Nurse's notes (only the sick bay sees these)"><textarea rows={3} value={h.notes ?? ""} onChange={(e) => set("notes", e.target.value)} /></Field>
          {error && <p className="error">{error}</p>}
          <div className="row"><span className="grow" /><button type="button" onClick={() => setEditing(false)}>Cancel</button><button className="primary" disabled={busy}>Save</button></div>
        </form>
      )}
    </Modal>
  );
}

function StockForm({ schoolId, item, onClose, onDone }: { schoolId: string; item: Stock | null; onClose: () => void; onDone: () => void }) {
  const [f, setF] = useState({ name: item?.name ?? "", unit: item?.unit ?? "tablet", quantity: item?.quantity ?? 0, reorder_level: item?.reorder_level ?? 10, expiry: item?.expiry ?? "", notes: item?.notes ?? "" });
  const [busy, error, run] = useBusy();
  return (
    <Modal title={item ? item.name : "Add medicine"} onClose={onClose}>
      <form className="stack" onSubmit={(e) => { e.preventDefault(); const body = { ...f, expiry: f.expiry || null, notes: f.notes || null }; run(async () => { if (item) await ops.editStock(item.id, body); else await ops.addStock(schoolId, body); onDone(); }); }}>
        <Field label="Name"><input required minLength={2} value={f.name} onChange={(e) => setF({ ...f, name: e.target.value })} placeholder="e.g. Paracetamol 500mg" /></Field>
        <div className="row wrap">
          <Field label="Quantity"><input type="number" min={0} step={0.5} value={f.quantity} onChange={(e) => setF({ ...f, quantity: Number(e.target.value) })} /></Field>
          <Field label="Unit"><select value={f.unit} onChange={(e) => setF({ ...f, unit: e.target.value })}>{["tablet", "capsule", "sachet", "bottle", "pack", "tube", "vial", "piece"].map((u) => <option key={u}>{u}</option>)}</select></Field>
          <Field label="Warn when below"><input type="number" min={0} value={f.reorder_level} onChange={(e) => setF({ ...f, reorder_level: Number(e.target.value) })} /></Field>
          <Field label="Expiry date"><input type="date" value={f.expiry} onChange={(e) => setF({ ...f, expiry: e.target.value })} /></Field>
        </div>
        {error && <p className="error">{error}</p>}
        <div className="row"><span className="grow" />
          {item && <button type="button" className="danger-hover" onClick={() => run(async () => { await ops.removeStock(item.id); onDone(); })}>Remove</button>}
          <button type="button" onClick={onClose}>Cancel</button><button className="primary" disabled={busy}>Save</button></div>
      </form>
    </Modal>
  );
}

export function ClinicBoard({ schoolId }: { schoolId: string }) {
  const [c, setC] = useState<Clinic | null>(null);
  const [modal, setModal] = useState<null | "visit" | { health: string } | { stock: Stock | null }>(null);
  const [tab, setTab] = useState<"today" | "stock">("today");
  const load = useCallback(() => { ops.clinic(schoolId).then(setC).catch(() => {}); }, [schoolId]);
  useEffect(load, [load]);
  if (!c) return <p className="muted">Loading…</p>;
  const max = Math.max(1, ...c.trend.map((t) => t.visits));
  const low = c.stock.filter((s) => s.low || s.expired || s.expiring).length;
  return (
    <section className="stack clinic">
      <div className="day-toolbar">
        <div className="segmented small-seg">
          <button className={tab === "today" ? "on" : ""} onClick={() => setTab("today")}>Today</button>
          <button className={tab === "stock" ? "on" : ""} onClick={() => setTab("stock")}>Medicine stock{low ? ` (${low})` : ""}</button>
        </div>
        <span className="grow" />
        <button className="primary with-icon" onClick={() => setModal("visit")}><Icon name="plus" size={16} />New visit</button>
      </div>
      {tab === "today" ? (
        <>
          <div className="stat-strip">
            <div className="stat-tile" style={hue("rose")}><Glyph icon="stethoscope" hue="rose" size={44} /><div className="stat-text"><strong>{c.visits.length}</strong><span>Seen today</span><span className="stat-note">{c.visits.filter((v) => v.temperature && v.temperature >= 37.5).length} with fever</span></div></div>
            <div className="stat-tile" style={hue("amber")}><Glyph icon="bed" hue="amber" size={44} /><div className="stat-text"><strong>{c.lying_in.length}</strong><span>In the sick bay now</span><span className="stat-note">kept in</span></div></div>
            <div className="stat-tile" style={hue("sky")}><Glyph icon="calendar-check" hue="sky" size={44} /><div className="stat-text"><strong>{c.follow_ups.length}</strong><span>Follow-ups</span><span className="stat-note">due now</span></div></div>
            <div className="stat-tile" style={hue(low ? "red" : "green")}><Glyph icon="store" hue={low ? "red" : "green"} size={44} /><div className="stat-text"><strong>{low}</strong><span>Medicine warnings</span><span className="stat-note">low or expiring</span></div></div>
          </div>
          {c.insights.length > 0 && <InsightList items={c.insights} schoolId={schoolId} />}
          <div className="growth-grid">
            <section className="card g-card" style={hue("rose")}>
              <h3 className="with-glyph"><Glyph icon="chart" hue="rose" size={30} />Last 14 days</h3>
              <div className="clinic-bars">
                {c.trend.map((t) => (
                  <div key={t.date} className="clinic-col" title={`${niceDate(t.date)}: ${t.visits} visits, ${t.fever} with fever`}>
                    <span className="clinic-track"><i className="all" style={{ height: `${(t.visits / max) * 100}%` }} /><i className="fever" style={{ height: `${(t.fever / max) * 100}%` }} /></span>
                    <small>{niceDate(t.date, { day: "numeric" })}</small>
                  </div>
                ))}
              </div>
              <p className="radar-key"><span className="bar-all" />All visits<span className="bar-fever" />With fever</p>
            </section>
            <section className="card g-card" style={hue("violet")}>
              <h3 className="with-glyph"><Glyph icon="gauge" hue="violet" size={30} />Most common, last 4 weeks</h3>
              <div className="mood-dist">{c.top_symptoms.map((s) => (
                <div key={s.symptom} className="mood-row" style={hue("violet")}><span>{s.symptom}</span><span className="mood-row-bar"><i style={{ width: `${(s.count / (c.top_symptoms[0]?.count || 1)) * 100}%` }} /></span><b>{s.count}</b></div>))}</div>
            </section>
          </div>
          <h3 className="with-glyph"><Glyph icon="bed" hue="amber" size={30} />In the sick bay now</h3>
          {c.lying_in.length === 0 ? <p className="muted small">Nobody is kept in.</p> : <div className="visit-grid">{c.lying_in.map((v) => <VisitCard key={v.id} v={v} onHealth={(id) => setModal({ health: id })} onChanged={load} />)}</div>}
          {c.follow_ups.length > 0 && <><h3 className="with-glyph"><Glyph icon="calendar-check" hue="sky" size={30} />Follow-ups due</h3>
            <div className="visit-grid">{c.follow_ups.map((v) => <VisitCard key={v.id} v={v} onHealth={(id) => setModal({ health: id })} onChanged={load} />)}</div></>}
          <h3 className="with-glyph"><Glyph icon="stethoscope" hue="rose" size={30} />Seen today</h3>
          {c.visits.length === 0 ? <Empty icon="stethoscope">No visits yet today.</Empty> : <div className="visit-grid">{c.visits.map((v) => <VisitCard key={v.id} v={v} onHealth={(id) => setModal({ health: id })} onChanged={load} />)}</div>}
        </>
      ) : (
        <div className="stock-list">
          <div className="row"><span className="grow" /><button className="with-icon" onClick={() => setModal({ stock: null })}><Icon name="plus" size={15} />Add medicine</button></div>
          {c.stock.map((s) => (
            <button key={s.id} className={`stock-row${s.low ? " low" : ""}${s.expired ? " expired" : ""}`} onClick={() => setModal({ stock: s })}
              style={hue(s.expired ? "red" : s.low ? "amber" : s.expiring ? "orange" : "green")}>
              <Glyph icon="clipboard" hue={s.expired ? "red" : s.low ? "amber" : "green"} size={34} soft />
              <span className="grow"><strong>{s.name}</strong><span className="muted small">warn below {s.reorder_level} · {s.expiry ? `expires ${niceDate(s.expiry, { day: "numeric", month: "short", year: "numeric" })}` : "no expiry date"}</span></span>
              <span className="stock-qty"><b>{s.quantity}</b>{s.unit}</span>
              {s.expired ? <span className="hue-chip" style={hue("red")}>Expired</span> : s.low ? <span className="hue-chip" style={hue("amber")}>Low</span> : s.expiring ? <span className="hue-chip" style={hue("orange")}>Expiring soon</span> : <span className="hue-chip" style={hue("green")}>OK</span>}
            </button>
          ))}
          {c.stock.length === 0 && <Empty icon="clipboard">No medicines recorded yet.</Empty>}
        </div>
      )}
      {modal === "visit" && <VisitForm schoolId={schoolId} stock={c.stock} onClose={() => setModal(null)} onDone={() => { setModal(null); load(); }} />}
      {modal && typeof modal === "object" && "health" in modal && <HealthModal studentId={modal.health} onClose={() => setModal(null)} />}
      {modal && typeof modal === "object" && "stock" in modal && <StockForm schoolId={schoolId} item={modal.stock} onClose={() => setModal(null)} onDone={() => { setModal(null); load(); }} />}
    </section>
  );
}

function VisitCard({ v, onHealth, onChanged }: { v: Visit; onHealth: (id: string) => void; onChanged: () => void }) {
  const lk = OUTCOME_LOOK[v.outcome] ?? OUTCOME_LOOK.class;
  const who = v.student?.name ?? v.staff?.name ?? "Patient";
  const hot = v.temperature != null && v.temperature >= 37.5;
  return (
    <article className="visit-card" style={hue(lk.hue)}>
      <div className="pass-top">
        <Avatar name={who} size={38} />
        <span className="pass-who"><strong>{who}</strong><span className="muted small">{v.student ? `${v.student.class_name ?? ""}${v.student.boarder ? " · boarder" : ""}` : "Staff"} · {hhmm(v.seen_at)}</span></span>
        {v.temperature != null && <span className={`temp${hot ? " hot" : ""}`}>{v.temperature}°</span>}
      </div>
      <p className="small"><b>{v.complaint}</b>{v.treatment && ` · ${v.treatment}`}</p>
      {v.medicines.length > 0 && <p className="small muted"><Icon name="clipboard" size={12} /> {v.medicines.map((m) => `${m.name} ×${m.quantity}`).join(", ")}</p>}
      {v.health && (v.health.allergies || v.health.conditions) && <p className="small" style={{ color: "var(--h-rose)" }}><Icon name="heart-pulse" size={12} /> {[v.health.allergies && `Allergic: ${v.health.allergies}`, v.health.conditions].filter(Boolean).join(" · ")}</p>}
      <div className="chips">
        <span className="hue-chip" style={hue(lk.hue)}><Icon name={lk.icon} size={12} />{v.outcome_label}</span>
        <span className="hue-chip" style={hue(v.parent_informed ? "green" : "slate")}><Icon name="phone" size={12} />{v.parent_informed ? "Parent told" : "Parent not told"}</span>
      </div>
      <div className="row wrap">
        {v.student && <button className="text-link small" onClick={() => onHealth(v.student!.id)}>Health record</button>}
        {!v.parent_informed && v.student && <button className="small" onClick={async () => { await ops.updateVisit(v.id, { parent_informed: true }); onChanged(); }}>Parent told</button>}
        {v.outcome === "sick_bay" && !v.discharged_at && <button className="small primary" onClick={async () => { await ops.updateVisit(v.id, { discharge: true }); onChanged(); }}>Discharge</button>}
      </div>
      <span className="muted small">Seen by {v.nurse} · {dayTime(v.seen_at)}</span>
    </article>
  );
}
