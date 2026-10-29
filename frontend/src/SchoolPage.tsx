import { useCallback, useEffect, useMemo, useState, type FormEvent } from "react";
import {
  api, errorText, SCHOOL_TYPE_LABEL,
  todayLocal,
  type AcademicSession, type BranchDetail, type Me, type School, type SchoolClass, type SchoolStats, type Subject, type Term,
} from "./api";
import AttendanceTab from "./AttendanceTab";
import { ClassesTab, StaffTab, StudentsTab } from "./DailyTabs";
import FacilitiesTab from "./FacilitiesTab";
import Layout from "./Layout";
import { SchoolForm } from "./forms";
import ProfileCard from "./ProfileCard";
import RecordEditor from "./RecordEditor";
import { GradingCard, SchemesCard } from "./GradingCards";
import SectionsCard from "./SectionsCard";
import { initials, schoolColour } from "./Dashboard";
import StarterSetup from "./StarterSetup";
import BoardsCard from "./BoardsCard";
import { org } from "./orgApi";
import { go } from "./router";
import { href, type SchoolTab } from "./router";
import {
  CLUB_KIND, DEPARTMENT_KIND, EVENT_CATEGORY, optionsOf, PERIOD_KIND, POLICY_CATEGORIES, records, structure,
  type Item, type PersonOption, type Profile, type SetupCounts,
} from "./structureApi";
import { Empty, Field, Modal } from "./ui";
import Icon from "./Icon";

const TAB_LABEL: Record<SchoolTab, string> = {
  overview: "Overview",
  students: "Students",
  attendance: "Attendance",
  classes: "Classes",
  staff: "Staff",
  facilities: "Facilities",
  sections: "Sections",
  departments: "Departments and subjects",
  houses: "Houses and clubs",
  grading: "Grading",
  calendar: "Calendar",
  policies: "Rules and policies",
};

export default function SchoolPage({
  me, onLogout, schoolId, tab,
}: { me: Me; onLogout: () => void; schoolId: string; tab: SchoolTab }) {
  const [school, setSchool] = useState<School | null>(null);
  const [people, setPeople] = useState<PersonOption[]>([]);
  const [error, setError] = useState("");
  const [editing, setEditing] = useState(false);
  const [managing, setManaging] = useState(false);

  const [campus, setCampus] = useState<BranchDetail | null>(null);
  const [classes, setClasses] = useState<SchoolClass[]>([]);
  const [profile, setProfile] = useState<Profile | null>(null);

  const load = useCallback(() => {
    structure.profile(schoolId).then(setProfile).catch(() => {});
    api.school(schoolId).then((s) => {
      setSchool(s);
      if (s.campus_id) {
        api.branch(s.campus_id).then(setCampus).catch(() => {});
        api.classes(s.campus_id).then(setClasses).catch(() => {});
      }
    }).catch((err) => setError(err.message));
    structure.staffOptions(schoolId).then(setPeople).catch(() => {});
  }, [schoolId]);
  useEffect(load, [load]);
  const loadClasses = useCallback(() => {
    if (school?.campus_id) api.classes(school.campus_id).then(setClasses).catch(() => {});
  }, [school?.campus_id]);

  return (
    <Layout wide me={me} onLogout={onLogout} crumbs={[{ label: "Home", href: "#/" }, { label: school?.name ?? "School" }]}>
      {error && <p className="error">{error}</p>}
      {school && (
        <>
          <SchoolHero
            school={school}
            profile={profile}
            onRename={() => setEditing(true)}
            onManage={() => setManaging(true)}
          />

          {managing && <ManageSchool school={school} onClose={() => setManaging(false)} />}

          {editing && (
            <Modal title="Edit school" onClose={() => setEditing(false)}>
              <SchoolForm
                initial={school}
                submitLabel="Save changes"
                onCancel={() => setEditing(false)}
                onSubmit={async (name, type) => {
                  setSchool(await api.updateSchool(school.id, name, type));
                  setEditing(false);
                }}
              />
            </Modal>
          )}

          <div className="school-shell" style={{ "--school": schoolColour(school) } as React.CSSProperties}>
            <SchoolNav schoolId={school.id} tab={tab} />
            <div className="school-main">
              <h2 className="main-title">
                <Icon name={tab} size={22} />
                {TAB_LABEL[tab]}
              </h2>
          {tab === "overview" && <OverviewTab school={school} profile={profile} onChanged={load} />}
          {campus && tab === "students" && <StudentsTab branch={campus} classes={classes} onClassesChanged={loadClasses} />}
          {campus && tab === "attendance" && <AttendanceTab branch={campus} />}
          {campus && tab === "classes" && <ClassesTab branch={campus} classes={classes} onChanged={loadClasses} setClasses={setClasses} />}
          {campus && tab === "staff" && <StaffTab branch={campus} />}
          {campus && tab === "facilities" && <FacilitiesTab branch={campus} />}
          {tab === "sections" && <SectionsCard schoolId={school.id} people={people} />}
          {tab === "departments" && <DepartmentsTab schoolId={school.id} people={people} />}
          {tab === "houses" && <HousesTab schoolId={school.id} people={people} />}
          {tab === "grading" && (
            <div className="sections wide">
              <GradingCard schoolId={school.id} />
              <SchemesCard schoolId={school.id} />
            </div>
          )}
          {tab === "calendar" && <CalendarTab school={school} people={people} />}
          {tab === "policies" && <PoliciesTab schoolId={school.id} people={people} />}
            </div>
          </div>
        </>
      )}
    </Layout>
  );
}

// ---------------- Header and menu ----------------

function SchoolHero({ school, profile, onRename, onManage }: {
  school: School; profile: Profile | null; onRename: () => void; onManage: () => void;
}) {
  const place = [profile?.lga, profile?.state].filter(Boolean).join(", ");
  const site = profile?.website?.replace(/^https?:\/\//, "").replace(/\/$/, "");
  return (
    <header className="school-hero" style={{ "--school": schoolColour(school) } as React.CSSProperties}>
      <div className="hero-band">
        <div className="hero-actions">
          <button className="on-band" onClick={onRename}>Rename or change type</button>
          <button className="on-band" onClick={onManage}>Move or remove</button>
        </div>
      </div>
      <div className="hero-body">
        <span className="crest hero-crest">
          {school.logo ? <img src={school.logo} alt="" /> : <span className="crest-initials">{initials(school.name)}</span>}
        </span>
        <div className="hero-text">
          <h1>{school.name}</h1>
          {school.motto && <p className="hero-motto">{school.motto}</p>}
          <ul className="facts">
            <li><Icon name="classes" size={15} />{SCHOOL_TYPE_LABEL[school.school_type]}</li>
            {place && <li><Icon name="place" size={15} />{place}</li>}
            {profile?.founded_year && <li><Icon name="founded" size={15} />Founded {profile.founded_year}</li>}
            {profile?.phone && <li><Icon name="phone" size={15} /><a href={`tel:${profile.phone.replace(/[^\d+]/g, "")}`}>{profile.phone}</a></li>}
            {site && <li><Icon name="globe" size={15} /><a href={profile!.website!.startsWith("http") ? profile!.website! : `https://${profile!.website}`} target="_blank" rel="noreferrer">{site}</a></li>}
          </ul>
        </div>
      </div>
    </header>
  );
}

const NAV_GROUPS: { label: string; tabs: SchoolTab[] }[] = [
  { label: "Daily", tabs: ["overview", "students", "attendance", "classes", "staff", "facilities"] },
  { label: "Set-up", tabs: ["sections", "departments", "houses", "grading", "calendar", "policies"] },
];

function SchoolNav({ schoolId, tab }: { schoolId: string; tab: SchoolTab }) {
  return (
    <nav className="school-nav" aria-label="School menu">
      {NAV_GROUPS.map((g) => (
        <div key={g.label} className="nav-group">
          <span className="nav-group-label">{g.label}</span>
          {g.tabs.map((t) => (
            <a key={t} href={href({ page: "school", id: schoolId, tab: t })}
               className={tab === t ? "active" : ""} aria-current={tab === t ? "page" : undefined}>
              <Icon name={t} />
              <span>{TAB_LABEL[t]}</span>
            </a>
          ))}
        </div>
      ))}
    </nav>
  );
}

// ---------------- Overview ----------------

function Ring({ value, total }: { value: number; total: number }) {
  const r = 34, c = 2 * Math.PI * r, pct = total ? value / total : 0;
  return (
    <svg className="ring" width="88" height="88" viewBox="0 0 88 88" role="img" aria-label={`${value} of ${total} done`}>
      <circle cx="44" cy="44" r={r} fill="none" stroke="var(--border)" strokeWidth="8" />
      <circle cx="44" cy="44" r={r} fill="none" stroke="var(--school)" strokeWidth="8" strokeLinecap="round"
              strokeDasharray={`${c * pct} ${c}`} transform="rotate(-90 44 44)" />
      <text x="44" y="44" textAnchor="middle" dominantBaseline="central" className="ring-text">{value}/{total}</text>
    </svg>
  );
}

function OverviewTab({ school, profile, onChanged }: { school: School; profile: Profile | null; onChanged: () => void }) {
  const [counts, setCounts] = useState<SetupCounts | null>(null);
  const [stats, setStats] = useState<SchoolStats | null>(null);
  const [events, setEvents] = useState<Item[]>([]);
  const [version, setVersion] = useState(0);
  const [editingProfile, setEditingProfile] = useState(false);

  useEffect(() => {
    structure.counts(school.id).then(setCounts).catch(() => {});
    api.dashboardStats(todayLocal()).then((all) => setStats(all[school.id] ?? null)).catch(() => {});
    records("school", school.id, "events").list()
      .then((list) => setEvents(list.filter((e) => String(e.ends_on ?? e.starts_on) >= todayLocal()).slice(0, 5)))
      .catch(() => {});
  }, [school.id, version]);

  const steps: { done: boolean; label: string; tab: SchoolTab }[] = counts
    ? [
        { done: counts.profile_complete, label: "Profile: motto, address and phone", tab: "overview" },
        { done: counts.sections > 0, label: "Sections and their class levels", tab: "sections" },
        { done: counts.grading_scales > 0 && counts.assessment_schemes > 0, label: "Grading scale and CA / exam split", tab: "grading" },
        { done: counts.departments > 0, label: "Departments", tab: "departments" },
        { done: counts.subjects > 0, label: "Subjects", tab: "departments" },
        { done: counts.houses > 0, label: "Houses and clubs", tab: "houses" },
        { done: counts.events > 0 || counts.periods > 0, label: "Calendar, events and bell times", tab: "calendar" },
        { done: counts.policies > 0, label: "Rules and policies", tab: "policies" },
      ]
    : [];
  const done = steps.filter((s) => s.done).length;
  const todo = steps.filter((s) => !s.done);
  // Decide once, when the page opens, whether to offer the starter set-up, so its summary
  // stays on screen after it runs (even though the progress then jumps).
  const [offerStarter, setOfferStarter] = useState<boolean | null>(null);
  useEffect(() => {
    if (counts && offerStarter === null) setOfferStarter(done < 5);
  }, [counts, done, offerStarter]);
  const t = stats?.today;
  const presentPct = t && t.in_classes ? Math.round((100 * t.present) / t.in_classes) : null;
  const refresh = () => { onChanged(); setVersion((v) => v + 1); };

  return (
    <div className="overview" style={{ "--school": schoolColour(school) } as React.CSSProperties}>
      <div className="tiles">
        <a className="tile" href={href({ page: "school", id: school.id, tab: "students" })}>
          <Icon name="students" size={22} />
          <span className="tile-value">{stats ? stats.students.toLocaleString("en-NG") : "–"}</span>
          <span className="tile-label">Students</span>
          {stats && stats.students > 0 && <span className="tile-note">{stats.boys} boys, {stats.girls} girls{stats.boarders ? `, ${stats.boarders} boarding` : ""}</span>}
        </a>
        <a className="tile" href={href({ page: "school", id: school.id, tab: "staff" })}>
          <Icon name="staff" size={22} />
          <span className="tile-value">{stats ? stats.staff : "–"}</span>
          <span className="tile-label">Staff</span>
        </a>
        <a className="tile" href={href({ page: "school", id: school.id, tab: "classes" })}>
          <Icon name="classes" size={22} />
          <span className="tile-value">{stats ? stats.classes : "–"}</span>
          <span className="tile-label">Classes</span>
          {stats && <span className="tile-note">{stats.departments} departments</span>}
        </a>
        <a className="tile tile-today" href={href({ page: "school", id: school.id, tab: "attendance" })}>
          <Icon name="attendance" size={22} />
          <span className="tile-value">{presentPct === null ? "–" : t!.marked ? `${presentPct}%` : "Not yet"}</span>
          <span className="tile-label">Present today</span>
          {t && t.in_classes > 0 && (
            <span className="tile-note">{t.marked ? `${t.present} of ${t.in_classes}${t.absent ? `, ${t.absent} absent` : ""}` : "Register not taken"}</span>
          )}
        </a>
      </div>

      <div className="overview-grid">
        <section className="card about">
          <div className="card-head">
            <h3>About the school</h3>
            <button onClick={() => setEditingProfile(true)}><Icon name="edit" size={15} /> Edit profile</button>
          </div>
          {profile && (
            <dl className="about-list">
              <dt>Address</dt><dd>{profile.address || <span className="muted">Not set</span>}</dd>
              <dt>Area</dt><dd>{[profile.lga, profile.state].filter(Boolean).join(", ") || <span className="muted">Not set</span>}</dd>
              <dt>Phone</dt><dd>{profile.phone || <span className="muted">Not set</span>}</dd>
              <dt>Email</dt><dd>{profile.email ? <a href={`mailto:${profile.email}`}>{profile.email}</a> : <span className="muted">Not set</span>}</dd>
              <dt>Founded</dt><dd>{profile.founded_year || <span className="muted">Not set</span>}</dd>
              <dt>School colour</dt>
              <dd>{profile.colour ? <span className="row" style={{ gap: 8, alignItems: "center" }}><span className="swatch" style={{ background: profile.colour }} />{profile.colour}</span> : <span className="muted">Not set (a uniform colour is used)</span>}</dd>
              <dt>Ministry approval</dt><dd>{profile.approval_number || <span className="muted">Not set</span>}</dd>
              <dt>WAEC centre</dt><dd>{profile.waec_centre_no || <span className="muted">Not set</span>}</dd>
              <dt>NECO centre</dt><dd>{profile.neco_centre_no || <span className="muted">Not set</span>}</dd>
            </dl>
          )}
        </section>

        {counts && (
          <section className="card progress-card">
            <h3>Setting up</h3>
            <div className="progress-head">
              <Ring value={done} total={steps.length} />
              <p className="small">
                {done === steps.length
                  ? "Everything is in place."
                  : `${todo.length} ${todo.length === 1 ? "thing" : "things"} left before ${school.name} is fully set up.`}
              </p>
            </div>
            {todo.length > 0 && (
              <ul className="todo">
                {todo.map((s) => (
                  <li key={s.label}><a href={href({ page: "school", id: school.id, tab: s.tab })}>{s.label}</a></li>
                ))}
              </ul>
            )}
            {offerStarter && <StarterSetup compact school={school} onDone={refresh} />}
          </section>
        )}

        <section className="card">
          <div className="card-head">
            <h3>Coming up</h3>
            <a className="small" href={href({ page: "school", id: school.id, tab: "calendar" })}>Calendar</a>
          </div>
          {events.length === 0 ? (
            <Empty>Nothing on the calendar yet.</Empty>
          ) : (
            <ul className="agenda">
              {events.map((e) => {
                const d = new Date(String(e.starts_on) + "T00:00:00");
                return (
                  <li key={e.id}>
                    <span className="agenda-date">
                      <span className="agenda-day">{d.getDate()}</span>
                      <span className="agenda-month">{d.toLocaleDateString("en-GB", { month: "short" })}</span>
                    </span>
                    <span>
                      <strong>{String(e.title)}</strong>
                      <span className="muted small block">
                        {EVENT_CATEGORY[e.category as keyof typeof EVENT_CATEGORY]}
                        {e.ends_on && e.ends_on !== e.starts_on
                          ? `, until ${new Date(String(e.ends_on) + "T00:00:00").toLocaleDateString("en-GB", { day: "numeric", month: "short" })}`
                          : ""}
                      </span>
                    </span>
                  </li>
                );
              })}
            </ul>
          )}
        </section>

        <div className="board-slot">
          <BoardsCard
            scope={{ kind: "school", id: school.id }}
            title="School board"
            suggestedName="Board of Governors"
            intro="Members get a read-only view of this school."
          />
        </div>
      </div>

      {editingProfile && (
        <Modal title={`${school.name} profile`} onClose={() => setEditingProfile(false)}>
          <ProfileCard bare schoolId={school.id} onSaved={() => { refresh(); setEditingProfile(false); }} />
        </Modal>
      )}
    </div>
  );
}

// ---------------- Departments and subjects ----------------

function DepartmentsTab({ schoolId, people }: { schoolId: string; people: PersonOption[] }) {
  const deptApi = useMemo(() => records("school", schoolId, "departments"), [schoolId]);
  const [version, setVersion] = useState(0);
  return (
    <div className="sections wide">
      <RecordEditor
        title="Departments"
        noun="department"
        intro="Academic departments group subjects and teachers. Non-academic departments are the school's support teams."
        fields={[
          { key: "name", label: "Name", required: true },
          { key: "kind", label: "Type", type: "select", required: true, options: optionsOf(DEPARTMENT_KIND), defaultValue: "academic" },
          { key: "head_user_id", label: "Head of department", type: "person" },
          { key: "description", label: "Description (optional)", type: "textarea" },
        ]}
        people={people}
        api={deptApi}
        groupBy={(d) => DEPARTMENT_KIND[d.kind as keyof typeof DEPARTMENT_KIND]}
        icon={(d) => (d.kind === "academic" ? "book" : "department")}
        summary={(d) => (
          <>
            <strong>{String(d.name)}</strong>
            <span className="muted small block">{d.head_name ? `Head: ${d.head_name}` : "No head yet"}</span>
          </>
        )}
        emptyText="No departments yet. Click Add common departments to start with the usual ones."
        actions={(reload) => (
          <button onClick={() => structure.addStandardDepartments(schoolId).then(reload)}>Add common departments</button>
        )}
        onChanged={() => setVersion((v) => v + 1)}
      />
      <SubjectsCard schoolId={schoolId} departmentsVersion={version} />
    </div>
  );
}

function SubjectsCard({ schoolId, departmentsVersion }: { schoolId: string; departmentsVersion: number }) {
  const [subjects, setSubjects] = useState<Subject[] | null>(null);
  const [departments, setDepartments] = useState<Item[]>([]);
  const [name, setName] = useState("");
  const [code, setCode] = useState("");
  const [error, setError] = useState("");

  const load = useCallback(() => {
    api.subjects(schoolId).then(setSubjects).catch((err) => setError(err.message));
  }, [schoolId]);
  useEffect(load, [load]);
  useEffect(() => {
    records("school", schoolId, "departments").list()
      .then((d) => setDepartments(d.filter((x) => x.kind === "academic")))
      .catch(() => {});
  }, [schoolId, departmentsVersion]);

  async function add(e: FormEvent) {
    e.preventDefault();
    if (name.trim().length < 2) return setError("Enter a subject name.");
    try {
      await api.addSubject(schoolId, name.trim(), code.trim());
      setName("");
      setCode("");
      load();
    } catch (err) {
      setError(errorText(err));
    }
  }

  return (
    <section className="card">
      <div className="card-head">
        <h2>Subjects</h2>
        <button onClick={() => api.addCommonSubjects(schoolId).then(setSubjects)}>Add common subjects</button>
      </div>
      <p className="muted small">Shared by every branch. Choose which academic department each subject belongs to.</p>
      <form className="row wrap" onSubmit={add} noValidate>
        <input aria-label="Subject name" placeholder="Subject name" value={name} onChange={(e) => { setName(e.target.value); setError(""); }} />
        <input aria-label="Code" placeholder="Code (optional)" value={code} onChange={(e) => setCode(e.target.value)} style={{ maxWidth: 140 }} />
        <button className="primary">Add</button>
      </form>
      {error && <p className="error">{error}</p>}
      {subjects?.length === 0 && <Empty>No subjects yet.</Empty>}
      {subjects && subjects.length > 0 && (
        <ul className="list">
          {subjects.map((s) => (
            <li key={s.id}>
              <span className="grow">
                {s.name}
                {s.code && <span className="muted"> ({s.code})</span>}
              </span>
              <select
                aria-label={`Department for ${s.name}`}
                value={s.department_id ?? ""}
                onChange={(e) =>
                  structure.setSubjectDepartment(s.id, e.target.value || null).then(load).catch((err) => setError(errorText(err)))
                }
                style={{ maxWidth: 200 }}
              >
                <option value="">No department</option>
                {departments.map((d) => <option key={d.id} value={d.id}>{String(d.name)}</option>)}
              </select>
              <button
                className="ghost"
                aria-label={`Remove ${s.name}`}
                onClick={() => {
                  if (window.confirm(`Remove ${s.name}?`)) api.deleteSubject(s.id).then(load).catch((err) => setError(errorText(err)));
                }}
              >
                ✕
              </button>
            </li>
          ))}
        </ul>
      )}
    </section>
  );
}

// ---------------- Houses and clubs ----------------

function HousesTab({ schoolId, people }: { schoolId: string; people: PersonOption[] }) {
  const houseApi = useMemo(() => records("school", schoolId, "houses"), [schoolId]);
  const clubApi = useMemo(() => records("school", schoolId, "clubs"), [schoolId]);
  return (
    <div className="sections wide">
      <RecordEditor
        title="Houses"
        noun="house"
        intro="Sports and inter-house competition houses. Students are put into houses later."
        fields={[
          { key: "name", label: "House name", required: true, placeholder: "e.g. Aggrey House" },
          { key: "colour", label: "House colour", type: "colour" },
          { key: "motto", label: "Motto (optional)" },
          { key: "master_user_id", label: "House master / mistress", type: "person" },
        ]}
        people={people}
        api={houseApi}
        icon={() => "houses"}
        accent={(h) => (h.colour as string) || null}
        summary={(h) => (
          <>
            <strong>{String(h.name)}</strong>
            <span className="muted small block">
              {[h.motto, h.master_name ? `Led by ${h.master_name}` : null].filter(Boolean).join(", ") || "No details yet"}
            </span>
          </>
        )}
        emptyText="No houses yet."
      />
      <RecordEditor
        title="Clubs, societies and teams"
        noun="club"
        fields={[
          { key: "name", label: "Name", required: true, placeholder: "e.g. JETS Club, Debate Society" },
          { key: "kind", label: "Type", type: "select", required: true, options: optionsOf(CLUB_KIND), defaultValue: "club" },
          { key: "meeting_time", label: "When it meets (optional)", placeholder: "e.g. Wednesdays, 3pm" },
          { key: "patron_user_id", label: "Patron", type: "person" },
          { key: "description", label: "Description (optional)", type: "textarea" },
        ]}
        people={people}
        api={clubApi}
        groupBy={(c) => CLUB_KIND[c.kind as keyof typeof CLUB_KIND]}
        icon={() => "club"}
        summary={(c) => (
          <>
            <strong>{String(c.name)}</strong>
            <span className="muted small block">
              {[c.meeting_time, c.patron_name ? `Patron: ${c.patron_name}` : null].filter(Boolean).join(", ") || "No details yet"}
            </span>
          </>
        )}
        emptyText="No clubs yet."
      />
    </div>
  );
}

// ---------------- Calendar ----------------

function niceDate(iso: string): string {
  return new Date(iso + "T00:00:00").toLocaleDateString("en-GB", { day: "numeric", month: "short", year: "numeric" });
}

function CalendarTab({ school, people }: { school: School; people: PersonOption[] }) {
  const eventApi = useMemo(() => records("school", school.id, "events"), [school.id]);
  const periodApi = useMemo(() => records("school", school.id, "periods"), [school.id]);
  const [sections, setSections] = useState<Item[]>([]);
  useEffect(() => {
    records("school", school.id, "sections").list().then(setSections).catch(() => {});
  }, [school.id]);

  return (
    <div className="sections wide">
      <SessionsSection schoolId={school.id} />
      <RecordEditor
        title="Events and dates"
        noun="event"
        intro="Resumption, mid-term breaks, exams, PTA meetings, visiting days, inter-house sports, graduation..."
        fields={[
          { key: "title", label: "Title", required: true },
          { key: "category", label: "Type", type: "select", required: true, options: optionsOf(EVENT_CATEGORY), defaultValue: "other" },
          { key: "starts_on", label: "Date (or start date)", type: "date", required: true },
          { key: "ends_on", label: "End date (optional)", type: "date" },
          { key: "description", label: "Details (optional)", type: "textarea" },
        ]}
        people={people}
        api={eventApi}
        groupBy={(e) => new Date(String(e.starts_on) + "T00:00:00").toLocaleDateString("en-GB", { month: "long", year: "numeric" })}
        icon={() => "event"}
        summary={(e) => (
          <>
            <strong>{String(e.title)}</strong>
            <span className="muted small block">
              {niceDate(String(e.starts_on))}
              {e.ends_on && e.ends_on !== e.starts_on ? ` to ${niceDate(String(e.ends_on))}` : ""} ·{" "}
              {EVENT_CATEGORY[e.category as keyof typeof EVENT_CATEGORY]}
            </span>
          </>
        )}
        emptyText="No events yet."
      />
      <RecordEditor
        title="Bell times"
        noun="period"
        intro="The shape of the school day. Leave the section empty if the times are the same for everyone. Used later for timetables."
        fields={[
          { key: "name", label: "Name", required: true, placeholder: "e.g. Period 1, Short break" },
          { key: "kind", label: "Type", type: "select", required: true, options: optionsOf(PERIOD_KIND), defaultValue: "lesson" },
          { key: "starts_at", label: "Starts", type: "time", required: true },
          { key: "ends_at", label: "Ends", type: "time", required: true },
          { key: "section_id", label: "Section", type: "select", allowNone: "Whole school", options: sections.map((s) => ({ value: s.id, label: String(s.name) })) },
        ]}
        people={people}
        api={periodApi}
        reloadKey={sections.length}
        groupBy={(p) => (p.section_name ? String(p.section_name) : "Whole school")}
        icon={() => "bell"}
        summary={(p) => (
          <>
            <strong>{String(p.name)}</strong>
            <span className="muted small block">
              {String(p.starts_at).slice(0, 5)} to {String(p.ends_at).slice(0, 5)} · {PERIOD_KIND[p.kind as keyof typeof PERIOD_KIND]}
            </span>
          </>
        )}
        emptyText="No bell times yet."
      />
    </div>
  );
}

function suggestedSessionName(): string {
  const now = new Date();
  const start = now.getMonth() >= 7 ? now.getFullYear() : now.getFullYear() - 1;
  return `${start}/${start + 1}`;
}

function SessionsSection({ schoolId }: { schoolId: string }) {
  const [sessions, setSessions] = useState<AcademicSession[] | null>(null);
  const [name, setName] = useState(suggestedSessionName());
  const [error, setError] = useState("");
  const [editingTerm, setEditingTerm] = useState<Term | null>(null);

  const load = useCallback(() => {
    api.sessions(schoolId).then(setSessions).catch((err) => setError(err.message));
  }, [schoolId]);
  useEffect(load, [load]);

  async function add(e: FormEvent) {
    e.preventDefault();
    setError("");
    try {
      await api.addSession(schoolId, name);
      load();
    } catch (err) {
      setError(errorText(err));
    }
  }

  return (
    <section className="card">
      <div className="card-head">
        <h2>Sessions and terms</h2>
      </div>
      <form className="row wrap" onSubmit={add} noValidate>
        <input aria-label="New session" value={name} onChange={(e) => { setName(e.target.value); setError(""); }} placeholder="2026/2027" style={{ maxWidth: 160 }} />
        <button className="primary">Add session</button>
      </form>
      {error && <p className="error">{error}</p>}
      {sessions?.length === 0 && <Empty>No sessions yet. Add one to create its three terms.</Empty>}
      {sessions?.map((s) => (
        <div key={s.id} className="session">
          <h3>{s.name}</h3>
          <ul className="list">
            {s.terms.map((t) => (
              <li key={t.id}>
                <div>
                  {t.name}
                  {t.is_current && <span className="tag">Current</span>}
                  <span className="muted small block">
                    {t.starts_on || t.ends_on
                      ? `${t.starts_on ? niceDate(t.starts_on) : "Not set"} to ${t.ends_on ? niceDate(t.ends_on) : "Not set"}`
                      : "Dates not set"}
                  </span>
                </div>
                <div className="row">
                  {!t.is_current && (
                    <button className="ghost" onClick={() => api.makeCurrent(t.id).then(setSessions)}>Make current</button>
                  )}
                  <button className="ghost" onClick={() => setEditingTerm(t)}>Dates</button>
                </div>
              </li>
            ))}
          </ul>
        </div>
      ))}
      {editingTerm && (
        <TermDates term={editingTerm} onClose={() => setEditingTerm(null)} onSaved={() => { setEditingTerm(null); load(); }} />
      )}
    </section>
  );
}

function TermDates({ term, onClose, onSaved }: { term: Term; onClose: () => void; onSaved: () => void }) {
  const [start, setStart] = useState(term.starts_on ?? "");
  const [end, setEnd] = useState(term.ends_on ?? "");
  const [error, setError] = useState("");
  async function save(e: FormEvent) {
    e.preventDefault();
    try {
      await api.updateTerm(term.id, start || null, end || null);
      onSaved();
    } catch (err) {
      setError(errorText(err));
    }
  }
  return (
    <Modal title={`${term.name} dates`} onClose={onClose}>
      <form className="stack" onSubmit={save} noValidate>
        <Field label="Starts">
          <input type="date" value={start} onChange={(e) => { setStart(e.target.value); setError(""); }} />
        </Field>
        <Field label="Ends">
          <input type="date" value={end} onChange={(e) => { setEnd(e.target.value); setError(""); }} />
        </Field>
        {error && <p className="error">{error}</p>}
        <div className="row">
          <button className="primary">Save dates</button>
          <button type="button" onClick={onClose}>Cancel</button>
        </div>
      </form>
    </Modal>
  );
}

// ---------------- Policies ----------------

function PoliciesTab({ schoolId, people }: { schoolId: string; people: PersonOption[] }) {
  const policyApi = useMemo(() => records("school", schoolId, "policies"), [schoolId]);
  const [reading, setReading] = useState<Item | null>(null);
  return (
    <>
      <RecordEditor
        title="Rules and policies"
        noun="policy"
        intro="School rules, uniform, visiting days, what boarders should bring, health and safety. Parents will be able to read these later."
        fields={[
          { key: "title", label: "Title", required: true, placeholder: "e.g. Items boarders should bring" },
          { key: "category", label: "Category", type: "select", required: true, options: POLICY_CATEGORIES.map((c) => ({ value: c, label: c })), defaultValue: "General" },
          { key: "body", label: "Text", type: "textarea", wide: true },
        ]}
        people={people}
        api={policyApi}
        groupBy={(p) => String(p.category)}
        icon={() => "policies"}
        summary={(p) => (
          <button className="link-button" onClick={() => setReading(p)}>
            <strong>{String(p.title)}</strong>
            <span className="muted small block clamp">{String(p.body || "No text yet")}</span>
          </button>
        )}
        emptyText="No rules or policies yet."
      />
      {reading && (
        <Modal title={String(reading.title)} onClose={() => setReading(null)}>
          <div className="policy-text">{String(reading.body || "No text yet")}</div>
        </Modal>
      )}
    </>
  );
}

function ManageSchool({ school, onClose }: { school: School; onClose: () => void }) {
  const [groups, setGroups] = useState<{ id: string; name: string; schoolIds: string[] }[]>([]);
  const [target, setTarget] = useState("");
  const [typed, setTyped] = useState("");
  const [error, setError] = useState("");
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    api.groups()
      .then((gs) => setGroups(gs.map((g) => ({ id: g.id, name: g.name, schoolIds: g.schools.map((s) => s.id) }))))
      .catch((err) => setError(errorText(err)));
  }, []);
  const current = groups.find((g) => g.schoolIds.includes(school.id));
  const others = groups.filter((g) => g !== current);

  async function move() {
    if (!target) return setError("Choose where to move it.");
    setBusy(true);
    try {
      await org.moveSchool(school.id, target);
      go({ page: "org", id: target });
    } catch (err) {
      setError(errorText(err));
      setBusy(false);
    }
  }

  async function remove() {
    if (typed.trim().toLowerCase() !== school.name.trim().toLowerCase()) return setError(`Type ${school.name} exactly to confirm.`);
    setBusy(true);
    try {
      await org.deleteSchool(school.id, typed);
      window.location.hash = "#/";
    } catch (err) {
      setError(errorText(err));
      setBusy(false);
    }
  }

  return (
    <Modal title={`Move or remove ${school.name}`} onClose={onClose}>
      <div className="stack">
        <section className="sub-card">
          <h3>Move to another organisation</h3>
          <p className="small muted">
            {current ? `It's in ${current.name} now. ` : ""}Its staff, students and board go with it.
          </p>
          {others.length === 0 ? (
            <p className="small">
              There's no other organisation yet. Create one with <strong>+ New organisation</strong> on the dashboard first.
            </p>
          ) : (
            <div className="row wrap">
              <select aria-label="Move to" value={target} onChange={(e) => { setTarget(e.target.value); setError(""); }}>
                <option value="">Choose an organisation…</option>
                {others.map((g) => <option key={g.id} value={g.id}>{g.name}</option>)}
              </select>
              <button className="primary" disabled={busy} onClick={move}>Move school</button>
            </div>
          )}
        </section>
        <section className="sub-card danger-zone">
          <h3>Remove this school</h3>
          <p className="small">
            This permanently deletes {school.name} with all its classes, students, attendance, facilities and
            set-up. It can't be undone. People's logins are kept.
          </p>
          <Field label={`Type ${school.name} to confirm`}>
            <input value={typed} onChange={(e) => { setTyped(e.target.value); setError(""); }} />
          </Field>
          <div className="row"><button className="danger" disabled={busy} onClick={remove}>Remove school</button></div>
        </section>
        {error && <p className="error">{error}</p>}
      </div>
    </Modal>
  );
}
