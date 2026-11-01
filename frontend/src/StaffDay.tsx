// "Staff day" in the school menu: who is in today, attendance history, leave, the duty rota,
// lesson notes waiting for review, and the sign-in settings (times, location, kiosk link).
import { useCallback, useEffect, useMemo, useState, type FormEvent } from "react";
import QRCode from "qrcode";
import { api, errorText, type StaffMember } from "./api";
import { ImportButton } from "./Bulk";
import {
  addDays, clock, day, DAY_SHORT, dutyLook, hm, iso, LEAVE_KINDS, LEAVE_STATUS, leaveLook, METHOD_LOOK, monday, niceDate,
  NOTE_STATUS, STATUS_LOOK, type Board, type BoardRow, type DaySettings, type Duty, type Leave, type Note, type SummaryRow,
} from "./dayApi";
import Icon from "./Icon";
import { Avatar, Empty, Field, Glyph, hue, IconButton, Modal } from "./ui";

type Seg = "today" | "history" | "leave" | "duties" | "notes" | "settings";
const SEGS: { key: Seg; label: string; icon: string }[] = [
  { key: "today", label: "Today", icon: "user-check" },
  { key: "history", label: "History", icon: "history" },
  { key: "leave", label: "Leave", icon: "palm-tree" },
  { key: "duties", label: "Duty rota", icon: "shield-check" },
  { key: "notes", label: "Lesson notes", icon: "notebook" },
  { key: "settings", label: "Sign-in settings", icon: "settings" },
];

/** "Mrs Adaeze Uzoma" -> "A. Uzoma", so names fit in the rota. */
const shortName = (n: string) => {
  const p = n.replace(/^((mr|mrs|ms|miss|dr|rev|fr|sr|br|prof|chief)\.?\s+)+/i, "").split(" ").filter(Boolean);
  if (p.length < 2) return n;
  return `${p[0][0]}. ${p[p.length - 1]}`;
};

export interface StaffOption { user_id: string; name: string; job_title: string | null }
const staffName = (s: StaffMember) => [s.title, s.full_name].filter(Boolean).join(" ");

export default function StaffDayPage({ schoolId, branchId }: { schoolId: string; branchId: string }) {
  const [seg, setSeg] = useState<Seg>(() => (sessionStorage.getItem("staff-day-seg") as Seg) || "today");
  const [staff, setStaff] = useState<StaffOption[]>([]);
  useEffect(() => {
    api.staff(branchId).then((all) => setStaff(all.map((s) => ({ user_id: s.user_id, name: staffName(s), job_title: s.job_title ?? null }))
      .sort((a, b) => a.name.localeCompare(b.name)))).catch(() => {});
  }, [branchId]);
  const pick = (s: Seg) => { setSeg(s); try { sessionStorage.setItem("staff-day-seg", s); } catch { /* private mode */ } };
  return (
    <div className="staff-day">
      <div className="segmented day-segs" role="tablist">
        {SEGS.map((s) => (
          <button key={s.key} role="tab" aria-selected={seg === s.key} className={seg === s.key ? "on" : ""} onClick={() => pick(s.key)}>
            <Icon name={s.icon} size={16} />{s.label}
          </button>
        ))}
      </div>
      {seg === "today" && <TodayBoard schoolId={schoolId} />}
      {seg === "history" && <History schoolId={schoolId} />}
      {seg === "leave" && <LeaveBoard schoolId={schoolId} staff={staff} />}
      {seg === "duties" && <DutyRota schoolId={schoolId} branchId={branchId} staff={staff} />}
      {seg === "notes" && <NotesReview schoolId={schoolId} view="all" />}
      {seg === "settings" && <SettingsPanel schoolId={schoolId} />}
    </div>
  );
}

// ---------------- Today ----------------

function DateNav({ date, onChange, max }: { date: string; onChange: (d: string) => void; max?: string }) {
  const today = iso(new Date());
  return (
    <div className="date-nav">
      <IconButton icon="chevron-left" label="Day before" onClick={() => onChange(addDays(date, -1))} />
      <label className="date-nav-pick">
        <Icon name="calendar-days" size={16} />
        <strong>{date === today ? "Today" : niceDate(date, { weekday: "long", day: "numeric", month: "long" })}</strong>
        <input type="date" value={date} max={max} onChange={(e) => e.target.value && onChange(e.target.value)} aria-label="Choose a day" />
      </label>
      <IconButton icon="chevron-right" label="Next day" onClick={() => (!max || date < max) && onChange(addDays(date, 1))} />
      {date !== today && <button className="text-link" onClick={() => onChange(today)}>Back to today</button>}
    </div>
  );
}

function Photo({ name, photo, size = 52 }: { name: string; photo: string | null; size?: number }) {
  return photo ? <img className="day-photo" src={photo} alt="" style={{ width: size, height: size }} /> : <Avatar name={name} size={size} />;
}

function TodayBoard({ schoolId }: { schoolId: string }) {
  const today = iso(new Date());
  const [date, setDate] = useState(today);
  const [board, setBoard] = useState<Board | null>(null);
  const [filter, setFilter] = useState("all");
  const [q, setQ] = useState("");
  const [marking, setMarking] = useState<BoardRow | null>(null);
  const [error, setError] = useState("");
  const load = useCallback(() => { day.board(schoolId, date).then(setBoard).catch((e) => setError(errorText(e))); }, [schoolId, date]);
  useEffect(() => { load(); if (date !== today) return; const t = setInterval(load, 30000); return () => clearInterval(t); }, [load, date, today]);
  const c = board?.counts ?? {};
  const inNow = (c.present ?? 0) + (c.late ?? 0);
  const expected = (board?.rows.length ?? 0) - (c.leave ?? 0) - (c.off ?? 0) - (c.excused ?? 0);
  const rows = (board?.rows ?? []).filter((r) => (filter === "all" || r.status === filter || (filter === "in" && ["present", "late"].includes(r.status)))
    && (!q || `${r.name} ${r.job_title ?? ""} ${r.department_name ?? ""}`.toLowerCase().includes(q.toLowerCase())));
  const chips = ["late", "not_in", "absent", "present", "leave", "excused", "off"].filter((k) => c[k]);
  return (
    <section className="day-today">
      <div className="day-toolbar">
        <DateNav date={date} onChange={setDate} max={today} />
        <span className="grow" />
        <button className="with-icon" onClick={load}><Icon name="refresh" size={16} />Refresh</button>
      </div>
      {error && <p className="error">{error}</p>}
      {board && (
        <>
          {!board.work_day && <p className="day-banner" style={hue("slate")}><Icon name="moon" size={18} />This is not a work day. Anyone who signs in still shows here.</p>}
          <div className="stat-strip">
            <div className="stat-tile day-ring-tile" style={hue("green")}>
              <DayRing value={inNow} total={Math.max(expected, inNow)} />
              <div className="stat-text"><strong>{inNow} <small>of {Math.max(expected, inNow)}</small></strong><span>Staff in school</span>
                <span className="stat-note">{expected > 0 ? `${Math.round((inNow / Math.max(expected, inNow)) * 100)}% present` : "No one expected"}</span></div>
            </div>
            <StatusTile k="late" n={c.late ?? 0} note={`after ${board ? "" : ""}the late time`} />
            <StatusTile k={board.day_over ? "absent" : "not_in"} n={(board.day_over ? c.absent : c.not_in) ?? 0} note={board.day_over ? "did not come" : "expected today"} />
            <StatusTile k="leave" n={(c.leave ?? 0) + (c.excused ?? 0)} note="on leave or excused" />
          </div>
          <div className="day-filters">
            <button className={`hue-chip pick-chip${filter === "all" ? " on" : ""}`} style={hue("blue")} onClick={() => setFilter("all")}>Everyone <b>{board.rows.length}</b></button>
            {chips.map((k) => (
              <button key={k} className={`hue-chip pick-chip${filter === k ? " on" : ""}`} style={hue(STATUS_LOOK[k].hue)} onClick={() => setFilter(k)}>
                <Icon name={STATUS_LOOK[k].icon} size={13} />{STATUS_LOOK[k].label} <b>{c[k]}</b>
              </button>
            ))}
            <span className="grow" />
            <input className="day-search" placeholder="Find a name…" value={q} onChange={(e) => setQ(e.target.value)} />
          </div>
          {rows.length === 0 ? <Empty icon="staff">No one here.</Empty> : (
            <div className="day-grid">
              {rows.map((r) => {
                const look = STATUS_LOOK[r.status] ?? STATUS_LOOK.not_in;
                return (
                  <button key={r.user_id} className={`day-person s-${r.status}`} style={hue(look.hue)} onClick={() => setMarking(r)} title="Change or mark">
                    <span className="day-person-photo"><Photo name={r.name} photo={r.photo} /><span className="day-dot"><Icon name={look.icon} size={12} stroke={2.6} /></span></span>
                    <span className="day-person-text">
                      <strong>{r.name}</strong>
                      <span className="muted small">{r.job_title ?? "Staff"}</span>
                      <span className="day-status">
                        {look.label}
                        {r.time_in && <> · {clock(r.time_in)}</>}
                        {r.time_out && <> → {clock(r.time_out)}</>}
                        {r.leave_kind && <> · {r.leave_kind}</>}
                      </span>
                    </span>
                    {r.method_in && METHOD_LOOK[r.method_in] && <span className="day-method" title={METHOD_LOOK[r.method_in].label}><Icon name={METHOD_LOOK[r.method_in].icon} size={14} /></span>}
                  </button>
                );
              })}
            </div>
          )}
        </>
      )}
      {marking && board && (
        <MarkModal row={marking} date={board.on_date} onClose={() => setMarking(null)}
          onSave={async (status, time, note) => { setBoard(await day.mark(schoolId, { user_id: marking.user_id, on_date: board.on_date, status, time_in: time, note })); setMarking(null); }} />
      )}
    </section>
  );
}

function StatusTile({ k, n, note }: { k: string; n: number; note: string }) {
  const l = STATUS_LOOK[k];
  return (
    <div className="stat-tile" style={hue(l.hue)}>
      <Glyph icon={l.icon} hue={l.hue} size={44} />
      <div className="stat-text"><strong>{n}</strong><span>{l.label}</span><span className="stat-note">{note}</span></div>
    </div>
  );
}

function DayRing({ value, total }: { value: number; total: number }) {
  const r = 22, c = 2 * Math.PI * r, pct = total ? value / total : 0;
  return (
    <svg width="56" height="56" viewBox="0 0 56 56" aria-hidden="true" className="day-ring">
      <circle cx="28" cy="28" r={r} fill="none" stroke="var(--tint-2)" strokeWidth="7" />
      <circle cx="28" cy="28" r={r} fill="none" stroke="var(--hue)" strokeWidth="7" strokeLinecap="round"
        strokeDasharray={`${c * pct} ${c}`} transform="rotate(-90 28 28)" />
    </svg>
  );
}

function MarkModal({ row, date, onClose, onSave }: {
  row: BoardRow; date: string; onClose: () => void; onSave: (status: string, time: string | null, note: string | null) => Promise<void>;
}) {
  const [status, setStatus] = useState(["present", "late", "absent", "excused"].includes(row.status) ? row.status : "present");
  const [time, setTime] = useState(row.time_in ? clock(row.time_in) : new Date().toTimeString().slice(0, 5));
  const [note, setNote] = useState(row.note ?? "");
  const [error, setError] = useState("");
  const [busy, setBusy] = useState(false);
  async function save(s: string) {
    setBusy(true); setError("");
    try { await onSave(s, ["present", "late"].includes(s) ? time : null, note.trim() || null); } catch (e) { setError(errorText(e)); setBusy(false); }
  }
  return (
    <Modal title={`Mark ${row.name}`} onClose={onClose}>
      <p className="muted small">{niceDate(date, { weekday: "long", day: "numeric", month: "long" })}{row.method_in && METHOD_LOOK[row.method_in] ? ` · signed in: ${METHOD_LOOK[row.method_in].label.toLowerCase()}` : ""}</p>
      <div className="mark-choices">
        {(["present", "late", "absent", "excused"] as const).map((k) => (
          <button key={k} type="button" className={`mark-choice${status === k ? " on" : ""}`} style={hue(STATUS_LOOK[k].hue)} onClick={() => setStatus(k)}>
            <Glyph icon={STATUS_LOOK[k].icon} hue={STATUS_LOOK[k].hue} size={34} soft={status !== k} />{k === "present" ? "Present" : STATUS_LOOK[k].label}
          </button>
        ))}
      </div>
      {["present", "late"].includes(status) && <Field label="Time in"><input type="time" value={time} onChange={(e) => setTime(e.target.value)} /></Field>}
      <Field label="Note (optional)"><input value={note} maxLength={200} onChange={(e) => setNote(e.target.value)} placeholder="e.g. Went to the ministry first" /></Field>
      {error && <p className="error">{error}</p>}
      <div className="row">
        {["present", "late", "absent", "excused"].includes(row.status) && <button disabled={busy} onClick={() => save("clear")}>Clear mark</button>}
        <span className="grow" />
        <button onClick={onClose}>Cancel</button>
        <button className="primary" disabled={busy} onClick={() => save(status)}>Save</button>
      </div>
    </Modal>
  );
}

// ---------------- History ----------------

function History({ schoolId }: { schoolId: string }) {
  const today = iso(new Date());
  const ranges = [
    { key: "week", label: "This week", from: monday(today) },
    { key: "2w", label: "Last 2 weeks", from: addDays(today, -13) },
    { key: "month", label: "This month", from: today.slice(0, 8) + "01" },
    { key: "90", label: "Last 3 months", from: addDays(today, -89) },
  ];
  const [range, setRange] = useState("2w");
  const [rows, setRows] = useState<SummaryRow[] | null>(null);
  const [error, setError] = useState("");
  const from = ranges.find((r) => r.key === range)!.from;
  useEffect(() => { setRows(null); day.summary(schoolId, from, today).then(setRows).catch((e) => setError(errorText(e))); }, [schoolId, from, today]);
  const total = rows?.reduce((a, r) => ({ p: a.p + r.present, l: a.l + r.late, ab: a.ab + r.absent, d: a.d + r.days - r.leave }), { p: 0, l: 0, ab: 0, d: 0 });
  return (
    <section>
      <div className="day-toolbar">
        <div className="segmented small-seg">
          {ranges.map((r) => <button key={r.key} className={range === r.key ? "on" : ""} onClick={() => setRange(r.key)}>{r.label}</button>)}
        </div>
      </div>
      {error && <p className="error">{error}</p>}
      {total && (
        <div className="stat-strip">
          <div className="stat-tile" style={hue("green")}><Glyph icon="circle-check" hue="green" size={44} /><div className="stat-text"><strong>{total.d ? Math.round((total.p / total.d) * 100) : 0}%</strong><span>Attendance</span><span className="stat-note">{total.p} staff-days present</span></div></div>
          <StatusTile k="late" n={total.l} note="late arrivals" />
          <StatusTile k="absent" n={total.ab} note="days missed" />
          <div className="stat-tile" style={hue("indigo")}><Glyph icon="trophy" hue="indigo" size={44} /><div className="stat-text"><strong>{rows!.filter((r) => r.days && !r.absent && !r.late && r.present).length}</strong><span>Perfect record</span><span className="stat-note">always in, never late</span></div></div>
        </div>
      )}
      {!rows ? <p className="muted">Loading…</p> : (
        <div className="history-list">
          {rows.map((r) => {
            const counted = Math.max(r.days - r.leave, 1);
            return (
              <div key={r.user_id} className="history-row">
                <Avatar name={r.name} size={34} />
                <span className="history-name"><strong>{r.name}</strong><span className="muted small">{r.job_title ?? "Staff"}</span></span>
                <span className="history-bar" aria-label={`${r.present} present, ${r.late} late, ${r.absent} absent, ${r.leave} on leave`}>
                  <i style={{ ...hue("green"), flexGrow: r.present - r.late }} /><i style={{ ...hue("amber"), flexGrow: r.late }} />
                  <i style={{ ...hue("red"), flexGrow: r.absent }} /><i style={{ ...hue("violet"), flexGrow: r.leave }} />
                  <i style={{ flexGrow: Math.max(0, r.days - r.present - r.absent - r.leave) }} className="rest" />
                </span>
                <span className="history-figs">
                  <b style={hue("green")}>{Math.round((r.present / counted) * 100)}%</b>
                  {r.late > 0 && <span className="hue-chip" style={hue("amber")}>{r.late} late</span>}
                  {r.absent > 0 && <span className="hue-chip" style={hue("red")}>{r.absent} absent</span>}
                  {r.leave > 0 && <span className="hue-chip" style={hue("violet")}>{r.leave} leave</span>}
                  {r.average_in && <span className="muted small" title="Usual time in"><Icon name="clock" size={13} /> {r.average_in}</span>}
                </span>
              </div>
            );
          })}
        </div>
      )}
    </section>
  );
}

// ---------------- Leave ----------------

export function LeaveCard({ l, actions }: { l: Leave; actions?: React.ReactNode }) {
  const look = leaveLook(l.kind), st = LEAVE_STATUS[l.status];
  const same = l.starts_on === l.ends_on;
  return (
    <article className={`leave-card l-${l.status}`} style={hue(look.hue)}>
      <Glyph icon={look.icon} hue={look.hue} size={42} />
      <div className="leave-text">
        <div className="leave-top"><strong>{l.name}</strong><span className="hue-chip" style={hue(st.hue)}>{st.label}</span></div>
        <span className="leave-kind">{l.kind_label} · {l.days} work day{l.days === 1 ? "" : "s"}</span>
        <span className="leave-dates"><Icon name="calendar-range" size={14} />{niceDate(l.starts_on)}{!same && <> → {niceDate(l.ends_on)}</>}</span>
        {l.reason && <span className="leave-reason">“{l.reason}”</span>}
        {(l.decided_by || l.cover_name) && (
          <span className="muted small">
            {l.decided_by && `${st.label} by ${l.decided_by}`}{l.decision_note && `: ${l.decision_note}`}
            {l.cover_name && <> · <b>Cover: {l.cover_name}</b></>}
          </span>
        )}
      </div>
      {actions && <div className="leave-actions">{actions}</div>}
    </article>
  );
}

export function LeaveForm({ schoolId, staff, onDone, onClose }: { schoolId: string; staff?: StaffOption[]; onDone: () => void; onClose: () => void }) {
  const today = iso(new Date());
  const [who, setWho] = useState("");
  const [kind, setKind] = useState("casual");
  const [start, setStart] = useState(today);
  const [end, setEnd] = useState(today);
  const [reason, setReason] = useState("");
  const [error, setError] = useState("");
  const [busy, setBusy] = useState(false);
  async function submit(e: FormEvent) {
    e.preventDefault(); setBusy(true); setError("");
    try {
      await day.askLeave(schoolId, { kind, starts_on: start, ends_on: end < start ? start : end, reason: reason.trim() || null, ...(staff ? { user_id: who } : {}) });
      onDone();
    } catch (err) { setError(errorText(err)); setBusy(false); }
  }
  return (
    <Modal title={staff ? "Record leave for a staff member" : "Ask for leave"} onClose={onClose}>
      <form onSubmit={submit} className="stack">
        {staff && (
          <Field label="Staff member" hint="Leave you record here is approved straight away.">
            <select required value={who} onChange={(e) => setWho(e.target.value)}>
              <option value="">Choose…</option>
              {staff.map((s) => <option key={s.user_id} value={s.user_id}>{s.name}{s.job_title ? ` · ${s.job_title}` : ""}</option>)}
            </select>
          </Field>
        )}
        <div className="leave-kinds">
          {LEAVE_KINDS.map((k) => (
            <button key={k.value} type="button" className={`mark-choice${kind === k.value ? " on" : ""}`} style={hue(k.hue)} onClick={() => setKind(k.value)}>
              <Glyph icon={k.icon} hue={k.hue} size={30} soft={kind !== k.value} />{k.label.replace(" leave", "")}
            </button>
          ))}
        </div>
        <div className="row wrap">
          <Field label="From"><input type="date" required value={start} onChange={(e) => { setStart(e.target.value); if (end < e.target.value) setEnd(e.target.value); }} /></Field>
          <Field label="To (last day away)"><input type="date" required value={end} min={start} onChange={(e) => setEnd(e.target.value)} /></Field>
        </div>
        <Field label="Reason (optional)"><textarea rows={3} maxLength={500} value={reason} onChange={(e) => setReason(e.target.value)} placeholder="Anything the principal should know" /></Field>
        {error && <p className="error">{error}</p>}
        <div className="row"><span className="grow" /><button type="button" onClick={onClose}>Cancel</button>
          <button className="primary with-icon" disabled={busy}><Icon name="send" size={16} />{staff ? "Record leave" : "Send request"}</button></div>
      </form>
    </Modal>
  );
}

function LeaveBoard({ schoolId, staff }: { schoolId: string; staff: StaffOption[] }) {
  const [list, setList] = useState<Leave[] | null>(null);
  const [deciding, setDeciding] = useState<{ l: Leave; approve: boolean } | null>(null);
  const [adding, setAdding] = useState(false);
  const [show, setShow] = useState("now");
  const load = useCallback(() => { day.leave(schoolId).then(setList).catch(() => setList([])); }, [schoolId]);
  useEffect(load, [load]);
  const today = iso(new Date());
  const pending = (list ?? []).filter((l) => l.status === "pending");
  const away = (list ?? []).filter((l) => l.status === "approved" && l.starts_on <= today && l.ends_on >= today);
  const coming = (list ?? []).filter((l) => l.status === "approved" && l.starts_on > today);
  const past = (list ?? []).filter((l) => !pending.includes(l) && !away.includes(l) && !coming.includes(l));
  return (
    <section className="stack">
      <div className="day-toolbar">
        <div className="segmented small-seg">
          <button className={show === "now" ? "on" : ""} onClick={() => setShow("now")}>Now and coming</button>
          <button className={show === "past" ? "on" : ""} onClick={() => setShow("past")}>Past and closed ({past.length})</button>
        </div>
        <span className="grow" />
        <button className="primary with-icon" onClick={() => setAdding(true)}><Icon name="plus" size={16} />Record leave</button>
      </div>
      {!list && <p className="muted">Loading…</p>}
      {list && show === "now" && (
        <>
          <LeaveGroup title="Waiting for a decision" icon="inbox" h="amber" list={pending} empty="No requests waiting."
            actions={(l) => (<>
              <button className="with-icon ok-button" onClick={() => setDeciding({ l, approve: true })}><Icon name="check" size={16} />Approve</button>
              <button className="with-icon" onClick={() => setDeciding({ l, approve: false })}><Icon name="close" size={16} />Decline</button>
            </>)} />
          <LeaveGroup title="Away today" icon="palm-tree" h="violet" list={away} empty="Nobody is on leave today."
            actions={(l) => <button className="with-icon" onClick={() => setDeciding({ l, approve: true })}><Icon name="user-check" size={16} />Cover</button>} />
          <LeaveGroup title="Coming up" icon="calendar-range" h="teal" list={coming} empty="No leave booked ahead."
            actions={(l) => <button className="with-icon" onClick={() => setDeciding({ l, approve: true })}><Icon name="user-check" size={16} />Cover</button>} />
        </>
      )}
      {list && show === "past" && <LeaveGroup title="Past and closed" icon="history" h="slate" list={past} empty="Nothing yet." />}
      {adding && <LeaveForm schoolId={schoolId} staff={staff} onClose={() => setAdding(false)} onDone={() => { setAdding(false); load(); }} />}
      {deciding && <DecideModal {...deciding} staff={staff} onClose={() => setDeciding(null)} onDone={() => { setDeciding(null); load(); }} />}
    </section>
  );
}

function LeaveGroup({ title, icon, h, list, empty, actions }: {
  title: string; icon: string; h: "amber" | "violet" | "teal" | "slate"; list: Leave[]; empty: string; actions?: (l: Leave) => React.ReactNode;
}) {
  return (
    <div className="leave-group">
      <h3 className="with-glyph"><Glyph icon={icon} hue={h} size={30} />{title}<span className="count">{list.length}</span></h3>
      {list.length === 0 ? <p className="muted small">{empty}</p> : (
        <div className="leave-list">{list.map((l) => <LeaveCard key={l.id} l={l} actions={actions?.(l)} />)}</div>
      )}
    </div>
  );
}

function DecideModal({ l, approve, staff, onClose, onDone }: { l: Leave; approve: boolean; staff: StaffOption[]; onClose: () => void; onDone: () => void }) {
  const [cover, setCover] = useState(l.cover_user_id ?? "");
  const [note, setNote] = useState(l.decision_note ?? "");
  const [error, setError] = useState("");
  const [busy, setBusy] = useState(false);
  async function go(ok: boolean) {
    setBusy(true); setError("");
    try { await day.decide(l.id, { approve: ok, note: note.trim() || null, cover_user_id: ok && cover ? cover : null }); onDone(); }
    catch (e) { setError(errorText(e)); setBusy(false); }
  }
  return (
    <Modal title={approve ? (l.status === "approved" ? "Cover for this leave" : "Approve leave") : "Decline leave"} onClose={onClose}>
      <LeaveCard l={l} />
      {approve && (
        <Field label="Who covers their work?" hint="Optional. They'll see it on their page.">
          <select value={cover} onChange={(e) => setCover(e.target.value)}>
            <option value="">No cover needed</option>
            {staff.filter((s) => s.user_id !== l.user_id).map((s) => <option key={s.user_id} value={s.user_id}>{s.name}{s.job_title ? ` · ${s.job_title}` : ""}</option>)}
          </select>
        </Field>
      )}
      <Field label={approve ? "Note (optional)" : "Reason for declining"}><input value={note} maxLength={300} onChange={(e) => setNote(e.target.value)} /></Field>
      {error && <p className="error">{error}</p>}
      <div className="row"><span className="grow" /><button onClick={onClose}>Cancel</button>
        {l.status === "approved" && <button disabled={busy} onClick={async () => { await day.cancelLeave(l.id); onDone(); }}>Cancel the leave</button>}
        <button className="primary" disabled={busy} onClick={() => go(approve)}>{approve ? (l.status === "approved" ? "Save" : "Approve") : "Decline"}</button></div>
    </Modal>
  );
}

// ---------------- Duty rota ----------------

function DutyRota({ schoolId, branchId, staff }: { schoolId: string; branchId: string; staff: StaffOption[] }) {
  const [week, setWeek] = useState(monday(iso(new Date())));
  const [data, setData] = useState<{ duties: Duty[]; kinds: string[] } | null>(null);
  const [adding, setAdding] = useState<string | null>(null);
  const load = useCallback(() => { day.duties(schoolId, week, addDays(week, 6)).then(setData).catch(() => {}); }, [schoolId, week]);
  useEffect(load, [load]);
  const days = Array.from({ length: 7 }, (_, i) => addDays(week, i));
  const today = iso(new Date());
  const kinds = data?.kinds ?? [];
  const weekend = (data?.duties ?? []).some((d) => d.on_date >= days[5]);
  const shown = weekend ? days : days.slice(0, 5);
  const present = new Set((data?.duties ?? []).map((x) => x.duty));
  const dutyRows = [...kinds.filter((k) => present.has(k)), ...[...present].filter((k) => !kinds.includes(k)).sort()];
  return (
    <section className="stack">
      <div className="day-toolbar">
        <div className="date-nav">
          <IconButton icon="chevron-left" label="Week before" onClick={() => setWeek(addDays(week, -7))} />
          <span className="date-nav-pick"><Icon name="calendar-range" size={16} /><strong>Week of {niceDate(week, { day: "numeric", month: "long" })}</strong></span>
          <IconButton icon="chevron-right" label="Next week" onClick={() => setWeek(addDays(week, 7))} />
          {week !== monday(today) && <button className="text-link" onClick={() => setWeek(monday(today))}>This week</button>}
        </div>
        <span className="grow" />
        <ImportButton branchId={branchId} kind="duty-rota" label="Upload rota" onDone={load} />
        <button className="primary with-icon" onClick={() => setAdding(week)}><Icon name="plus" size={16} />Add duty</button>
      </div>
      <div className="rota-wrap">
        <table className="rota-table">
          <thead>
            <tr>
              <th className="rota-duty-head">Duty</th>
              {shown.map((d, i) => (
                <th key={d} className={d === today ? "today" : ""}>
                  <span>{DAY_SHORT[i]}</span><strong>{niceDate(d, { day: "numeric", month: "short" })}</strong>
                </th>
              ))}
            </tr>
          </thead>
          <tbody>
            {dutyRows.length === 0 && <tr><td colSpan={shown.length + 1}><Empty icon="shield-check">No duties this week. Add one, or upload the rota from a spreadsheet.</Empty></td></tr>}
            {dutyRows.map((duty) => {
              const look = dutyLook(duty, kinds);
              return (
                <tr key={duty} style={hue(look.hue)}>
                  <th scope="row" className="rota-duty"><Glyph icon={look.icon} hue={look.hue} size={30} /><span>{duty}</span></th>
                  {shown.map((d) => {
                    const list = (data?.duties ?? []).filter((x) => x.on_date === d && x.duty === duty);
                    return (
                      <td key={d} className={d === today ? "today" : ""}>
                        {list.map((x) => (
                          <span key={x.id} className="rota-name" title={`${x.name}${x.note ? ` · ${x.note}` : ""}`}>
                            <span>{shortName(x.name)}</span>
                            <button className="chip-x" aria-label={`Remove ${x.name} from ${x.duty}`} onClick={async () => { await day.removeDuty(x.id); load(); }}><Icon name="close" size={12} /></button>
                          </span>
                        ))}
                        <button className="rota-add" aria-label={`Add ${duty} on ${niceDate(d)}`} onClick={() => setAdding(d)}><Icon name="plus" size={13} /></button>
                      </td>
                    );
                  })}
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>
      {adding && <DutyForm schoolId={schoolId} date={adding} staff={staff} kinds={kinds} onClose={() => setAdding(null)} onDone={() => { setAdding(null); load(); }} />}
    </section>
  );
}

function DutyForm({ schoolId, date, staff, kinds, onClose, onDone }: { schoolId: string; date: string; staff: StaffOption[]; kinds: string[]; onClose: () => void; onDone: () => void }) {
  const [who, setWho] = useState("");
  const [duty, setDuty] = useState(kinds[0] ?? "Teacher on duty");
  const [own, setOwn] = useState("");
  const [start, setStart] = useState(date);
  const [repeat, setRepeat] = useState(false);
  const [until, setUntil] = useState(addDays(date, 4));
  const [note, setNote] = useState("");
  const [error, setError] = useState("");
  async function submit(e: FormEvent) {
    e.preventDefault(); setError("");
    try {
      await day.addDuty(schoolId, { user_id: who, duty: duty === "__own" ? own.trim() : duty, on_date: start, until: repeat ? until : null, note: note.trim() || null });
      onDone();
    } catch (err) { setError(errorText(err)); }
  }
  return (
    <Modal title="Add a duty" onClose={onClose}>
      <form onSubmit={submit} className="stack">
        <div className="duty-kinds">
          {kinds.map((k) => { const l = dutyLook(k, kinds); return (
            <button key={k} type="button" className={`mark-choice${duty === k ? " on" : ""}`} style={hue(l.hue)} onClick={() => setDuty(k)}>
              <Glyph icon={l.icon} hue={l.hue} size={28} soft={duty !== k} />{k}
            </button>); })}
          <button type="button" className={`mark-choice${duty === "__own" ? " on" : ""}`} style={hue("slate")} onClick={() => setDuty("__own")}>
            <Glyph icon="edit" hue="slate" size={28} soft={duty !== "__own"} />Other…
          </button>
        </div>
        {duty === "__own" && <Field label="Name of the duty"><input required minLength={2} maxLength={80} value={own} onChange={(e) => setOwn(e.target.value)} /></Field>}
        <Field label="Staff member">
          <select required value={who} onChange={(e) => setWho(e.target.value)}>
            <option value="">Choose…</option>
            {staff.map((s) => <option key={s.user_id} value={s.user_id}>{s.name}{s.job_title ? ` · ${s.job_title}` : ""}</option>)}
          </select>
        </Field>
        <div className="row wrap">
          <Field label="Date"><input type="date" required value={start} onChange={(e) => setStart(e.target.value)} /></Field>
          {repeat && <Field label="Every work day until"><input type="date" required min={start} value={until} onChange={(e) => setUntil(e.target.value)} /></Field>}
        </div>
        <label className="check"><input type="checkbox" checked={repeat} onChange={(e) => setRepeat(e.target.checked)} />Repeat every work day (e.g. a week on duty)</label>
        <Field label="Note (optional)"><input value={note} maxLength={200} onChange={(e) => setNote(e.target.value)} /></Field>
        {error && <p className="error">{error}</p>}
        <div className="row"><span className="grow" /><button type="button" onClick={onClose}>Cancel</button><button className="primary">Add</button></div>
      </form>
    </Modal>
  );
}

// ---------------- Lesson notes (review) ----------------

export function NotesReview({ schoolId, view, onChanged }: { schoolId: string; view: "review" | "all"; onChanged?: () => void }) {
  const [status, setStatus] = useState("submitted");
  const [list, setList] = useState<Note[] | null>(null);
  const [open, setOpen] = useState<Note | null>(null);
  const load = useCallback(() => { day.notes(schoolId, view === "all" ? "review" : "review", status || undefined).then(setList).catch(() => setList([])); }, [schoolId, view, status]);
  useEffect(load, [load]);
  return (
    <section className="stack">
      <div className="day-filters">
        {[["submitted", "Waiting for review"], ["returned", "Returned"], ["approved", "Approved"], ["", "All"]].map(([k, label]) => (
          <button key={k} className={`hue-chip pick-chip${status === k ? " on" : ""}`} style={hue(k ? NOTE_STATUS[k].hue : "blue")} onClick={() => setStatus(k)}>
            {k && <Icon name={NOTE_STATUS[k].icon} size={13} />}{label}
          </button>
        ))}
      </div>
      {!list ? <p className="muted">Loading…</p> : list.length === 0 ? <Empty icon="notebook">{status === "submitted" ? "Nothing waiting for review." : "No lesson notes here."}</Empty> : (
        <div className="note-grid">{list.map((n) => <NoteCard key={n.id} n={n} who onOpen={() => setOpen(n)} />)}</div>
      )}
      {open && <NoteView n={open} onClose={() => setOpen(null)} onReviewed={() => { setOpen(null); load(); onChanged?.(); }} />}
    </section>
  );
}

export function NoteCard({ n, who = false, onOpen }: { n: Note; who?: boolean; onOpen: () => void }) {
  const st = NOTE_STATUS[n.status];
  return (
    <button className="note-card" style={hue(st.hue)} onClick={onOpen}>
      <span className="note-top">
        <span className="hue-chip" style={hue(n.kind === "scheme" ? "indigo" : "teal")}><Icon name={n.kind === "scheme" ? "calendar-range" : "notebook"} size={12} />{n.kind === "scheme" ? "Scheme of work" : "Lesson note"}</span>
        <span className="hue-chip" style={hue(st.hue)}><Icon name={st.icon} size={12} />{st.label}</span>
      </span>
      <strong className="note-topic">{n.topic}</strong>
      <span className="note-meta">{n.subject_name} · {n.level}{n.week_starting && ` · week of ${niceDate(n.week_starting, { day: "numeric", month: "short" })}`}{n.term_label && ` · ${n.term_label}`}</span>
      {who && <span className="note-who"><Avatar name={n.teacher} size={22} />{n.teacher}</span>}
      {n.review_note && <span className="note-review"><Icon name="undo" size={13} />{n.review_note}</span>}
    </button>
  );
}

export function NoteView({ n, onClose, onReviewed, onEdit }: { n: Note; onClose: () => void; onReviewed?: () => void; onEdit?: () => void }) {
  const [note, setNote] = useState("");
  const [error, setError] = useState("");
  async function review(ok: boolean) {
    setError("");
    try { await day.review(n.id, ok, note.trim() || null); onReviewed?.(); } catch (e) { setError(errorText(e)); }
  }
  return (
    <Modal title={n.topic} onClose={onClose}>
      <p className="muted small">{n.kind === "scheme" ? "Scheme of work" : "Lesson note"} · {n.subject_name} · {n.level} · {n.teacher}
        {n.week_starting && ` · week of ${niceDate(n.week_starting)}`}</p>
      {n.objectives && <div className="note-section"><h4>Objectives</h4><p>{n.objectives}</p></div>}
      {n.content && <div className="note-section"><h4>{n.kind === "scheme" ? "Weeks and topics" : "Lesson"}</h4><p>{n.content}</p></div>}
      {n.review_note && <p className="day-banner" style={hue(NOTE_STATUS[n.status].hue)}><Icon name={NOTE_STATUS[n.status].icon} size={16} />{n.reviewer}: {n.review_note}</p>}
      {n.can_review && (
        <>
          <Field label="Comment for the teacher" hint="Needed if you send it back."><textarea rows={2} maxLength={500} value={note} onChange={(e) => setNote(e.target.value)} /></Field>
          {error && <p className="error">{error}</p>}
          <div className="row"><span className="grow" />
            <button className="with-icon" onClick={() => review(false)}><Icon name="undo" size={16} />Send back</button>
            <button className="primary with-icon" onClick={() => review(true)}><Icon name="check" size={16} />Approve</button></div>
        </>
      )}
      {onEdit && n.can_edit && <div className="row"><span className="grow" /><button className="primary with-icon" onClick={onEdit}><Icon name="edit" size={16} />Edit</button></div>}
    </Modal>
  );
}

// ---------------- Settings ----------------

const WEEK = ["Monday", "Tuesday", "Wednesday", "Thursday", "Friday", "Saturday", "Sunday"];

function SettingsPanel({ schoolId }: { schoolId: string }) {
  const [s, setS] = useState<DaySettings | null>(null);
  const [saved, setSaved] = useState(false);
  const [error, setError] = useState("");
  const [qr, setQr] = useState("");
  const [copied, setCopied] = useState(false);
  const [locating, setLocating] = useState(false);
  useEffect(() => { day.settings(schoolId).then(setS).catch((e) => setError(errorText(e))); }, [schoolId]);
  const link = useMemo(() => s?.kiosk_token ? `${location.origin}${location.pathname}#/kiosk/${schoolId}/${s.kiosk_token}` : "", [s?.kiosk_token, schoolId]);
  useEffect(() => { if (link) QRCode.toDataURL(link, { margin: 1, width: 220 }).then(setQr).catch(() => {}); }, [link]);
  if (!s) return error ? <p className="error">{error}</p> : <p className="muted">Loading…</p>;
  const set = (k: Partial<DaySettings>) => { setS({ ...s, ...k }); setSaved(false); };
  async function save(e: FormEvent) {
    e.preventDefault(); setError("");
    try { const { kiosk_token: _t, ...rest } = s!; setS(await day.saveSettings(schoolId, { ...rest, day_starts: hm(rest.day_starts), late_after: hm(rest.late_after), day_ends: hm(rest.day_ends) })); setSaved(true); }
    catch (err) { setError(errorText(err)); }
  }
  function here() {
    setLocating(true); setError("");
    navigator.geolocation?.getCurrentPosition(
      (p) => { set({ latitude: Math.round(p.coords.latitude * 1e6) / 1e6, longitude: Math.round(p.coords.longitude * 1e6) / 1e6 }); setLocating(false); },
      () => { setError("Couldn't get your location. Allow location for this site, then try again."); setLocating(false); },
      { enableHighAccuracy: true, timeout: 15000 });
  }
  return (
    <div className="settings-grid">
      <form className="card settings-card" onSubmit={save}>
        <h3 className="with-glyph"><Glyph icon="clock" hue="blue" size={34} />The school day</h3>
        <div className="time-row">
          <Field label="Day starts"><input type="time" value={hm(s.day_starts)} onChange={(e) => set({ day_starts: e.target.value })} /></Field>
          <Field label="Late after"><input type="time" value={hm(s.late_after)} onChange={(e) => set({ late_after: e.target.value })} /></Field>
          <Field label="Day ends"><input type="time" value={hm(s.day_ends)} onChange={(e) => set({ day_ends: e.target.value })} /></Field>
        </div>
        <div>
          <span className="field-label">Work days</span>
          <div className="chips">
            {WEEK.map((d, i) => (
              <label key={d} className={`chip pick${s.work_days.includes(i) ? " on" : ""}`}>
                <input type="checkbox" checked={s.work_days.includes(i)} onChange={(e) => set({ work_days: e.target.checked ? [...s.work_days, i].sort() : s.work_days.filter((x) => x !== i) })} />{d.slice(0, 3)}
              </label>
            ))}
          </div>
        </div>
        <h3 className="with-glyph"><Glyph icon="smartphone" hue="violet" size={34} />Signing in on their own phone</h3>
        <label className="check"><input type="checkbox" checked={s.allow_self} onChange={(e) => set({ allow_self: e.target.checked })} />Staff may tap “I'm in” on their own phone</label>
        {s.allow_self && (
          <>
            <p className="muted small">To stop people signing in from home, set the school's location. Phones must then be within the distance below.</p>
            <div className="row wrap">
              <button type="button" className="with-icon" onClick={here} disabled={locating}><Icon name="locate" size={16} />{locating ? "Finding you…" : "Use my current location"}</button>
              {s.latitude != null && <button type="button" className="text-link" onClick={() => set({ latitude: null, longitude: null })}>Don't check location</button>}
            </div>
            {s.latitude != null ? (
              <p className="day-banner" style={hue("green")}><Icon name="place" size={16} />School is at {s.latitude}, {s.longitude}.{" "}
                <a href={`https://www.openstreetmap.org/?mlat=${s.latitude}&mlon=${s.longitude}#map=17/${s.latitude}/${s.longitude}`} target="_blank" rel="noreferrer">See on a map</a></p>
            ) : <p className="day-banner" style={hue("amber")}><Icon name="place" size={16} />No location set: phones can sign in from anywhere.</p>}
            {s.latitude != null && (
              <Field label={`Allowed distance: ${s.radius_m} m`}>
                <input type="range" min={50} max={2000} step={50} value={s.radius_m} onChange={(e) => set({ radius_m: Number(e.target.value) })} />
              </Field>
            )}
          </>
        )}
        {error && <p className="error">{error}</p>}
        <div className="row"><span className="grow" />{saved && <span className="saved-note"><Icon name="check" size={15} />Saved</span>}<button className="primary">Save settings</button></div>
      </form>
      <div className="card settings-card kiosk-card" style={hue("teal")}>
        <h3 className="with-glyph"><Glyph icon="scan-qr" hue="teal" size={34} />Gate or staff-room kiosk</h3>
        <p className="small">Open this link on a phone or tablet at the gate. Staff hold up their ID card and it signs them in (and out at the end of the day). No login needed on that device.</p>
        {qr && <img className="kiosk-qr" src={qr} alt="QR code of the kiosk link" />}
        <p className="muted small">Scan this with the kiosk phone's camera to open the link.</p>
        <div className="row wrap">
          <a className="button primary with-icon" href={link} target="_blank" rel="noreferrer"><Icon name="scan" size={16} />Open kiosk</a>
          <button className="with-icon" onClick={() => navigator.clipboard?.writeText(link).then(() => setCopied(true))}><Icon name="copy" size={16} />{copied ? "Copied" : "Copy link"}</button>
          <button className="with-icon" onClick={async () => { if (confirm("Make a new kiosk link? The old link will stop working on every device.")) { setS(await day.newKiosk(schoolId)); setCopied(false); } }}><Icon name="refresh" size={16} />New link</button>
        </div>
        <p className="muted small">Lost the kiosk phone? Make a new link: the old one stops working at once.</p>
      </div>
    </div>
  );
}
