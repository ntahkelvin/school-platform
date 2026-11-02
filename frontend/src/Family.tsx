// The family portal: parents see their own children, students see themselves. Phone first: most parents will use a phone.
import { useEffect, useMemo, useState } from "react";
import { api, errorText, type Me } from "./api";
import { InsightList, useBusy } from "./GrowthBits";
import type { Insight } from "./growthApi";
import Icon from "./Icon";
import Layout from "./Layout";
import { href } from "./router";
import { Avatar, Field, Glyph, hue, Modal, nicePhone } from "./ui";
import { WeekGrid, type Grid, type Today as TodayLessons } from "./Timetable";
import { subjectLook } from "./look";

// ---------- API ----------

interface Today { key: string; text: string; hue: string }
interface ChildCard {
  id: string; first_name: string; name: string; nickname: string | null; photo: string | null; gender: string; class_name: string | null; school_id: string;
  house: string | null; house_colour: string | null; boarder: boolean; is_me: boolean; status: string; today: Today; attendance: number | null;
  points_30: number; late_books: number; latest_award: string | null; birthday_in: number | null;
}
interface SchoolCard { id: string; name: string; logo: string | null; colour: string | null; motto: string | null; phone: string | null; email: string | null; address: string | null; welcome: string | null }
export interface FamilyNote {
  id: string; student_id: string; student: string; class_name: string | null; kind: string; kind_label: string; from_date: string; to_date: string | null; text: string;
  collector: string | null; collector_phone: string | null; by: string | null; at: string; seen_by: string | null; seen_at: string | null; reply: string | null;
}
interface FamilyHome { name: string; is_student: boolean; children: ChildCard[]; schools: SchoolCard[]; notes: FamilyNote[]; note_kinds: Record<string, string> }
interface ChildView {
  how: "parent" | "self"; school: SchoolCard; settings: { sickbay: boolean; conduct: boolean };
  student: { id: string; full_name: string; first_name: string; nickname: string | null; admission_no: string; gender: string; photo: string | null; boarder: boolean;
    leadership: string | null; talents: string[]; status: string; date_of_birth: string | null; birthday_in: number | null };
  today: Today;
  placement: { class: { name: string; form_teacher: string | null } | null; house: { name: string; colour: string | null; master: string | null } | null;
    bed: { hostel: string | null; house_parent: string | null } | null; bus: { route: string; stop: string | null } | null;
    clubs: { name: string; role: string; patron: string | null }[]; subjects: { name: string; teacher: string | null; elective: boolean }[] };
  attendance: { rate_30: number | null; rate_prev: number | null; rate_90: number | null; days: number; absent: number; late: number; streak: number; calendar: { date: string; status: string; kind: string }[] };
  conduct: { total: number; last_30: number; demerits_30: number; entries: { label: string; points: number; note: string | null; by: string | null; at: string }[] } | null;
  awards: { title: string; level: string; on_date: string; note: string | null }[];
  health: { allergies: string | null; diet: string | null; blood_group: string | null; genotype: string | null;
    visits: { at: string; complaint: string; outcome: string; temperature: number | null; parent_informed: boolean }[] | null };
  library: { out: { title: string; due_on: string; late: number }[]; read: { title: string; author: string | null; at: string }[]; this_term: number };
  passes: { code: string | null; reason: string; status: string; leave_at: string; return_by: string | null; escort: string | null }[];
  open_pass: boolean;
  houses: { name: string; colour: string | null; points: number; mine: boolean }[];
  family: { name: string; relationship: string; phone: string | null; can_pick_up: boolean; is_me: boolean }[];
  notes: FamilyNote[]; journey: { at: string; text: string }[]; note_kinds: Record<string, string>; highlights: Insight[];
  timetable: (Grid & TodayLessons) | null;
}

export const fam = {
  home: () => api.raw<FamilyHome>("GET", "/api/me/family"),
  child: (id: string) => api.raw<ChildView>("GET", `/api/me/children/${id}`),
  note: (id: string, body: unknown) => api.raw<FamilyNote>("POST", `/api/me/children/${id}/notes`, body),
  exeat: (id: string, body: unknown) => api.raw("POST", `/api/me/children/${id}/exeat`, body),
  schoolNotes: (sid: string) => api.raw<FamilyNote[]>("GET", `/api/schools/${sid}/family-notes`),
  seen: (nid: string, reply: string | null) => api.raw<FamilyNote>("PUT", `/api/family-notes/${nid}/seen`, { reply }),
};

const day = (d: string) => new Date(d.length === 10 ? `${d}T12:00:00` : d);
const nice = (d: string, o: Intl.DateTimeFormatOptions = { day: "numeric", month: "short" }) => day(d).toLocaleDateString("en-GB", o);
const isoDay = (x: Date) => `${x.getFullYear()}-${String(x.getMonth() + 1).padStart(2, "0")}-${String(x.getDate()).padStart(2, "0")}`;
function greeting() { const h = new Date().getHours(); return h < 12 ? "Good morning" : h < 17 ? "Good afternoon" : "Good evening"; }
const KIND_LOOK: Record<string, { icon: string; hue: string; emoji: string }> = {
  away: { icon: "calendar-x", hue: "amber", emoji: "🧳" }, sick: { icon: "stethoscope", hue: "rose", emoji: "🤒" },
  collect: { icon: "users", hue: "violet", emoji: "🚗" }, late: { icon: "clock", hue: "sky", emoji: "⏰" }, other: { icon: "message", hue: "teal", emoji: "💬" },
};

function Photo({ src, name, size }: { src: string | null; name: string; size: number }) {
  return src ? <img className="fam-photo" src={src} alt="" width={size} height={size} /> : <Avatar name={name} size={size} />;
}

// ---------- Home ----------

export function FamilyHomePage({ me, onLogout }: { me: Me; onLogout: () => void }) {
  const [d, setD] = useState<FamilyHome | null>(null);
  const [error, setError] = useState("");
  const [tell, setTell] = useState<ChildCard | null>(null);
  const load = () => fam.home().then(setD).catch((e) => setError(errorText(e)));
  useEffect(() => { void load(); }, []);
  if (error) return <Layout me={me} onLogout={onLogout} crumbs={[{ label: "Home" }]}><p className="error">{error}</p></Layout>;
  if (!d) return <Layout me={me} onLogout={onLogout} crumbs={[{ label: "Home" }]}><div className="skeleton" aria-hidden="true"><span /><span /><span /></div></Layout>;
  if (d.is_student && d.children.length === 1) return <ChildPage me={me} onLogout={onLogout} studentId={d.children[0].id} home />;
  const school = d.schools[0];
  const firstName = d.name.replace(/^(mr|mrs|ms|miss|dr|chief|prof|engr|barr)\.?\s+/i, (m) => m).split(" ").slice(0, 2).join(" ");
  return (
    <Layout me={me} onLogout={onLogout} crumbs={[{ label: "Home" }]}>
      <header className="fam-hero" style={{ ["--school" as string]: school?.colour || "#0f7a4f" }}>
        <span className="hero-pattern" aria-hidden="true" />
        {school?.logo && <img className="fam-logo" src={school.logo} alt="" />}
        <div className="fam-hello">
          <small>{d.schools.map((s) => s.name).join(" · ") || "School Platform"}</small>
          <h1>{greeting()}, {firstName} 👋</h1>
          <p>{d.children.length === 0 ? "No children are linked to your login yet. Please call the school." :
            d.children.length === 1 ? `Here is how ${d.children[0].nickname || d.children[0].first_name} is doing.` : `Here is how your ${d.children.length} children are doing.`}</p>
        </div>
      </header>
      {school?.welcome && <p className="fam-welcome"><Icon name="megaphone" size={16} />{school.welcome}</p>}

      <div className="fam-kids">
        {d.children.map((c) => (
          <article key={c.id} className="fam-kid" style={{ ["--hc" as string]: c.house_colour || "var(--accent)" }}>
            <a className="fam-kid-main" href={href({ page: "child", id: c.id })}>
              <span className="fam-kid-photo"><Photo src={c.photo} name={c.name} size={76} />{c.birthday_in === 0 && <span className="fam-cake">🎂</span>}</span>
              <span className="fam-kid-text">
                <b>{c.nickname || c.first_name}</b>
                <small>{c.name}</small>
                <span className="fam-kid-tags">
                  {c.class_name && <span className="class-chip" style={hue("orange")}>{c.class_name}</span>}
                  {c.house && <span className="house-tag"><span className="house-dot" />{c.house}</span>}
                  {c.boarder && <span className="hue-chip" style={hue("indigo")}><Icon name="bed" size={11} />Boarder</span>}
                </span>
              </span>
              <Icon name="chevron-right" size={20} />
            </a>
            <div className="fam-today" style={hue(c.today.hue as never)}><span className="dot" />{c.today.text}</div>
            <div className="fam-nums">
              <span style={hue(c.attendance == null ? "slate" : c.attendance >= 90 ? "green" : c.attendance >= 85 ? "amber" : "red")}><b>{c.attendance == null ? "–" : `${c.attendance}%`}</b>attendance</span>
              <span style={hue(c.points_30 >= 0 ? "amber" : "orange")}><b>{c.points_30 > 0 ? "+" : ""}{c.points_30}</b>points this month</span>
              <span style={hue(c.late_books ? "red" : "sky")}><b>{c.late_books}</b>late books</span>
            </div>
            {c.latest_award && <p className="fam-award"><Icon name="trophy" size={14} />{c.latest_award}</p>}
            {!d.is_student && <button className="fam-tell with-icon" onClick={() => setTell(c)}><Icon name="message" size={15} />Tell the school</button>}
          </article>
        ))}
      </div>

      {d.notes.length > 0 && (
        <section className="card g-card fam-notes-card" style={hue("teal")}>
          <h3 className="with-glyph"><Glyph icon="message" hue="teal" size={30} />Your messages to the school</h3>
          <NoteList notes={d.notes.slice(0, 3)} />
        </section>
      )}

      {d.schools.map((s) => <SchoolContact key={s.id} s={s} />)}
      {tell && <TellSchool childId={tell.id} name={tell.first_name} kinds={d.note_kinds} onClose={() => setTell(null)} onDone={() => { setTell(null); void load(); }} />}
    </Layout>
  );
}

function SchoolContact({ s }: { s: SchoolCard }) {
  return (
    <section className="card fam-contact" style={{ ["--school" as string]: s.colour || "#0f7a4f" }}>
      <div className="row">{s.logo ? <img src={s.logo} alt="" className="fam-logo sm" /> : <Glyph icon="school" hue="green" size={36} />}
        <span><b>{s.name}</b>{s.motto && <small className="muted block">{s.motto}</small>}</span></div>
      <div className="fam-contact-links">
        {s.phone && <a className="button with-icon" href={`tel:${s.phone}`}><Icon name="phone" size={15} />Call {nicePhone(s.phone)}</a>}
        {s.email && <a className="button with-icon" href={`mailto:${s.email}`}><Icon name="mail" size={15} />Email</a>}
      </div>
      {s.address && <p className="muted small"><Icon name="place" size={13} /> {s.address}</p>}
    </section>
  );
}

export function NoteList({ notes, onSeen }: { notes: FamilyNote[]; onSeen?: (n: FamilyNote) => void }) {
  return (
    <ul className="fam-note-list">
      {notes.map((n) => {
        const k = KIND_LOOK[n.kind] ?? KIND_LOOK.other;
        return (
          <li key={n.id} style={hue(k.hue as never)} className={n.seen_at ? "" : "new"}>
            <span className="fam-note-emoji" aria-hidden="true">{k.emoji}</span>
            <div>
              <p><b>{n.kind_label}</b> · {n.student}{n.class_name ? ` (${n.class_name})` : ""} · {nice(n.from_date, { weekday: "short", day: "numeric", month: "short" })}{n.to_date && n.to_date !== n.from_date ? ` to ${nice(n.to_date)}` : ""}</p>
              <p className="fam-note-text">{n.text}</p>
              {n.collector && <p className="small"><Icon name="users" size={12} /> Collecting: <b>{n.collector}</b>{n.collector_phone ? ` · ${nicePhone(n.collector_phone)}` : ""}</p>}
              <p className="small muted">{onSeen ? `From ${n.by ?? "a parent"}, ` : ""}{new Date(n.at).toLocaleString("en-GB", { weekday: "short", day: "numeric", month: "short", hour: "2-digit", minute: "2-digit" })}</p>
              {n.seen_at ? <p className="fam-seen"><Icon name="circle-check" size={13} />Seen by {n.seen_by}{n.reply ? <>: <i>“{n.reply}”</i></> : ""}</p>
                : onSeen ? <button className="small-btn primary" onClick={() => onSeen(n)}>Mark as seen</button> : <p className="small muted">Waiting to be seen</p>}
            </div>
          </li>
        );
      })}
    </ul>
  );
}

// ---------- Telling the school ----------

function TellSchool({ childId, name, kinds, onClose, onDone }: { childId: string; name: string; kinds: Record<string, string>; onClose: () => void; onDone: () => void }) {
  const today = isoDay(new Date());
  const [kind, setKind] = useState("sick");
  const [from, setFrom] = useState(today);
  const [to, setTo] = useState("");
  const [text, setText] = useState("");
  const [collector, setCollector] = useState("");
  const [phone, setPhone] = useState("");
  const [busy, error, run] = useBusy();
  const [sent, setSent] = useState(false);
  if (sent) return (
    <Modal title="Sent" onClose={onDone}>
      <div className="fam-sent"><span>✅</span><h3>The school has your message</h3><p className="muted">{name}'s form teacher{kind === "collect" ? " and the gate" : ""} will see it now. You'll get a notice when they read it.</p>
        <button className="primary" onClick={onDone}>Done</button></div>
    </Modal>
  );
  return (
    <Modal title={`Tell the school about ${name}`} onClose={onClose}>
      <form className="stack" onSubmit={(e) => { e.preventDefault(); run(async () => {
        await fam.note(childId, { kind, from_date: from, to_date: to || null, text, collector: kind === "collect" ? collector : null, collector_phone: kind === "collect" ? phone || null : null });
        setSent(true);
      }); }}>
        <div className="fam-kinds" role="radiogroup" aria-label="What is it about?">
          {Object.entries(kinds).map(([k, label]) => (
            <button type="button" role="radio" aria-checked={kind === k} key={k} className={kind === k ? "on" : ""} style={hue((KIND_LOOK[k] ?? KIND_LOOK.other).hue as never)} onClick={() => setKind(k)}>
              <span>{(KIND_LOOK[k] ?? KIND_LOOK.other).emoji}</span>{label}
            </button>
          ))}
        </div>
        <div className="form-grid">
          <Field label={kind === "collect" || kind === "late" ? "Which day" : "From"}><input type="date" value={from} min={today} onChange={(e) => setFrom(e.target.value)} required /></Field>
          {(kind === "away" || kind === "sick") && <Field label="Until (if more than one day)"><input type="date" value={to} min={from} onChange={(e) => setTo(e.target.value)} /></Field>}
        </div>
        {kind === "collect" && (
          <div className="form-grid">
            <Field label="Who is collecting?"><input value={collector} onChange={(e) => setCollector(e.target.value)} required maxLength={120} placeholder="e.g. Uncle Chidi Okafor" /></Field>
            <Field label="Their phone"><input type="tel" value={phone} onChange={(e) => setPhone(e.target.value)} maxLength={32} /></Field>
          </div>
        )}
        <Field label="Your message"><textarea rows={3} value={text} onChange={(e) => setText(e.target.value)} required minLength={3} maxLength={600}
          placeholder={kind === "sick" ? "e.g. She has a fever and is seeing the doctor today." : kind === "collect" ? "e.g. I am travelling; my brother will pick him up at 2pm." : "Write your message"} /></Field>
        {kind === "collect" && <p className="hint-line"><Icon name="shield" size={14} />The gate will check the person's ID against this message.</p>}
        {error && <p className="error">{error}</p>}
        <div className="row"><span className="grow" /><button type="button" onClick={onClose}>Cancel</button><button className="primary with-icon" disabled={busy}><Icon name="send" size={15} />Send</button></div>
      </form>
    </Modal>
  );
}

function Exeat({ c, me, onClose, onDone }: { c: ChildView; me: Me; onClose: () => void; onDone: () => void }) {
  const mine = c.family.find((f) => f.is_me);
  const local = (x: Date) => `${isoDay(x)}T${String(x.getHours()).padStart(2, "0")}:00`;
  const fri = new Date(); fri.setDate(fri.getDate() + ((5 - fri.getDay() + 7) % 7 || 7)); fri.setHours(14, 0, 0, 0);
  const sun = new Date(fri); sun.setDate(fri.getDate() + 2); sun.setHours(17);
  const [leave, setLeave] = useState(local(fri));
  const [back, setBack] = useState(local(sun));
  const [reason, setReason] = useState("");
  const [escort, setEscort] = useState(me.full_name);
  const [phone, setPhone] = useState(mine?.phone ?? "");
  const [rel, setRel] = useState(mine?.relationship ?? "Parent");
  const [busy, error, run] = useBusy();
  return (
    <Modal title={`Ask for ${c.student.first_name} to come home`} onClose={onClose}>
      <form className="stack" onSubmit={(e) => { e.preventDefault(); run(async () => {
        await fam.exeat(c.student.id, { reason, leave_at: new Date(leave).toISOString(), return_by: new Date(back).toISOString(), escort_name: escort, escort_phone: phone || null, escort_relation: rel || null });
        onDone();
      }); }}>
        <p className="muted small">The house parent or principal will approve it. When it is approved you'll see a pass code here; the gate checks it with the person collecting.</p>
        <div className="form-grid">
          <Field label="Leaving"><input type="datetime-local" value={leave} onChange={(e) => setLeave(e.target.value)} required /></Field>
          <Field label="Back by"><input type="datetime-local" value={back} onChange={(e) => setBack(e.target.value)} required /></Field>
        </div>
        <Field label="Reason"><input value={reason} onChange={(e) => setReason(e.target.value)} required minLength={3} maxLength={300} placeholder="e.g. Family wedding in Enugu" /></Field>
        <div className="form-grid">
          <Field label="Who will collect"><input value={escort} onChange={(e) => setEscort(e.target.value)} required minLength={2} /></Field>
          <Field label="Their phone"><input type="tel" value={phone} onChange={(e) => setPhone(e.target.value)} /></Field>
          <Field label="Relationship"><input value={rel} onChange={(e) => setRel(e.target.value)} /></Field>
        </div>
        {error && <p className="error">{error}</p>}
        <div className="row"><span className="grow" /><button type="button" onClick={onClose}>Cancel</button><button className="primary" disabled={busy}>Ask the school</button></div>
      </form>
    </Modal>
  );
}

// ---------- One child ----------

type Tab = "overview" | "timetable" | "attendance" | "conduct" | "library" | "health" | "school";

export function ChildPage({ me, onLogout, studentId, home = false }: { me: Me; onLogout: () => void; studentId: string; home?: boolean }) {
  const [c, setC] = useState<ChildView | null>(null);
  const [error, setError] = useState("");
  const [tab, setTab] = useState<Tab>("overview");
  const [modal, setModal] = useState<null | "tell" | "exeat">(null);
  const load = () => fam.child(studentId).then(setC).catch((e) => setError(errorText(e)));
  useEffect(() => { void load(); setTab("overview"); }, [studentId]); // eslint-disable-line react-hooks/exhaustive-deps
  const crumbs = home ? [{ label: "Home" }] : [{ label: "Home", href: "#/" }, { label: c?.student.first_name ?? "…" }];
  if (error) return <Layout me={me} onLogout={onLogout} crumbs={crumbs}><p className="error">{error}</p></Layout>;
  if (!c) return <Layout me={me} onLogout={onLogout} crumbs={crumbs}><div className="skeleton" aria-hidden="true"><span /><span /><span /></div></Layout>;
  const s = c.student, self = c.how === "self";
  const colour = c.placement.house?.colour || c.school.colour || "#1e63d6";
  const tabs: [Tab, string, string][] = [["overview", self ? "My day" : "Overview", "sparkle"], ...(c.timetable ? [["timetable", "Timetable", "calendar-days"] as [Tab, string, string]] : []), ["attendance", "Attendance", "attendance"],
    ...(c.conduct ? [["conduct", "Merits and awards", "star"] as [Tab, string, string]] : []), ["library", "Library", "book"],
    ["health", "Health", "heart-pulse"], ["school", self ? "My school" : "Teachers and school", "classes"]];
  return (
    <Layout me={me} onLogout={onLogout} crumbs={crumbs}>
      <header className="stu-hero fam-child-hero" style={{ ["--house" as string]: colour }}>
        <div className="stu-band"><span className="hero-pattern" aria-hidden="true" />
          <div className="hero-actions">
            {!self && <button className="on-band" onClick={() => setModal("tell")}><Icon name="message" size={14} />Tell the school</button>}
            {!self && s.boarder && !c.open_pass && <button className="on-band" onClick={() => setModal("exeat")}><Icon name="home" size={14} />Ask to bring home</button>}
          </div>
        </div>
        <div className="stu-body">
          <span className="stu-photo">{s.photo ? <img src={s.photo} alt="" /> : <Avatar name={s.full_name} size={112} />}</span>
          <div className="stu-text">
            <h1>{self ? `Hi ${s.nickname || s.first_name}! 🌟` : s.full_name}{!self && s.nickname && <small> “{s.nickname}”</small>}</h1>
            <ul className="facts">
              {c.placement.class && <li style={hue("orange")}><Icon name="classes" size={15} />{c.placement.class.name}</li>}
              {c.placement.house && <li className="house-fact" style={{ ["--hc" as string]: c.placement.house.colour || "#888" }}><span className="house-dot" />{c.placement.house.name}</li>}
              <li style={hue("violet")}><Icon name={s.boarder ? "bed" : "home"} size={15} />{s.boarder ? `Boarder${c.placement.bed?.hostel ? ` · ${c.placement.bed.hostel}` : ""}` : "Day student"}</li>
              {s.leadership && <li style={hue("amber")}><Icon name="crown" size={15} />{s.leadership}</li>}
              <li style={hue("indigo")}><Icon name="id-card" size={15} /><span className="mono">{s.admission_no}</span></li>
            </ul>
            <div className="fam-today big" style={hue(c.today.hue as never)}><span className="dot" />{self ? c.today.text.replace("In school today", "You're in school today") : c.today.text}</div>
          </div>
        </div>
      </header>

      <nav className="stu-tabs" role="tablist">
        {tabs.map(([k, l, ic]) => <button key={k} role="tab" aria-selected={tab === k} className={tab === k ? "on" : ""} onClick={() => setTab(k)}><Icon name={ic} size={15} />{l}</button>)}
      </nav>

      <div className="stu-main">
        {tab === "overview" && <Overview c={c} go={setTab} />}
        {tab === "timetable" && c.timetable && <section className="card editor tt-card"><h3 className="with-glyph"><Glyph icon="calendar-days" hue="blue" size={30} />{self ? "My week" : `${s.first_name}'s week`}</h3><WeekGrid g={c.timetable} today={new Date().getDay() - 1} /></section>}
        {tab === "attendance" && <Attendance c={c} />}
        {tab === "conduct" && c.conduct && <Conduct c={c} />}
        {tab === "library" && <Library c={c} />}
        {tab === "health" && <Health c={c} />}
        {tab === "school" && <SchoolTab c={c} />}
      </div>
      {modal === "tell" && <TellSchool childId={s.id} name={s.first_name} kinds={c.note_kinds} onClose={() => setModal(null)} onDone={() => { setModal(null); void load(); }} />}
      {modal === "exeat" && <Exeat c={c} me={me} onClose={() => setModal(null)} onDone={() => { setModal(null); void load(); }} />}
    </Layout>
  );
}

function Overview({ c, go }: { c: ChildView; go: (t: Tab) => void }) {
  const a = c.attendance, self = c.how === "self";
  const pass = c.passes.find((p) => ["requested", "approved", "out"].includes(p.status));
  return (
    <section className="stack">
      {c.highlights.length > 0 && <InsightList items={c.highlights} schoolId={c.school.id} />}
      {c.timetable && c.timetable.today.some((p) => p.cell) && (
        <section className="card g-card" style={hue("blue")}>
          <h3 className="with-glyph"><Glyph icon="calendar-days" hue="blue" size={30} />{self ? "My lessons today" : "Lessons today"}</h3>
          <ol className="today-lessons">{c.timetable.today.filter((p) => p.kind === "lesson").map((p) => <li key={p.id} className={`s-${p.state}${p.cell ? "" : " free"}`} style={p.cell ? hue(subjectLook(p.cell.subject ?? "").hue) : undefined}>
            <span className="tl-time">{p.starts_at}</span>{p.cell ? <><b>{p.cell.subject}</b><span className="muted">{p.cell.teacher ?? ""}</span></> : <span className="muted">Free</span>}</li>)}</ol>
        </section>
      )}
      {pass && (
        <div className={`fam-pass s-${pass.status}`}>
          <Glyph icon="log-out" hue={pass.status === "requested" ? "amber" : "green"} size={40} />
          <div><b>{pass.status === "requested" ? "Going home: waiting for the school to approve" : pass.status === "approved" ? "Going home: approved" : "Out of school now"}</b>
            <span className="muted small block">{new Date(pass.leave_at).toLocaleString("en-GB", { weekday: "short", day: "numeric", month: "short", hour: "2-digit", minute: "2-digit" })}
              {pass.return_by ? ` to ${new Date(pass.return_by).toLocaleString("en-GB", { weekday: "short", day: "numeric", month: "short", hour: "2-digit", minute: "2-digit" })}` : ""}{pass.escort ? ` · with ${pass.escort}` : ""}</span></div>
          {pass.code && <span className="fam-code" title="Show this at the gate">{pass.code}</span>}
        </div>
      )}
      <div className="stat-strip">
        <button className="stat-tile as-button" style={hue(a.rate_30 == null ? "slate" : a.rate_30 >= 90 ? "green" : a.rate_30 >= 85 ? "amber" : "red")} onClick={() => go("attendance")}>
          <Glyph icon="attendance" hue="green" size={44} /><div className="stat-text"><strong>{a.rate_30 == null ? "–" : `${a.rate_30}%`}</strong><span>Attendance, 30 days</span><span className="stat-note">{a.streak} days in a row</span></div></button>
        {c.conduct && <button className="stat-tile as-button" style={hue("amber")} onClick={() => go("conduct")}>
          <Glyph icon="star" hue="amber" size={44} /><div className="stat-text"><strong>{c.conduct.last_30 > 0 ? "+" : ""}{c.conduct.last_30}</strong><span>Points this month</span><span className="stat-note">{c.awards.length} award{c.awards.length === 1 ? "" : "s"}</span></div></button>}
        <button className="stat-tile as-button" style={hue("sky")} onClick={() => go("library")}>
          <Glyph icon="book" hue="sky" size={44} /><div className="stat-text"><strong>{c.library.this_term}</strong><span>Books this term</span><span className="stat-note">{c.library.out.length} out now</span></div></button>
      </div>
      {c.houses.length > 1 && (
        <section className="card g-card" style={hue("amber")}>
          <h3 className="with-glyph"><Glyph icon="trophy" hue="amber" size={30} />House league</h3>
          <ol className="fam-league">
            {c.houses.map((h, i) => {
              const max = Math.max(1, ...c.houses.map((x) => x.points));
              return <li key={h.name} className={h.mine ? "mine" : ""} style={{ ["--hc" as string]: h.colour || "#888" }}>
                <span className="fam-rank">{["🥇", "🥈", "🥉"][i] ?? i + 1}</span><span className="fam-hname">{h.name}{h.mine ? (self ? " (yours)" : " (their house)") : ""}</span>
                <span className="fam-bar"><span style={{ width: `${Math.max(4, (100 * Math.max(0, h.points)) / max)}%` }} /></span><b>{h.points}</b></li>;
            })}
          </ol>
        </section>
      )}
      {c.notes.length > 0 && !self && (
        <section className="card g-card" style={hue("teal")}>
          <h3 className="with-glyph"><Glyph icon="message" hue="teal" size={30} />Messages to the school</h3>
          <NoteList notes={c.notes.slice(0, 3)} />
        </section>
      )}
      {c.journey.length > 0 && (
        <section className="card g-card" style={hue("indigo")}>
          <h3 className="with-glyph"><Glyph icon="history" hue="indigo" size={30} />{self ? "My journey" : "Their journey"}</h3>
          <ul className="fam-journey">{c.journey.slice(0, 8).map((j, i) => <li key={i}><span className="muted small">{nice(j.at, { day: "numeric", month: "short", year: "numeric" })}</span>{j.text}</li>)}</ul>
        </section>
      )}
    </section>
  );
}

function Attendance({ c }: { c: ChildView }) {
  const a = c.attendance;
  const weeks = useMemo(() => {
    const by = new Map(a.calendar.filter((x) => x.kind === "school").map((x) => [x.date, x.status]));
    const now = new Date(); const start = new Date(now); start.setDate(now.getDate() - 41 - ((now.getDay() + 6) % 7));
    return Array.from({ length: 7 }, (_, w) => Array.from({ length: 7 }, (_, d) => { const x = new Date(start); x.setDate(start.getDate() + w * 7 + d); const k = isoDay(x); return { date: k, status: by.get(k), future: x > now }; }));
  }, [a.calendar]);
  return (
    <section className="stack">
      <div className="stat-strip">
        <div className="stat-tile" style={hue(a.rate_30 != null && a.rate_30 < 85 ? "red" : "green")}><Glyph icon="attendance" hue="green" size={44} /><div className="stat-text"><strong>{a.rate_30 == null ? "–" : `${a.rate_30}%`}</strong><span>last 30 days</span></div></div>
        <div className="stat-tile" style={hue("red")}><Glyph icon="circle-x" hue="red" size={44} /><div className="stat-text"><strong>{a.absent}</strong><span>days absent</span><span className="stat-note">in 3 months</span></div></div>
        <div className="stat-tile" style={hue("amber")}><Glyph icon="clock" hue="amber" size={44} /><div className="stat-text"><strong>{a.late}</strong><span>times late</span></div></div>
        <div className="stat-tile" style={hue("orange")}><Glyph icon="flame" hue="orange" size={44} /><div className="stat-text"><strong>{a.streak}</strong><span>days in a row</span></div></div>
      </div>
      <section className="card g-card" style={hue("green")}>
        <h3 className="with-glyph"><Glyph icon="calendar" hue="green" size={30} />The last 6 weeks</h3>
        <div className="att-cal">
          <div className="att-row head">{["M", "T", "W", "T", "F", "S", "S"].map((d, i) => <span key={i}>{d}</span>)}</div>
          {weeks.map((w, i) => <div key={i} className="att-row">{w.map((x) => <span key={x.date} className={`att-day s-${x.status ?? "none"}`} style={x.future ? { opacity: 0.35 } : undefined} title={`${nice(x.date, { weekday: "short", day: "numeric", month: "short" })}: ${x.status ?? "no register"}`}>{day(x.date).getDate()}</span>)}</div>)}
        </div>
        <p className="radar-key"><span className="key s-present" />Present<span className="key s-late" />Late<span className="key s-absent" />Absent<span className="key s-excused" />Excused</p>
      </section>
    </section>
  );
}

function Conduct({ c }: { c: ChildView }) {
  const k = c.conduct!;
  return (
    <section className="stack">
      {c.awards.length > 0 && (
        <div className="fam-awards">{c.awards.map((w, i) => <div key={i} className="fam-award-card"><span>🏆</span><b>{w.title}</b><small>{w.level} · {nice(w.on_date, { day: "numeric", month: "short", year: "numeric" })}</small></div>)}</div>
      )}
      <section className="card g-card" style={hue("amber")}>
        <h3 className="with-glyph"><Glyph icon="star" hue="amber" size={30} />Merits and demerits <span className="muted small">({k.total > 0 ? "+" : ""}{k.total} in all)</span></h3>
        {k.entries.length === 0 ? <p className="muted">Nothing yet.</p> : (
          <ul className="mini-list">{k.entries.slice(0, 30).map((e, i) => (
            <li key={i}><span className={`pts ${e.points > 0 ? "up" : "down"}`}>{e.points > 0 ? "+" : ""}{e.points}</span>
              <span><b>{e.label}</b>{e.note && <span className="muted"> · {e.note}</span>}<small className="muted block">{nice(e.at, { day: "numeric", month: "short" })}{e.by ? ` · ${e.by}` : ""}</small></span></li>))}</ul>
        )}
      </section>
    </section>
  );
}

function Library({ c }: { c: ChildView }) {
  return (
    <section className="stack">
      <section className="card g-card" style={hue("sky")}>
        <h3 className="with-glyph"><Glyph icon="book" hue="sky" size={30} />Out now</h3>
        {c.library.out.length === 0 ? <p className="muted">No library books out.</p> :
          <ul className="mini-list">{c.library.out.map((b, i) => <li key={i}><Icon name="book" size={16} /><span><b>{b.title}</b><small className={`block ${b.late ? "danger-text" : "muted"}`}>{b.late ? `${b.late} days late. Please bring it back.` : `Due ${nice(b.due_on, { weekday: "short", day: "numeric", month: "short" })}`}</small></span></li>)}</ul>}
      </section>
      <section className="card g-card" style={hue("violet")}>
        <h3 className="with-glyph"><Glyph icon="book-marked" hue="violet" size={30} />Books read recently</h3>
        {c.library.read.length === 0 ? <p className="muted">None yet. The library is waiting!</p> :
          <div className="fam-shelf">{c.library.read.map((b, i) => <span key={i} className="fam-book" style={hue((["violet", "sky", "teal", "orange", "rose", "indigo"] as const)[i % 6])}><b>{b.title}</b>{b.author && <small>{b.author}</small>}</span>)}</div>}
      </section>
    </section>
  );
}

function Health({ c }: { c: ChildView }) {
  const h = c.health;
  return (
    <section className="stack">
      <section className="card g-card" style={hue("rose")}>
        <h3 className="with-glyph"><Glyph icon="heart-pulse" hue="rose" size={30} />What the school knows</h3>
        <dl className="fam-facts">
          <div><dt>Allergies</dt><dd>{h.allergies || "None recorded"}</dd></div>
          <div><dt>Diet</dt><dd>{h.diet || "None recorded"}</dd></div>
          <div><dt>Blood group</dt><dd>{h.blood_group || "–"}</dd></div>
          <div><dt>Genotype</dt><dd>{h.genotype || "–"}</dd></div>
        </dl>
        <p className="muted small">Something wrong or missing? Use “Tell the school” so the nurse can update it.</p>
      </section>
      {h.visits && (
        <section className="card g-card" style={hue("teal")}>
          <h3 className="with-glyph"><Glyph icon="stethoscope" hue="teal" size={30} />Sick bay visits</h3>
          {h.visits.length === 0 ? <p className="muted">No visits. 💪</p> :
            <ul className="mini-list">{h.visits.map((v, i) => <li key={i}><Icon name="stethoscope" size={16} /><span><b>{v.complaint}</b><span className="muted"> · {v.outcome}{v.temperature ? ` · ${v.temperature}°C` : ""}</span>
              <small className="muted block">{new Date(v.at).toLocaleString("en-GB", { weekday: "short", day: "numeric", month: "short", hour: "2-digit", minute: "2-digit" })}</small></span></li>)}</ul>}
        </section>
      )}
    </section>
  );
}

function SchoolTab({ c }: { c: ChildView }) {
  const p = c.placement, self = c.how === "self";
  const people: [string, string | null | undefined, string][] = [["Form teacher", p.class?.form_teacher, "user"], ["House master", p.house?.master, "house"],
    ["House parent", p.bed?.house_parent, "bed"]];
  return (
    <section className="stack">
      <div className="fam-people">
        {people.filter(([, n]) => n).map(([role, n, ic]) => <div key={role} className="fam-person"><Avatar name={n!} size={44} /><span><b>{n}</b><small>{role}</small></span><Icon name={ic} size={16} /></div>)}
        {p.bus && <div className="fam-person"><Glyph icon="bus" hue="amber" size={44} /><span><b>{p.bus.route}</b><small>School bus{p.bus.stop ? ` · stop: ${p.bus.stop}` : ""}</small></span></div>}
      </div>
      {p.subjects.length > 0 && (
        <section className="card g-card" style={hue("blue")}>
          <h3 className="with-glyph"><Glyph icon="book-text" hue="blue" size={30} />{self ? "My subjects" : "Subjects and teachers"}</h3>
          <ul className="fam-subjects">{p.subjects.map((x) => <li key={x.name}><b>{x.name}</b>{x.elective && <span className="hue-chip" style={hue("violet")}>Elective</span>}<small className="muted">{x.teacher ?? "Teacher to be named"}</small></li>)}</ul>
        </section>
      )}
      {p.clubs.length > 0 && (
        <section className="card g-card" style={hue("fuchsia")}>
          <h3 className="with-glyph"><Glyph icon="club" hue="fuchsia" size={30} />Clubs</h3>
          <ul className="mini-list">{p.clubs.map((x) => <li key={x.name}><Icon name="club" size={16} /><span><b>{x.name}</b><span className="muted"> · {x.role}{x.patron ? ` · patron ${x.patron}` : ""}</span></span></li>)}</ul>
        </section>
      )}
      {!self && (
        <section className="card g-card" style={hue("teal")}>
          <h3 className="with-glyph"><Glyph icon="users" hue="teal" size={30} />Family on record</h3>
          <ul className="mini-list">{c.family.map((f, i) => <li key={i}><Avatar name={f.name} size={30} /><span><b>{f.name}{f.is_me ? " (you)" : ""}</b><span className="muted"> · {f.relationship}{f.phone ? ` · ${nicePhone(f.phone)}` : ""}</span>
            <small className="muted block">{f.can_pick_up ? "Allowed to collect from school" : "Not listed to collect"}</small></span></li>)}</ul>
          <p className="muted small">To change who can collect your child, please tell the school.</p>
        </section>
      )}
      <SchoolContact s={c.school} />
    </section>
  );
}
