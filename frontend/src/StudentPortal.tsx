// The student's own portal parts: my day extras, library, reading, clubs, goals, badges, calendar, ID card and "report a worry".
// Parents see the same pages for their child, read only (and never the worries).
import { useEffect, useState } from "react";
import { api, errorText } from "./api";
import { useBusy } from "./GrowthBits";
import Icon from "./Icon";
import { EVENT_LOOK } from "./look";
import { PrintSheet, Qr } from "./Scanner";
import { Avatar, Field, Glyph, hue, Modal } from "./ui";

interface Badge { key: string; icon: string; hue: string; name: string; what: string; value: number; level: number; levels: number; next: number | null; earned: boolean; progress: number }
interface Goal { id: string; title: string; area: string; area_label: string; target_on: string | null; progress: number; status: string; steps: { text: string; done: boolean }[];
  updates: { at: string; text: string; progress: number }[]; teacher_note: string | null; at: string }
interface Worry { id: string; kind: string; kind_label: string; text: string; about: string | null; where: string | null; urgent: boolean; status: string; status_label: string; reply: string | null; at: string }
export interface Extras {
  how: "self" | "parent";
  card: { name: string; admission_no: string; class_name: string | null; photo: string | null; boarder: boolean; house: string | null; house_colour: string | null; code: string;
    school: { name: string; logo: string | null; colour: string | null; motto: string | null; phone: string | null }; session: string };
  events: { title: string; category: string; starts_on: string; ends_on: string | null; description: string | null }[];
  badges: Badge[];
  reading: { target: number; this_term: number; total: number; to_rate: { loan_id: string; title: string; author: string | null }[];
    books: { id: string; title: string; author: string | null; rating: number | null; review: string | null; finished_on: string; library: boolean }[] };
  goals: Goal[]; goal_areas: Record<string, string>; worries: Worry[]; worry_kinds: Record<string, string>;
  notices: { id: string; text: string; icon: string; at: string; link: string | null }[]; greeting: string; choices_waiting?: string[];
  homework?: { todo: number; late: number; next: { title: string; subject: string; due: string; state: string }[] } | null;
}
interface LibBook { id: string; title: string; author: string | null; category: string; subject: string | null; level: string | null; shelf: string | null; summary: string | null;
  colour: string | null; available: number; copies: number; held: boolean; popular: number; for_me: boolean }
interface Lib { loans: { id: string; title: string; author: string | null; due_on: string; late: number; days_left: number }[]; holds: { id: string; book_id: string; title: string; ahead: number; ready: boolean }[];
  books: LibBook[]; can_act: boolean; categories: Record<string, string> }
interface ClubRow { id: string; name: string; kind: string; description: string | null; meeting_time: string | null; patron: string | null; members: number; mine: string | null;
  asked: string | null; note: string | null; request_id: string | null }

const q = (sid?: string) => (sid ? `?student_id=${sid}` : "");
export const spapi = {
  extras: (sid?: string) => api.raw<Extras>("GET", `/api/me/student/extras${q(sid)}`),
  library: (sid: string | undefined, text: string, cat: string) => api.raw<Lib>("GET", `/api/me/student/library?${sid ? `student_id=${sid}&` : ""}q=${encodeURIComponent(text)}&category=${cat}`),
  reserve: (book_id: string) => api.raw("POST", "/api/me/student/library/holds", { book_id }),
  unreserve: (id: string) => api.raw("DELETE", `/api/me/student/library/holds/${id}`),
  read: (b: unknown) => api.raw("POST", "/api/me/student/reading", b),
  unread: (id: string) => api.raw("DELETE", `/api/me/student/reading/${id}`),
  clubs: (sid?: string) => api.raw<{ clubs: ClubRow[]; can_act: boolean }>("GET", `/api/me/student/clubs${q(sid)}`),
  join: (id: string, why: string | null) => api.raw("POST", `/api/me/student/clubs/${id}/join`, { why }),
  unjoin: (rid: string) => api.raw("DELETE", `/api/me/student/clubs/requests/${rid}`),
  addGoal: (b: unknown) => api.raw<Goal>("POST", "/api/me/student/goals", b),
  goal: (id: string, b: unknown) => api.raw<Goal>("PUT", `/api/me/student/goals/${id}`, b),
  worry: (b: unknown) => api.raw<Worry>("POST", "/api/me/student/worries", b),
};

const nice = (d: string, o: Intl.DateTimeFormatOptions = { day: "numeric", month: "short" }) => new Date(d.length === 10 ? `${d}T12:00:00` : d).toLocaleDateString("en-GB", o);
const daysTo = (d: string) => Math.round((new Date(`${d}T12:00:00`).getTime() - Date.now()) / 86400000);
const BOOK_HUES = ["violet", "sky", "teal", "orange", "rose", "indigo", "green", "fuchsia"] as const;
const bookHue = (t: string) => BOOK_HUES[[...t].reduce((n, ch) => n + ch.charCodeAt(0), 0) % BOOK_HUES.length];
const KIND_EMOJI: Record<string, string> = { bullying: "😟", unsafe: "⚠️", sad: "💙", online: "📱", health: "🤕", other: "💬" };

// ---------- My day extras ----------

export function DayExtras({ x, go }: { x: Extras; go: (t: string) => void }) {
  const self = x.how === "self";
  const earned = x.badges.filter((b) => b.earned);
  const close = [...x.badges].filter((b) => b.next).sort((a, b) => b.progress - a.progress)[0];
  const goal = x.goals.find((g) => g.status === "active");
  const pct = Math.min(100, Math.round((100 * x.reading.this_term) / x.reading.target));
  return (
    <>
      {self && (
        <section className="sp-hello">
          <span className="sp-hello-emoji" aria-hidden="true">{x.greeting.includes("birthday") ? "🎂" : new Date().getHours() < 12 ? "🌤️" : new Date().getHours() < 17 ? "☀️" : "🌙"}</span>
          <div><strong>{x.greeting}</strong>
            <span className="small">{close ? `${close.name}: ${close.value} of ${close.next} ${close.what}. Keep going!` : "You've earned every badge. Amazing!"}</span></div>
        </section>
      )}
      {x.homework && x.homework.next.length > 0 && (
        <button className="sp-hw-strip" onClick={() => go("homework")}>
          <span className="sp-hw-count" style={hue(x.homework.late ? "red" : "amber")}><b>{x.homework.todo + x.homework.late}</b><small>homework</small></span>
          <ul>{x.homework.next.map((h) => <li key={h.title} className={h.state}><b>{h.subject}</b> {h.title}<small className={h.state === "late" ? "late" : ""}>{h.due}</small></li>)}</ul>
          <Icon name="arrow-right" size={18} />
        </button>
      )}
      {(x.choices_waiting ?? []).length > 0 && (
        <button className="sp-choose-banner" style={hue("fuchsia")} onClick={() => go("record")}>
          <Glyph icon="book-text" hue="fuchsia" size={40} />
          <span className="grow"><b>{self ? "Time to choose your subjects!" : "Subject choices are open"}</b><small className="block">{x.choices_waiting!.join(" · ")}</small></span>
          <Icon name="arrow-right" size={18} />
        </button>
      )}
      {self && x.notices.length > 0 && (
        <section className="card g-card" style={hue("amber")}>
          <h3 className="with-glyph"><Glyph icon="bell" hue="amber" size={30} />New for you</h3>
          <ul className="mini-list">{x.notices.map((n) => <li key={n.id}><Icon name={n.icon} size={15} /><span>{n.text}<small className="muted block">{nice(n.at, { weekday: "short", day: "numeric", month: "short" })}</small></span></li>)}</ul>
        </section>
      )}
      <div className="sp-tiles">
        <button className="sp-tile" style={hue("fuchsia")} onClick={() => go("badges")}>
          <span className="sp-badge-row">{earned.slice(0, 4).map((b) => <span key={b.key} style={hue(b.hue as never)}><Icon name={b.icon} size={14} /></span>)}{earned.length === 0 && <span style={hue("slate")}><Icon name="star" size={14} /></span>}</span>
          <b>{earned.length} badge{earned.length === 1 ? "" : "s"}</b><small>{self ? "See how to earn more" : "Earned so far"}</small></button>
        <button className="sp-tile" style={hue("sky")} onClick={() => go("library")}>
          <span className="sp-mini-bar"><i style={{ width: `${pct}%` }} /></span>
          <b>{x.reading.this_term} of {x.reading.target} books</b><small>Reading challenge this term</small></button>
        <button className="sp-tile" style={hue("violet")} onClick={() => go("goals")}>
          {goal ? <span className="sp-mini-bar"><i style={{ width: `${goal.progress}%` }} /></span> : <Icon name="target" size={20} />}
          <b>{goal ? goal.title : self ? "Set a goal" : "No goals yet"}</b><small>{goal ? `${goal.progress}% there` : self ? "Something you want to get better at" : ""}</small></button>
        <button className="sp-tile" style={hue("pink")} onClick={() => go("calendar")}>
          <Icon name="calendar" size={20} />
          <b>{x.events[0] ? x.events[0].title : "Nothing coming up"}</b><small>{x.events[0] ? (daysTo(x.events[0].starts_on) <= 0 ? "Now" : `In ${daysTo(x.events[0].starts_on)} days · ${nice(x.events[0].starts_on)}`) : "School calendar"}</small></button>
      </div>
    </>
  );
}

// ---------- My ID card ----------

export function MyCard({ x, onClose }: { x: Extras; onClose: () => void }) {
  const c = x.card, colour = c.school.colour || "#1e63d6";
  return (
    <PrintSheet title="My ID card" onClose={onClose} note="Show the QR code at the library or the gate. You can print it too.">
      <div className="sp-card-wrap">
        <div className="id-card big" style={{ ["--card" as string]: colour, ["--hc" as string]: c.house_colour || colour }}>
          <div className="idc-head">{c.school.logo ? <img src={c.school.logo} alt="" /> : <span className="idc-logo">{c.school.name[0]}</span>}<span><b>{c.school.name}</b>{c.school.motto && <small>{c.school.motto}</small>}</span></div>
          <div className="idc-body">
            <div className="idc-photo">{c.photo ? <img src={c.photo} alt="" /> : <span>Photo</span>}</div>
            <div className="idc-text"><small className="idc-kind">STUDENT</small><b className="idc-name">{c.name}</b><span>{c.class_name ?? ""}{c.boarder ? " · Boarder" : ""}</span>
              <span className="mono">{c.admission_no}</span>{c.house && <span className="idc-house"><i />{c.house}</span>}</div>
            <div className="idc-qr"><Qr text={c.code} size={74} /><small>{c.session}</small></div>
          </div>
          <div className="idc-foot">If found, please return to the school{c.school.phone ? ` · ${c.school.phone}` : ""}</div>
        </div>
        <div className="sp-big-qr no-print"><Qr text={c.code} size={220} /><small>Hold your phone up to the scanner</small></div>
      </div>
    </PrintSheet>
  );
}

// ---------- Library and reading ----------

export function LibraryPage({ studentId, x, reload }: { studentId?: string; x: Extras; reload: () => void }) {
  const [text, setText] = useState("");
  const [cat, setCat] = useState("");
  const [d, setD] = useState<Lib | null>(null);
  const [open, setOpen] = useState<LibBook | null>(null);
  const [log, setLog] = useState<{ title: string; author: string; loan_id?: string } | null>(null);
  const [more, setMore] = useState(24);
  const [busy, error, run] = useBusy();
  const load = () => spapi.library(studentId, text, cat).then(setD).catch(() => {});
  useEffect(() => { const t = setTimeout(load, 250); return () => clearTimeout(t); }, [text, cat]); // eslint-disable-line react-hooks/exhaustive-deps
  const self = x.how === "self";
  const pct = Math.min(100, Math.round((100 * x.reading.this_term) / x.reading.target));
  return (
    <section className="stack">
      <div className="sp-reading" style={hue("sky")}>
        <div className="sp-shelf-ring"><span className="setup-ring big" style={{ ["--pct" as string]: `${pct}%` }}><b>{x.reading.this_term}/{x.reading.target}</b></span></div>
        <div className="grow"><strong>Reading challenge: {x.reading.target} books this term</strong>
          <span className="small muted">{x.reading.this_term >= x.reading.target ? "Challenge done! 🏆 Every extra book still counts for the Bookworm badge." : `${x.reading.target - x.reading.this_term} to go. Library books and books from home both count.`}</span>
          {self && <button className="small-btn with-icon" onClick={() => setLog({ title: "", author: "" })}><Icon name="plus" size={13} />I finished a book</button>}</div>
      </div>
      {self && x.reading.to_rate.length > 0 && (
        <div className="sp-rate">{x.reading.to_rate.map((b) => (
          <button key={b.loan_id} className="sp-rate-item" onClick={() => setLog({ title: b.title, author: b.author ?? "", loan_id: b.loan_id })}>
            <span className="fam-book mini" style={hue(bookHue(b.title))}><b>{b.title}</b></span><span>Did you finish <b>{b.title}</b>? Add it and rate it ⭐</span></button>))}</div>
      )}
      {d && (d.loans.length > 0 || d.holds.length > 0) && (
        <section className="card g-card" style={hue("teal")}>
          <h3 className="with-glyph"><Glyph icon="book" hue="teal" size={30} />{self ? "My books" : "Books out"}</h3>
          <ul className="mini-list">
            {d.loans.map((l) => <li key={l.id} className={l.late ? "late" : ""}><Icon name="book" size={15} /><span><b>{l.title}</b><small className={`block ${l.late ? "danger-text" : "muted"}`}>
              {l.late ? `${l.late} day${l.late > 1 ? "s" : ""} late. Please take it back.` : l.days_left <= 2 ? `Due ${l.days_left <= 0 ? "today" : l.days_left === 1 ? "tomorrow" : `in ${l.days_left} days`}` : `Due ${nice(l.due_on, { weekday: "short", day: "numeric", month: "short" })}`}</small></span></li>)}
            {d.holds.map((h) => <li key={h.id}><Icon name="clock" size={15} /><span><b>{h.title}</b><small className="muted block">{h.ready ? "Ready for you at the library desk! 🎉" : h.ahead ? `Reserved · ${h.ahead} ahead of you` : "Reserved · waiting for a copy"}</small></span>
              {d.can_act && <button className="text-link danger-hover small" disabled={busy} onClick={() => run(async () => { await spapi.unreserve(h.id); await load(); })}>Cancel</button>}</li>)}
          </ul>
        </section>
      )}
      <section className="card editor">
        <h3 className="with-glyph"><Glyph icon="search" hue="blue" size={30} />Find a book</h3>
        <label className="search"><Icon name="search" size={16} /><input placeholder="Title, author or subject" value={text} onChange={(e) => setText(e.target.value)} /></label>
        {d && <div className="filter-chips"><button className={cat === "" ? "on" : ""} onClick={() => setCat("")}>All</button>{Object.entries(d.categories).map(([k, l]) => <button key={k} className={cat === k ? "on" : ""} onClick={() => setCat(k)}>{l}</button>)}</div>}
        {d && d.books.length === 0 && <p className="muted">No books found.</p>}
        <div className="sp-books">
          {d?.books.slice(0, more).map((b) => (
            <button key={b.id} className="sp-book" onClick={() => setOpen(b)}>
              <span className="fam-book" style={hue(bookHue(b.title))}><b>{b.title}</b>{b.author && <small>{b.author}</small>}</span>
              <span className={`sp-avail ${b.available ? "yes" : "no"}`}>{b.held ? "Reserved" : b.available ? `${b.available} on the shelf` : "All out"}</span>
              {b.for_me && <span className="sp-for-me">For my class</span>}
            </button>
          ))}
        </div>
        {d && d.books.length > more && <button className="show-more" onClick={() => setMore(more + 24)}>Show more books</button>}
      </section>
      {x.reading.books.length > 0 && (
        <section className="card g-card" style={hue("violet")}>
          <h3 className="with-glyph"><Glyph icon="book-marked" hue="violet" size={30} />{self ? "Books I've read" : "Books read"} ({x.reading.total})</h3>
          <ul className="mini-list">{x.reading.books.map((r) => <li key={r.id}><span className="sp-stars">{"★".repeat(r.rating ?? 0)}<i>{"★".repeat(5 - (r.rating ?? 0))}</i></span>
            <span className="grow"><b>{r.title}</b>{r.author && <span className="muted"> · {r.author}</span>}{r.review && <small className="block muted">“{r.review}”</small>}</span>
            <small className="muted">{nice(r.finished_on)}</small>
            {self && <button className="icon-button danger-hover" aria-label="Remove" onClick={() => run(async () => { await spapi.unread(r.id); reload(); })}><Icon name="close" size={14} /></button>}</li>)}</ul>
        </section>
      )}
      {error && <p className="error">{error}</p>}
      {open && (
        <Modal title={open.title} onClose={() => setOpen(null)}>
          <div className="stack">
            <div className="row"><span className="fam-book" style={hue(bookHue(open.title))}><b>{open.title}</b></span>
              <dl className="fam-facts grow"><div><dt>Author</dt><dd>{open.author ?? "–"}</dd></div><div><dt>On the shelf</dt><dd>{open.available} of {open.copies}</dd></div>
                {open.shelf && <div><dt>Shelf</dt><dd>{open.shelf}</dd></div>}{open.subject && <div><dt>Subject</dt><dd>{open.subject}</dd></div>}</dl></div>
            {open.summary && <p>{open.summary}</p>}
            {d?.can_act && (open.held ? <p className="fam-seen"><Icon name="circle-check" size={14} />You've reserved this book.</p>
              : <button className="primary with-icon" disabled={busy} onClick={() => run(async () => { await spapi.reserve(open.id); setOpen(null); await load(); })}><Icon name="book-marked" size={15} />{open.available ? "Keep one for me" : "Reserve: tell me when it's back"}</button>)}
            {error && <p className="error">{error}</p>}
          </div>
        </Modal>
      )}
      {log && <ReadForm start={log} onClose={() => setLog(null)} onDone={() => { setLog(null); reload(); }} />}
    </section>
  );
}

function ReadForm({ start, onClose, onDone }: { start: { title: string; author: string; loan_id?: string }; onClose: () => void; onDone: () => void }) {
  const [title, setTitle] = useState(start.title);
  const [author, setAuthor] = useState(start.author);
  const [rating, setRating] = useState(0);
  const [review, setReview] = useState("");
  const [busy, error, run] = useBusy();
  return (
    <Modal title="I finished a book! 📚" onClose={onClose}>
      <form className="stack" onSubmit={(e) => { e.preventDefault(); run(async () => { await spapi.read({ title, author: author || null, rating: rating || null, review: review || null, loan_id: start.loan_id ?? null }); onDone(); }); }}>
        <div className="form-grid"><Field label="Title"><input value={title} onChange={(e) => setTitle(e.target.value)} required maxLength={250} disabled={!!start.loan_id} /></Field>
          <Field label="Author"><input value={author} onChange={(e) => setAuthor(e.target.value)} maxLength={200} disabled={!!start.loan_id} /></Field></div>
        <div className="sp-rate-stars" role="radiogroup" aria-label="Your rating">{[1, 2, 3, 4, 5].map((n) => <button type="button" key={n} className={n <= rating ? "on" : ""} onClick={() => setRating(n)} aria-label={`${n} stars`}>★</button>)}</div>
        <Field label="What did you think? (optional)"><textarea rows={2} maxLength={500} value={review} onChange={(e) => setReview(e.target.value)} placeholder="The best part was…" /></Field>
        {error && <p className="error">{error}</p>}
        <div className="row"><span className="grow" /><button type="button" onClick={onClose}>Cancel</button><button className="primary" disabled={busy}>Add to my books</button></div>
      </form>
    </Modal>
  );
}

// ---------- Clubs ----------

export function ClubsPage({ studentId }: { studentId?: string }) {
  const [d, setD] = useState<{ clubs: ClubRow[]; can_act: boolean } | null>(null);
  const [ask, setAsk] = useState<ClubRow | null>(null);
  const [why, setWhy] = useState("");
  const [busy, error, run] = useBusy();
  const load = () => spapi.clubs(studentId).then(setD).catch(() => {});
  useEffect(() => { void load(); }, [studentId]); // eslint-disable-line react-hooks/exhaustive-deps
  if (!d) return <div className="skeleton"><span /><span /></div>;
  if (d.clubs.length === 0) return <p className="muted">The school hasn't added any clubs yet.</p>;
  const KIND: Record<string, string> = { club: "Club", society: "Society", sports_team: "Sports team", uniformed: "Uniformed group" };
  return (
    <section className="stack">
      {error && <p className="error">{error}</p>}
      <div className="sp-clubs">
        {d.clubs.map((c) => (
          <div key={c.id} className={`sp-club${c.mine ? " mine" : ""}`} style={hue(c.kind === "sports_team" ? "green" : c.kind === "uniformed" ? "indigo" : c.kind === "society" ? "violet" : "fuchsia")}>
            <div className="row"><Glyph icon={c.kind === "sports_team" ? "trophy" : "club"} hue={c.kind === "sports_team" ? "green" : "fuchsia"} size={36} />
              <span className="grow"><b>{c.name}</b><small className="muted block">{KIND[c.kind] ?? c.kind} · {c.members} member{c.members === 1 ? "" : "s"}</small></span></div>
            {c.description && <p className="small">{c.description}</p>}
            <p className="small muted">{[c.meeting_time && `Meets ${c.meeting_time}`, c.patron && `Patron: ${c.patron}`].filter(Boolean).join(" · ")}</p>
            {c.mine ? <span className="fam-seen"><Icon name="circle-check" size={14} />{d.can_act ? "You're in" : "Member"}{c.mine !== "Member" ? ` (${c.mine})` : ""}</span>
              : c.asked === "waiting" ? <span className="row"><span className="hue-chip" style={hue("amber")}>Asked to join</span>{d.can_act && c.request_id && <button className="text-link small" disabled={busy} onClick={() => run(async () => { await spapi.unjoin(c.request_id!); await load(); })}>Cancel</button>}</span>
              : d.can_act && <button className="small-btn primary with-icon" onClick={() => { setAsk(c); setWhy(""); }}><Icon name="plus" size={13} />Ask to join</button>}
            {c.asked === "declined" && c.note && <small className="muted">Last time: “{c.note}”</small>}
          </div>
        ))}
      </div>
      {ask && (
        <Modal title={`Join ${ask.name}`} onClose={() => setAsk(null)}>
          <div className="stack">
            <p>{ask.patron ? `${ask.patron} will see your request.` : "The school will see your request."}</p>
            <Field label="Why do you want to join? (optional)"><textarea rows={2} maxLength={300} value={why} onChange={(e) => setWhy(e.target.value)} placeholder="e.g. I love football and I play in defence" /></Field>
            {error && <p className="error">{error}</p>}
            <div className="row"><span className="grow" /><button onClick={() => setAsk(null)}>Cancel</button>
              <button className="primary" disabled={busy} onClick={() => run(async () => { await spapi.join(ask.id, why || null); setAsk(null); await load(); })}>Send</button></div>
          </div>
        </Modal>
      )}
    </section>
  );
}

// ---------- Goals ----------

export function GoalsPage({ x, reload }: { x: Extras; reload: () => void }) {
  const self = x.how === "self";
  const [adding, setAdding] = useState(false);
  const [busy, error, run] = useBusy();
  const act = (id: string, b: unknown) => run(async () => { await spapi.goal(id, b); reload(); });
  const active = x.goals.filter((g) => g.status === "active"), done = x.goals.filter((g) => g.status === "done");
  return (
    <section className="stack">
      {self && <div className="row"><p className="muted grow">Pick something you want to get better at, break it into small steps and tick them off.</p>
        <button className="primary with-icon" onClick={() => setAdding(true)}><Icon name="plus" size={15} />New goal</button></div>}
      {x.goals.length === 0 && <div className="adm-empty"><span>🎯</span><p>{self ? "No goals yet. What would you like to get better at this term?" : "No goals yet."}</p></div>}
      {error && <p className="error">{error}</p>}
      <div className="sp-goals">
        {active.map((g) => (
          <div key={g.id} className="sp-goal" style={hue("violet")}>
            <div className="row"><span className="setup-ring" style={{ ["--pct" as string]: `${g.progress}%` }}><b>{g.progress}%</b></span>
              <span className="grow"><b>{g.title}</b><small className="muted block">{g.area_label}{g.target_on ? ` · by ${nice(g.target_on)}` : ""}</small></span></div>
            {g.steps.length > 0 && <ul className="sp-steps">{g.steps.map((st, i) => (
              <li key={i}><label className="check"><input type="checkbox" checked={st.done} disabled={!self || busy}
                onChange={(e) => act(g.id, { steps: g.steps.map((y, j) => (j === i ? { ...y, done: e.target.checked } : y)) })} /><span className={st.done ? "done" : ""}>{st.text}</span></label></li>))}</ul>}
            {g.teacher_note && <p className="sp-note"><Icon name="message" size={13} />{g.teacher_note}</p>}
            {g.updates[0] && <p className="small muted">Latest: “{g.updates[0].text}”</p>}
            {self && <GoalActions g={g} busy={busy} act={act} />}
          </div>
        ))}
      </div>
      {done.length > 0 && <section className="card g-card" style={hue("green")}><h3 className="with-glyph"><Glyph icon="trophy" hue="green" size={30} />Goals reached 🎉</h3>
        <ul className="mini-list">{done.map((g) => <li key={g.id}><Icon name="circle-check" size={15} /><span><b>{g.title}</b><small className="muted block">{g.area_label}</small></span></li>)}</ul></section>}
      {adding && <GoalForm areas={x.goal_areas} onClose={() => setAdding(false)} onDone={() => { setAdding(false); reload(); }} />}
    </section>
  );
}

function GoalActions({ g, busy, act }: { g: Goal; busy: boolean; act: (id: string, b: unknown) => void }) {
  const [say, setSay] = useState("");
  return (
    <div className="stack sp-goal-act">
      {g.steps.length === 0 && <label className="sp-slider"><span className="small muted">How far along?</span><input type="range" min={0} max={100} step={10} defaultValue={g.progress} onMouseUp={(e) => act(g.id, { progress: Number((e.target as HTMLInputElement).value) })} onTouchEnd={(e) => act(g.id, { progress: Number((e.target as HTMLInputElement).value) })} /></label>}
      <div className="row"><input className="grow" placeholder="How is it going?" value={say} maxLength={300} onChange={(e) => setSay(e.target.value)} />
        <button className="small-btn" disabled={busy || !say.trim()} onClick={() => { act(g.id, { text: say }); setSay(""); }}>Add</button></div>
      <div className="row"><button className="small-btn primary with-icon" disabled={busy} onClick={() => act(g.id, { status: "done" })}><Icon name="circle-check" size={13} />I did it!</button>
        <span className="grow" /><button className="text-link small danger-hover" disabled={busy} onClick={() => act(g.id, { status: "dropped" })}>Drop this goal</button></div>
    </div>
  );
}

function GoalForm({ areas, onClose, onDone }: { areas: Record<string, string>; onClose: () => void; onDone: () => void }) {
  const [title, setTitle] = useState("");
  const [area, setArea] = useState("study");
  const [target, setTarget] = useState("");
  const [steps, setSteps] = useState(["", "", ""]);
  const [busy, error, run] = useBusy();
  const ideas: Record<string, string[]> = { study: ["Get 70% in Maths", "Hand in every homework on time"], reading: ["Read 5 storybooks this term"], sport: ["Make the school football team"],
    character: ["Help someone every day for a week"], skill: ["Learn to type with ten fingers"], other: ["Keep my locker tidy"] };
  return (
    <Modal title="A new goal 🎯" onClose={onClose}>
      <form className="stack" onSubmit={(e) => { e.preventDefault(); run(async () => { await spapi.addGoal({ title, area, target_on: target || null, steps: steps.filter((x) => x.trim()) }); onDone(); }); }}>
        <div className="chips">{Object.entries(areas).map(([k, l]) => <button type="button" key={k} className={`small-btn${area === k ? " primary" : ""}`} onClick={() => setArea(k)}>{l}</button>)}</div>
        <Field label="My goal"><input value={title} onChange={(e) => setTitle(e.target.value)} required minLength={3} maxLength={150} placeholder={ideas[area]?.[0]} /></Field>
        <Field label="By when? (optional)"><input type="date" value={target} onChange={(e) => setTarget(e.target.value)} /></Field>
        <span className="small muted">Small steps to get there (optional)</span>
        {steps.map((st, i) => <input key={i} value={st} maxLength={120} placeholder={`Step ${i + 1}`} onChange={(e) => setSteps(steps.map((y, j) => (j === i ? e.target.value : y)))} />)}
        {error && <p className="error">{error}</p>}
        <div className="row"><span className="grow" /><button type="button" onClick={onClose}>Cancel</button><button className="primary" disabled={busy}>Save my goal</button></div>
      </form>
    </Modal>
  );
}

// ---------- Badges ----------

const one = (what: string) => what.replace(/^days/, "day").replace(/^books/, "book").replace(/library books/, "library book").replace(/^merit points/, "merit point")
  .replace(/^awards/, "award").replace(/^clubs and teams/, "club or team").replace(/^goals/, "goal");

export function BadgesPage({ x }: { x: Extras }) {
  return (
    <div className="sp-badges">
      {x.badges.map((b) => (
        <div key={b.key} className={`sp-badge${b.earned ? " earned" : ""}`} style={hue(b.hue as never)}>
          <span className="sp-medal"><Icon name={b.icon} size={28} />{b.level > 0 && <i>{b.level}</i>}</span>
          <b>{b.name}</b>
          <small>{b.value} {b.value === 1 ? one(b.what) : b.what}</small>
          {b.next ? <><span className="sp-mini-bar"><i style={{ width: `${b.progress}%` }} /></span><small className="muted">Next level at {b.next}</small></> : <small className="sp-max">Top level! 🏆</small>}
          <span className="sp-stars-row">{Array.from({ length: b.levels }, (_, i) => <i key={i} className={i < b.level ? "on" : ""}>★</i>)}</span>
        </div>
      ))}
    </div>
  );
}

// ---------- Calendar ----------

export function CalendarPage({ x }: { x: Extras }) {
  if (x.events.length === 0) return <div className="adm-empty"><span>📅</span><p>Nothing on the school calendar yet.</p></div>;
  return (
    <ul className="sp-events">
      {x.events.map((e, i) => {
        const look = EVENT_LOOK[e.category as keyof typeof EVENT_LOOK] ?? { icon: "calendar", hue: "slate" };
        const d = daysTo(e.starts_on);
        return (
          <li key={i} style={hue(look.hue)}>
            <span className="sp-date"><b>{new Date(`${e.starts_on}T12:00:00`).getDate()}</b><small>{nice(e.starts_on, { month: "short" })}</small></span>
            <span className="grow"><b>{e.title}</b><small className="muted block">{e.ends_on && e.ends_on !== e.starts_on ? `${nice(e.starts_on)} to ${nice(e.ends_on)}` : nice(e.starts_on, { weekday: "long", day: "numeric", month: "long" })}</small>
              {e.description && <small className="block">{e.description}</small>}</span>
            <span className="hue-chip">{d <= 0 ? "Now" : d === 1 ? "Tomorrow" : `In ${d} days`}</span>
          </li>
        );
      })}
    </ul>
  );
}

// ---------- Report a worry ----------

export function WorryPage({ x, reload }: { x: Extras; reload: () => void }) {
  const [kind, setKind] = useState("");
  const [text, setText] = useState("");
  const [about, setAbout] = useState("");
  const [where, setWhere] = useState("");
  const [urgent, setUrgent] = useState(false);
  const [sent, setSent] = useState(false);
  const [busy, error, run] = useBusy();
  return (
    <section className="stack">
      <div className="sp-worry-intro">
        <span>💙</span>
        <div><strong>You can tell us anything.</strong>
          <p>Only the school's trusted adults for keeping students safe will read this. Not your classmates, and not other teachers. You won't get in trouble for telling us.</p>
          <p className="small"><b>In danger right now?</b> Go straight to the nearest teacher, house parent or the school office.</p></div>
      </div>
      {sent ? (
        <div className="fam-sent"><span>✅</span><h3>Thank you for telling us</h3><p className="muted">A trusted adult will read it and reply here. You did the right thing.</p>
          <button className="primary" onClick={() => { setSent(false); setKind(""); setText(""); setAbout(""); setWhere(""); setUrgent(false); }}>OK</button></div>
      ) : (
        <form className="stack card editor" onSubmit={(e) => { e.preventDefault(); run(async () => { await spapi.worry({ kind, text, about: about || null, where: where || null, urgent }); setSent(true); reload(); }); }}>
          <div className="fam-kinds" role="radiogroup" aria-label="What is it about?">
            {Object.entries(x.worry_kinds).map(([k, l]) => <button type="button" role="radio" aria-checked={kind === k} key={k} className={kind === k ? "on" : ""} style={hue("sky")} onClick={() => setKind(k)}><span>{KIND_EMOJI[k]}</span>{l}</button>)}
          </div>
          {kind && <>
            <Field label="What happened?"><textarea rows={4} value={text} onChange={(e) => setText(e.target.value)} required minLength={5} maxLength={3000} placeholder="Write it in your own words. Say what happened and when." /></Field>
            <div className="form-grid">
              <Field label="Who is it about? (optional)"><input value={about} onChange={(e) => setAbout(e.target.value)} maxLength={200} /></Field>
              <Field label="Where? (optional)"><input value={where} onChange={(e) => setWhere(e.target.value)} maxLength={120} placeholder="e.g. hostel, dining hall, online" /></Field>
            </div>
            <label className="check"><input type="checkbox" checked={urgent} onChange={(e) => setUrgent(e.target.checked)} />It's happening now or it's very serious</label>
            {error && <p className="error">{error}</p>}
            <div className="row"><span className="grow" /><button className="primary with-icon" disabled={busy}><Icon name="send" size={15} />Send to a trusted adult</button></div>
          </>}
        </form>
      )}
      {x.worries.length > 0 && (
        <section className="card g-card" style={hue("sky")}>
          <h3 className="with-glyph"><Glyph icon="shield" hue="sky" size={30} />What you've told us</h3>
          <ul className="fam-note-list">{x.worries.map((w) => (
            <li key={w.id} style={hue("sky")}><span className="fam-note-emoji">{KIND_EMOJI[w.kind] ?? "💬"}</span>
              <div><p><b>{w.kind_label}</b> · {nice(w.at)}</p><p className="fam-note-text">{w.text}</p>
                <p className={w.status === "new" ? "small muted" : "fam-seen"}>{w.status !== "new" && <Icon name="circle-check" size={13} />}{w.status_label}</p>
                {w.reply && <p className="sp-reply"><Icon name="message" size={13} />{w.reply}</p>}</div></li>))}</ul>
        </section>
      )}
    </section>
  );
}

// ---------- The school's side: worries, for the safeguarding team ----------

interface StaffWorry extends Worry { student: { id: string; name: string; class_name: string | null; thumb: string | null } | null; handled_by: string | null; notes: { at: string; by: string; text: string }[] }

export function WorriesPanel({ schoolId }: { schoolId: string }) {
  const [d, setD] = useState<{ worries: StaffWorry[]; open: number } | null>(null);
  const [show, setShow] = useState<"open" | "all">("open");
  const [error, setError] = useState("");
  const [open, setOpen] = useState<StaffWorry | null>(null);
  const load = () => api.raw<{ worries: StaffWorry[]; open: number }>("GET", `/api/schools/${schoolId}/worries?show=${show}`).then(setD).catch((e) => setError(errorText(e)));
  useEffect(() => { void load(); }, [schoolId, show]); // eslint-disable-line react-hooks/exhaustive-deps
  if (error) return <p className="error">{error}</p>;
  if (!d) return <div className="skeleton"><span /><span /></div>;
  return (
    <section className="stack">
      <p className="hint-line"><Icon name="lock" size={14} />Only people with the safeguarding right see this page. Each time it's opened, it's recorded.</p>
      <div className="segmented small-seg"><button className={show === "open" ? "on" : ""} onClick={() => setShow("open")}>Open ({d.open})</button><button className={show === "all" ? "on" : ""} onClick={() => setShow("all")}>All</button></div>
      {d.worries.length === 0 && <div className="adm-empty"><span>🕊️</span><p>No worries reported.</p></div>}
      <ul className="fam-note-list">
        {d.worries.map((w) => (
          <li key={w.id} className={w.status === "new" ? "new" : ""} style={hue(w.urgent ? "red" : "sky")} onClick={() => setOpen(w)}>
            <span className="fam-note-emoji">{w.urgent ? "🚨" : KIND_EMOJI[w.kind] ?? "💬"}</span>
            <div className="grow"><p><b>{w.kind_label}</b> · {w.student?.name} ({w.student?.class_name}) · {nice(w.at, { weekday: "short", day: "numeric", month: "short" })}</p>
              <p className="fam-note-text">{w.text.slice(0, 220)}{w.text.length > 220 ? "…" : ""}</p>
              <p className="small muted">{w.status_label}{w.handled_by ? ` · ${w.handled_by}` : ""}</p></div>
          </li>
        ))}
      </ul>
      {open && <WorryDetail w={open} onClose={() => setOpen(null)} onDone={() => { setOpen(null); void load(); }} />}
    </section>
  );
}

function WorryDetail({ w, onClose, onDone }: { w: StaffWorry; onClose: () => void; onDone: () => void }) {
  const [reply, setReply] = useState(w.reply ?? "");
  const [note, setNote] = useState("");
  const [busy, error, run] = useBusy();
  const save = (status?: string) => run(async () => { await api.raw("PUT", `/api/worries/${w.id}`, { status: status ?? null, reply: reply !== (w.reply ?? "") ? reply : null, note: note || null }); onDone(); });
  return (
    <Modal title={`${w.kind_label}${w.urgent ? " (urgent)" : ""}`} onClose={onClose} wide>
      <div className="stack">
        {w.student && <div className="row">{w.student.thumb ? <img src={w.student.thumb} alt="" className="pf-thumb" /> : <Avatar name={w.student.name} size={40} />}
          <span><a href={`#/student/${w.student.id}`}><b>{w.student.name}</b></a><small className="muted block">{w.student.class_name} · {new Date(w.at).toLocaleString("en-GB")}</small></span></div>}
        <p className="sp-worry-text">{w.text}</p>
        <dl className="fam-facts">{w.about && <div><dt>About</dt><dd>{w.about}</dd></div>}{w.where && <div><dt>Where</dt><dd>{w.where}</dd></div>}<div><dt>Now</dt><dd>{w.status_label}</dd></div></dl>
        {w.notes.length > 0 && <ul className="fam-journey">{w.notes.map((n, i) => <li key={i}><span className="muted small">{new Date(n.at).toLocaleString("en-GB")} · {n.by}</span>{n.text}</li>)}</ul>}
        <Field label="Reply to the student (they see this)"><textarea rows={2} maxLength={500} value={reply} onChange={(e) => setReply(e.target.value)} placeholder="e.g. Thank you for telling me. Come and see me at break." /></Field>
        <Field label="Private note for the safeguarding team"><textarea rows={2} maxLength={1000} value={note} onChange={(e) => setNote(e.target.value)} placeholder="What was done, who was spoken to" /></Field>
        {error && <p className="error">{error}</p>}
        <div className="row wrap">
          {w.status === "new" && <button disabled={busy} onClick={() => save("seen")}>Mark as seen</button>}
          <button disabled={busy} onClick={() => save("acting")}>Looking into it</button>
          <button className="danger-soft" disabled={busy} onClick={() => save("closed")}>Close</button>
          <span className="grow" /><button className="primary" disabled={busy || (!note && reply === (w.reply ?? ""))} onClick={() => save()}>Save</button>
        </div>
      </div>
    </Modal>
  );
}

// ---------- Staff: requests to join my clubs; a student's goals on their profile ----------

interface ClubReq { id: string; club: string; club_id: string; student: { id: string; name: string; thumb: string | null; class_name: string | null }; why: string | null; at: string }

export function ClubRequestsCard({ schoolId }: { schoolId: string }) {
  const [list, setList] = useState<ClubReq[]>([]);
  const [busy, , run] = useBusy();
  const load = () => api.raw<ClubReq[]>("GET", `/api/me/schools/${schoolId}/club-requests`).then(setList).catch(() => setList([]));
  useEffect(() => { void load(); }, [schoolId]); // eslint-disable-line react-hooks/exhaustive-deps
  if (list.length === 0) return null;
  return (
    <section className="card editor portal-card" style={hue("fuchsia")}>
      <div className="card-head"><h2 className="with-glyph"><Glyph icon="club" hue="fuchsia" size={34} />Asking to join ({list.length})</h2></div>
      <ul className="mini-list">{list.map((r) => (
        <li key={r.id}>{r.student.thumb ? <img src={r.student.thumb} alt="" className="pf-thumb" /> : <Avatar name={r.student.name} size={32} />}
          <span className="grow"><a href={`#/student/${r.student.id}`}><b>{r.student.name}</b></a> <span className="muted">{r.student.class_name}</span>
            <small className="block">{r.club}{r.why ? ` · “${r.why}”` : ""}</small></span>
          <button className="small-btn primary" disabled={busy} onClick={() => run(async () => { await api.raw("POST", `/api/club-requests/${r.id}/decide`, { accept: true }); await load(); })}>Accept</button>
          <button className="small-btn" disabled={busy} onClick={() => run(async () => { await api.raw("POST", `/api/club-requests/${r.id}/decide`, { accept: false, note: "The club is full this term" }); await load(); })}>Not now</button></li>))}</ul>
    </section>
  );
}

export function StudentGoalsCard({ studentId, name, canNote }: { studentId: string; name: string; canNote: boolean }) {
  const [goals, setGoals] = useState<Goal[] | null>(null);
  const [note, setNote] = useState<Record<string, string>>({});
  const [busy, , run] = useBusy();
  const load = () => api.raw<Goal[]>("GET", `/api/students/${studentId}/goals`).then(setGoals).catch(() => setGoals([]));
  useEffect(() => { void load(); }, [studentId]); // eslint-disable-line react-hooks/exhaustive-deps
  if (!goals || goals.length === 0) return null;
  return (
    <section className="card g-card wide" style={hue("violet")}>
      <h3 className="with-glyph"><Glyph icon="target" hue="violet" size={30} />{name}'s goals</h3>
      <div className="sp-goals">{goals.map((g) => (
        <div key={g.id} className="sp-goal">
          <div className="row"><span className="setup-ring" style={{ ["--pct" as string]: `${g.progress}%` }}><b>{g.progress}%</b></span>
            <span className="grow"><b>{g.title}</b><small className="muted block">{g.area_label} · {g.status === "done" ? "reached 🎉" : "working on it"}</small></span></div>
          {g.updates[0] && <p className="small muted">“{g.updates[0].text}”</p>}
          {g.teacher_note && <p className="sp-note"><Icon name="message" size={13} />{g.teacher_note}</p>}
          {canNote && <div className="row"><input className="grow" placeholder="A word of encouragement" maxLength={300} value={note[g.id] ?? ""} onChange={(e) => setNote({ ...note, [g.id]: e.target.value })} />
            <button className="small-btn" disabled={busy || (note[g.id] ?? "").trim().length < 2} onClick={() => run(async () => { await api.raw("PUT", `/api/goals/${g.id}/teacher-note`, { note: note[g.id] }); setNote({ ...note, [g.id]: "" }); await load(); })}>Send</button></div>}
        </div>))}</div>
    </section>
  );
}
