// Student 360: one page with everything the school knows about a student, from every part of the platform.
import RecordPage from "./Records";
import { Fragment, useCallback, useEffect, useMemo, useState, type FormEvent } from "react";
import {
  api, errorText, getToken,
  type BranchDetail, type GuardianInput, type Me, type NewLogin, type SchoolClass, type StudentDetail,
} from "./api";
import { InsightList, useBusy } from "./GrowthBits";
import Icon from "./Icon";
import Layout from "./Layout";
import { subjectLook } from "./look";
import { AskAccess } from "./Rights";
import { href } from "./router";
import { HealthModal } from "./SickBay";
import StudentForm, { checkGuardian, emptyGuardian, GuardianFields } from "./StudentForm";
import { records, type Item } from "./structureApi";
import type { Insight } from "./growthApi";
import { Avatar, Empty, Field, Glyph, hue, Modal, NewLoginNotice, Stat } from "./ui";
import { IdCards, LeaveForm, Letter, makeThumb } from "./StudentYear";
import { NoteList, type FamilyNote } from "./Family";
import { NotYours } from "./ClassPage";
import { StudentGoalsCard } from "./StudentPortal";
import { WeekGrid, type Grid } from "./Timetable";
import { SeenForm } from "./FamilyAdmin";

// ---------- Types ----------

interface Guardian { link_id: string; user_id: string; name: string; relationship: string; phone: string | null; email: string | null; is_primary: boolean; emergency: boolean;
  can_pick_up: boolean; lives_with: boolean; occupation: string | null; address: string | null; has_login: boolean; other_children: { id: string; name: string; class_name: string | null }[] }
interface Profile {
  access: { full: boolean; edit: boolean; teacher: boolean; health: boolean; safeguarding: boolean; why: string };
  student: { id: string; admission_no: string; first_name: string; middle_name: string | null; last_name: string; full_name: string; nickname: string | null; gender: string;
    date_of_birth: string | null; age: number | null; boarding_status: string; status: string; photo: string | null; has_thumb?: boolean; leadership: string | null; talents: string[];
    class_id: string | null; house_id: string | null; branch_id: string; school_id: string; school_name: string; school_colour: string | null; birthday_in: number | null };
  personal: Record<string, string | null | boolean> & { has_nin: boolean; has_support_needs: boolean };
  family: { guardians: Guardian[]; contacts: { id: string; name: string; phone: string | null; relationship: string; photo: string | null; note: string | null }[] };
  placement: { class: { id: string; name: string; level: string; form_teacher: string | null } | null; house: { id: string; name: string; colour: string | null; master: string | null } | null;
    bed: { hostel: string | null; room: string | null; bed: string; house_parent: string | null } | null; bus: { route: string; stop: string | null } | null;
    clubs: { id: string; name: string; role: string; patron: string | null }[]; subjects: { name: string; teacher: string | null; elective: boolean }[] };
  attendance: { rate_30: number | null; rate_prev: number | null; rate_90: number | null; days: number; absent: number; late: number; streak: number;
    worst_day: [string, number] | null; calendar: { date: string; status: string; kind: string }[] };
  health: { allergies: string | null; diet: string | null; alert: boolean; record: Record<string, string | null> | null;
    visits: { at: string; complaint: string; outcome: string; temperature: number | null }[] | null; visit_count_30: number | null };
  incidents: { id: string; number: number; kind: string; severity: string; summary: string; status: string; at: string }[] | null; incident_count: number | null;
  passes: { kind: string; reason: string; status: string; leave_at: string; return_by: string | null; escort: string | null; returned_at: string | null }[];
  visitors: { name: string; kind: string; purpose: string; at: string }[];
  library: { out: { title: string; due_on: string; late: number }[]; total: number; this_term: number; recent: { title: string; at: string }[] };
  conduct: { total: number; merits: number; demerits: number; last_30: number; demerits_30: number;
    entries: { id: string; kind: string; category: string; label: string; points: number; note: string | null; by: string | null; by_id: string | null; at: string }[] };
  awards: { id: string; title: string; level: string; on_date: string; note: string | null; by: string | null }[];
  notes: { id: string; text: string; private: boolean; by: string | null; by_id: string | null; at: string }[];
  documents: { id: string; kind: string; label: string; filename: string; size: number; at: string; by: string | null }[] | null;
  completeness: { percent: number; missing: string[] } | null;
  timeline: { at: string; kind: string; icon: string; hue: string; title: string; detail: string }[];
  insights: Insight[];
  from_home: FamilyNote[];
  timetable: Grid | null;
}
interface StuMeta { merits: Record<string, { label: string; points: number }>; demerits: Record<string, { label: string; points: number }>; documents: Record<string, string>; award_levels: Record<string, string> }

const sapi = {
  profile: (id: string) => api.raw<Profile>("GET", `/api/students/${id}/profile`),
  meta: () => api.raw<StuMeta>("GET", "/api/student-meta"),
  personal: (id: string, body: Record<string, unknown>) => api.raw<Profile>("PUT", `/api/students/${id}/personal`, body),
  photo: async (id: string, photo: string | null) => api.raw<{ photo: string | null }>("PUT", `/api/students/${id}/photo`, { photo, thumb: photo ? (await makeThumb(photo)) || null : null }),
  support: (id: string, support_needs: string | null) => api.raw("PUT", `/api/students/${id}/support`, { support_needs }),
  guardian: (id: string, link: string, body: Record<string, unknown>) => api.raw<Profile>("PUT", `/api/students/${id}/guardians/${link}`, body),
  addContact: (id: string, body: Record<string, unknown>) => api.raw<Profile>("POST", `/api/students/${id}/contacts`, body),
  removeContact: (id: string, cid: string) => api.raw<Profile>("DELETE", `/api/students/${id}/contacts/${cid}`),
  clubs: (id: string, clubs: { club_id: string; role: string }[]) => api.raw<Profile>("PUT", `/api/students/${id}/clubs`, { clubs }),
  conduct: (id: string, category: string, note: string | null) => api.raw<Profile>("POST", `/api/students/${id}/conduct`, { category, note }),
  removeConduct: (eid: string) => api.raw<Profile>("DELETE", `/api/conduct/${eid}`),
  award: (id: string, body: Record<string, unknown>) => api.raw<Profile>("POST", `/api/students/${id}/awards`, body),
  removeAward: (aid: string) => api.raw<Profile>("DELETE", `/api/awards/${aid}`),
  note: (id: string, text: string, priv: boolean) => api.raw<Profile>("POST", `/api/students/${id}/notes`, { text, private: priv }),
  removeNote: (nid: string) => api.raw<Profile>("DELETE", `/api/student-notes/${nid}`),
  removeDoc: (id: string, did: string) => api.raw<Profile>("DELETE", `/api/students/${id}/documents/${did}`),
};
let metaP: Promise<StuMeta> | null = null;
const loadMeta = () => (metaP ??= sapi.meta().catch((e) => { metaP = null; throw e; }));

const day = (d: string) => new Date(d.length === 10 ? `${d}T12:00:00` : d);
const nice = (d: string | null, o: Intl.DateTimeFormatOptions = { day: "numeric", month: "short", year: "numeric" }) => (d ? day(d).toLocaleDateString("en-GB", o) : "–");

type Tab = "overview" | "record" | "about" | "school" | "attendance" | "health" | "conduct" | "library" | "timeline" | "documents";

export default function StudentPage({ me, onLogout, studentId }: { me: Me; onLogout: () => void; studentId: string }) {
  const [p, setP] = useState<Profile | null>(null);
  const [error, setError] = useState("");
  const [tab, setTab] = useState<Tab>("overview");
  const [modal, setModal] = useState<null | "edit" | "personal" | "guardian" | "merit" | "photo" | "leave" | "card" | "transfer" | "testimonial">(null);
  const [more, setMore] = useState(false);
  const [seen, setSeen] = useState<FamilyNote | null>(null);
  const [detail, setDetail] = useState<StudentDetail | null>(null);
  const [branch, setBranch] = useState<BranchDetail | null>(null);
  const [classes, setClasses] = useState<SchoolClass[]>([]);
  const [newLogin, setNewLogin] = useState<NewLogin | null>(null);
  const load = useCallback(() => { sapi.profile(studentId).then(setP).catch((e) => setError(errorText(e))); }, [studentId]);
  useEffect(load, [load]);
  useEffect(() => { setTab("overview"); }, [studentId]);
  // Older photos had no small copy for lists: make one the first time someone who can edit opens the profile.
  useEffect(() => {
    if (p && p.student.photo && !p.student.has_thumb && p.access.edit) void sapi.photo(p.student.id, p.student.photo).catch(() => {});
  }, [p?.student.id]); // eslint-disable-line react-hooks/exhaustive-deps
  const openEdit = async () => {
    try {
      const s = await api.student(studentId);
      const [b, c] = await Promise.all([api.branch(s.branch_id), api.classes(s.branch_id)]);
      setDetail(s); setBranch(b); setClasses(c); setModal("edit");
    } catch (e) { setError(errorText(e)); }
  };
  if (error) return <Layout me={me} onLogout={onLogout} crumbs={[{ label: "Home", href: "#/" }, { label: "Student" }]}><NotYours text="This student isn't one of yours." /></Layout>;
  if (!p) return <Layout me={me} onLogout={onLogout} crumbs={[{ label: "Home", href: "#/" }]}><p className="muted">Loading…</p></Layout>;
  const s = p.student;
  const a = p.access;
  const crumbs = [{ label: "Home", href: "#/" }, ...(a.full ? [{ label: s.school_name, href: href({ page: "school", id: s.school_id, tab: "students" }) }] : []), { label: s.full_name }];
  const colour = p.placement.house?.colour || s.school_colour || "#1e63d6";
  const tabs: [Tab, string, string][] = [["overview", "Overview", "sparkle"], ["record", "Academic record", "graduation-cap"], ["about", "About and family", "users"], ["school", "School life", "classes"],
    ["attendance", "Attendance", "attendance"], ["health", "Health", "heart-pulse"], ["conduct", "Conduct and awards", "star"], ["library", "Library", "book"],
    ["timeline", "Timeline", "history"], ...(a.full ? [["documents", "Documents", "file"] as [Tab, string, string]] : [])];
  return (
    <Layout wide me={me} onLogout={onLogout} crumbs={crumbs}>
      <header className="stu-hero" style={{ ["--house" as string]: colour }}>
        <div className="stu-band"><span className="hero-pattern" aria-hidden="true" />
          <div className="hero-actions">
            {a.edit && <button className="on-band" onClick={openEdit}>Edit name, class or status</button>}
            {(a.edit || a.teacher) && <button className="on-band" onClick={() => setModal("merit")}><Icon name="star" size={14} />Give a merit</button>}
            {a.full && <button className="on-band" onClick={() => setMore(true)}><Icon name="printer" size={14} />Print and more</button>}
          </div>
        </div>
        <div className="stu-body">
          <button className="stu-photo" disabled={!a.edit} onClick={() => setModal("photo")} aria-label={a.edit ? "Change photo" : "Photo"}>
            {s.photo ? <img src={s.photo} alt="" /> : <Avatar name={s.full_name} size={112} />}
            {a.edit && <span className="photo-edit"><Icon name="edit" size={14} /></span>}
          </button>
          <div className="stu-text">
            <h1>{s.full_name}{s.nickname && <small> “{s.nickname}”</small>}</h1>
            <ul className="facts">
              <li style={hue("indigo")}><Icon name="id-card" size={15} /><span className="mono">{s.admission_no}</span></li>
              {p.placement.class && <li style={hue("orange")}><Icon name="classes" size={15} /><a className="fact-link" href={href({ page: "class", id: p.placement.class.id })}>{p.placement.class.name}</a></li>}
              {p.placement.house && <li className="house-fact" style={{ ["--hc" as string]: p.placement.house.colour || "#888" }}><span className="house-dot" />{p.placement.house.name}</li>}
              <li style={hue("violet")}><Icon name={s.boarding_status === "boarder" ? "bed" : "home"} size={15} />{s.boarding_status === "boarder" ? `Boarder${p.placement.bed ? ` · ${p.placement.bed.hostel}, ${p.placement.bed.bed}` : ""}` : "Day student"}</li>
              {s.age != null && <li style={hue("teal")}><Icon name="sparkle" size={15} />{s.age} years{s.birthday_in != null && s.birthday_in <= 7 ? ` · birthday ${s.birthday_in === 0 ? "today 🎂" : `in ${s.birthday_in} days`}` : ""}</li>}
              {s.leadership && <li style={hue("amber")}><Icon name="crown" size={15} />{s.leadership}</li>}
              {s.status !== "active" && <li style={hue("slate")}><Icon name="flag" size={15} />{s.status === "graduated" ? "Graduated" : "Left the school"}</li>}
            </ul>
            <div className="stu-alerts">
              {p.health.allergies && <span className="alert-chip red"><Icon name="circle-x" size={14} />Allergic: {p.health.allergies}</span>}
              {p.health.diet && <span className="alert-chip amber"><Icon name="utensils" size={14} />{p.health.diet}</span>}
              {p.library.out.some((b) => b.late) && <span className="alert-chip sky"><Icon name="book" size={14} />Overdue library book</span>}
              {p.attendance.rate_30 != null && p.attendance.rate_30 < 85 && <span className="alert-chip red"><Icon name="attendance" size={14} />Attendance {p.attendance.rate_30}%</span>}
              {p.personal.has_support_needs && <span className="alert-chip violet"><Icon name="heart" size={14} />Learning support</span>}
            </div>
          </div>
          {p.completeness && (
            <div className="stu-complete" title={p.completeness.missing.length ? `Missing: ${p.completeness.missing.join(", ")}` : "Complete"}>
              <span className="setup-ring" style={{ ...hue(p.completeness.percent >= 80 ? "green" : p.completeness.percent >= 50 ? "amber" : "red"), ["--pct" as string]: `${p.completeness.percent}%` }}><b>{p.completeness.percent}%</b></span>
              <small>profile complete</small>
            </div>
          )}
        </div>
        {!a.full && <p className="stu-why"><Icon name="eye" size={14} />You see this profile as {a.why.toLowerCase()}. Addresses, ID numbers and documents are only for the school office.</p>}
      </header>

      <nav className="stu-tabs" role="tablist">
        {tabs.map(([k, l, ic]) => <button key={k} role="tab" aria-selected={tab === k} className={tab === k ? "on" : ""} onClick={() => setTab(k)}><Icon name={ic} size={15} />{l}</button>)}
      </nav>

      <div className="stu-main">
        {tab === "overview" && p.from_home.length > 0 && (
          <section className="card g-card from-home" style={hue("teal")}>
            <h3 className="with-glyph"><Glyph icon="message" hue="teal" size={30} />From home</h3>
            <NoteList notes={p.from_home.slice(0, 3)} onSeen={setSeen} />
          </section>
        )}
        {tab === "overview" && <Overview p={p} go={setTab} />}
        {tab === "record" && <RecordPage studentId={s.id} who="staff" />}
        {tab === "about" && <About p={p} onChange={setP} onEdit={() => setModal("personal")} onAddGuardian={() => setModal("guardian")} reload={load} />}
        {tab === "school" && <SchoolLife p={p} onChange={setP} />}
        {tab === "attendance" && <Attendance p={p} />}
        {tab === "health" && <Health p={p} reload={load} />}
        {tab === "conduct" && <Conduct p={p} me={me} onChange={setP} />}
        {tab === "library" && <Library p={p} />}
        {tab === "timeline" && <Timeline items={p.timeline} />}
        {tab === "documents" && p.documents && <Documents p={p} onChange={setP} reload={load} />}
      </div>

      {modal === "edit" && detail && branch && (
        <Modal title="Edit student" onClose={() => setModal(null)}>
          <StudentForm initial={detail} classes={classes} hasBoarding={branch.has_boarding} withGuardian={false} submitLabel="Save changes" hideStatus onCancel={() => setModal(null)}
            onSubmit={async (data) => { await api.updateStudent(detail.id, data); setModal(null); load(); }} />
        </Modal>
      )}
      {modal === "personal" && <PersonalForm p={p} onClose={() => setModal(null)} onDone={(x) => { setP(x); setModal(null); }} />}
      {modal === "guardian" && (
        <Modal title="Add parent or guardian" onClose={() => setModal(null)}>
          <AddGuardianForm onCancel={() => setModal(null)} onSubmit={async (g) => { const r = await api.addGuardian(s.id, g); setModal(null); if (r.new_login) setNewLogin(r.new_login); load(); }} />
        </Modal>
      )}
      {modal === "merit" && <MeritForm p={p} onClose={() => setModal(null)} onDone={(x) => { setP(x); setModal(null); }} />}
      {modal === "photo" && <PhotoForm p={p} onClose={() => setModal(null)} onDone={(photo) => { setP({ ...p, student: { ...s, photo } }); setModal(null); }} />}
      {more && (
        <Modal title="Print and more" onClose={() => setMore(false)}>
          <div className="more-grid">
            <button onClick={() => { setMore(false); setModal("card"); }} style={hue("indigo")}><Glyph icon="id-card" hue="indigo" size={40} /><b>ID card</b><small>With photo and QR code for the gate and library</small></button>
            <button onClick={() => { setMore(false); setModal("transfer"); }} style={hue("sky")}><Glyph icon="send" hue="sky" size={40} /><b>Transfer letter</b><small>For a student moving to another school</small></button>
            <button onClick={() => { setMore(false); setModal("testimonial"); }} style={hue("amber")}><Glyph icon="award" hue="amber" size={40} /><b>Testimonial</b><small>Their record in brief, signed by the principal</small></button>
            {a.edit && <button onClick={() => { setMore(false); setModal("leave"); }} style={hue(s.status === "active" ? "rose" : "green")}><Glyph icon={s.status === "active" ? "log-out" : "log-in"} hue={s.status === "active" ? "rose" : "green"} size={40} />
              <b>{s.status === "active" ? "Leaving the school" : "Back on the roll"}</b><small>{s.status === "active" ? "Withdrawn or graduated, with the reason and next school" : "Make them an active student again"}</small></button>}
          </div>
        </Modal>
      )}
      {seen && <SeenForm n={seen} onClose={() => setSeen(null)} onDone={() => { setSeen(null); load(); }} />}
      {modal === "leave" && <LeaveForm studentId={s.id} name={s.first_name} status={s.status} onClose={() => setModal(null)} onDone={() => { setModal(null); load(); }} />}
      {modal === "card" && <IdCards schoolId={s.school_id} query={`ids=${s.id}`} onClose={() => setModal(null)} />}
      {(modal === "transfer" || modal === "testimonial") && <Letter studentId={s.id} kind={modal} onClose={() => setModal(null)} />}
      {newLogin && <Modal title="Parent login" onClose={() => setNewLogin(null)}><NewLoginNotice login={newLogin} onDone={() => setNewLogin(null)} /></Modal>}
    </Layout>
  );
}

// ---------- Overview ----------

function Overview({ p, go }: { p: Profile; go: (t: Tab) => void }) {
  const primary = p.family.guardians.find((g) => g.is_primary) ?? p.family.guardians[0];
  const att = p.attendance;
  return (
    <section className="stack">
      {p.insights.length > 0 && <InsightList items={p.insights} schoolId={p.student.school_id} />}
      <div className="stat-strip">
        <button className="stat-tile as-button" style={hue(att.rate_30 == null ? "slate" : att.rate_30 >= 90 ? "green" : att.rate_30 >= 80 ? "amber" : "red")} onClick={() => go("attendance")}>
          <Glyph icon="attendance" hue="green" size={44} /><div className="stat-text"><strong>{att.rate_30 == null ? "–" : `${att.rate_30}%`}</strong><span>Attendance, 30 days</span><span className="stat-note">{att.absent} absences in 3 months</span></div></button>
        <button className="stat-tile as-button" style={hue(p.conduct.total >= 0 ? "amber" : "orange")} onClick={() => go("conduct")}>
          <Glyph icon="star" hue="amber" size={44} /><div className="stat-text"><strong>{p.conduct.total > 0 ? "+" : ""}{p.conduct.total}</strong><span>Conduct points</span><span className="stat-note">{p.awards.length} award{p.awards.length === 1 ? "" : "s"}</span></div></button>
        <button className="stat-tile as-button" style={hue("sky")} onClick={() => go("library")}>
          <Glyph icon="book" hue="sky" size={44} /><div className="stat-text"><strong>{p.library.this_term}</strong><span>Books this term</span><span className="stat-note">{p.library.out.length} out now</span></div></button>
        <button className="stat-tile as-button" style={hue("rose")} onClick={() => go("health")}>
          <Glyph icon="stethoscope" hue="rose" size={44} /><div className="stat-text"><strong>{p.health.visit_count_30 ?? "🔒"}</strong><span>Sick bay, 30 days</span><span className="stat-note">{p.incident_count != null ? `${p.incident_count} incident${p.incident_count === 1 ? "" : "s"}` : "Private"}</span></div></button>
      </div>
      <div className="growth-grid">
        <section className="card g-card" style={hue("teal")}>
          <h3 className="with-glyph"><Glyph icon="users" hue="teal" size={30} />Family</h3>
          {primary ? (
            <div className="contact-big">
              <Avatar name={primary.name} size={44} />
              <span className="grow"><strong>{primary.name}</strong><small>{primary.relationship}{primary.is_primary ? " · main contact" : ""}</small></span>
              {primary.phone && <a className="button primary with-icon" href={`tel:${primary.phone}`}><Icon name="phone" size={15} />Call</a>}
            </div>
          ) : <p className="muted small">No parent linked yet.</p>}
          {p.family.guardians.length > 1 && <p className="small muted">and {p.family.guardians.slice(1).map((g) => g.name).join(", ")}</p>}
          <button className="text-link small" onClick={() => go("about")}>All family details →</button>
        </section>
        <section className="card g-card" style={hue("orange")}>
          <h3 className="with-glyph"><Glyph icon="classes" hue="orange" size={30} />School life</h3>
          <dl className="mini-facts">
            <dt>Class</dt><dd>{p.placement.class ? `${p.placement.class.name}${p.placement.class.form_teacher ? ` · ${p.placement.class.form_teacher}` : ""}` : "–"}</dd>
            <dt>House</dt><dd>{p.placement.house?.name ?? "–"}</dd>
            {p.placement.bed && <><dt>Bed</dt><dd>{[p.placement.bed.hostel, p.placement.bed.room, p.placement.bed.bed].filter(Boolean).join(", ")}</dd></>}
            <dt>Getting here</dt><dd>{p.placement.bus ? `${p.placement.bus.route}${p.placement.bus.stop ? `, ${p.placement.bus.stop}` : ""}` : p.student.boarding_status === "boarder" ? "Lives in school" : "Not on a school bus"}</dd>
            <dt>Clubs</dt><dd>{p.placement.clubs.map((c) => c.name).join(", ") || "–"}</dd>
          </dl>
          <button className="text-link small" onClick={() => go("school")}>Subjects and more →</button>
        </section>
        <section className="card g-card wide" style={hue("indigo")}>
          <h3 className="with-glyph"><Glyph icon="history" hue="indigo" size={30} />Latest</h3>
          <Timeline items={p.timeline.slice(0, 8)} />
          {p.timeline.length > 8 && <button className="text-link small" onClick={() => go("timeline")}>The whole timeline →</button>}
        </section>
      </div>
    </section>
  );
}

// ---------- About and family ----------

const PERSONAL: [string, string][] = [["religion", "Religion"], ["nationality", "Nationality"], ["state_of_origin", "State of origin"], ["lga", "LGA"], ["home_town", "Home town"],
  ["home_address", "Home address"], ["languages", "Languages"], ["nin", "NIN"], ["previous_school", "Previous school"], ["entry_class", "Joined in class"], ["admitted_on", "Admitted on"]];

function About({ p, onChange, onEdit, onAddGuardian, reload }: { p: Profile; onChange: (x: Profile) => void; onEdit: () => void; onAddGuardian: () => void; reload: () => void }) {
  const a = p.access;
  const [editG, setEditG] = useState<Guardian | null>(null);
  const [addC, setAddC] = useState(false);
  const [busy, error, run] = useBusy();
  return (
    <div className="growth-grid">
      <section className="card g-card" style={hue("blue")}>
        <h3 className="with-glyph"><Glyph icon="user" hue="blue" size={30} />About {p.student.nickname || p.student.first_name}{a.edit && <button className="text-link small push" onClick={onEdit}>Edit</button>}</h3>
        <dl className="mini-facts">
          <dt>Full name</dt><dd>{p.student.full_name}</dd>
          <dt>Gender</dt><dd>{p.student.gender === "female" ? "Female" : "Male"}</dd>
          <dt>Born</dt><dd>{nice(p.student.date_of_birth, { day: "numeric", month: "long", year: "numeric" })}{p.student.age != null && ` (${p.student.age})`}</dd>
          {PERSONAL.filter(([k]) => p.personal[k] != null && p.personal[k] !== "").map(([k, l]) => <Fragment key={k}><dt>{l}</dt><dd>{k === "admitted_on" ? nice(String(p.personal[k])) : String(p.personal[k])}</dd></Fragment>)}
          {p.student.talents.length > 0 && <><dt>Good at</dt><dd><span className="chips">{p.student.talents.map((t) => <span key={t} className="hue-chip" style={hue("pink")}>{t}</span>)}</span></dd></>}
          {p.personal.left_on && <><dt>Left on</dt><dd>{nice(String(p.personal.left_on))}{p.personal.leave_reason ? ` · ${p.personal.leave_reason}` : ""}{p.personal.next_school ? ` · to ${p.personal.next_school}` : ""}</dd></>}
        </dl>
      </section>
      <section className="card g-card" style={hue("teal")}>
        <h3 className="with-glyph"><Glyph icon="users" hue="teal" size={30} />Parents and guardians{a.edit && <button className="text-link small push" onClick={onAddGuardian}>+ Add</button>}</h3>
        {p.family.guardians.length === 0 && <Empty icon="users">No parent linked yet.</Empty>}
        {p.family.guardians.map((g) => (
          <div key={g.link_id} className={`guardian-card${g.is_primary ? " primary" : ""}`}>
            <div className="row"><Avatar name={g.name} size={40} /><span className="grow"><strong>{g.name}</strong><small className="block muted">{g.relationship}{g.occupation ? ` · ${g.occupation}` : ""}</small></span>
              {g.phone && <a className="icon-button" href={`tel:${g.phone}`} aria-label={`Call ${g.name}`}><Icon name="phone" size={16} /></a>}
              {a.edit && <button className="icon-button" aria-label={`Edit ${g.name}`} onClick={() => setEditG(g)}><Icon name="edit" size={15} /></button>}</div>
            <p className="small">{[g.phone, g.email].filter(Boolean).join(" · ")}{g.address ? ` · ${g.address}` : ""}</p>
            <div className="chips">
              {g.is_primary && <span className="hue-chip" style={hue("indigo")}><Icon name="star" size={11} />Main contact</span>}
              {g.emergency && <span className="hue-chip" style={hue("red")}>Emergency</span>}
              {g.can_pick_up && <span className="hue-chip" style={hue("green")}><Icon name="shield" size={11} />May collect</span>}
              {g.lives_with && <span className="hue-chip" style={hue("sky")}><Icon name="home" size={11} />Lives with</span>}
              <span className="hue-chip" style={hue(g.has_login ? "teal" : "slate")}>{g.has_login ? "Uses the parent app" : "Not logged in yet"}</span>
            </div>
            {g.other_children.length > 0 && <p className="small"><span className="muted">Also parent of </span>{g.other_children.map((c, i) => <span key={c.id}>{i > 0 && ", "}<a href={href({ page: "student", id: c.id })}>{c.name}</a>{c.class_name && <span className="muted"> ({c.class_name})</span>}</span>)}</p>}
          </div>
        ))}
      </section>
      <section className="card g-card" style={hue("green")}>
        <h3 className="with-glyph"><Glyph icon="shield" hue="green" size={30} />Who may collect {p.student.first_name}{a.edit && <button className="text-link small push" onClick={() => setAddC(true)}>+ Add someone</button>}</h3>
        <p className="muted small">The gate checks this list before letting {p.student.first_name} leave with anyone.</p>
        <ul className="collect-list">
          {p.family.guardians.filter((g) => g.can_pick_up).map((g) => <li key={g.link_id}><Avatar name={g.name} size={34} /><span className="grow"><strong>{g.name}</strong><small>{g.relationship} · {g.phone ?? "no phone"}</small></span></li>)}
          {p.family.contacts.map((c) => (
            <li key={c.id}>{c.photo ? <img className="collect-photo" src={c.photo} alt="" /> : <Avatar name={c.name} size={34} />}
              <span className="grow"><strong>{c.name}</strong><small>{c.relationship} · {c.phone ?? "no phone"}{c.note ? ` · ${c.note}` : ""}</small></span>
              {a.edit && <button className="chip-x" aria-label={`Remove ${c.name}`} disabled={busy} onClick={() => run(async () => { if (confirm(`Take ${c.name} off the list?`)) onChange(await sapi.removeContact(p.student.id, c.id)); })}><Icon name="close" size={13} /></button>}</li>
          ))}
        </ul>
        {error && <p className="error">{error}</p>}
      </section>
      {editG && <GuardianFlagsForm p={p} g={editG} onClose={() => setEditG(null)} onDone={(x) => { onChange(x); setEditG(null); }} onUnlinked={() => { setEditG(null); reload(); }} />}
      {addC && <ContactForm p={p} onClose={() => setAddC(false)} onDone={(x) => { onChange(x); setAddC(false); }} />}
    </div>
  );
}

function PersonalForm({ p, onClose, onDone }: { p: Profile; onClose: () => void; onDone: (x: Profile) => void }) {
  const [houses, setHouses] = useState<Item[]>([]);
  const init = { nickname: p.student.nickname, house_id: p.student.house_id, leadership: p.student.leadership, talents: p.student.talents.join(", "),
    ...Object.fromEntries(["religion", "nationality", "state_of_origin", "lga", "home_town", "home_address", "languages", "nin", "previous_school", "admitted_on", "entry_class", "leave_reason", "next_school"].map((k) => [k, p.personal[k] ?? ""])) };
  const [f, setF] = useState<Record<string, string | null>>(init as Record<string, string | null>);
  const [busy, error, run] = useBusy();
  useEffect(() => { records("school", p.student.school_id, "houses").list().then(setHouses).catch(() => {}); }, [p.student.school_id]);
  const inp = (k: string, l: string, ph = "", type = "text") => <Field label={l}><input type={type} value={f[k] ?? ""} placeholder={ph} onChange={(e) => setF({ ...f, [k]: e.target.value })} /></Field>;
  const submit = (e: FormEvent) => {
    e.preventDefault();
    const body: Record<string, unknown> = Object.fromEntries(Object.entries(f).map(([k, v]) => [k, v === "" ? null : v]));
    body.talents = String(f.talents ?? "").split(",").map((x) => x.trim()).filter(Boolean);
    run(async () => onDone(await sapi.personal(p.student.id, body)));
  };
  return (
    <Modal title={`About ${p.student.first_name}`} onClose={onClose}>
      <form className="stack" onSubmit={submit}>
        <div className="row wrap">{inp("nickname", "Likes to be called")}{inp("religion", "Religion", "e.g. Catholic, Islam")}{inp("nationality", "Nationality", "Nigerian")}</div>
        <div className="row wrap">{inp("state_of_origin", "State of origin")}{inp("lga", "LGA")}{inp("home_town", "Home town")}</div>
        <Field label="Home address"><textarea rows={2} value={f.home_address ?? ""} onChange={(e) => setF({ ...f, home_address: e.target.value })} /></Field>
        <div className="row wrap">{inp("languages", "Languages spoken", "e.g. English, Igbo")}{inp("nin", "NIN (11 digits)", "")}</div>
        <div className="row wrap">{inp("previous_school", "Previous school")}{inp("entry_class", "Joined in class", "e.g. JSS 1")}{inp("admitted_on", "Admitted on", "", "date")}</div>
        <div className="row wrap">
          <Field label="House"><select value={f.house_id ?? ""} onChange={(e) => setF({ ...f, house_id: e.target.value || null })}><option value="">No house</option>{houses.map((h) => <option key={h.id} value={h.id}>{String(h.name)}</option>)}</select></Field>
          {inp("leadership", "Leadership role", "e.g. Class captain, Head girl")}
        </div>
        {inp("talents", "Good at (commas between)", "e.g. Football, Debate, Drawing")}
        {p.student.status !== "active" && <div className="row wrap">{inp("leave_reason", "Why they left")}{inp("next_school", "Went on to")}</div>}
        {error && <p className="error">{error}</p>}
        <div className="row"><span className="grow" /><button type="button" onClick={onClose}>Cancel</button><button className="primary" disabled={busy}>Save</button></div>
      </form>
    </Modal>
  );
}

function GuardianFlagsForm({ p, g, onClose, onDone, onUnlinked }: { p: Profile; g: Guardian; onClose: () => void; onDone: (x: Profile) => void; onUnlinked: () => void }) {
  const [f, setF] = useState({ relationship: g.relationship, is_primary: g.is_primary, emergency: g.emergency, can_pick_up: g.can_pick_up, lives_with: g.lives_with, occupation: g.occupation ?? "", address: g.address ?? "" });
  const [busy, error, run] = useBusy();
  const tick = (k: "is_primary" | "emergency" | "can_pick_up" | "lives_with", l: string) => <label className="check"><input type="checkbox" checked={f[k]} onChange={(e) => setF({ ...f, [k]: e.target.checked })} />{l}</label>;
  return (
    <Modal title={g.name} onClose={onClose}>
      <div className="row wrap">
        <Field label="Relationship"><select value={f.relationship} onChange={(e) => setF({ ...f, relationship: e.target.value })}>{["Father", "Mother", "Guardian", "Grandparent", "Uncle", "Aunt", "Brother", "Sister", "Sponsor", "Parent"].map((x) => <option key={x}>{x}</option>)}</select></Field>
        <Field label="Occupation"><input value={f.occupation} onChange={(e) => setF({ ...f, occupation: e.target.value })} /></Field>
      </div>
      <Field label="Address"><input value={f.address} onChange={(e) => setF({ ...f, address: e.target.value })} /></Field>
      <div className="check-col">{tick("is_primary", "Main contact (called first)")}{tick("emergency", "Call in an emergency")}{tick("can_pick_up", "Allowed to collect the student")}{tick("lives_with", "The student lives with them")}</div>
      {error && <p className="error">{error}</p>}
      <div className="row"><button className="text-link danger-hover" disabled={busy} onClick={() => run(async () => { if (confirm(`Unlink ${g.name} from ${p.student.first_name}?`)) { await api.removeGuardian(p.student.id, g.link_id); onUnlinked(); } })}>Unlink</button>
        <span className="grow" /><button onClick={onClose}>Cancel</button><button className="primary" disabled={busy} onClick={() => run(async () => onDone(await sapi.guardian(p.student.id, g.link_id, { ...f, occupation: f.occupation || null, address: f.address || null })))}>Save</button></div>
    </Modal>
  );
}

function ContactForm({ p, onClose, onDone }: { p: Profile; onClose: () => void; onDone: (x: Profile) => void }) {
  const [f, setF] = useState({ name: "", phone: "", relationship: "Driver", note: "" });
  const [photo, setPhoto] = useState<string | null>(null);
  const [busy, error, run] = useBusy();
  return (
    <Modal title="Someone else who may collect" onClose={onClose}>
      <form className="stack" onSubmit={(e) => { e.preventDefault(); run(async () => onDone(await sapi.addContact(p.student.id, { ...f, phone: f.phone || null, note: f.note || null, photo }))); }}>
        <div className="row wrap">
          <Field label="Name"><input required minLength={2} value={f.name} onChange={(e) => setF({ ...f, name: e.target.value })} /></Field>
          <Field label="Phone"><input value={f.phone} onChange={(e) => setF({ ...f, phone: e.target.value })} /></Field>
        </div>
        <div className="row wrap">
          <Field label="Who they are"><select value={f.relationship} onChange={(e) => setF({ ...f, relationship: e.target.value })}>{["Driver", "Uncle", "Aunt", "Grandparent", "Older brother", "Older sister", "Family friend", "Neighbour", "Other"].map((x) => <option key={x}>{x}</option>)}</select></Field>
          <Field label="Photo (helps the gate)"><input type="file" accept="image/*" capture="environment" onChange={(e) => shrink(e.target.files?.[0], setPhoto)} /></Field>
        </div>
        <Field label="Note"><input value={f.note} onChange={(e) => setF({ ...f, note: e.target.value })} placeholder="e.g. Only on Fridays" /></Field>
        {error && <p className="error">{error}</p>}
        <div className="row"><span className="grow" /><button type="button" onClick={onClose}>Cancel</button><button className="primary" disabled={busy}>Add</button></div>
      </form>
    </Modal>
  );
}

function shrink(file: File | undefined, done: (url: string) => void, max = 360) {
  if (!file) return;
  const img = new Image(); const url = URL.createObjectURL(file);
  img.onload = () => {
    const c = document.createElement("canvas"); const sc = Math.min(1, max / Math.max(img.width, img.height));
    c.width = img.width * sc; c.height = img.height * sc; c.getContext("2d")?.drawImage(img, 0, 0, c.width, c.height);
    done(c.toDataURL("image/jpeg", 0.8)); URL.revokeObjectURL(url);
  };
  img.src = url;
}

function PhotoForm({ p, onClose, onDone }: { p: Profile; onClose: () => void; onDone: (photo: string | null) => void }) {
  const [photo, setPhoto] = useState<string | null>(p.student.photo);
  const [busy, error, run] = useBusy();
  return (
    <Modal title="Photo" onClose={onClose}>
      <div className="photo-pick">{photo ? <img src={photo} alt="" /> : <Avatar name={p.student.full_name} size={160} />}</div>
      <label className="button with-icon"><Icon name="scan" size={15} />Take or choose a photo<input hidden type="file" accept="image/*" capture="user" onChange={(e) => shrink(e.target.files?.[0], setPhoto, 400)} /></label>
      {error && <p className="error">{error}</p>}
      <div className="row">{p.student.photo && <button className="text-link danger-hover" onClick={() => run(async () => { await sapi.photo(p.student.id, null); onDone(null); })}>Remove photo</button>}
        <span className="grow" /><button onClick={onClose}>Cancel</button><button className="primary" disabled={busy || photo === p.student.photo} onClick={() => run(async () => { const r = await sapi.photo(p.student.id, photo); onDone(r.photo); })}>Save</button></div>
    </Modal>
  );
}

function AddGuardianForm({ onSubmit, onCancel }: { onSubmit: (g: GuardianInput) => Promise<void>; onCancel: () => void }) {
  const [g, setG] = useState<GuardianInput>(emptyGuardian());
  const [error, setError] = useState("");
  const [busy, setBusy] = useState(false);
  async function submit(e: FormEvent) {
    e.preventDefault();
    const msg = checkGuardian(g, true);
    if (msg) return setError(msg);
    setBusy(true);
    try { await onSubmit(g); } catch (err) { setError(errorText(err)); setBusy(false); }
  }
  return (
    <form className="stack" onSubmit={submit} noValidate>
      <GuardianFields value={g} onChange={(v) => { setG(v); setError(""); }} />
      {error && <p className="error">{error}</p>}
      <div className="row"><button className="primary" disabled={busy}>Link parent</button><button type="button" onClick={onCancel}>Cancel</button></div>
    </form>
  );
}

// ---------- School life ----------

function SchoolLife({ p, onChange }: { p: Profile; onChange: (x: Profile) => void }) {
  const pl = p.placement;
  const [clubs, setClubs] = useState(false);
  return (
    <div className="growth-grid">
      <section className="card g-card" style={hue("orange")}>
        <h3 className="with-glyph"><Glyph icon="classes" hue="orange" size={30} />Class and house</h3>
        <dl className="mini-facts">
          <dt>Class</dt><dd>{pl.class?.name ?? "No class"}</dd>
          <dt>Form teacher</dt><dd>{pl.class?.form_teacher ?? "–"}</dd>
          <dt>House</dt><dd>{pl.house ? <span className="house-fact inline" style={{ ["--hc" as string]: pl.house.colour || "#888" }}><span className="house-dot" />{pl.house.name}{pl.house.master ? ` · ${pl.house.master}` : ""}</span> : "–"}</dd>
          <dt>Leadership</dt><dd>{p.student.leadership ?? "–"}</dd>
        </dl>
      </section>
      <section className="card g-card" style={hue("violet")}>
        <h3 className="with-glyph"><Glyph icon={p.student.boarding_status === "boarder" ? "bed" : "bus"} hue="violet" size={30} />{p.student.boarding_status === "boarder" ? "Boarding" : "Getting to school"}</h3>
        <dl className="mini-facts">
          {pl.bed ? <><dt>Hostel</dt><dd>{pl.bed.hostel}</dd><dt>Room and bed</dt><dd>{[pl.bed.room, pl.bed.bed].filter(Boolean).join(", ")}</dd><dt>House parent</dt><dd>{pl.bed.house_parent ?? "–"}</dd></>
            : p.student.boarding_status === "boarder" ? <><dt>Bed</dt><dd>No bed given yet (Facilities → Hostels)</dd></> : null}
          <dt>School bus</dt><dd>{pl.bus ? `${pl.bus.route}${pl.bus.stop ? `, stop: ${pl.bus.stop}` : ""}` : "Not on a bus route"}</dd>
          <dt>Exit passes</dt><dd>{p.passes.length ? `${p.passes.length} (latest ${nice(p.passes[0].leave_at)}, ${p.passes[0].status})` : "None"}</dd>
          <dt>Visitors</dt><dd>{p.visitors.length ? `${p.visitors.length} (latest ${p.visitors[0].name}, ${nice(p.visitors[0].at)})` : "None recorded"}</dd>
        </dl>
      </section>
      <section className="card g-card wide" style={hue("fuchsia")}>
        <h3 className="with-glyph"><Glyph icon="presentation" hue="fuchsia" size={30} />Subjects and teachers</h3>
        {pl.subjects.length === 0 ? <p className="muted small">No subjects yet. They come from the class on the Teaching page.</p> : (
          <ul className="student-subjects grid">{pl.subjects.map((x) => { const l = subjectLook(x.name); return (
            <li key={x.name} style={hue(l.hue)}><span className="subject-chip-icon"><Icon name={l.icon} size={13} stroke={2.2} /></span>
              <span className="grow">{x.name}{x.elective && <span className="elective-tag">elective</span>}<span className="block small muted">{x.teacher ?? "No teacher yet"}</span></span></li>); })}</ul>
        )}
      </section>
      <section className="card g-card" style={hue("green")}>
        <h3 className="with-glyph"><Glyph icon="trophy" hue="green" size={30} />Clubs and societies{p.access.edit && <button className="text-link small push" onClick={() => setClubs(true)}>Change</button>}</h3>
        {pl.clubs.length === 0 ? <p className="muted small">Not in a club yet.</p> : <ul className="collect-list">{pl.clubs.map((c) => <li key={c.id}><Glyph icon="star" hue="green" size={30} soft /><span className="grow"><strong>{c.name}</strong><small>{c.role}{c.patron ? ` · patron ${c.patron}` : ""}</small></span></li>)}</ul>}
        {p.student.talents.length > 0 && <div className="chips">{p.student.talents.map((t) => <span key={t} className="hue-chip" style={hue("pink")}>{t}</span>)}</div>}
      </section>
      <StudentGoalsCard studentId={p.student.id} name={p.student.first_name} canNote={p.access.edit || p.access.teacher} />
      {p.timetable && (
        <section className="card g-card wide tt-card" style={hue("blue")}>
          <h3 className="with-glyph"><Glyph icon="calendar-days" hue="blue" size={30} />{p.student.first_name}'s week</h3>
          <WeekGrid g={p.timetable} today={new Date().getDay() - 1} />
        </section>
      )}
      {clubs && <ClubsForm p={p} onClose={() => setClubs(false)} onDone={(x) => { onChange(x); setClubs(false); }} />}
    </div>
  );
}

function ClubsForm({ p, onClose, onDone }: { p: Profile; onClose: () => void; onDone: (x: Profile) => void }) {
  const [all, setAll] = useState<Item[]>([]);
  const [pick, setPick] = useState<Record<string, string>>(Object.fromEntries(p.placement.clubs.map((c) => [c.id, c.role])));
  const [busy, error, run] = useBusy();
  useEffect(() => { records("school", p.student.school_id, "clubs").list().then(setAll).catch(() => {}); }, [p.student.school_id]);
  return (
    <Modal title="Clubs and societies" onClose={onClose}>
      {all.length === 0 && <p className="muted small">No clubs yet. Add them in Set-up → Houses and clubs.</p>}
      <ul className="pick-list">{all.map((c) => (
        <li key={c.id}><div className="find-row"><label className="check grow"><input type="checkbox" checked={c.id in pick} onChange={(e) => { const x = { ...pick }; if (e.target.checked) x[c.id] = "Member"; else delete x[c.id]; setPick(x); }} />{String(c.name)}</label>
          {c.id in pick && <select value={pick[c.id]} onChange={(e) => setPick({ ...pick, [c.id]: e.target.value })}>{["Member", "Captain", "President", "Secretary", "Treasurer"].map((r) => <option key={r}>{r}</option>)}</select>}</div></li>
      ))}</ul>
      {error && <p className="error">{error}</p>}
      <div className="row"><span className="grow" /><button onClick={onClose}>Cancel</button><button className="primary" disabled={busy} onClick={() => run(async () => onDone(await sapi.clubs(p.student.id, Object.entries(pick).map(([club_id, role]) => ({ club_id, role })))))}>Save</button></div>
    </Modal>
  );
}

// ---------- Attendance ----------

function Attendance({ p }: { p: Profile }) {
  const a = p.attendance;
  const weeks = useMemo(() => {
    const by = new Map(a.calendar.filter((c) => c.kind === "school").map((c) => [c.date, c.status]));
    const night = new Map(a.calendar.filter((c) => c.kind === "night").map((c) => [c.date, c.status]));
    const out: { date: string; status: string | undefined; night: string | undefined }[][] = [];
    const now = new Date(); const start = new Date(now); start.setDate(now.getDate() - 41 - ((now.getDay() + 6) % 7));
    for (let w = 0; w < 7; w++) {
      const row = [];
      for (let d = 0; d < 7; d++) {
        const x = new Date(start); x.setDate(start.getDate() + w * 7 + d);
        const k = `${x.getFullYear()}-${String(x.getMonth() + 1).padStart(2, "0")}-${String(x.getDate()).padStart(2, "0")}`;
        row.push({ date: k, status: by.get(k), night: night.get(k) });
      }
      out.push(row);
    }
    return out;
  }, [a.calendar]);
  return (
    <section className="stack">
      <div className="stat-strip">
        <Stat icon="attendance" hue={a.rate_30 != null && a.rate_30 < 85 ? "red" : "green"} value={a.rate_30 == null ? "–" : `${a.rate_30}%`} label="last 30 days" note={a.rate_prev != null ? `${a.rate_prev}% the month before` : undefined} />
        <Stat icon="calendar" hue="teal" value={a.rate_90 == null ? "–" : `${a.rate_90}%`} label="last 3 months" note={`${a.days} school days`} />
        <Stat icon="circle-x" hue="red" value={a.absent} label="absences" note={a.worst_day ? `Most on ${a.worst_day[0]}s` : undefined} />
        <Stat icon="flame" hue="amber" value={a.streak} label="days in a row" note={`${a.late} times late`} />
      </div>
      <section className="card g-card" style={hue("green")}>
        <h3 className="with-glyph"><Glyph icon="calendar" hue="green" size={30} />The last 6 weeks</h3>
        <div className="att-cal">
          <div className="att-row head">{["M", "T", "W", "T", "F", "S", "S"].map((d, i) => <span key={i}>{d}</span>)}</div>
          {weeks.map((w, i) => <div key={i} className="att-row">{w.map((c) => <span key={c.date} style={day(c.date) > new Date() ? { opacity: 0.35 } : undefined} className={`att-day s-${c.status ?? "none"}${c.night ? ` n-${c.night}` : ""}`} title={`${nice(c.date, { weekday: "short", day: "numeric", month: "short" })}: ${c.status ?? "no register"}${c.night ? `, night roll ${c.night}` : ""}`}>{day(c.date).getDate()}</span>)}</div>)}
        </div>
        <p className="radar-key"><span className="key s-present" />Present<span className="key s-late" />Late<span className="key s-absent" />Absent<span className="key s-excused" />Excused</p>
      </section>
    </section>
  );
}

// ---------- Health ----------

const HEALTH_LABEL: Record<string, string> = { blood_group: "Blood group", genotype: "Genotype", conditions: "Conditions", medications: "Regular medicine", hospital: "Family hospital" };

function Health({ p, reload }: { p: Profile; reload: () => void }) {
  const h = p.health;
  const [open, setOpen] = useState(false);
  const [support, setSupport] = useState<string>(String(p.personal.support_needs ?? ""));
  const [busy, error, run] = useBusy();
  return (
    <section className="stack">
      <section className="card g-card" style={hue("red")}>
        <h3 className="with-glyph"><Glyph icon="heart-pulse" hue="red" size={30} />Everyone who looks after {p.student.first_name} should know</h3>
        <div className="chips">
          {h.allergies ? <span className="alert-chip red"><Icon name="circle-x" size={14} />Allergic to {h.allergies}</span> : <span className="muted small">No allergies recorded.</span>}
          {h.diet && <span className="alert-chip amber"><Icon name="utensils" size={14} />{h.diet}</span>}
        </div>
      </section>
      {!p.access.health ? <AskAccess schoolId={p.student.school_id} right="private.health" what="Medical records" /> : (
        <>
          <section className="card g-card" style={hue("rose")}>
            <h3 className="with-glyph"><Glyph icon="stethoscope" hue="rose" size={30} />Health record<button className="text-link small push" onClick={() => setOpen(true)}>Open full record</button></h3>
            {h.record ? <dl className="mini-facts">{Object.entries(h.record).filter(([, v]) => v).map(([k, v]) => <Fragment key={k}><dt>{HEALTH_LABEL[k] ?? k}</dt><dd>{v}</dd></Fragment>)}</dl> : <p className="muted small">No health record yet.</p>}
            <h4 className="goals-title"><Icon name="history" size={15} />Sick bay visits</h4>
            {h.visits && h.visits.length ? <ul className="mini-list">{h.visits.map((v, i) => <li key={i}><span className="date-chip">{nice(v.at, { day: "numeric", month: "short" })}</span><span className="grow">{v.complaint}{v.temperature ? ` · ${v.temperature}°C` : ""}</span><small>{v.outcome.replace("_", " ")}</small></li>)}</ul> : <p className="muted small">No visits.</p>}
          </section>
          <section className="card g-card" style={hue("violet")}>
            <h3 className="with-glyph"><Glyph icon="heart" hue="violet" size={30} />Learning support (private)</h3>
            <textarea rows={3} value={support} onChange={(e) => setSupport(e.target.value)} placeholder="e.g. Dyslexia: give extra time in tests and print in large type." />
            {error && <p className="error">{error}</p>}
            <div className="row"><span className="grow" /><button className="primary" disabled={busy} onClick={() => run(async () => { await sapi.support(p.student.id, support || null); reload(); })}>Save</button></div>
          </section>
          {open && <HealthModal studentId={p.student.id} onClose={() => { setOpen(false); reload(); }} />}
        </>
      )}
      {p.access.safeguarding ? (
        <section className="card g-card" style={hue("orange")}>
          <h3 className="with-glyph"><Glyph icon="flame" hue="orange" size={30} />Incidents</h3>
          {p.incidents && p.incidents.length ? <ul className="mini-list">{p.incidents.map((i) => <li key={i.id}><span className="date-chip">{nice(i.at, { day: "numeric", month: "short" })}</span><span className="grow">#{i.number} {i.summary}</span><span className="hue-chip" style={hue(i.severity === "minor" ? "amber" : "red")}>{i.severity}</span></li>)}</ul> : <p className="muted small">None.</p>}
        </section>
      ) : <AskAccess schoolId={p.student.school_id} right="private.safeguarding" what="Incident reports" />}
    </section>
  );
}

// ---------- Conduct, awards and notes ----------

function Conduct({ p, me, onChange }: { p: Profile; me: Me; onChange: (x: Profile) => void }) {
  const can = (p.access.edit || p.access.teacher) && !me.acting;
  const [meta, setMeta] = useState<StuMeta | null>(null);
  const [award, setAward] = useState(false);
  const [note, setNote] = useState("");
  const [priv, setPriv] = useState(false);
  const [busy, error, run] = useBusy();
  useEffect(() => { loadMeta().then(setMeta).catch(() => {}); }, []);
  const c = p.conduct;
  return (
    <section className="stack">
      <div className="stat-strip">
        <Stat icon="star" hue="amber" value={`${c.total > 0 ? "+" : ""}${c.total}`} label="points in all" note={`${c.last_30 > 0 ? "+" : ""}${c.last_30} in the last 30 days`} />
        <Stat icon="thumbs-up" hue="green" value={`+${c.merits}`} label="merits" />
        <Stat icon="target" hue="orange" value={c.demerits} label="demerits" note={`${c.demerits_30} in 30 days`} />
        <Stat icon="trophy" hue="violet" value={p.awards.length} label="awards" />
      </div>
      {can && meta && <QuickConduct p={p} meta={meta} onDone={onChange} />}
      <div className="growth-grid">
        <section className="card g-card" style={hue("amber")}>
          <h3 className="with-glyph"><Glyph icon="star" hue="amber" size={30} />Merits and demerits</h3>
          {c.entries.length === 0 ? <p className="muted small">Nothing yet.</p> : (
            <ul className="mini-list">{c.entries.map((e) => (
              <li key={e.id}><span className={`pts ${e.points > 0 ? "up" : "down"}`}>{e.points > 0 ? "+" : ""}{e.points}</span><span className="grow"><strong>{e.label}</strong><small className="block muted">{e.note ? `${e.note} · ` : ""}{e.by} · {nice(e.at, { day: "numeric", month: "short" })}</small></span>
                {(p.access.edit || e.by_id === me.id) && !me.acting && <button className="chip-x" aria-label="Take back" disabled={busy} onClick={() => run(async () => onChange(await sapi.removeConduct(e.id)))}><Icon name="close" size={12} /></button>}</li>))}</ul>
          )}
        </section>
        <section className="card g-card" style={hue("violet")}>
          <h3 className="with-glyph"><Glyph icon="trophy" hue="violet" size={30} />Awards{can && <button className="text-link small push" onClick={() => setAward(true)}>+ Add</button>}</h3>
          {p.awards.length === 0 ? <p className="muted small">No awards yet.</p> : <ul className="mini-list">{p.awards.map((w) => <li key={w.id}><span className="medal-sm">🏅</span><span className="grow"><strong>{w.title}</strong><small className="block muted">{meta?.award_levels[w.level] ?? w.level} · {nice(w.on_date)}{w.note ? ` · ${w.note}` : ""}</small></span>
            {p.access.edit && <button className="chip-x" aria-label="Remove" onClick={() => run(async () => onChange(await sapi.removeAward(w.id)))}><Icon name="close" size={12} /></button>}</li>)}</ul>}
        </section>
        <section className="card g-card wide" style={hue("slate")}>
          <h3 className="with-glyph"><Glyph icon="message" hue="slate" size={30} />Notes</h3>
          {can && (
            <div className="stack">
              <textarea rows={2} value={note} onChange={(e) => setNote(e.target.value)} placeholder={`Something other teachers should know about ${p.student.first_name}…`} />
              <div className="row">{p.access.safeguarding && <label className="check small"><input type="checkbox" checked={priv} onChange={(e) => setPriv(e.target.checked)} /><Icon name="lock" size={13} />Private (only people with the safeguarding right)</label>}
                <span className="grow" /><button className="primary" disabled={busy || note.trim().length < 2} onClick={() => run(async () => { onChange(await sapi.note(p.student.id, note.trim(), priv)); setNote(""); setPriv(false); })}>Add note</button></div>
            </div>
          )}
          {p.notes.length === 0 ? <p className="muted small">No notes.</p> : <ul className="mini-list">{p.notes.map((n) => (
            <li key={n.id} className={n.private ? "private" : ""}><Icon name={n.private ? "lock" : "message"} size={15} /><span className="grow">{n.text}<small className="block muted">{n.by} · {nice(n.at)}</small></span>
              {n.by_id === me.id && !me.acting && <button className="chip-x" aria-label="Remove" onClick={() => run(async () => onChange(await sapi.removeNote(n.id)))}><Icon name="close" size={12} /></button>}</li>))}</ul>}
        </section>
      </div>
      {error && <p className="error">{error}</p>}
      {award && <AwardForm p={p} levels={meta?.award_levels ?? {}} onClose={() => setAward(false)} onDone={(x) => { onChange(x); setAward(false); }} />}
    </section>
  );
}

function QuickConduct({ p, meta, onDone }: { p: Profile; meta: StuMeta; onDone: (x: Profile) => void }) {
  const [pick, setPick] = useState<string | null>(null);
  const [note, setNote] = useState("");
  const [busy, error, run] = useBusy();
  const chip = (k: string, v: { label: string; points: number }) => (
    <button key={k} className={`conduct-chip ${v.points > 0 ? "up" : "down"}${pick === k ? " on" : ""}`} onClick={() => setPick(pick === k ? null : k)}>{v.label}<b>{v.points > 0 ? "+" : ""}{v.points}</b></button>
  );
  return (
    <section className="card quick-conduct">
      <div className="conduct-row"><span className="cr-label good">Well done for</span>{Object.entries(meta.merits).map(([k, v]) => chip(k, v))}</div>
      <div className="conduct-row"><span className="cr-label bad">Needs to work on</span>{Object.entries(meta.demerits).map(([k, v]) => chip(k, v))}</div>
      {pick && (
        <div className="row wrap">
          <input className="grow" value={note} onChange={(e) => setNote(e.target.value)} placeholder="What happened (optional)" />
          <button className="primary" disabled={busy} onClick={() => run(async () => { onDone(await sapi.conduct(p.student.id, pick, note || null)); setPick(null); setNote(""); })}>Give</button>
        </div>
      )}
      {error && <p className="error">{error}</p>}
      {p.placement.house && <p className="muted small">Points also count for {p.placement.house.name}.</p>}
    </section>
  );
}

function MeritForm({ p, onClose, onDone }: { p: Profile; onClose: () => void; onDone: (x: Profile) => void }) {
  const [meta, setMeta] = useState<StuMeta | null>(null);
  useEffect(() => { loadMeta().then(setMeta).catch(() => {}); }, []);
  return <Modal title={`Merit or demerit for ${p.student.first_name}`} onClose={onClose}>{meta ? <QuickConduct p={p} meta={meta} onDone={onDone} /> : <p className="muted">Loading…</p>}</Modal>;
}

function AwardForm({ p, levels, onClose, onDone }: { p: Profile; levels: Record<string, string>; onClose: () => void; onDone: (x: Profile) => void }) {
  const [f, setF] = useState({ title: "", level: "school", on_date: new Date().toISOString().slice(0, 10), note: "" });
  const [busy, error, run] = useBusy();
  return (
    <Modal title="Add an award" onClose={onClose}>
      <form className="stack" onSubmit={(e) => { e.preventDefault(); run(async () => onDone(await sapi.award(p.student.id, { ...f, note: f.note || null }))); }}>
        <Field label="Award"><input required minLength={2} value={f.title} onChange={(e) => setF({ ...f, title: e.target.value })} placeholder="e.g. Best in Mathematics, 1st place inter-house relay" /></Field>
        <div className="row wrap">
          <Field label="Level"><select value={f.level} onChange={(e) => setF({ ...f, level: e.target.value })}>{Object.entries(levels).map(([k, l]) => <option key={k} value={k}>{l}</option>)}</select></Field>
          <Field label="Date"><input type="date" value={f.on_date} onChange={(e) => setF({ ...f, on_date: e.target.value })} /></Field>
        </div>
        <Field label="Note"><input value={f.note} onChange={(e) => setF({ ...f, note: e.target.value })} /></Field>
        {error && <p className="error">{error}</p>}
        <div className="row"><span className="grow" /><button type="button" onClick={onClose}>Cancel</button><button className="primary" disabled={busy}>Add</button></div>
      </form>
    </Modal>
  );
}

// ---------- Library, timeline, documents ----------

function Library({ p }: { p: Profile }) {
  return (
    <div className="growth-grid">
      <section className="card g-card" style={hue("sky")}>
        <h3 className="with-glyph"><Glyph icon="book" hue="sky" size={30} />Books out now</h3>
        {p.library.out.length === 0 ? <p className="muted small">None.</p> : <ul className="mini-list">{p.library.out.map((b, i) => <li key={i} className={b.late ? "late" : ""}><Icon name="book" size={15} /><span className="grow">{b.title}<small className="block muted">due {nice(b.due_on, { day: "numeric", month: "short" })}</small></span>{b.late > 0 && <span className="hue-chip" style={hue("red")}>{b.late} days late</span>}</li>)}</ul>}
      </section>
      <section className="card g-card" style={hue("violet")}>
        <h3 className="with-glyph"><Glyph icon="trophy" hue="violet" size={30} />Reading</h3>
        <p className="desk-big"><b>{p.library.this_term}</b>books this term · {p.library.total} ever</p>
        {p.library.recent.length > 0 && <ul className="mini-list">{p.library.recent.map((b, i) => <li key={i}><span className="date-chip">{nice(b.at, { day: "numeric", month: "short" })}</span><span className="grow">{b.title}</span></li>)}</ul>}
      </section>
    </div>
  );
}

function Timeline({ items }: { items: Profile["timeline"] }) {
  if (items.length === 0) return <Empty icon="history">Nothing yet.</Empty>;
  let last = "";
  return (
    <ol className="stu-timeline">
      {items.map((t, i) => {
        const m = day(t.at).toLocaleDateString("en-GB", { month: "long", year: "numeric" });
        const head = m !== last; last = m;
        return (
          <li key={i} style={hue(t.hue)}>
            {head && <span className="tl-month">{m}</span>}
            <span className="tl-dot"><Icon name={t.icon} size={14} /></span>
            <span className="tl-when">{nice(t.at, { day: "numeric", month: "short" })}</span>
            <span className="tl-text"><strong>{t.title}</strong>{t.detail && <small>{t.detail}</small>}</span>
          </li>
        );
      })}
    </ol>
  );
}

function Documents({ p, onChange, reload }: { p: Profile; onChange: (x: Profile) => void; reload: () => void }) {
  const [meta, setMeta] = useState<StuMeta | null>(null);
  const [kind, setKind] = useState("birth_certificate");
  const [busy, error, run] = useBusy();
  useEffect(() => { loadMeta().then(setMeta).catch(() => {}); }, []);
  const have = new Set((p.documents ?? []).map((d) => d.kind));
  const upload = (file: File | undefined) => {
    if (!file) return;
    run(async () => {
      const fd = new FormData(); fd.append("kind", kind); fd.append("file", file);
      const r = await fetch(`/api/students/${p.student.id}/documents`, { method: "POST", body: fd, headers: { Authorization: `Bearer ${getToken() ?? ""}` } });
      if (!r.ok) { const j = await r.json().catch(() => ({})); throw new Error(typeof j.detail === "string" ? j.detail : "Upload failed"); }
      reload();
    });
  };
  const open = async (id: string) => {
    const r = await fetch(`/api/students/${p.student.id}/documents/${id}`, { headers: { Authorization: `Bearer ${getToken() ?? ""}` } });
    if (r.ok) window.open(URL.createObjectURL(await r.blob()), "_blank");
  };
  return (
    <section className="stack">
      <div className="chips">{["birth_certificate", "passport_photo", "previous_report", "immunisation"].map((k) => (
        <span key={k} className="hue-chip" style={hue(have.has(k) ? "green" : "slate")}><Icon name={have.has(k) ? "circle-check" : "hourglass"} size={12} />{meta?.documents[k] ?? k}</span>))}</div>
      {p.access.edit && (
        <section className="card g-card" style={hue("blue")}>
          <div className="row wrap">
            <Field label="What is it"><select value={kind} onChange={(e) => setKind(e.target.value)}>{meta && Object.entries(meta.documents).map(([k, l]) => <option key={k} value={k}>{l}</option>)}</select></Field>
            <label className="button primary with-icon upload-btn"><Icon name="plus" size={15} />{busy ? "Uploading…" : "Upload a scan or photo"}<input hidden type="file" accept="image/*,application/pdf,.doc,.docx" onChange={(e) => upload(e.target.files?.[0])} /></label>
          </div>
          <p className="muted small">PDF, photo or Word file, up to 5 MB. Only the school office can see documents.</p>
        </section>
      )}
      {error && <p className="error">{error}</p>}
      {(p.documents ?? []).length === 0 ? <Empty icon="file">No documents yet.</Empty> : (
        <ul className="mini-list">{p.documents!.map((d) => (
          <li key={d.id}><Icon name="file" size={16} /><span className="grow"><button className="text-link" onClick={() => open(d.id)}>{d.label}</button><small className="block muted">{d.filename} · {Math.round(d.size / 1024)} KB · {d.by} · {nice(d.at)}</small></span>
            {p.access.edit && <button className="chip-x" aria-label="Delete" onClick={() => run(async () => { if (confirm(`Delete ${d.label}?`)) onChange(await sapi.removeDoc(p.student.id, d.id)); })}><Icon name="close" size={12} /></button>}</li>
        ))}</ul>
      )}
    </section>
  );
}

export { StudentLink } from "./StudentLink";
