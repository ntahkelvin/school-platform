// The helpdesk: report a problem, and the desk's board of jobs from new to done.
import { useCallback, useEffect, useRef, useState, type FormEvent } from "react";
import { InsightList, useBusy } from "./GrowthBits";
import Icon from "./Icon";
import {
  dayTime, loadOpsMeta, ops, PRIORITY, shrinkPhoto, TICKET_STATUS, type Desk, type DeskStats, type OpsMeta, type StudentCard, type Ticket, type TicketIn,
} from "./opsApi";
import { niceDate } from "./dayApi";
import type { Insight } from "./growthApi";
import { Avatar, Empty, Field, Glyph, hue, Modal } from "./ui";

export function useOpsMeta(): OpsMeta | null {
  const [m, setM] = useState<OpsMeta | null>(null);
  useEffect(() => { loadOpsMeta().then(setM).catch(() => {}); }, []);
  return m;
}

export function StudentPicker({ schoolId, value, onPick, label = "Student" }: { schoolId: string; value: StudentCard | null; onPick: (s: StudentCard | null) => void; label?: string }) {
  const [q, setQ] = useState("");
  const [list, setList] = useState<StudentCard[]>([]);
  useEffect(() => {
    if (q.trim().length < 2) { setList([]); return; }
    const t = setTimeout(() => ops.students(schoolId, q).then(setList).catch(() => {}), 220);
    return () => clearTimeout(t);
  }, [q, schoolId]);
  if (value) return (
    <Field label={label}>
      <span className="picked-student"><Avatar name={value.name} size={30} /><span><strong>{value.name}</strong><span className="muted small">{value.class_name ?? ""} · {value.admission_no}{value.boarder ? " · boarder" : ""}</span></span>
        <button type="button" className="text-link" onClick={() => onPick(null)}>Change</button></span>
    </Field>
  );
  return (
    <Field label={label}>
      <div className="student-search">
        <input placeholder="Type a name or admission number…" value={q} onChange={(e) => setQ(e.target.value)} autoComplete="off" />
        {list.length > 0 && (
          <ul>{list.map((s) => <li key={s.id}><button type="button" onClick={() => { onPick(s); setQ(""); }}>
            <Avatar name={s.name} size={26} /><strong>{s.name}</strong><span className="muted small">{s.class_name} · {s.admission_no}</span></button></li>)}</ul>
        )}
      </div>
    </Field>
  );
}

export function TicketForm({ schoolId, onClose, onDone }: { schoolId: string; onClose: () => void; onDone: (t: Ticket) => void }) {
  const meta = useOpsMeta();
  const [f, setF] = useState<TicketIn>({ category: "", title: "", details: "", location: "", priority: "normal", photo: null });
  const [busy, error, run] = useBusy();
  const file = useRef<HTMLInputElement>(null);
  const [places, setPlaces] = useState<{ id: string | null; name: string; kind: string }[]>([]);
  useEffect(() => { ops.places(schoolId).then(setPlaces).catch(() => {}); }, [schoolId]);
  function submit(e: FormEvent) {
    e.preventDefault();
    const place = places.find((p) => p.id && p.name.toLowerCase() === (f.location ?? "").trim().toLowerCase());
    run(async () => onDone(await ops.raise(schoolId, { ...f, details: f.details || null, location: f.location || null, facility_id: place?.id ?? null })));
  }
  return (
    <Modal title="Report a problem or ask for something" onClose={onClose}>
      <form className="stack" onSubmit={submit}>
        <div className="cat-grid">
          {meta && Object.entries(meta.categories).map(([k, c]) => { const d = meta.desks[c.desk]; return (
            <button key={k} type="button" className={`cat-tile${f.category === k ? " on" : ""}`} style={hue(d.hue)} onClick={() => setF({ ...f, category: k })}>
              <Glyph icon={c.icon} hue={d.hue} size={34} soft={f.category !== k} /><strong>{c.label}</strong><span>{c.hint}</span>
            </button>); })}
        </div>
        {f.category && (
          <>
            <Field label="What's the problem?"><input required minLength={3} maxLength={200} value={f.title} onChange={(e) => setF({ ...f, title: e.target.value })}
              placeholder={f.category === "store" ? "e.g. 4 boxes of chalk, 10 markers" : "e.g. Ceiling fan not working"} /></Field>
            <div className="row wrap">
              <Field label="Where?"><input maxLength={120} list="places-list" value={f.location ?? ""} onChange={(e) => setF({ ...f, location: e.target.value })} placeholder="Pick a place or type one" />
                <datalist id="places-list">{places.map((p) => <option key={p.name} value={p.name} />)}</datalist></Field>
              <Field label="How soon?">
                <div className="segmented small-seg">{(["urgent", "normal", "low"] as const).map((p) => (
                  <button key={p} type="button" className={f.priority === p ? "on" : ""} onClick={() => setF({ ...f, priority: p })}>{PRIORITY[p].label}</button>))}</div>
              </Field>
            </div>
            <Field label="More details (optional)"><textarea rows={2} maxLength={3000} value={f.details ?? ""} onChange={(e) => setF({ ...f, details: e.target.value })} /></Field>
            <div className="photo-pick">
              {f.photo ? <><img src={f.photo} alt="" /><button type="button" className="text-link" onClick={() => setF({ ...f, photo: null })}>Remove photo</button></>
                : <button type="button" className="with-icon" onClick={() => file.current?.click()}><Icon name="camera" size={16} />Add a photo</button>}
              <input ref={file} type="file" accept="image/*" capture="environment" hidden onChange={async (e) => { const x = e.target.files?.[0]; if (x) setF({ ...f, photo: await shrinkPhoto(x) }); }} />
            </div>
          </>
        )}
        {error && <p className="error">{error}</p>}
        <div className="row"><span className="grow" /><button type="button" onClick={onClose}>Cancel</button>
          <button className="primary with-icon" disabled={busy || !f.category}><Icon name="send" size={16} />Send</button></div>
      </form>
    </Modal>
  );
}

function Stars({ value, onChange }: { value: number; onChange?: (v: number) => void }) {
  return (
    <span className="stars">{[1, 2, 3, 4, 5].map((v) => (
      <button key={v} type="button" disabled={!onChange} className={v <= value ? "on" : ""} onClick={() => onChange?.(v)} aria-label={`${v} star${v > 1 ? "s" : ""}`}>★</button>))}</span>
  );
}

export function TicketView({ t: initial, desks, onClose, onChanged }: { t: Ticket; desks?: Desk[]; onClose: () => void; onChanged: (t: Ticket) => void }) {
  const meta = useOpsMeta();
  const [t, setT] = useState(initial);
  const [text, setText] = useState("");
  const [cost, setCost] = useState("");
  const [rating, setRating] = useState(0);
  const [busy, error, run] = useBusy();
  const act = (action: string, extra: Record<string, unknown> = {}) => run(async () => { const x = await ops.act(t.id, { action, text: text || null, ...extra }); setT(x); setText(""); onChanged(x); });
  const st = TICKET_STATUS[t.status];
  const cat = meta?.categories[t.category];
  const team = desks?.find((d) => d.key === t.desk)?.members ?? [];
  return (
    <Modal title={`Job #${t.number}`} onClose={onClose}>
      <div className="ticket-head" style={hue(meta?.desks[t.desk]?.hue ?? "slate")}>
        <Glyph icon={cat?.icon ?? "wrench"} hue={meta?.desks[t.desk]?.hue ?? "slate"} size={44} />
        <div className="grow"><h3>{t.title}</h3>
          <p className="muted small">{cat?.label} · {meta?.desks[t.desk]?.label}{t.location && ` · ${t.location}`}</p></div>
      </div>
      <div className="chips">
        <span className="hue-chip" style={hue(st.hue)}><Icon name={st.icon} size={12} />{st.label}</span>
        <span className="hue-chip" style={hue(PRIORITY[t.priority].hue)}>{PRIORITY[t.priority].label}</span>
        {t.due_on && <span className="hue-chip" style={hue(t.overdue ? "red" : "slate")}><Icon name="calendar-days" size={12} />{t.overdue ? "Overdue: " : "Due "}{niceDate(t.due_on)}</span>}
        {t.rating && <span className="hue-chip" style={hue("amber")}>★ {t.rating}</span>}
      </div>
      {t.photo && <img className="ticket-photo" src={t.photo} alt="Photo of the problem" />}
      {t.details && <p className="ticket-details">{t.details}</p>}
      <p className="small muted">Reported by {t.raised_by?.name ?? "someone"} · {dayTime(t.created_at)}{t.assigned_to && <> · with <b>{t.assigned_to.name}</b></>}{t.cost != null && <> · ₦{t.cost.toLocaleString()} spent</>}</p>
      <ol className="ticket-log">
        {t.comments.map((c, i) => <li key={i}><span className="log-dot" /><span><strong>{c.name}</strong> {c.text}<span className="muted small"> · {dayTime(c.at)}</span></span></li>)}
      </ol>
      {t.can_work && t.status !== "closed" && (
        <div className="ticket-actions">
          {team.length > 0 && t.status !== "done" && (
            <select value="" onChange={(e) => e.target.value && act("assign", { user_id: e.target.value })} aria-label="Give the job to">
              <option value="">Give to…</option>{team.map((m) => <option key={m.user_id} value={m.user_id}>{m.name}</option>)}
            </select>
          )}
          {!t.assigned_to && <button disabled={busy} onClick={() => act("assign")}><Icon name="user-check" size={15} /> I'll take it</button>}
          {["new", "assigned", "waiting"].includes(t.status) && <button disabled={busy} onClick={() => act("start")}><Icon name="wrench" size={15} /> Start</button>}
          {["assigned", "working"].includes(t.status) && <button disabled={busy} onClick={() => act("wait")}><Icon name="hourglass" size={15} /> Waiting for parts</button>}
          {t.status !== "done" && <span className="done-box"><input type="number" min={0} placeholder="₦ spent" value={cost} onChange={(e) => setCost(e.target.value)} aria-label="Money spent" />
            <button className="ok-button" disabled={busy} onClick={() => act("done", { cost: cost ? Number(cost) : null })}><Icon name="check" size={15} /> Done</button></span>}
          {desks && t.status !== "done" && (
            <select value="" onChange={(e) => e.target.value && act("move", { desk: e.target.value })} aria-label="Pass to another desk">
              <option value="">Pass to another desk…</option>{desks.filter((d) => d.key !== t.desk).map((d) => <option key={d.key} value={d.key}>{d.label}</option>)}
            </select>
          )}
        </div>
      )}
      {t.can_rate && (
        <div className="rate-box">
          <strong>Is it fixed? Rate the job</strong><Stars value={rating} onChange={setRating} />
          <div className="row"><button disabled={busy} onClick={() => act("reopen")}>No, not fixed</button><span className="grow" />
            <button className="primary" disabled={busy || !rating} onClick={() => act("rate", { rating })}>Yes, close it</button></div>
        </div>
      )}
      {t.status !== "closed" && (
        <form className="row" onSubmit={(e) => { e.preventDefault(); if (text.trim()) act("comment"); }}>
          <input value={text} maxLength={1000} onChange={(e) => setText(e.target.value)} placeholder={t.can_rate ? "Optional comment" : "Add a comment or update"} />
          <button disabled={busy || !text.trim()}>Comment</button>
        </form>
      )}
      {error && <p className="error">{error}</p>}
    </Modal>
  );
}

export function TicketCard({ t, onOpen, showDesk }: { t: Ticket; onOpen: () => void; showDesk?: string }) {
  const meta = useOpsMeta();
  const c = meta?.categories[t.category];
  const d = meta?.desks[t.desk];
  return (
    <button className={`ticket-card p-${t.priority}${t.overdue ? " overdue" : ""}`} style={hue(d?.hue ?? "slate")} onClick={onOpen}>
      <span className="ticket-top"><Icon name={c?.icon ?? "wrench"} size={14} /><span className="muted small">#{t.number}{showDesk && d ? ` · ${d.label}` : ""}</span>
        <span className="grow" />{t.priority === "urgent" && <span className="hue-chip" style={hue("red")}>Urgent</span>}{t.overdue && <span className="hue-chip" style={hue("red")}>Overdue</span>}</span>
      <strong>{t.title}</strong>
      {t.location && <span className="ticket-loc"><Icon name="place" size={13} />{t.location}</span>}
      <span className="ticket-foot">
        {t.photo && <Icon name="camera" size={13} />}
        {t.assigned_to ? <span className="who-inline small"><Avatar name={t.assigned_to.name ?? "?"} size={20} />{t.assigned_to.name}</span> : <span className="muted small">Nobody yet</span>}
        <span className="grow" /><span className="muted small">{niceDate(t.created_at.slice(0, 10), { day: "numeric", month: "short" })}</span>
        {t.rating && <span className="small rating-mini">★{t.rating}</span>}
      </span>
    </button>
  );
}

const COLS: { key: string; label: string; statuses: string[]; hue: "sky" | "violet" | "amber" | "green" }[] = [
  { key: "new", label: "New", statuses: ["new"], hue: "sky" },
  { key: "doing", label: "Being worked on", statuses: ["assigned", "working"], hue: "violet" },
  { key: "waiting", label: "Waiting", statuses: ["waiting"], hue: "amber" },
  { key: "done", label: "Done", statuses: ["done", "closed"], hue: "green" },
];

export function HelpdeskBoard({ schoolId, desk, manager = false }: { schoolId: string; desk?: string; manager?: boolean }) {
  const meta = useOpsMeta();
  const [list, setList] = useState<Ticket[] | null>(null);
  const [desks, setDesks] = useState<Desk[]>([]);
  const [summary, setSummary] = useState<{ desks: Record<string, DeskStats>; insights: Insight[] } | null>(null);
  const [filter, setFilter] = useState(desk ?? "all");
  const [open, setOpen] = useState<Ticket | null>(null);
  const [raising, setRaising] = useState(false);
  const load = useCallback(() => {
    ops.tickets(schoolId, manager ? "all" : "desk", desk).then(setList).catch(() => setList([]));
    ops.summary(schoolId).then(setSummary).catch(() => {});
  }, [schoolId, desk, manager]);
  useEffect(() => { load(); ops.desks(schoolId).then(setDesks).catch(() => {}); }, [load, schoolId]);
  const weekAgo = Date.now() - 7 * 86400000;
  const rows = (list ?? []).filter((t) => (filter === "all" || t.desk === filter)
    && (!["done", "closed"].includes(t.status) || new Date(t.done_at ?? t.created_at).getTime() > weekAgo));
  const stats = filter !== "all" ? summary?.desks[filter] : summary && Object.values(summary.desks).reduce((a, s) => ({
    open: a.open + s.open, overdue: a.overdue + s.overdue, urgent: a.urgent + s.urgent, done_30: a.done_30 + s.done_30, avg_hours: a.avg_hours ?? s.avg_hours, rating: a.rating ?? s.rating }),
    { open: 0, overdue: 0, urgent: 0, done_30: 0, avg_hours: null, rating: null } as DeskStats);
  return (
    <section className="stack">
      <div className="day-toolbar">
        {!desk && summary && (
          <div className="day-filters">
            <button className={`hue-chip pick-chip${filter === "all" ? " on" : ""}`} style={hue("blue")} onClick={() => setFilter("all")}>All desks</button>
            {meta && Object.keys(summary.desks).filter((k) => !["gate", "sickbay"].includes(k) || summary.desks[k].open).map((k) => (
              <button key={k} className={`hue-chip pick-chip${filter === k ? " on" : ""}`} style={hue(meta.desks[k].hue)} onClick={() => setFilter(k)}>
                <Icon name={meta.desks[k].icon} size={13} />{meta.desks[k].label} <b>{summary.desks[k].open}</b></button>
            ))}
          </div>
        )}
        <span className="grow" />
        <button className="primary with-icon" onClick={() => setRaising(true)}><Icon name="plus" size={16} />Report a problem</button>
      </div>
      {stats && (
        <div className="stat-strip">
          <div className="stat-tile" style={hue("sky")}><Glyph icon="inbox" hue="sky" size={44} /><div className="stat-text"><strong>{stats.open}</strong><span>Open jobs</span><span className="stat-note">{stats.urgent} urgent</span></div></div>
          <div className="stat-tile" style={hue(stats.overdue ? "red" : "green")}><Glyph icon="timer" hue={stats.overdue ? "red" : "green"} size={44} /><div className="stat-text"><strong>{stats.overdue}</strong><span>Overdue</span><span className="stat-note">past the due date</span></div></div>
          <div className="stat-tile" style={hue("green")}><Glyph icon="circle-check" hue="green" size={44} /><div className="stat-text"><strong>{stats.done_30}</strong><span>Fixed in 30 days</span><span className="stat-note">{stats.avg_hours != null ? `about ${stats.avg_hours < 24 ? `${Math.round(stats.avg_hours)} h` : `${Math.round(stats.avg_hours / 24)} days`} each` : "—"}</span></div></div>
          <div className="stat-tile" style={hue("amber")}><span className="mood-big" aria-hidden="true">⭐</span><div className="stat-text"><strong>{stats.rating ?? "–"}<small> / 5</small></strong><span>Rating</span><span className="stat-note">from the people who asked</span></div></div>
        </div>
      )}
      {summary && summary.insights.length > 0 && <InsightList items={summary.insights} schoolId={schoolId} />}
      {list && list.length === 0 && <Empty icon="wrench">No jobs. All quiet!</Empty>}
      <div className="kanban">
        {COLS.map((c) => {
          const items = rows.filter((t) => c.statuses.includes(t.status));
          return (
            <div key={c.key} className="kanban-col" style={hue(c.hue)}>
              <h4><span className="kanban-dot" />{c.label}<span className="count">{items.length}</span></h4>
              {items.map((t) => <TicketCard key={t.id} t={t} showDesk={filter === "all" ? t.desk : undefined} onOpen={() => setOpen(t)} />)}
              {items.length === 0 && <p className="muted small kanban-empty">Nothing here</p>}
            </div>
          );
        })}
      </div>
      {open && <TicketView t={open} desks={desks} onClose={() => setOpen(null)} onChanged={() => load()} />}
      {raising && <TicketForm schoolId={schoolId} onClose={() => setRaising(false)} onDone={() => { setRaising(false); load(); }} />}
    </section>
  );
}

export function MyTickets({ schoolId, onClose }: { schoolId: string; onClose: () => void }) {
  const [list, setList] = useState<Ticket[] | null>(null);
  const [open, setOpen] = useState<Ticket | null>(null);
  const load = useCallback(() => { ops.tickets(schoolId, "mine").then(setList).catch(() => setList([])); }, [schoolId]);
  useEffect(load, [load]);
  return (
    <Modal title="My requests" onClose={onClose}>
      {list && list.length === 0 && <Empty icon="inbox">You haven't reported anything yet.</Empty>}
      <div className="ticket-list">{(list ?? []).map((t) => <TicketCard key={t.id} t={t} showDesk={t.desk} onOpen={() => setOpen(t)} />)}</div>
      {open && <TicketView t={open} onClose={() => setOpen(null)} onChanged={load} />}
    </Modal>
  );
}
