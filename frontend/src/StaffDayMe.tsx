// The staff member's own working day, on their portal: sign in, leave, duties and lesson notes.
import { useCallback, useEffect, useState, type FormEvent } from "react";
import { errorText } from "./api";
import { clock, day, dutyLook, hm, iso, niceDate, NOTE_STATUS, STATUS_LOOK, type Leave, type MyDay, type MySubject, type Note, type NoteIn } from "./dayApi";
import Icon from "./Icon";
import { href } from "./router";
import { LeaveCard, LeaveForm, NoteCard, NotesReview, NoteView } from "./StaffDay";
import { Empty, Field, Glyph, hue, Modal } from "./ui";

/** Big "I'm in" card at the top of the portal. */
export function MyDayCard({ schoolId }: { schoolId: string }) {
  const [d, setD] = useState<MyDay | null>(null);
  const [busy, setBusy] = useState(false);
  const [msg, setMsg] = useState("");
  const [error, setError] = useState("");
  const load = useCallback(() => { day.myDay(schoolId).then(setD).catch(() => {}); }, [schoolId]);
  useEffect(load, [load]);
  if (!d) return null;
  const signedIn = !!d.time_in, out = !!d.time_out;
  const look = STATUS_LOOK[d.status] ?? STATUS_LOOK.not_in;
  async function sign() {
    setBusy(true); setError(""); setMsg("");
    const send = async (pos: { latitude?: number; longitude?: number }) => {
      try { const s = await day.sign(schoolId, pos); setMsg(s.message); load(); } catch (e) { setError(errorText(e)); } finally { setBusy(false); }
    };
    if (d!.needs_location) {
      if (!navigator.geolocation) { setError("This phone can't share its location."); setBusy(false); return; }
      navigator.geolocation.getCurrentPosition((p) => send({ latitude: p.coords.latitude, longitude: p.coords.longitude }),
        () => { setError("Allow location for this site so we can check you are at school."); setBusy(false); },
        { enableHighAccuracy: true, timeout: 15000 });
    } else send({});
  }
  return (
    <section className={`card my-day s-${d.status}`} style={hue(look.hue)}>
      <div className="my-day-main">
        <Glyph icon={signedIn ? (out ? "log-out" : look.icon) : d.status === "leave" ? "palm-tree" : "log-in"} hue={look.hue} size={58} />
        <div className="grow">
          <p className="my-day-date">{niceDate(d.on_date, { weekday: "long", day: "numeric", month: "long" })}</p>
          <h2>{d.status === "leave" ? "You're on leave today" : out ? `Signed out at ${clock(d.time_out)}` : signedIn
            ? `Signed in at ${clock(d.time_in)}${d.status === "late" ? " (late)" : ""}` : d.work_day ? "You haven't signed in yet" : "Not a work day"}</h2>
          <p className="small muted">{!signedIn && d.work_day ? `Sign in before ${hm(d.late_after)} to be on time. ` : ""}
            {d.allow_self ? (d.needs_location ? "Your phone checks you're at school." : "") : "Scan your ID card at the gate."}</p>
        </div>
        {d.allow_self && d.status !== "leave" && !out && (
          <button className={`my-day-button${signedIn ? " out" : ""}`} disabled={busy} onClick={sign}>
            <Icon name={signedIn ? "log-out" : "log-in"} size={22} stroke={2.4} />{busy ? "Checking…" : signedIn ? "Sign out" : "I'm in"}
          </button>
        )}
      </div>
      {(msg || error) && <p className={error ? "error" : "saved-note"}>{error || msg}</p>}
      {d.recent.length > 0 && (
        <div className="my-day-recent" aria-label="Last few work days">
          {[...d.recent].reverse().map((r) => {
            const l = STATUS_LOOK[r.status] ?? STATUS_LOOK.absent;
            return <span key={r.date} className="recent-dot" style={hue(l.hue)} title={`${niceDate(r.date)}: ${l.label}${r.time_in ? ` at ${r.time_in}` : ""}`}>
              <i /><small>{niceDate(r.date, { weekday: "narrow" })}</small></span>;
          })}
          <span className="muted small">last {d.recent.length} work days</span>
        </div>
      )}
    </section>
  );
}

export function MyLeaveCard({ schoolId }: { schoolId: string }) {
  const [list, setList] = useState<Leave[]>([]);
  const [asking, setAsking] = useState(false);
  const load = useCallback(() => { day.leave(schoolId, true).then(setList).catch(() => {}); }, [schoolId]);
  useEffect(load, [load]);
  const today = iso(new Date());
  const open = list.filter((l) => (l.status === "pending" || l.status === "approved") && l.ends_on >= today);
  return (
    <section className="card editor portal-card" style={hue("violet")}>
      <div className="card-head"><h2 className="with-glyph"><Glyph icon="palm-tree" hue="violet" size={34} />My leave</h2></div>
      {open.length === 0 ? <p className="small muted">No leave booked. Ask here and the principal decides; you'll see the answer on this card.</p> : (
        <div className="leave-list compact">{open.slice(0, 3).map((l) => (
          <LeaveCard key={l.id} l={l} actions={l.status === "pending" ? <button className="text-link" onClick={async () => { await day.cancelLeave(l.id); load(); }}>Withdraw</button> : undefined} />
        ))}</div>
      )}
      <div className="row wrap"><button className="primary with-icon" onClick={() => setAsking(true)}><Icon name="send" size={16} />Ask for leave</button>
        {list.length > open.length && <span className="muted small">{list.length - open.length} past</span>}</div>
      {asking && <LeaveForm schoolId={schoolId} onClose={() => setAsking(false)} onDone={() => { setAsking(false); load(); }} />}
    </section>
  );
}

export function MyDutiesCard({ duties }: { duties: { duty: string; on_date: string; note: string | null }[] }) {
  const today = iso(new Date());
  const grouped = new Map<string, string[]>();
  for (const d of duties) grouped.set(d.duty, [...(grouped.get(d.duty) ?? []), d.on_date]);
  return (
    <section className="card editor portal-card" style={hue("teal")}>
      <div className="card-head"><h2 className="with-glyph"><Glyph icon="shield-check" hue="teal" size={34} />My duties</h2></div>
      {duties.length === 0 ? <Empty icon="shield-check">No duties in the next two weeks.</Empty> : (
        <ul className="my-duties">
          {[...grouped].map(([duty, dates]) => {
            const l = dutyLook(duty, []);
            return (
              <li key={duty} style={hue(l.hue)}>
                <Glyph icon={l.icon} hue={l.hue} size={32} />
                <span><strong>{duty}{dates.includes(today) && <span className="hue-chip today-chip" style={hue("rose")}>Today</span>}</strong>
                  <span className="small muted">{dates.length > 2 ? `${niceDate(dates[0])} → ${niceDate(dates[dates.length - 1])} (${dates.length} days)` : dates.map((x) => niceDate(x)).join(", ")}</span></span>
              </li>
            );
          })}
        </ul>
      )}
    </section>
  );
}

export function MyNotesCard({ schoolId, returned }: { schoolId: string; returned: number }) {
  const [list, setList] = useState<Note[] | null>(null);
  const [editing, setEditing] = useState<Note | "new" | null>(null);
  const [viewing, setViewing] = useState<Note | null>(null);
  const load = useCallback(() => { day.notes(schoolId, "mine").then(setList).catch(() => setList([])); }, [schoolId]);
  useEffect(load, [load]);
  const counts = (list ?? []).reduce<Record<string, number>>((a, n) => ({ ...a, [n.status]: (a[n.status] ?? 0) + 1 }), {});
  return (
    <section className="card editor portal-card wide-card" style={hue("green")}>
      <div className="card-head"><h2 className="with-glyph"><Glyph icon="notebook" hue="green" size={34} />My lesson notes</h2>
        <span className="grow" /><button className="primary with-icon" onClick={() => setEditing("new")}><Icon name="plus" size={16} />New</button></div>
      {returned > 0 && <p className="day-banner" style={hue("rose")}><Icon name="undo" size={16} />{returned} note{returned === 1 ? " was" : "s were"} sent back for changes.</p>}
      <div className="chips">{Object.entries(NOTE_STATUS).filter(([k]) => counts[k]).map(([k, v]) => <span key={k} className="hue-chip" style={hue(v.hue)}><Icon name={v.icon} size={12} />{counts[k]} {v.label.toLowerCase()}</span>)}</div>
      {list && list.length === 0 && <Empty icon="notebook">Write your lesson notes and schemes of work here. Your HOD or the principal reviews them.</Empty>}
      <div className="note-grid">{(list ?? []).slice(0, 6).map((n) => <NoteCard key={n.id} n={n} onOpen={() => (n.can_edit ? setEditing(n) : setViewing(n))} />)}</div>
      {editing && <NoteForm schoolId={schoolId} note={editing === "new" ? null : editing} onClose={() => setEditing(null)} onDone={() => { setEditing(null); load(); }} />}
      {viewing && <NoteView n={viewing} onClose={() => setViewing(null)} />}
    </section>
  );
}

export function ToReviewCard({ schoolId, count, onChanged }: { schoolId: string; count: number; onChanged: () => void }) {
  const [open, setOpen] = useState(false);
  return (
    <section className="card editor portal-card" style={hue("amber")}>
      <div className="card-head"><h2 className="with-glyph"><Glyph icon="inbox" hue="amber" size={34} />Lesson notes to review</h2></div>
      <p className="review-count"><strong>{count}</strong> waiting for you</p>
      <button className="primary with-icon" onClick={() => setOpen(true)}><Icon name="clipboard" size={16} />Review notes</button>
      {open && (
        <Modal title="Lesson notes to review" onClose={() => { setOpen(false); onChanged(); }}>
          <NotesReview schoolId={schoolId} view="review" />
        </Modal>
      )}
    </section>
  );
}

export function LeaveWaitingCard({ schoolId, count }: { schoolId: string; count: number }) {
  return (
    <section className="card editor portal-card" style={hue("violet")}>
      <div className="card-head"><h2 className="with-glyph"><Glyph icon="palm-tree" hue="violet" size={34} />Leave requests</h2></div>
      <p className="review-count"><strong>{count}</strong> waiting for a decision</p>
      <a className="button primary-link" href={href({ page: "school", id: schoolId, tab: "staff-day" })}><Icon name="user-check" size={16} />Open staff day</a>
    </section>
  );
}

function NoteForm({ schoolId, note, onClose, onDone }: { schoolId: string; note: Note | null; onClose: () => void; onDone: () => void }) {
  const [subjects, setSubjects] = useState<MySubject[]>([]);
  const [f, setF] = useState<NoteIn>({
    kind: note?.kind ?? "note", subject_id: note?.subject_id ?? "", level: note?.level ?? "", week_starting: note?.week_starting ?? null,
    term_label: note?.term_label ?? null, topic: note?.topic ?? "", objectives: note?.objectives ?? "", content: note?.content ?? "", submit: false,
  });
  const [error, setError] = useState("");
  useEffect(() => { day.mySubjects(schoolId).then((s) => { setSubjects(s); if (!note && s[0]) setF((x) => ({ ...x, subject_id: s[0].subject_id, level: s[0].level })); }).catch(() => {}); }, [schoolId, note]);
  const pairKey = `${f.subject_id}|${f.level}`;
  async function save(submit: boolean, e?: FormEvent) {
    e?.preventDefault(); setError("");
    const body = { ...f, submit, objectives: f.objectives || null, content: f.content || null, term_label: f.term_label || null, week_starting: f.week_starting || null };
    try { if (note) await day.editNote(note.id, body); else await day.addNote(schoolId, body); onDone(); } catch (err) { setError(errorText(err)); }
  }
  return (
    <Modal title={note ? "Edit lesson note" : "New lesson note"} onClose={onClose}>
      <form className="stack" onSubmit={(e) => save(true, e)}>
        {note?.review_note && <p className="day-banner" style={hue("rose")}><Icon name="undo" size={16} />{note.reviewer}: {note.review_note}</p>}
        <div className="segmented small-seg">
          <button type="button" className={f.kind === "note" ? "on" : ""} onClick={() => setF({ ...f, kind: "note" })}><Icon name="notebook" size={14} />Lesson note</button>
          <button type="button" className={f.kind === "scheme" ? "on" : ""} onClick={() => setF({ ...f, kind: "scheme" })}><Icon name="calendar-range" size={14} />Scheme of work</button>
        </div>
        <Field label="Subject and class level">
          <select required value={pairKey} onChange={(e) => { const [subject_id, level] = e.target.value.split("|"); setF({ ...f, subject_id, level }); }}>
            {subjects.length === 0 && <option value="|">No classes assigned to you yet</option>}
            {subjects.map((s) => <option key={`${s.subject_id}|${s.level}`} value={`${s.subject_id}|${s.level}`}>{s.subject_name} · {s.level}</option>)}
            {note && !subjects.some((s) => `${s.subject_id}|${s.level}` === pairKey) && <option value={pairKey}>{note.subject_name} · {note.level}</option>}
          </select>
        </Field>
        <div className="row wrap">
          {f.kind === "note"
            ? <Field label="Week starting"><input type="date" value={f.week_starting ?? ""} onChange={(e) => setF({ ...f, week_starting: e.target.value || null })} /></Field>
            : <Field label="Term"><input value={f.term_label ?? ""} placeholder="e.g. First term 2026/27" onChange={(e) => setF({ ...f, term_label: e.target.value })} /></Field>}
        </div>
        <Field label="Topic"><input required minLength={2} maxLength={200} value={f.topic} onChange={(e) => setF({ ...f, topic: e.target.value })} placeholder={f.kind === "note" ? "e.g. Separation of mixtures" : "e.g. SS 1 Chemistry, first term"} /></Field>
        <Field label="Objectives"><textarea rows={3} value={f.objectives ?? ""} onChange={(e) => setF({ ...f, objectives: e.target.value })} placeholder="By the end of the lesson, students should be able to…" /></Field>
        <Field label={f.kind === "note" ? "Lesson (introduction, steps, evaluation, assignment)" : "Weeks and topics"}>
          <textarea rows={8} value={f.content ?? ""} onChange={(e) => setF({ ...f, content: e.target.value })} placeholder={f.kind === "note" ? "Introduction…\nStep 1…\nEvaluation…\nAssignment…" : "Week 1: …\nWeek 2: …"} />
        </Field>
        {error && <p className="error">{error}</p>}
        <div className="row"><span className="grow" />
          {note && <button type="button" className="danger-hover" onClick={async () => { await day.removeNote(note.id); onDone(); }}>Delete</button>}
          <button type="button" onClick={() => save(false)}>Save draft</button>
          <button className="primary with-icon"><Icon name="send" size={16} />Send for review</button></div>
      </form>
    </Modal>
  );
}
