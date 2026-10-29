import { useCallback, useEffect, useMemo, useState, type FormEvent } from "react";
import {
  api, errorText, SCHOOL_TYPE_LABEL,
  todayLocal,
  type AcademicSession, type BranchDetail, type Me, type School, type SchoolClass, type SchoolStats, type StaffMember,
  type StaffProfileIn, type Subject, type Term,
} from "./api";
import AttendanceTab from "./AttendanceTab";
import BulkPage, { ImportButton } from "./Bulk";
import LoginsPage from "./Logins";
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
import { Avatar, Empty, Field, Glyph, hue, IconButton, Modal } from "./ui";
import Icon from "./Icon";
import {
  clubLook, departmentLook, EVENT_LOOK, hueOf, PERIOD_LOOK, POLICY_LOOK, subjectLook, TAB_LOOK, type Look,
} from "./look";

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
  imports: "Bulk upload",
  logins: "Logins and passwords",
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
  // Figures can change on other pages (an upload, say), so fetch them fresh on every page.
  useEffect(() => { loadClasses(); }, [tab, loadClasses]);

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
                <Glyph icon={TAB_LOOK[tab].icon} hue={TAB_LOOK[tab].hue} size={42} />
                {TAB_LABEL[tab]}
              </h2>
          {tab === "overview" && <OverviewTab school={school} profile={profile} onChanged={load} />}
          {campus && tab === "students" && <StudentsTab branch={campus} classes={classes} onClassesChanged={loadClasses} />}
          {campus && tab === "attendance" && <AttendanceTab branch={campus} />}
          {campus && tab === "classes" && <ClassesTab branch={campus} classes={classes} onChanged={loadClasses} setClasses={setClasses} />}
          {campus && tab === "staff" && <StaffTab branch={campus} />}
          {campus && tab === "facilities" && <FacilitiesTab branch={campus} />}
          {tab === "sections" && <SectionsCard schoolId={school.id} people={people} />}
          {tab === "departments" && <DepartmentsTab schoolId={school.id} branchId={school.campus_id} people={people} onPeopleChanged={load} />}
          {tab === "houses" && <HousesTab schoolId={school.id} people={people} />}
          {tab === "grading" && (
            <div className="sections wide">
              <GradingCard schoolId={school.id} />
              <SchemesCard schoolId={school.id} />
            </div>
          )}
          {tab === "calendar" && <CalendarTab school={school} people={people} />}
          {tab === "policies" && <PoliciesTab schoolId={school.id} people={people} />}
          {tab === "logins" && <LoginsPage schoolId={school.id} />}
          {campus && tab === "imports" && <BulkPage branchId={campus.id} onChanged={() => { loadClasses(); load(); }} />}
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
        <span className="hero-pattern" aria-hidden="true" />
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
            <li style={hue("violet")}><Icon name={school.has_boarding ? "bed" : "classes"} size={15} />{SCHOOL_TYPE_LABEL[school.school_type]}</li>
            {place && <li style={hue("rose")}><Icon name="place" size={15} />{place}</li>}
            {profile?.founded_year && <li style={hue("amber")}><Icon name="founded" size={15} />Founded {profile.founded_year}</li>}
            {profile?.phone && <li style={hue("green")}><Icon name="phone" size={15} /><a href={`tel:${profile.phone.replace(/[^\d+]/g, "")}`}>{profile.phone}</a></li>}
            {site && <li style={hue("blue")}><Icon name="globe" size={15} /><a href={profile!.website!.startsWith("http") ? profile!.website! : `https://${profile!.website}`} target="_blank" rel="noreferrer">{site}</a></li>}
          </ul>
        </div>
      </div>
    </header>
  );
}

const NAV_GROUPS: { label: string; tabs: SchoolTab[] }[] = [
  { label: "Daily", tabs: ["overview", "students", "attendance", "classes", "staff", "facilities"] },
  { label: "Set-up", tabs: ["sections", "departments", "houses", "grading", "calendar", "policies", "imports", "logins"] },
];

function SchoolNav({ schoolId, tab }: { schoolId: string; tab: SchoolTab }) {
  return (
    <nav className="school-nav" aria-label="School menu">
      {NAV_GROUPS.map((g) => (
        <div key={g.label} className="nav-group">
          <span className="nav-group-label">{g.label}</span>
          {g.tabs.map((t) => (
            <a key={t} href={href({ page: "school", id: schoolId, tab: t })} style={hue(TAB_LOOK[t].hue)}
               className={tab === t ? "active" : ""} aria-current={tab === t ? "page" : undefined}>
              <Glyph icon={TAB_LOOK[t].icon} hue={TAB_LOOK[t].hue} size={30} />
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
        <a className="tile" style={hue("violet")} href={href({ page: "school", id: school.id, tab: "students" })}>
          <Glyph icon="students" hue="violet" size={44} />
          <span className="tile-value">{stats ? stats.students.toLocaleString("en-NG") : "–"}</span>
          <span className="tile-label">Students</span>
          {stats && stats.students > 0 && <span className="tile-note">{stats.boys} boys, {stats.girls} girls{stats.boarders ? `, ${stats.boarders} boarding` : ""}</span>}
        </a>
        <a className="tile" style={hue("cyan")} href={href({ page: "school", id: school.id, tab: "staff" })}>
          <Glyph icon="staff" hue="cyan" size={44} />
          <span className="tile-value">{stats ? stats.staff : "–"}</span>
          <span className="tile-label">Staff</span>
          <span className="tile-note">Teaching and support</span>
        </a>
        <a className="tile" style={hue("orange")} href={href({ page: "school", id: school.id, tab: "classes" })}>
          <Glyph icon="classes" hue="orange" size={44} />
          <span className="tile-value">{stats ? stats.classes : "–"}</span>
          <span className="tile-label">Classes</span>
          {stats && <span className="tile-note">{stats.departments} departments</span>}
        </a>
        <a className="tile" style={hue("green")} href={href({ page: "school", id: school.id, tab: "attendance" })}>
          <Glyph icon="attendance" hue="green" size={44} />
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
            <h3 className="with-glyph"><Glyph icon="school" hue="blue" size={32} soft />About the school</h3>
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
            <h3 className="with-glyph"><Glyph icon="sparkle" hue="amber" size={32} soft />Setting up</h3>
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
            <h3 className="with-glyph"><Glyph icon="calendar" hue="pink" size={32} soft />Coming up</h3>
            <a className="small" href={href({ page: "school", id: school.id, tab: "calendar" })}>Calendar</a>
          </div>
          {events.length === 0 ? (
            <Empty>Nothing on the calendar yet.</Empty>
          ) : (
            <ul className="agenda">
              {events.map((e) => {
                const lk = EVENT_LOOK[String(e.category)] ?? EVENT_LOOK.other;
                return (
                  <li key={e.id}>
                    <DateBadge iso={String(e.starts_on)} look={lk} />
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

function DepartmentsTab({ schoolId, branchId, people, onPeopleChanged }: {
  schoolId: string; branchId: string | null | undefined; people: PersonOption[]; onPeopleChanged: () => void;
}) {
  const deptApi = useMemo(() => records("school", schoolId, "departments"), [schoolId]);
  const [departments, setDepartments] = useState<Item[]>([]);
  const [subjects, setSubjects] = useState<Subject[] | null>(null);
  const [staff, setStaff] = useState<StaffMember[]>([]);
  const [open, setOpen] = useState<Item | null>(null);
  const [version, setVersion] = useState(0);
  const loadSubjects = useCallback(() => { api.subjects(schoolId).then(setSubjects).catch(() => {}); }, [schoolId]);
  const loadStaff = useCallback(() => { if (branchId) api.staff(branchId).then(setStaff).catch(() => {}); }, [branchId]);
  useEffect(loadSubjects, [loadSubjects]);
  useEffect(loadStaff, [loadStaff]);
  const perDept = (id: string) => (subjects ?? []).filter((x) => x.department_id === id).length;
  const members = (id: string) => staff.filter((p) => p.department_id === id).length;
  return (
    <div className="stack wide-stack">
      <RecordEditor
        title="Departments"
        noun="department"
        intro="Click a department to see its head, staff, subjects and rooms."
        fields={[
          { key: "name", label: "Name", required: true },
          { key: "kind", label: "Type", type: "select", required: true, options: optionsOf(DEPARTMENT_KIND), defaultValue: "academic" },
          { key: "head_user_id", label: "Head of department", type: "person" },
          { key: "description", label: "Description (optional)", type: "textarea" },
        ]}
        people={people}
        api={deptApi}
        layout="tiles"
        emptyIcon="departments"
        reloadKey={version}
        onItems={setDepartments}
        groupBy={(d) => DEPARTMENT_KIND[d.kind as keyof typeof DEPARTMENT_KIND]}
        groupLook={(g) => (g === "Academic" ? { icon: "book", hue: "blue" } : { icon: "building", hue: "slate" })}
        look={(d) => departmentLook(String(d.name), String(d.kind))}
        summary={(d) => (
          <button className="link-button" onClick={() => setOpen(d)}>
            <strong>{String(d.name)}</strong>
            <span className="muted small block">
              {[
                d.kind === "academic" ? `${perDept(d.id)} ${perDept(d.id) === 1 ? "subject" : "subjects"}` : null,
                `${members(d.id)} staff`,
              ].filter(Boolean).join(" · ")}
            </span>
            <span className="small block dept-head">
              {d.head_name ? <><Icon name="crown" size={12} stroke={2.3} />{String(d.head_name)}</> : <span className="muted">No head yet</span>}
            </span>
          </button>
        )}
        emptyText="No departments yet. Click Add common departments to start with the usual ones."
        actions={(reload) => (
          <>
            {branchId && <ImportButton branchId={branchId} kind="departments" onDone={reload} label="Upload" />}
            <button className="with-icon" onClick={() => structure.addStandardDepartments(schoolId).then(reload)}>
              <Icon name="sparkle" size={16} />Add common departments
            </button>
          </>
        )}
      />
      <SubjectsCard schoolId={schoolId} subjects={subjects} setSubjects={setSubjects} reload={loadSubjects}
                    departments={departments.filter((d) => d.kind === "academic")} />
      {open && branchId && (
        <DepartmentDetail
          dept={departments.find((d) => d.id === open.id) ?? open}
          branchId={branchId}
          schoolId={schoolId}
          staff={staff}
          subjects={(subjects ?? []).filter((x) => x.department_id === open.id)}
          onClose={() => setOpen(null)}
          onChanged={() => { loadStaff(); setVersion((x) => x + 1); onPeopleChanged(); }}
        />
      )}
    </div>
  );
}

const profileOf = (p: StaffMember): StaffProfileIn => ({
  full_name: p.full_name, title: p.title, gender: p.gender, job_title: p.job_title, department_id: p.department_id,
  teaching: p.teaching, staff_no: p.staff_no, employment_type: p.employment_type, date_joined: p.date_joined,
  qualification: p.qualification,
});

function DepartmentDetail({ dept, branchId, schoolId, staff, subjects, onClose, onChanged }: {
  dept: Item; branchId: string; schoolId: string; staff: StaffMember[]; subjects: Subject[]; onClose: () => void; onChanged: () => void;
}) {
  const look = departmentLook(String(dept.name), String(dept.kind));
  const [facilities, setFacilities] = useState<Item[]>([]);
  const [adding, setAdding] = useState("");
  const [error, setError] = useState("");
  useEffect(() => {
    records("branch", branchId, "facilities").list().then((f) => setFacilities(f.filter((x) => x.department_id === dept.id))).catch(() => {});
  }, [branchId, dept.id]);
  const inDept = staff.filter((p) => p.department_id === dept.id);
  const others = staff.filter((p) => p.department_id !== dept.id);
  const head = staff.find((p) => p.user_id === dept.head_user_id);
  const deptApi = records("school", schoolId, "departments");
  const saveDept = (head_user_id: string | null) =>
    deptApi.update(dept.id, { name: dept.name, kind: dept.kind, description: dept.description ?? null, head_user_id })
      .then(onChanged).catch((err) => setError(errorText(err)));
  const moveIn = (p: StaffMember, to: string | null) =>
    api.updateStaff(branchId, p.user_id, { ...profileOf(p), department_id: to }).then(onChanged).catch((err) => setError(errorText(err)));

  return (
    <Modal title={String(dept.name)} onClose={onClose}>
      <div className="stack dept-detail" style={hue(look.hue)}>
        <div className="dept-hero">
          <Glyph icon={look.icon} hue={look.hue} size={60} />
          <div className="grow">
            <span className="hue-chip">{dept.kind === "academic" ? "Academic department" : "Support team"}</span>
            {dept.description ? <p className="small" style={{ marginTop: 6 }}>{String(dept.description)}</p> : null}
            <div className="dept-figures">
              <span><strong>{inDept.length}</strong> staff</span>
              {dept.kind === "academic" && <span><strong>{subjects.length}</strong> subjects</span>}
              <span><strong>{facilities.length}</strong> rooms</span>
            </div>
          </div>
        </div>

        <section>
          <h3 className="with-glyph"><Glyph icon="crown" hue="amber" size={28} soft />Head of department</h3>
          <div className="head-pick">
            {head ? <Avatar name={head.full_name} size={40} /> : <span className="vacant-dot"><Icon name="user" size={16} /></span>}
            <select aria-label="Head of department" value={dept.head_user_id ? String(dept.head_user_id) : ""} onChange={(e) => saveDept(e.target.value || null)}>
              <option value="">Nobody yet</option>
              {[...inDept, ...others].map((p) => <option key={p.user_id} value={p.user_id}>{displayName(p)}{p.job_title ? ` (${p.job_title})` : ""}</option>)}
            </select>
          </div>
        </section>

        <section>
          <h3 className="with-glyph"><Glyph icon="users" hue={look.hue} size={28} soft />Staff in this department</h3>
          {inDept.length === 0 ? <p className="small muted">Nobody yet.</p> : (
            <ul className="member-list">
              {inDept.map((p) => (
                <li key={p.user_id}>
                  <Avatar name={p.full_name} size={34} />
                  <span className="grow">
                    <strong>{displayName(p)}</strong>
                    <span className="block small muted">{p.job_title || "No position yet"}{p.user_id === dept.head_user_id ? " · Head" : ""}</span>
                  </span>
                  <IconButton icon="close" label={`Take ${p.full_name} out of ${String(dept.name)}`} onClick={() => moveIn(p, null)} />
                </li>
              ))}
            </ul>
          )}
          {others.length > 0 && (
            <div className="row wrap" style={{ marginTop: 8 }}>
              <select aria-label="Add a staff member" value={adding} onChange={(e) => setAdding(e.target.value)} style={{ flex: 1 }}>
                <option value="">Add someone to this department…</option>
                {others.map((p) => <option key={p.user_id} value={p.user_id}>{displayName(p)}{p.department_name ? ` (now ${p.department_name})` : ""}</option>)}
              </select>
              <button className="primary" disabled={!adding} onClick={() => {
                const p = others.find((x) => x.user_id === adding);
                if (p) moveIn(p, dept.id).then(() => setAdding(""));
              }}>Add</button>
            </div>
          )}
        </section>

        {dept.kind === "academic" && (
          <section>
            <h3 className="with-glyph"><Glyph icon="book" hue="blue" size={28} soft />Subjects</h3>
            {subjects.length === 0 ? <p className="small muted">No subjects yet. Choose this department for a subject on the Subjects card.</p> : (
              <div className="subject-chips">
                {subjects.map((x) => {
                  const l = subjectLook(x.name);
                  return <span key={x.id} className="subject-chip" style={hue(l.hue)}><span className="subject-chip-icon"><Icon name={l.icon} size={15} stroke={2.2} /></span>{x.name}</span>;
                })}
              </div>
            )}
          </section>
        )}

        {facilities.length > 0 && (
          <section>
            <h3 className="with-glyph"><Glyph icon="facilities" hue="teal" size={28} soft />Rooms and facilities</h3>
            <div className="chips">{facilities.map((f) => <span key={f.id} className="hue-chip" style={hue("teal")}>{String(f.name)}</span>)}</div>
          </section>
        )}
        {error && <p className="error">{error}</p>}
      </div>
    </Modal>
  );
}

const displayName = (p: StaffMember) => [p.title, p.full_name].filter(Boolean).join(" ");

function SubjectsCard({ schoolId, subjects, setSubjects, reload, departments }: {
  schoolId: string; subjects: Subject[] | null; setSubjects: (s: Subject[]) => void; reload: () => void; departments: Item[];
}) {
  const [name, setName] = useState("");
  const [code, setCode] = useState("");
  const [dept, setDept] = useState("");
  const [error, setError] = useState("");
  const [open, setOpen] = useState<Subject | null>(null);

  async function add(e: FormEvent) {
    e.preventDefault();
    if (name.trim().length < 2) return setError("Enter a subject name.");
    try {
      const made = await api.addSubject(schoolId, name.trim(), code.trim());
      if (dept) await structure.setSubjectDepartment(made.id, dept);
      setName("");
      setCode("");
      reload();
    } catch (err) {
      setError(errorText(err));
    }
  }

  const groups: { id: string; name: string; look: Look; list: Subject[] }[] = [
    ...departments.map((d) => ({
      id: d.id, name: String(d.name), look: departmentLook(String(d.name), "academic"),
      list: (subjects ?? []).filter((x) => x.department_id === d.id),
    })),
    { id: "", name: "Not in a department", look: { icon: "shapes", hue: "slate" } as Look, list: (subjects ?? []).filter((x) => !x.department_id || !departments.some((d) => d.id === x.department_id)) },
  ].filter((g) => g.list.length > 0);

  return (
    <section className="card editor">
      <div className="card-head">
        <div>
          <h2>Subjects</h2>
          <p className="muted small editor-intro">{subjects ? `${subjects.length} subjects, grouped by department. Click a subject to move or remove it.` : "\u00a0"}</p>
        </div>
        <button className="with-icon" onClick={() => api.addCommonSubjects(schoolId).then(setSubjects)}><Icon name="sparkle" size={16} />Add common subjects</button>
      </div>
      <form className="add-row" onSubmit={add} noValidate>
        <input aria-label="Subject name" placeholder="New subject, e.g. Further Mathematics" value={name} onChange={(e) => { setName(e.target.value); setError(""); }} />
        <input aria-label="Code" placeholder="Code (optional)" value={code} onChange={(e) => setCode(e.target.value)} />
        <select aria-label="Department for the new subject" value={dept} onChange={(e) => setDept(e.target.value)}>
          <option value="">No department</option>
          {departments.map((d) => <option key={d.id} value={d.id}>{String(d.name)}</option>)}
        </select>
        <button className="primary with-icon"><Icon name="plus" size={16} />Add</button>
      </form>
      {error && <p className="error">{error}</p>}
      {subjects === null && <div className="skeleton" aria-hidden="true"><span /><span /></div>}
      {subjects?.length === 0 && <Empty icon="book">No subjects yet. Click Add common subjects to start with the usual ones.</Empty>}
      <div className="subject-groups">
        {groups.map((g) => (
          <div key={g.id || "none"} className="subject-group" style={hue(g.look.hue)}>
            <h3 className="group-title"><Glyph icon={g.look.icon} hue={g.look.hue} size={26} soft />{g.name}<span className="count">{g.list.length}</span></h3>
            <div className="subject-chips">
              {g.list.map((x) => {
                const l = subjectLook(x.name);
                return (
                  <button key={x.id} className="subject-chip" style={hue(l.hue)} onClick={() => setOpen(x)} title={`${x.name}: move or remove`}>
                    <span className="subject-chip-icon"><Icon name={l.icon} size={15} stroke={2.2} /></span>
                    {x.name}
                    {x.code && <span className="subject-code">{x.code}</span>}
                  </button>
                );
              })}
            </div>
          </div>
        ))}
      </div>
      {open && (
        <Modal title={open.name} onClose={() => setOpen(null)}>
          <div className="stack">
            <div className="subject-hero" style={hue(subjectLook(open.name).hue)}>
              <Glyph icon={subjectLook(open.name).icon} hue={subjectLook(open.name).hue} size={52} />
              <div>
                <strong>{open.name}</strong>
                <span className="muted small block">{open.code ? `Code ${open.code}` : "No code"}</span>
              </div>
            </div>
            <Field label="Department">
              <select value={open.department_id ?? ""} onChange={(e) => {
                const v = e.target.value || null;
                structure.setSubjectDepartment(open.id, v).then(() => { setOpen({ ...open, department_id: v }); reload(); }).catch((err) => setError(errorText(err)));
              }}>
                <option value="">No department</option>
                {departments.map((d) => <option key={d.id} value={d.id}>{String(d.name)}</option>)}
              </select>
            </Field>
            <div className="row">
              <button className="primary" onClick={() => setOpen(null)}>Done</button>
              <button className="danger-outline with-icon" onClick={() => {
                if (window.confirm(`Remove ${open.name}?`))
                  api.deleteSubject(open.id).then(() => { setOpen(null); reload(); }).catch((err) => setError(errorText(err)));
              }}><Icon name="trash" size={16} />Remove subject</button>
            </div>
          </div>
        </Modal>
      )}
    </section>
  );
}

// ---------------- Houses and clubs ----------------

function HouseCrest({ name, colour }: { name: string; colour: string | null }) {
  return (
    <span className="house-crest" style={hue(hueOf(name), colour)} aria-hidden="true">
      <svg viewBox="0 0 48 52" width="48" height="52">
        <path d="M24 2 4 9v14c0 13 8.6 22.6 20 27 11.4-4.4 20-14 20-27V9z" fill="var(--hue)" />
        <path d="M24 2 4 9v14c0 13 8.6 22.6 20 27V2z" fill="#fff" opacity="0.14" />
        <text x="24" y="29" textAnchor="middle" dominantBaseline="central">{name.trim()[0]?.toUpperCase()}</text>
      </svg>
    </span>
  );
}

function HousesTab({ schoolId, people }: { schoolId: string; people: PersonOption[] }) {
  const houseApi = useMemo(() => records("school", schoolId, "houses"), [schoolId]);
  const clubApi = useMemo(() => records("school", schoolId, "clubs"), [schoolId]);
  return (
    <div className="stack wide-stack">
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
        layout="cards"
        emptyIcon="houses"
        look={(h) => ({ icon: "houses", hue: hueOf(String(h.name)), colour: (h.colour as string) || null })}
        lead={(h) => <HouseCrest name={String(h.name)} colour={(h.colour as string) || null} />}
        summary={(h) => (
          <>
            <strong className="item-title">{String(h.name)}</strong>
            {h.motto ? <span className="small block house-motto">“{String(h.motto)}”</span> : null}
            <span className="muted small block">{h.master_name ? `Led by ${h.master_name}` : "No house master yet"}</span>
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
        layout="tiles"
        emptyIcon="club"
        groupBy={(c) => CLUB_KIND[c.kind as keyof typeof CLUB_KIND]}
        groupLook={(g) => clubLook("", Object.entries(CLUB_KIND).find(([, v]) => v === g)?.[0])}
        look={(c) => clubLook(String(c.name), String(c.kind))}
        summary={(c) => (
          <>
            <strong>{String(c.name)}</strong>
            <span className="muted small block">
              {[c.meeting_time, c.patron_name ? `Patron: ${c.patron_name}` : null].filter(Boolean).join(" · ") || "No details yet"}
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

/** A little calendar page: month on a coloured strip, day underneath. */
function DateBadge({ iso, look }: { iso: string; look: Look }) {
  const d = new Date(iso + "T00:00:00");
  return (
    <span className="date-badge" style={hue(look.hue)} aria-hidden="true">
      <span className="date-badge-month">{d.toLocaleDateString("en-GB", { month: "short" })}</span>
      <span className="date-badge-day">{d.getDate()}</span>
    </span>
  );
}

function daysFrom(iso: string): number {
  const today = new Date(todayLocal() + "T00:00:00").getTime();
  return Math.round((new Date(iso + "T00:00:00").getTime() - today) / 86400000);
}

function NextUp({ events }: { events: Item[] }) {
  const today = todayLocal();
  const now = events.find((e) => String(e.starts_on) <= today && String(e.ends_on || e.starts_on) >= today);
  const next = events.filter((e) => String(e.starts_on) > today).sort((a, b) => String(a.starts_on).localeCompare(String(b.starts_on)))[0];
  const e = now ?? next;
  if (!e) return null;
  const lk = EVENT_LOOK[String(e.category)] ?? EVENT_LOOK.other;
  const n = daysFrom(String(e.starts_on));
  return (
    <div className="next-up" style={hue(lk.hue)}>
      <Glyph icon={lk.icon} hue={lk.hue} size={56} />
      <div className="grow">
        <span className="next-label">{now ? "Happening now" : "Next on the calendar"}</span>
        <strong className="next-title">{String(e.title)}</strong>
        <span className="small">
          {niceDate(String(e.starts_on))}
          {e.ends_on && e.ends_on !== e.starts_on ? ` to ${niceDate(String(e.ends_on))}` : ""}
        </span>
      </div>
      {!now && (
        <span className="countdown">
          <strong>{n}</strong>
          <span>{n === 1 ? "day to go" : "days to go"}</span>
        </span>
      )}
    </div>
  );
}

function CalendarTab({ school, people }: { school: School; people: PersonOption[] }) {
  const eventApi = useMemo(() => records("school", school.id, "events"), [school.id]);
  const periodApi = useMemo(() => records("school", school.id, "periods"), [school.id]);
  const [sections, setSections] = useState<Item[]>([]);
  const [events, setEvents] = useState<Item[]>([]);
  useEffect(() => {
    records("school", school.id, "sections").list().then(setSections).catch(() => {});
  }, [school.id]);

  return (
    <div className="stack">
      <NextUp events={events} />
      <div className="calendar-grid">
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
          onItems={setEvents}
          emptyIcon="event"
          groupBy={(e) => new Date(String(e.starts_on) + "T00:00:00").toLocaleDateString("en-GB", { month: "long", year: "numeric" })}
          lead={(e) => <DateBadge iso={String(e.starts_on)} look={EVENT_LOOK[String(e.category)] ?? EVENT_LOOK.other} />}
          summary={(e) => {
            const lk = EVENT_LOOK[String(e.category)] ?? EVENT_LOOK.other;
            const days = e.ends_on && e.ends_on !== e.starts_on ? daysFrom(String(e.ends_on)) - daysFrom(String(e.starts_on)) + 1 : 1;
            return (
              <>
                <strong>{String(e.title)}</strong>
                <span className="event-meta">
                  <span className="hue-chip" style={hue(lk.hue)}><Icon name={lk.icon} size={13} stroke={2.2} />{EVENT_CATEGORY[e.category as keyof typeof EVENT_CATEGORY]}</span>
                  <span className="muted small">
                    {days > 1 ? `${days} days, to ${niceDate(String(e.ends_on))}` : "One day"}
                  </span>
                </span>
              </>
            );
          }}
          emptyText="No events yet."
        />
      </div>
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
        layout="tiles"
        emptyIcon="bell"
        groupBy={(p) => (p.section_name ? String(p.section_name) : "Whole school")}
        lead={(p) => {
          const lk = PERIOD_LOOK[String(p.kind)] ?? PERIOD_LOOK.other;
          return <span className="time-badge" style={hue(lk.hue)}><Icon name={lk.icon} size={14} stroke={2.2} />{String(p.starts_at).slice(0, 5)}</span>;
        }}
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

const TERM_HUES = ["green", "amber", "violet"] as const;

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
    <section className="card editor sessions-card">
      <div className="card-head">
        <div>
          <h2>Sessions and terms</h2>
          <p className="muted small editor-intro">Each session has three terms. Mark the term you are in now as current.</p>
        </div>
      </div>
      <form className="add-row" onSubmit={add} noValidate>
        <input aria-label="New session" value={name} onChange={(e) => { setName(e.target.value); setError(""); }} placeholder="2026/2027" />
        <button className="primary with-icon"><Icon name="plus" size={16} />Add session</button>
      </form>
      {error && <p className="error">{error}</p>}
      {sessions?.length === 0 && <Empty icon="calendar">No sessions yet. Add one to create its three terms.</Empty>}
      {sessions?.map((s) => (
        <div key={s.id} className="session">
          <h3 className="session-name"><Icon name="graduation-cap" size={18} />{s.name} session</h3>
          <ol className="terms">
            {s.terms.map((t, i) => (
              <li key={t.id} className={`term${t.is_current ? " current" : ""}`} style={hue(TERM_HUES[i % 3])}>
                <span className="term-number">{i + 1}</span>
                <div className="grow">
                  <strong>{t.name}</strong>
                  {t.is_current && <span className="now-pill">Now</span>}
                  <span className="muted small block">
                    {t.starts_on || t.ends_on
                      ? `${t.starts_on ? niceDate(t.starts_on) : "Not set"} to ${t.ends_on ? niceDate(t.ends_on) : "Not set"}`
                      : "Dates not set"}
                  </span>
                </div>
                <div className="term-actions">
                  {!t.is_current && (
                    <button className="ghost small" onClick={() => api.makeCurrent(t.id).then(setSessions)}>Make current</button>
                  )}
                  <IconButton icon="calendar" label={`${t.name} dates`} onClick={() => setEditingTerm(t)} />
                </div>
              </li>
            ))}
          </ol>
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
        groupLook={(g) => POLICY_LOOK[g] ?? POLICY_LOOK.General}
        look={(p) => POLICY_LOOK[String(p.category)] ?? POLICY_LOOK.General}
        layout="tiles"
        emptyIcon="policies"
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
