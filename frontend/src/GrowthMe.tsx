// Growth on the staff portal: the weekly check-in, my growth, kudos, things to sign or review, mentoring.
import { useCallback, useEffect, useState } from "react";
import { APP_STATUS, grow, MOOD, type Appraisal, type Kudos, type MyGrowth, type MyPulse, type Observation } from "./growthApi";
import { KudosItem, Ring, useBusy } from "./GrowthBits";
import { AppraisalModal, CpdForm, KudosForm, MentoringView, ObservationForm, ObservationView, usePeople } from "./GrowthForms";
import { ObsCard } from "./Growth";
import Icon from "./Icon";
import { href } from "./router";
import { Avatar, Field, Glyph, hue, Modal } from "./ui";

const WORK = ["Very light", "Light", "About right", "Heavy", "Too much"];
const SUPPORT = ["Not at all", "A little", "Somewhat", "Mostly", "Fully"];

export function CheckInCard({ schoolId }: { schoolId: string }) {
  const [p, setP] = useState<MyPulse | null>(null);
  const [editing, setEditing] = useState(false);
  const [mood, setMood] = useState<number | null>(null);
  const [work, setWork] = useState(3);
  const [sup, setSup] = useState(4);
  const [chat, setChat] = useState(false);
  const [note, setNote] = useState("");
  const [busy, error, run] = useBusy();
  useEffect(() => { grow.myPulse(schoolId).then((x) => { setP(x); const t = x.this_week; if (t) { setMood(t.mood); setWork(t.workload); setSup(t.supported); setChat(t.wants_chat); setNote(t.note ?? ""); } }).catch(() => {}); }, [schoolId]);
  if (!p) return null;
  const done = p.this_week && !editing;
  const m = done ? MOOD[p.this_week!.mood - 1] : mood ? MOOD[mood - 1] : null;
  return (
    <section className="card editor portal-card checkin" style={hue(m?.hue ?? "rose")}>
      <div className="card-head"><h2 className="with-glyph"><Glyph icon="heart-pulse" hue={m?.hue ?? "rose"} size={34} />Weekly check-in</h2></div>
      {done ? (
        <>
          <p className="checkin-done"><span className="mood-big">{m!.emoji}</span><span><strong>Thanks! You're feeling “{m!.label.toLowerCase()}” this week.</strong>
            <span className="muted small">Only totals are shared with the school, never your answers.</span></span></p>
          <div className="mood-history" aria-label="Your last weeks">
            {p.history.map((h) => <span key={h.week_start} title={h.week_start} style={hue(MOOD[h.mood - 1].hue)}>{MOOD[h.mood - 1].emoji}</span>)}
          </div>
          <button className="text-link" onClick={() => setEditing(true)}>Change my answer</button>
        </>
      ) : (
        <>
          <p className="small">How are you, really? Two taps. <span className="muted">Private: the school only sees totals.</span></p>
          <div className="mood-pick" role="radiogroup" aria-label="Mood">
            {MOOD.map((x) => (
              <button key={x.v} type="button" role="radio" aria-checked={mood === x.v} className={mood === x.v ? "on" : ""} style={hue(x.hue)} onClick={() => setMood(x.v)}>
                <span>{x.emoji}</span><small>{x.label}</small>
              </button>
            ))}
          </div>
          {mood && (
            <div className="stack">
              <Field label={`My workload this week: ${WORK[work - 1]}`}><input type="range" min={1} max={5} value={work} onChange={(e) => setWork(Number(e.target.value))} /></Field>
              <Field label={`I feel supported: ${SUPPORT[sup - 1]}`}><input type="range" min={1} max={5} value={sup} onChange={(e) => setSup(Number(e.target.value))} /></Field>
              <label className="check"><input type="checkbox" checked={chat} onChange={(e) => setChat(e.target.checked)} />I'd like someone to check in with me (shares my name with the principal)</label>
              <Field label="A private note to myself (optional)"><input value={note} maxLength={500} onChange={(e) => setNote(e.target.value)} placeholder="Only you can see this" /></Field>
              {error && <p className="error">{error}</p>}
              <div className="row"><span className="grow" /><button className="primary" disabled={busy}
                onClick={() => run(async () => { setP(await grow.savePulse(schoolId, { mood, workload: work, supported: sup, wants_chat: chat, note: note || null })); setEditing(false); })}>Save</button></div>
            </div>
          )}
        </>
      )}
    </section>
  );
}

export function MyGrowthCard({ schoolId, meId, onChanged }: { schoolId: string; meId: string; onChanged?: () => void }) {
  const [g, setG] = useState<MyGrowth | null>(null);
  const [modal, setModal] = useState<null | "cpd" | "sign" | "review" | "appraisal" | "observe" | { mentoring: string }>(null);
  const load = useCallback(() => { grow.me(schoolId).then(setG).catch(() => {}); }, [schoolId]);
  useEffect(load, [load]);
  const { people } = usePeople(schoolId);
  if (!g) return null;
  const app = g.appraisal;
  const appLook = app ? APP_STATUS[app.status] : null;
  const appAction = app && ((app.status === "self") || (app.status === "sign" && !app.staff_signed));
  const prog = app && app.goals.length ? Math.round(app.goals.reduce((s, x) => s + x.progress, 0) / app.goals.length) : null;
  const done = () => { setModal(null); load(); onChanged?.(); };
  return (
    <section className="card editor portal-card wide-card my-growth" style={hue("lime")}>
      <div className="card-head"><h2 className="with-glyph"><Glyph icon="growth" hue="lime" size={34} />My growth</h2><span className="grow" />
        <a className="button primary-link" href={href({ page: "passport", school: schoolId, id: meId })}><Icon name="sparkle" size={16} />My growth passport</a></div>
      <div className="my-growth-figs">
        <div style={hue("teal")}><Ring value={g.cpd_hours} max={g.cpd_target} size={58} stroke={7} label={<b>{Math.round(g.cpd_hours)}</b>} />
          <span><strong>{g.cpd_hours} of {g.cpd_target} h</strong><span className="muted small">training this year</span>
            <button className="text-link small" onClick={() => setModal("cpd")}>+ Log training</button></span></div>
        <div style={hue(appLook?.hue ?? "slate")}><Glyph icon={appLook?.icon ?? "clipboard-list"} hue={appLook?.hue ?? "slate"} size={46} />
          <span><strong>{app ? `Appraisal: ${appLook!.label.toLowerCase()}` : "No appraisal yet"}</strong>
            <span className="muted small">{app ? `${app.period_label}${prog != null ? ` · goals ${prog}% done` : ""}` : "The principal starts these"}</span>
            {app && <button className={appAction ? "small primary" : "text-link small"} onClick={() => setModal("appraisal")}>{app.status === "self" ? "Do my self-review" : app.status === "sign" && !app.staff_signed ? "Read and sign" : "Open"}</button>}</span></div>
        <div style={hue("pink")}><Glyph icon="heart" hue="pink" size={46} /><span><strong>{g.kudos} kudos</strong><span className="muted small">from colleagues</span></span></div>
      </div>
      {(g.observations_to_sign > 0 || g.appraisals_to_review > 0 || g.observations_to_finish > 0) && (
        <div className="todo-list">
          {g.observations_to_sign > 0 && <button className="todo" style={hue("amber")} onClick={() => setModal("sign")}><Icon name="pen-tool" size={16} />{g.observations_to_sign} observation{g.observations_to_sign === 1 ? "" : "s"} of my lessons to read and sign<Icon name="chevron-right" size={16} /></button>}
          {g.appraisals_to_review > 0 && <button className="todo" style={hue("violet")} onClick={() => setModal("review")}><Icon name="clipboard-list" size={16} />{g.appraisals_to_review} appraisal{g.appraisals_to_review === 1 ? "" : "s"} waiting for me as appraiser<Icon name="chevron-right" size={16} /></button>}
          {g.observations_to_finish > 0 && <button className="todo" style={hue("sky")} onClick={() => setModal("sign")}><Icon name="eye" size={16} />{g.observations_to_finish} observation{g.observations_to_finish === 1 ? "" : "s"} I planned or started<Icon name="chevron-right" size={16} /></button>}
        </div>
      )}
      <div className="row wrap">
        {g.can_observe && <button className="with-icon" onClick={() => setModal("observe")}><Icon name="eye" size={16} />Observe a lesson</button>}
        {g.mentoring.map((m) => (
          <button key={m.id} className="with-icon" onClick={() => setModal({ mentoring: m.id })}><Icon name="handshake" size={16} />
            {m.mentor.user_id === meId ? `Mentoring ${m.mentee.name}` : `Mentored by ${m.mentor.name}`}</button>
        ))}
      </div>
      {modal === "cpd" && <CpdForm schoolId={schoolId} onClose={() => setModal(null)} onDone={done} />}
      {modal === "appraisal" && app && <AppraisalModal id={app.id} onClose={() => setModal(null)} onChanged={load} />}
      {modal === "sign" && <MyObservations schoolId={schoolId} meId={meId} onClose={done} />}
      {modal === "review" && <ToAppraise schoolId={schoolId} meId={meId} onClose={done} />}
      {modal === "observe" && <ObservationForm schoolId={schoolId} people={people} onClose={() => setModal(null)} onDone={done} />}
      {modal && typeof modal === "object" && (() => { const m = g.mentoring.find((x) => x.id === modal.mentoring); return m ? <MentoringView m={m} onClose={() => setModal(null)} onChanged={() => load()} /> : null; })()}
    </section>
  );
}

function MyObservations({ schoolId, meId, onClose }: { schoolId: string; meId: string; onClose: () => void }) {
  const { people } = usePeople(schoolId);
  const [list, setList] = useState<Observation[]>([]);
  const [open, setOpen] = useState<Observation | null>(null);
  const [edit, setEdit] = useState<Observation | null>(null);
  const load = useCallback(() => { grow.observations(schoolId).then(setList).catch(() => {}); }, [schoolId]);
  useEffect(load, [load]);
  const mine = list.filter((o) => o.teacher.user_id === meId);
  const byMe = list.filter((o) => o.observer_id === meId && o.teacher.user_id !== meId);
  return (
    <Modal title="Lesson observations" onClose={onClose}>
      <h4 className="goals-title"><Icon name="eye" size={16} />Of my lessons</h4>
      {mine.length === 0 ? <p className="muted small">None shared with you yet.</p> : <div className="obs-grid compact">{mine.map((o) => <ObsCard key={o.id} o={o} onOpen={() => setOpen(o)} />)}</div>}
      {byMe.length > 0 && <><h4 className="goals-title"><Icon name="clipboard-list" size={16} />That I did</h4>
        <div className="obs-grid compact">{byMe.map((o) => <ObsCard key={o.id} o={o} onOpen={() => (o.status === "planned" ? setEdit(o) : setOpen(o))} />)}</div></>}
      {open && <ObservationView o={open} onClose={() => setOpen(null)} onChanged={() => { setOpen(null); load(); }} onEdit={() => { setEdit(open); setOpen(null); }} />}
      {edit && <ObservationForm schoolId={schoolId} people={people} obs={edit} onClose={() => setEdit(null)} onDone={() => { setEdit(null); load(); }} />}
    </Modal>
  );
}

function ToAppraise({ schoolId, meId, onClose }: { schoolId: string; meId: string; onClose: () => void }) {
  const [list, setList] = useState<Appraisal[]>([]);
  const [open, setOpen] = useState<string | null>(null);
  const load = useCallback(() => { grow.appraisals(schoolId).then((d) => setList(d.appraisals.filter((a) => a.appraiser_id === meId && a.person.user_id !== meId))).catch(() => {}); }, [schoolId, meId]);
  useEffect(load, [load]);
  return (
    <Modal title="Appraisals I'm doing" onClose={onClose}>
      <div className="app-list">
        {list.map((a) => { const st = APP_STATUS[a.status]; return (
          <button key={a.id} className="app-item compact" onClick={() => setOpen(a.id)}>
            <span className="who-inline"><Avatar name={a.person.name} size={30} /><strong>{a.person.name}</strong></span>
            <span className="hue-chip" style={hue(st.hue)}><Icon name={st.icon} size={12} />{st.label}</span>
            {(a.can_review || a.can_sign) && <span className="hue-chip" style={hue("rose")}>Your turn</span>}
          </button>); })}
      </div>
      {open && <AppraisalModal id={open} onClose={() => setOpen(null)} onChanged={load} />}
    </Modal>
  );
}

export function KudosCard({ schoolId, meId }: { schoolId: string; meId: string }) {
  const { people } = usePeople(schoolId);
  const [list, setList] = useState<Kudos[]>([]);
  const [giving, setGiving] = useState(false);
  const load = useCallback(() => { grow.kudos(schoolId, undefined, 4).then(setList).catch(() => {}); }, [schoolId]);
  useEffect(load, [load]);
  return (
    <section className="card editor portal-card" style={hue("pink")}>
      <div className="card-head"><h2 className="with-glyph"><Glyph icon="trophy" hue="pink" size={34} />Kudos</h2><span className="grow" />
        <button className="primary with-icon" onClick={() => setGiving(true)}><Icon name="heart" size={15} />Give</button></div>
      <p className="small muted">Thank a colleague. It shows on the school's recognition wall.</p>
      <div className="kudos-stack">{list.slice(0, 3).map((k) => <KudosItem key={k.id} k={k} compact onChanged={load} />)}</div>
      {giving && <KudosForm schoolId={schoolId} people={people} me={meId} onClose={() => setGiving(false)} onDone={() => { setGiving(false); load(); }} />}
    </section>
  );
}
