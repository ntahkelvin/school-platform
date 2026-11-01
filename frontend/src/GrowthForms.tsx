// Forms and detail views for Growth: observation, appraisal, training, kudos, mentoring.
import { useEffect, useMemo, useState, type FormEvent } from "react";
import { iso, niceDate } from "./dayApi";
import {
  APP_STATUS, BADGE_LOOK, CPD_LOOK, grow, LEVEL_LOOK, loadMeta, OBS_KIND, OBS_STATUS,
  type Appraisal, type Card, type Cpd, type CpdIn, type Goal, type Meta, type Mentoring, type Observation, type ObsIn,
} from "./growthApi";
import { LevelChip, PersonLine, ScorePicker, useBusy } from "./GrowthBits";
import Icon from "./Icon";
import { Avatar, Field, Glyph, hue, Modal } from "./ui";

export function useMeta(): Meta | null {
  const [m, setM] = useState<Meta | null>(null);
  useEffect(() => { loadMeta().then(setM).catch(() => {}); }, []);
  return m;
}

export function PersonSelect({ people, value, onChange, exclude, label = "Staff member", required = true }: {
  people: Card[]; value: string; onChange: (v: string) => void; exclude?: string[]; label?: string; required?: boolean;
}) {
  const [q, setQ] = useState("");
  const list = people.filter((p) => !exclude?.includes(p.user_id) && (!q || `${p.name} ${p.job_title ?? ""} ${p.department_name ?? ""}`.toLowerCase().includes(q.toLowerCase())));
  return (
    <Field label={label}>
      <div className="person-select">
        <input placeholder="Type to find…" value={q} onChange={(e) => setQ(e.target.value)} aria-label={`Find ${label.toLowerCase()}`} />
        <select required={required} value={value} onChange={(e) => onChange(e.target.value)} aria-label={label}>
          <option value="">Choose… ({list.length})</option>
          {list.map((p) => <option key={p.user_id} value={p.user_id}>{p.name}{p.job_title ? ` · ${p.job_title}` : ""}</option>)}
        </select>
      </div>
    </Field>
  );
}

// ---------- Observations ----------

export function ObservationForm({ schoolId, people, obs, teacherId, peer = false, onClose, onDone }: {
  schoolId: string; people: Card[]; obs?: Observation | null; teacherId?: string; peer?: boolean; onClose: () => void; onDone: () => void;
}) {
  const meta = useMeta();
  const [f, setF] = useState<ObsIn>({
    teacher_id: obs?.teacher.user_id ?? teacherId ?? "", subject_id: obs?.subject_id ?? null, class_label: obs?.class_label ?? "",
    on_date: obs?.on_date ?? iso(new Date()), kind: obs?.kind ?? (peer ? "peer" : "formal"), focus: obs?.focus ?? "",
    scores: obs?.scores ?? {}, strengths: obs?.strengths ?? "", next_steps: obs?.next_steps ?? "", status: obs?.status === "shared" ? "shared" : "draft",
  });
  const [busy, error, run] = useBusy();
  const scored = Object.keys(f.scores).length;
  const avg = scored ? Object.values(f.scores).reduce((a, b) => a + b, 0) / scored : null;
  function save(statusTo: "planned" | "draft" | "shared", e?: FormEvent) {
    e?.preventDefault();
    const body = { ...f, status: statusTo, class_label: f.class_label || null, focus: f.focus || null, strengths: f.strengths || null, next_steps: f.next_steps || null };
    run(async () => { if (obs) await grow.editObservation(obs.id, body); else await grow.addObservation(schoolId, body); onDone(); });
  }
  return (
    <Modal title={obs ? "Lesson observation" : peer ? "Peer observation" : "Observe a lesson"} onClose={onClose}>
      <form className="stack obs-form" onSubmit={(e) => save("shared", e)}>
        {!obs && !teacherId ? <PersonSelect people={people.filter((p) => p.teaching)} value={f.teacher_id} onChange={(v) => setF({ ...f, teacher_id: v })} label="Teacher" />
          : <PersonLine p={obs?.teacher ?? people.find((p) => p.user_id === f.teacher_id) ?? { user_id: f.teacher_id, name: "Teacher", job_title: null, photo: null, department_name: null, teaching: true }} />}
        <div className="row wrap">
          <Field label="Date"><input type="date" required value={f.on_date} onChange={(e) => setF({ ...f, on_date: e.target.value })} /></Field>
          <Field label="Class"><input value={f.class_label ?? ""} maxLength={60} placeholder="e.g. JSS 2B, Mathematics" onChange={(e) => setF({ ...f, class_label: e.target.value })} /></Field>
          <Field label="Type">
            <select value={f.kind} onChange={(e) => setF({ ...f, kind: e.target.value })}>
              {Object.entries(OBS_KIND).map(([k, v]) => <option key={k} value={k}>{v}</option>)}
            </select>
          </Field>
        </div>
        <Field label="Focus (optional)"><input value={f.focus ?? ""} maxLength={200} placeholder="e.g. Questioning, behaviour, use of teaching aids" onChange={(e) => setF({ ...f, focus: e.target.value })} /></Field>
        <div className="obs-scores">
          <div className="obs-scores-head">
            <strong>Teaching standards</strong>
            <span className="score-key">{[1, 2, 3, 4].map((v) => <span key={v} style={hue(LEVEL_LOOK[v].hue)}><b>{v}</b>{LEVEL_LOOK[v].label}</span>)}</span>
          </div>
          {meta?.criteria.map((c) => (
            <div key={c.key} className="obs-score-row">
              <Glyph icon={c.icon} hue="indigo" size={30} soft />
              <span className="obs-score-text"><strong>{c.label}</strong><span className="muted small">{c.hint}</span></span>
              <ScorePicker value={f.scores[c.key]} onChange={(v) => { const s = { ...f.scores }; if (v) s[c.key] = v; else delete s[c.key]; setF({ ...f, scores: s }); }} />
            </div>
          ))}
          {avg != null && <p className="obs-avg">Average so far <LevelChip v={Math.round(avg * 10) / 10} /> ({scored} of {meta?.criteria.length ?? 9} scored)</p>}
        </div>
        <Field label="What went well"><textarea rows={3} value={f.strengths ?? ""} onChange={(e) => setF({ ...f, strengths: e.target.value })} placeholder="Be specific: what you saw and why it worked" /></Field>
        <Field label="Next steps"><textarea rows={3} value={f.next_steps ?? ""} onChange={(e) => setF({ ...f, next_steps: e.target.value })} placeholder="One or two clear, doable targets" /></Field>
        {error && <p className="error">{error}</p>}
        <div className="row wrap"><span className="grow" />
          <button type="button" onClick={onClose}>Cancel</button>
          {!obs && <button type="button" disabled={busy || !f.teacher_id} onClick={() => save("planned")}><Icon name="calendar-days" size={15} /> Just plan it</button>}
          <button type="button" disabled={busy || !f.teacher_id} onClick={() => save("draft")}>Save draft</button>
          <button className="primary with-icon" disabled={busy || !f.teacher_id}><Icon name="send" size={16} />Share with teacher</button>
        </div>
      </form>
    </Modal>
  );
}

export function ObservationView({ o, onClose, onChanged, onEdit }: { o: Observation; onClose: () => void; onChanged: () => void; onEdit?: () => void }) {
  const meta = useMeta();
  const [comment, setComment] = useState(o.teacher_comment ?? "");
  const [busy, error, run] = useBusy();
  const st = OBS_STATUS[o.status];
  return (
    <Modal title="Lesson observation" onClose={onClose}>
      <div className="obs-view-head">
        <PersonLine p={o.teacher} />
        <span className="hue-chip" style={hue(st.hue)}><Icon name={st.icon} size={12} />{st.label}</span>
      </div>
      <p className="muted small">{OBS_KIND[o.kind]} · {niceDate(o.on_date, { day: "numeric", month: "long", year: "numeric" })}{o.class_label && ` · ${o.class_label}`} · by {o.observer}{o.focus && ` · focus: ${o.focus}`}</p>
      {o.average != null && <p className="obs-avg">Average <LevelChip v={o.average} /></p>}
      <div className="obs-bars">
        {meta?.criteria.filter((c) => o.scores[c.key]).map((c) => {
          const v = o.scores[c.key], l = LEVEL_LOOK[v];
          return (
            <div key={c.key} className="obs-bar" style={hue(l.hue)}>
              <span>{c.label}</span>
              <span className="obs-bar-track"><i style={{ width: `${v * 25}%` }} /></span>
              <b>{v}</b>
            </div>
          );
        })}
      </div>
      {o.strengths && <div className="note-section"><h4>What went well</h4><p>{o.strengths}</p></div>}
      {o.next_steps && <div className="note-section"><h4>Next steps</h4><p>{o.next_steps}</p></div>}
      {o.teacher_comment && !o.can_acknowledge && <div className="note-section"><h4>Teacher's reply</h4><p>{o.teacher_comment}</p></div>}
      {o.can_acknowledge && (
        <>
          <Field label="Your reply (optional)"><textarea rows={2} value={comment} onChange={(e) => setComment(e.target.value)} placeholder="Thank the observer, or add your side" /></Field>
          {error && <p className="error">{error}</p>}
          <div className="row"><span className="grow" /><button className="primary with-icon" disabled={busy}
            onClick={() => run(async () => { await grow.acknowledge(o.id, comment.trim() || null); onChanged(); })}><Icon name="pen-tool" size={16} />Sign: I have read this</button></div>
        </>
      )}
      {o.can_edit && (
        <div className="row"><span className="grow" />
          <button className="danger-hover" onClick={() => run(async () => { if (confirm("Delete this observation?")) { await grow.removeObservation(o.id); onChanged(); } })}>Delete</button>
          {onEdit && <button className="primary with-icon" onClick={onEdit}><Icon name="edit" size={16} />{o.status === "planned" ? "Start observing" : "Edit"}</button>}
        </div>
      )}
    </Modal>
  );
}

// ---------- Appraisals ----------

function GoalsEditor({ goals, onChange, editable }: { goals: Goal[]; onChange: (g: Goal[]) => void; editable: boolean }) {
  return (
    <div className="goals">
      {goals.map((g, i) => (
        <div key={i} className="goal" style={hue(g.progress >= 100 ? "green" : g.progress >= 50 ? "teal" : "sky")}>
          <Glyph icon="target" hue={g.progress >= 100 ? "green" : "sky"} size={30} soft />
          <div className="goal-text">
            {editable ? <input value={g.title} placeholder="Goal" onChange={(e) => onChange(goals.map((x, j) => (j === i ? { ...x, title: e.target.value } : x)))} />
              : <strong>{g.title}</strong>}
            {editable ? <input value={g.measure ?? ""} placeholder="How we'll know (optional)" onChange={(e) => onChange(goals.map((x, j) => (j === i ? { ...x, measure: e.target.value || null } : x)))} />
              : g.measure && <span className="muted small">{g.measure}</span>}
            <div className="goal-progress">
              <input type="range" min={0} max={100} step={5} value={g.progress} aria-label="Progress"
                onChange={(e) => onChange(goals.map((x, j) => (j === i ? { ...x, progress: Number(e.target.value) } : x)))} />
              <b>{g.progress}%</b>
              {editable && <input type="date" value={g.due ?? ""} aria-label="Due" onChange={(e) => onChange(goals.map((x, j) => (j === i ? { ...x, due: e.target.value || null } : x)))} />}
              {!editable && g.due && <span className="muted small">by {niceDate(g.due, { day: "numeric", month: "short", year: "numeric" })}</span>}
            </div>
          </div>
          {editable && <button type="button" className="chip-x" aria-label="Remove goal" onClick={() => onChange(goals.filter((_, j) => j !== i))}><Icon name="close" size={14} /></button>}
        </div>
      ))}
      {editable && goals.length < 8 && <button type="button" className="with-icon" onClick={() => onChange([...goals, { title: "", measure: null, due: null, progress: 0 }])}><Icon name="plus" size={15} />Add a goal</button>}
    </div>
  );
}

export function AppraisalModal({ id, onClose, onChanged }: { id: string; onClose: () => void; onChanged: () => void }) {
  const meta = useMeta();
  const [a, setA] = useState<Appraisal | null>(null);
  const [scores, setScores] = useState<Record<string, number>>({});
  const [comment, setComment] = useState("");
  const [overall, setOverall] = useState<number | undefined>();
  const [goals, setGoals] = useState<Goal[]>([]);
  const [sig, setSig] = useState("");
  const [busy, error, run] = useBusy();
  const load = (x: Appraisal) => {
    setA(x);
    setScores(x.can_self ? x.self_scores : x.scores && Object.keys(x.scores).length ? x.scores : x.can_review ? { ...x.self_scores } : x.scores);
    setComment((x.can_self ? x.self_comment : x.appraiser_comment) ?? "");
    setOverall(x.overall ?? undefined); setGoals(x.goals);
  };
  useEffect(() => { grow.appraisal(id).then(load).catch(() => {}); }, [id]);
  if (!a || !meta) return <Modal title="Appraisal" onClose={onClose}><p className="muted">Loading…</p></Modal>;
  const areas = [...meta.criteria, ...meta.professional];
  const st = APP_STATUS[a.status];
  const editing = a.can_self || a.can_review;
  const goalsChanged = JSON.stringify(goals) !== JSON.stringify(a.goals);
  async function save(submit: boolean) {
    await run(async () => {
      const x = a!.can_self
        ? await grow.selfReview(a!.id, { self_scores: scores, self_comment: comment || null, goals: goals.filter((g) => g.title.trim().length > 1), submit })
        : await grow.review(a!.id, { scores, appraiser_comment: comment || null, overall: overall ?? null, goals: goals.filter((g) => g.title.trim().length > 1), submit });
      load(x); onChanged();
    });
  }
  return (
    <Modal title={`Appraisal ${a.period_label}`} onClose={onClose}>
      <div className="obs-view-head"><PersonLine p={a.person} sub={`Appraiser: ${a.appraiser || "not set"}`} />
        <span className="hue-chip" style={hue(st.hue)}><Icon name={st.icon} size={12} />{st.label}</span></div>
      <ol className="app-steps">
        {(["self", "review", "sign", "done"] as const).map((k) => (
          <li key={k} className={APP_STATUS[k].step < st.step ? "past" : APP_STATUS[k].step === st.step ? "now" : ""} style={hue(APP_STATUS[k].hue)}>
            <span><Icon name={APP_STATUS[k].step < st.step ? "check" : APP_STATUS[k].icon} size={14} /></span>{APP_STATUS[k].label}
          </li>
        ))}
      </ol>
      {a.can_self && <p className="day-banner" style={hue("sky")}><Icon name="lightbulb" size={16} />Rate yourself honestly from 1 to 4 and set up to 8 goals for the year. Your appraiser sees this when you send it.</p>}
      {a.can_review && <p className="day-banner" style={hue("amber")}><Icon name="lightbulb" size={16} />Their own ratings are shown faintly. Agree or adjust, then give an overall rating.</p>}
      <div className="app-table">
        <div className="app-row app-head"><span>Area</span><span>{a.role === "staff" ? "My rating" : "Self"}</span><span>{a.can_self ? "" : "Appraiser"}</span></div>
        {areas.map((c) => (
          <div key={c.key} className="app-row">
            <span className="app-area"><Icon name={c.icon} size={15} /><span><strong>{c.label}</strong><span className="muted small">{c.hint}</span></span></span>
            {a.can_self ? <ScorePicker value={scores[c.key]} onChange={(v) => { const s = { ...scores }; if (v) s[c.key] = v; else delete s[c.key]; setScores(s); }} />
              : <span>{a.self_scores[c.key] ? <LevelChip v={a.self_scores[c.key]} label={false} /> : "–"}</span>}
            {a.can_review ? <ScorePicker value={scores[c.key]} compare={a.self_scores[c.key]} onChange={(v) => { const s = { ...scores }; if (v) s[c.key] = v; else delete s[c.key]; setScores(s); }} />
              : !a.can_self && <span>{a.scores[c.key] ? <LevelChip v={a.scores[c.key]} label={false} /> : "–"}</span>}
          </div>
        ))}
      </div>
      {!a.can_self && a.self_comment && <div className="note-section"><h4>{a.person.name.split(" ").slice(-1)}'s reflection</h4><p>{a.self_comment}</p></div>}
      {editing ? (
        <Field label={a.can_self ? "My reflection on the year" : "Appraiser's summary"}><textarea rows={3} value={comment} onChange={(e) => setComment(e.target.value)} /></Field>
      ) : a.appraiser_comment && <div className="note-section"><h4>Appraiser's summary</h4><p>{a.appraiser_comment}</p></div>}
      {a.can_review ? (
        <div className="overall-pick"><strong>Overall rating</strong><ScorePicker value={overall} onChange={setOverall} />{overall && <span>{LEVEL_LOOK[overall].label}</span>}</div>
      ) : a.overall != null && <p className="obs-avg">Overall <LevelChip v={a.overall} /></p>}
      <h4 className="goals-title"><Icon name="target" size={16} />Goals for the year</h4>
      <GoalsEditor goals={goals} onChange={setGoals} editable={editing} />
      {!editing && a.can_goals && goalsChanged && <div className="row"><span className="grow" /><button className="primary" disabled={busy} onClick={() => run(async () => { load(await grow.goals(a.id, goals)); onChanged(); })}>Save progress</button></div>}
      {a.staff_comment && <div className="note-section"><h4>Staff member's comment</h4><p>{a.staff_comment}</p></div>}
      {(a.staff_signed_at || a.appraiser_signed_at) && (
        <p className="signatures">
          <span className={a.staff_signed_at ? "on" : ""}><Icon name={a.staff_signed_at ? "circle-check" : "hourglass"} size={15} />Staff member {a.staff_signed_at ? `signed ${niceDate(a.staff_signed_at.slice(0, 10))}` : "to sign"}</span>
          <span className={a.appraiser_signed_at ? "on" : ""}><Icon name={a.appraiser_signed_at ? "circle-check" : "hourglass"} size={15} />Appraiser {a.appraiser_signed_at ? `signed ${niceDate(a.appraiser_signed_at.slice(0, 10))}` : "to sign"}</span>
        </p>
      )}
      {a.can_sign && a.role === "staff" && <Field label="Your comment before signing (optional)"><textarea rows={2} value={sig} onChange={(e) => setSig(e.target.value)} /></Field>}
      {error && <p className="error">{error}</p>}
      <div className="row wrap"><span className="grow" />
        {editing && <button disabled={busy} onClick={() => save(false)}>Save for later</button>}
        {editing && <button className="primary with-icon" disabled={busy} onClick={() => save(true)}><Icon name="send" size={16} />{a.can_self ? "Send to my appraiser" : "Send for signing"}</button>}
        {a.can_sign && <button className="primary with-icon" disabled={busy} onClick={() => run(async () => { load(await grow.sign(a.id, sig || null)); onChanged(); })}><Icon name="pen-tool" size={16} />Sign</button>}
      </div>
    </Modal>
  );
}

// ---------- Training ----------

export function CpdForm({ schoolId, people, record, many = false, onClose, onDone }: {
  schoolId: string; people?: Card[]; record?: Cpd | null; many?: boolean; onClose: () => void; onDone: () => void;
}) {
  const meta = useMeta();
  const [f, setF] = useState<CpdIn>({ title: record?.title ?? "", provider: record?.provider ?? "", kind: record?.kind ?? (many ? "in_school" : "workshop"),
    on_date: record?.on_date ?? iso(new Date()), hours: record?.hours ?? 2, notes: record?.notes ?? "", impact: record?.impact ?? "" });
  const [who, setWho] = useState<Set<string>>(new Set());
  const [q, setQ] = useState("");
  const [busy, error, run] = useBusy();
  const shown = (people ?? []).filter((p) => !q || `${p.name} ${p.department_name ?? ""} ${p.job_title ?? ""}`.toLowerCase().includes(q.toLowerCase()));
  function submit(e: FormEvent) {
    e.preventDefault();
    const body = { ...f, provider: f.provider || null, notes: f.notes || null, impact: f.impact || null, ...(many ? { user_ids: [...who] } : {}) };
    run(async () => { if (record) await grow.editCpd(record.id, body); else await grow.addCpd(schoolId, body); onDone(); });
  }
  return (
    <Modal title={record ? "Training record" : many ? "Record training for staff" : "Log my training"} onClose={onClose}>
      <form className="stack" onSubmit={submit}>
        <div className="cpd-kinds">
          {meta && Object.entries(meta.cpd_kinds).map(([k, label]) => { const l = CPD_LOOK[k] ?? CPD_LOOK.other; return (
            <button key={k} type="button" className={`mark-choice${f.kind === k ? " on" : ""}`} style={hue(l.hue)} onClick={() => setF({ ...f, kind: k })}>
              <Glyph icon={l.icon} hue={l.hue} size={28} soft={f.kind !== k} />{label}
            </button>); })}
        </div>
        <Field label="Title"><input required minLength={2} maxLength={200} value={f.title} onChange={(e) => setF({ ...f, title: e.target.value })} placeholder="e.g. Jolly Phonics training" /></Field>
        <div className="row wrap">
          <Field label="Run by (optional)"><input value={f.provider ?? ""} maxLength={120} onChange={(e) => setF({ ...f, provider: e.target.value })} placeholder="e.g. SUBEB, British Council" /></Field>
          <Field label="Date"><input type="date" required value={f.on_date} onChange={(e) => setF({ ...f, on_date: e.target.value })} /></Field>
          <Field label="Hours"><input type="number" required min={0.5} max={500} step={0.5} value={f.hours} onChange={(e) => setF({ ...f, hours: Number(e.target.value) })} /></Field>
        </div>
        <Field label="What I learned (optional)"><textarea rows={2} value={f.notes ?? ""} onChange={(e) => setF({ ...f, notes: e.target.value })} /></Field>
        <Field label="What I'll change in my teaching (optional)" hint="This is what turns training into better lessons."><textarea rows={2} value={f.impact ?? ""} onChange={(e) => setF({ ...f, impact: e.target.value })} /></Field>
        {many && people && (
          <div className="who-pick">
            <div className="row wrap"><strong>Who attended? ({who.size})</strong><span className="grow" />
              <button type="button" className="text-link" onClick={() => setWho(new Set(people.map((p) => p.user_id)))}>Everyone</button>
              <button type="button" className="text-link" onClick={() => setWho(new Set(people.filter((p) => p.teaching).map((p) => p.user_id)))}>All teachers</button>
              <button type="button" className="text-link" onClick={() => setWho(new Set())}>Nobody</button></div>
            <input placeholder="Find…" value={q} onChange={(e) => setQ(e.target.value)} />
            <div className="who-list">
              {shown.map((p) => (
                <label key={p.user_id} className={`chip pick${who.has(p.user_id) ? " on" : ""}`}>
                  <input type="checkbox" checked={who.has(p.user_id)} onChange={(e) => { const s = new Set(who); if (e.target.checked) s.add(p.user_id); else s.delete(p.user_id); setWho(s); }} />{p.name}
                </label>
              ))}
            </div>
          </div>
        )}
        {error && <p className="error">{error}</p>}
        <div className="row"><span className="grow" />
          {record?.can_edit && <button type="button" className="danger-hover" onClick={() => run(async () => { await grow.removeCpd(record.id); onDone(); })}>Delete</button>}
          <button type="button" onClick={onClose}>Cancel</button>
          <button className="primary" disabled={busy || (many && who.size === 0)}>{many ? `Record for ${who.size}` : "Save"}</button></div>
      </form>
    </Modal>
  );
}

// ---------- Kudos ----------

export function KudosForm({ schoolId, people, me, to, onClose, onDone }: { schoolId: string; people: Card[]; me: string; to?: string; onClose: () => void; onDone: () => void }) {
  const meta = useMeta();
  const [toId, setTo] = useState(to ?? "");
  const [badge, setBadge] = useState("great_lesson");
  const [msg, setMsg] = useState("");
  const [busy, error, run] = useBusy();
  const ideas: Record<string, string> = {
    above_beyond: "Thank you for staying late to…", great_lesson: "I saw your lesson on… and…", team_player: "Thank you for covering…",
    student_champion: "You noticed … and helped them…", innovator: "Your idea of … is working so well", reliable: "Always there when…",
    mentor: "You helped me…", kind_heart: "Thank you for…", spirit: "The … was brilliant because of you",
  };
  return (
    <Modal title="Give kudos" onClose={onClose}>
      <form className="stack" onSubmit={(e) => { e.preventDefault(); run(async () => { await grow.giveKudos(schoolId, { to_id: toId, badge, message: msg }); onDone(); }); }}>
        <PersonSelect people={people} value={toId} onChange={setTo} exclude={[me]} label="Who for?" />
        <div className="badge-pick">
          {meta && Object.entries(meta.badges).map(([k, label]) => { const l = BADGE_LOOK[k]; return (
            <button key={k} type="button" className={`badge-choice${badge === k ? " on" : ""}`} style={hue(l.hue)} onClick={() => setBadge(k)}>
              <span aria-hidden="true">{l.emoji}</span>{label}
            </button>); })}
        </div>
        <Field label="Your message"><textarea required minLength={3} maxLength={400} rows={3} value={msg} placeholder={ideas[badge]} onChange={(e) => setMsg(e.target.value)} /></Field>
        <p className="muted small">Kudos show on the recognition wall for all staff.</p>
        {error && <p className="error">{error}</p>}
        <div className="row"><span className="grow" /><button type="button" onClick={onClose}>Cancel</button>
          <button className="primary with-icon" disabled={busy || !toId}><Icon name="send" size={16} />Send kudos</button></div>
      </form>
    </Modal>
  );
}

// ---------- Mentoring ----------

export function MentoringForm({ schoolId, people, mentee, mentor, focus, onClose, onDone }: {
  schoolId: string; people: Card[]; mentee?: string; mentor?: string; focus?: string; onClose: () => void; onDone: () => void;
}) {
  const [f, setF] = useState({ mentor_id: mentor ?? "", mentee_id: mentee ?? "", focus: focus ?? "" });
  const [busy, error, run] = useBusy();
  return (
    <Modal title="Start mentoring" onClose={onClose}>
      <form className="stack" onSubmit={(e) => { e.preventDefault(); run(async () => { await grow.addMentoring(schoolId, f); onDone(); }); }}>
        <PersonSelect people={people} value={f.mentee_id} onChange={(v) => setF({ ...f, mentee_id: v })} label="Mentee (who is supported)" />
        <PersonSelect people={people} value={f.mentor_id} onChange={(v) => setF({ ...f, mentor_id: v })} exclude={[f.mentee_id]} label="Mentor" />
        <Field label="Focus"><input required minLength={2} maxLength={200} value={f.focus} onChange={(e) => setF({ ...f, focus: e.target.value })} placeholder="e.g. Questioning, settling in, class control" /></Field>
        {error && <p className="error">{error}</p>}
        <div className="row"><span className="grow" /><button type="button" onClick={onClose}>Cancel</button><button className="primary" disabled={busy}>Start</button></div>
      </form>
    </Modal>
  );
}

export function MentoringView({ m, onClose, onChanged }: { m: Mentoring; onClose: () => void; onChanged: (m: Mentoring) => void }) {
  const [note, setNote] = useState("");
  const [date, setDate] = useState(iso(new Date()));
  const [busy, error, run] = useBusy();
  return (
    <Modal title={`Mentoring: ${m.focus}`} onClose={onClose}>
      <div className="mentor-pair">
        <PersonLine p={m.mentor} sub="Mentor" /><Icon name="chevron-right" size={20} /><PersonLine p={m.mentee} sub="Mentee" />
      </div>
      <p className="muted small">Since {niceDate(m.started_on, { day: "numeric", month: "long", year: "numeric" })} · {m.meetings.length} meeting{m.meetings.length === 1 ? "" : "s"}{m.status === "ended" ? " · ended" : ""}</p>
      <ul className="meetings">
        {m.meetings.map((x, i) => <li key={i}><span className="date-chip">{niceDate(x.date, { day: "numeric", month: "short" })}</span><p>{x.note}<span className="muted small"> · {x.by}</span></p></li>)}
        {m.meetings.length === 0 && <li className="muted small">No meetings logged yet.</li>}
      </ul>
      {m.can_log && m.status === "active" && (
        <form className="stack" onSubmit={(e) => { e.preventDefault(); run(async () => { onChanged(await grow.addMeeting(m.id, date, note)); setNote(""); }); }}>
          <div className="row wrap"><Field label="Date"><input type="date" value={date} onChange={(e) => setDate(e.target.value)} /></Field></div>
          <Field label="What we did and agreed"><textarea rows={2} required minLength={2} value={note} onChange={(e) => setNote(e.target.value)} /></Field>
          {error && <p className="error">{error}</p>}
          <div className="row"><span className="grow" />
            {m.can_end && <button type="button" onClick={() => run(async () => onChanged(await grow.endMentoring(m.id)))}>End mentoring</button>}
            <button className="primary" disabled={busy}>Log meeting</button></div>
        </form>
      )}
      {m.status === "ended" && m.can_end && <div className="row"><span className="grow" /><button onClick={() => run(async () => onChanged(await grow.endMentoring(m.id)))}>Restart</button></div>}
    </Modal>
  );
}

export function usePeople(schoolId: string): { people: Card[]; reload: () => void } {
  const [people, setPeople] = useState<Card[]>([]);
  const [n, setN] = useState(0);
  useEffect(() => { grow.people(schoolId).then((r) => setPeople(r.people)).catch(() => {}); }, [schoolId, n]);
  return useMemo(() => ({ people, reload: () => setN((x) => x + 1) }), [people]);
}

export function Who({ p }: { p: Card }) {
  return <span className="who-inline"><Avatar name={p.name} size={22} />{p.name}</span>;
}
