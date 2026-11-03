// The staff portal: what a teacher, head or support staff member sees after logging in.
import { useCallback, useEffect, useState, type CSSProperties, type FormEvent } from "react";
import { api, errorText, todayLocal, type Me } from "./api";
import { initials } from "./Dashboard";
import Icon from "./Icon";
import Layout from "./Layout";
import { EVENT_LOOK, ROLE_HUE, STAGE_LOOK, stageOf, subjectLook } from "./look";
import { href } from "./router";
import { TeacherPicker, type Teacher } from "./Teaching";
import { CheckInCard, KudosCard, MyGrowthCard } from "./GrowthMe";
import { HelpCard, MyDeskCards } from "./OpsMe";
import { MyCleaningCard } from "./Cleaning";
import { MyLibraryCard } from "./Library";
import { StudentLink } from "./StudentLink";
import { LeaveWaitingCard, MyDayCard, MyDutiesCard, MyLeaveCard, MyNotesCard, ToReviewCard } from "./StaffDayMe";
import { Avatar, Empty, Field, Glyph, hue, Modal, Stat } from "./ui";
import { MyLessonsCard } from "./Timetable";
import { MarkingCard } from "./Assessment";
import { ClubRequestsCard } from "./StudentPortal";

interface Today { total: number; marked: number; present: number; absent: number }
interface FormClass { id: string; name: string; students: number; boys: number; girls: number; today: Today }
interface Teach { slot_id: string; class_id: string; class_name: string; subject_name: string; students: number }
interface Group { id: string; subject_id: string; name: string; level: string; subject_name: string; count: number; capacity: number | null }
interface Gap { slot_id: string; class_name: string; subject_name: string; department_name: string | null }
interface Person { user_id: string; name: string; job_title: string | null; unit_name: string | null }
interface Leads { kind: string; id: string; name: string; teaching: boolean; staff: Person[]; subjects: string[]; gaps: Gap[]; classes_covered: number }
interface SchoolHome {
  school_id: string; school_name: string; motto: string | null; logo: string | null; colour: string | null; school_type: string;
  branch_id: string; has_boarding: boolean; roles: string[]; runs_school: boolean; title: string | null; job_title: string | null;
  department_name: string | null; unit_name: string | null; form_classes: FormClass[]; teaches: Teach[]; groups: Group[];
  night_roll: Today | null; leads: Leads[]; events: { title: string; starts_on: string; ends_on: string | null; category: string }[];
  teachers: Person[];
  teaching: boolean;
  team: { kind: string; name: string; head: string | null; people: Person[] } | null;
  duties: { duty: string; on_date: string; note: string | null }[];
  to_review: number; leave_waiting: number; notes_returned: number;
}
interface Home { full_name: string; owner: boolean; schools: SchoolHome[] }
interface Pupil { id: string; name: string; admission_no: string; class_name: string | null; gender: string; boarder: boolean; in_group: boolean }

const ROLE_NAME: Record<string, string> = {
  head_of_school: "Head of school", head: "Principal", vice_principal: "Vice principal", it_admin: "ICT admin", bursar: "Bursar", teacher: "Teacher",
  house_parent: "House parent", support: "Support staff",
};
const FALLBACK = ["#1d5e3a", "#1e40af", "#7e22ce", "#b45309", "#0f766e", "#be123c"];

function greeting(): string {
  const h = new Date().getHours();
  return h < 12 ? "Good morning" : h < 17 ? "Good afternoon" : "Good evening";
}

function Ring({ t, size = 52 }: { t: Today; size?: number }) {
  const r = size / 2 - 5, len = 2 * Math.PI * r;
  const pct = t.total ? t.present / t.total : 0;
  const colour = pct >= 0.9 ? "var(--h-green)" : pct >= 0.75 ? "var(--h-amber)" : "var(--h-red)";
  return (
    <svg width={size} height={size} viewBox={`0 0 ${size} ${size}`} aria-hidden="true" className="mini-ring">
      <circle cx={size / 2} cy={size / 2} r={r} fill="none" stroke="var(--border)" strokeWidth="5" />
      {t.marked > 0 && <circle cx={size / 2} cy={size / 2} r={r} fill="none" stroke={colour} strokeWidth="5" strokeLinecap="round"
                               strokeDasharray={`${len * pct} ${len}`} transform={`rotate(-90 ${size / 2} ${size / 2})`} />}
      <text x={size / 2} y={size / 2} textAnchor="middle" dominantBaseline="central" className="mini-ring-text">
        {t.marked ? `${Math.round(pct * 100)}%` : "–"}
      </text>
    </svg>
  );
}

function PupilList({ pupils }: { pupils: Pupil[] }) {
  if (pupils.length === 0) return <Empty icon="students">No students yet.</Empty>;
  return (
    <ul className="pupil-list">
      {pupils.map((p) => (
        <li key={p.id}>
          <Avatar name={p.name.split(", ").reverse().join(" ")} size={32} />
          <span className="grow"><strong><StudentLink id={p.id} name={p.name} /></strong><span className="block small muted mono">{p.admission_no}</span></span>
          {p.class_name && <span className="class-chip" style={hue(STAGE_LOOK[stageOf(p.class_name)].hue)}>{p.class_name}</span>}
          <span className="hue-chip" style={hue(p.gender === "female" ? "pink" : "blue")}>{p.gender === "female" ? "F" : "M"}</span>
          {p.boarder && <span className="hue-chip" style={hue("indigo")}><Icon name="bed" size={12} /></span>}
        </li>
      ))}
    </ul>
  );
}

function ClassListModal({ classId, title, onClose }: { classId: string; title: string; onClose: () => void }) {
  const [pupils, setPupils] = useState<Pupil[] | null>(null);
  const [error, setError] = useState("");
  useEffect(() => { api.raw<Pupil[]>("GET", `/api/me/classes/${classId}/students`).then(setPupils).catch((err) => setError(errorText(err))); }, [classId]);
  return (
    <Modal title={title} onClose={onClose}>
      {error && <p className="error">{error}</p>}
      {pupils ? <><p className="small muted">{pupils.length} students</p><PupilList pupils={pupils} /></> : <div className="skeleton"><span /><span /></div>}
    </Modal>
  );
}

function GroupModal({ group, onClose, onChanged }: { group: Group; onClose: () => void; onChanged: () => void }) {
  const [data, setData] = useState<{ members: Pupil[]; others: Pupil[] } | null>(null);
  const [q, setQ] = useState("");
  const [error, setError] = useState("");
  const load = useCallback(() => {
    api.raw<{ members: Pupil[]; others: Pupil[] }>("GET", `/api/me/groups/${group.id}`).then(setData).catch((err) => setError(errorText(err)));
  }, [group.id]);
  useEffect(load, [load]);
  const subjectId = group.subject_id;
  const change = (p: Pupil, add: boolean) => {
    if (!subjectId) return;
    api.raw("PUT", `/api/students/${p.id}/electives/${subjectId}`, add ? { taking: true, group_id: group.id } : { taking: false })
      .then(() => { load(); onChanged(); }).catch((err) => setError(errorText(err)));
  };
  const others = (data?.others ?? []).filter((p) => !q || `${p.name} ${p.admission_no} ${p.class_name}`.toLowerCase().includes(q.toLowerCase()));
  return (
    <Modal title={group.name} onClose={onClose}>
      <div className="stack">
        {error && <p className="error">{error}</p>}
        <h3 className="with-glyph"><Glyph icon="users" hue="violet" size={28} soft />In this group ({data?.members.length ?? 0}{group.capacity ? ` of ${group.capacity}` : ""})</h3>
        {data && (data.members.length === 0 ? <p className="small muted">Nobody yet.</p> : (
          <ul className="pupil-list">
            {data.members.map((p) => (
              <li key={p.id}>
                <Avatar name={p.name.split(", ").reverse().join(" ")} size={30} />
                <span className="grow"><strong>{p.name}</strong><span className="block small muted">{p.class_name}</span></span>
                <button className="ghost small" onClick={() => change(p, false)}>Remove</button>
              </li>
            ))}
          </ul>
        ))}
        <h3 className="with-glyph"><Glyph icon="user-plus" hue="green" size={28} soft />Add students</h3>
        <label className="search"><Icon name="search" size={16} /><input placeholder="Find by name, number or class" value={q} onChange={(e) => setQ(e.target.value)} /></label>
        <ul className="pupil-list short">
          {others.slice(0, 60).map((p) => (
            <li key={p.id}>
              <span className="grow"><strong>{p.name}</strong><span className="block small muted">{p.class_name}{p.in_group ? " · already has a teacher" : ""}</span></span>
              <button className="ghost small" disabled={p.in_group} onClick={() => change(p, true)}>{p.in_group ? "Taken" : "Add"}</button>
            </li>
          ))}
        </ul>
      </div>
    </Modal>
  );
}

export function ChangePassword({ onClose }: { onClose: () => void }) {
  const [current, setCurrent] = useState("");
  const [next, setNext] = useState("");
  const [done, setDone] = useState(false);
  const [error, setError] = useState("");
  async function submit(e: FormEvent) {
    e.preventDefault();
    if (next.length < 8) return setError("Use at least 8 characters.");
    try { await api.changePassword(current, next); setDone(true); } catch (err) { setError(errorText(err)); }
  }
  return (
    <Modal title="Change your password" onClose={onClose}>
      {done ? <div className="stack"><p>Your password has been changed.</p><button className="primary" onClick={onClose}>Done</button></div> : (
        <form className="stack" onSubmit={submit} noValidate>
          <Field label="Current password"><input type="password" value={current} onChange={(e) => { setCurrent(e.target.value); setError(""); }} autoFocus /></Field>
          <Field label="New password" hint="At least 8 characters. Mix letters and numbers."><input type="password" value={next} onChange={(e) => { setNext(e.target.value); setError(""); }} /></Field>
          {error && <p className="error">{error}</p>}
          <div className="row"><button className="primary">Change password</button><button type="button" onClick={onClose}>Cancel</button></div>
        </form>
      )}
    </Modal>
  );
}

function SchoolPortal({ s, me, reload }: { s: SchoolHome; me: Me; reload: () => void }) {
  const [list, setList] = useState<{ id: string; title: string } | null>(null);
  const [group, setGroup] = useState<Group | null>(null);
  const [picking, setPicking] = useState<Gap | null>(null);
  const [error, setError] = useState("");
  const colour = s.colour || FALLBACK[s.school_name.length % FALLBACK.length];
  const today = todayLocal();
  const subjects = new Map<string, Teach[]>();
  for (const t of s.teaches) subjects.set(t.subject_name, [...(subjects.get(t.subject_name) ?? []), t]);
  const students = s.teaches.reduce((n, t) => n + t.students, 0) + s.groups.reduce((n, g) => n + g.count, 0);
  const teachers: Teacher[] = s.teachers.map((p) => ({ user_id: p.user_id, full_name: p.name, title: null, job_title: p.job_title, department_name: p.unit_name, teaching: true }));

  return (
    <div className="stack staff-portal" style={{ "--school": colour } as CSSProperties}>
      <header className="school-hero portal-hero" style={{ "--school": colour } as CSSProperties}>
        <div className="hero-band"><span className="hero-pattern" aria-hidden="true" /></div>
        <div className="hero-body">
          <span className="crest hero-crest">{s.logo ? <img src={s.logo} alt="" /> : <span className="crest-initials">{initials(s.school_name)}</span>}</span>
          <div className="hero-text">
            <p className="portal-greeting">{greeting()},</p>
            <h1>{[s.title, me.full_name].filter(Boolean).join(" ")}</h1>
            <ul className="facts">
              <li style={hue("blue")}><Icon name="school" size={15} />{s.school_name}</li>
              {s.job_title && <li style={hue("violet")}><Icon name="briefcase" size={15} />{s.job_title}</li>}
              {s.department_name && <li style={hue("sky")}><Icon name="network" size={15} />{s.department_name}{s.unit_name ? `, ${s.unit_name} unit` : ""}</li>}
              {s.roles.map((r) => <li key={r} style={hue(ROLE_HUE[r] ?? "slate")}><Icon name="shield-check" size={15} />{ROLE_NAME[r] ?? r}</li>)}
            </ul>
          </div>
        </div>
      </header>

      {s.teaching ? (
        <div className="stat-strip">
          <Stat icon="classes" hue="orange" value={s.form_classes.length} label={s.form_classes.length === 1 ? "class of my own" : "classes of my own"} />
          <Stat icon="presentation" hue="sky" value={s.teaches.length + s.groups.length} label="classes and groups I teach" />
          <Stat icon="students" hue="violet" value={students} label="students I teach" />
          <Stat icon="calendar" hue="pink" value={s.events.length} label="coming up" />
        </div>
      ) : (
        <div className="stat-strip">
          <Stat icon="users" hue="cyan" value={(s.team?.people.length ?? 0) + (s.leads[0]?.staff.length ?? 0)} label="people in my team" />
          <Stat icon="calendar" hue="pink" value={s.events.length} label="coming up" />
        </div>
      )}

      {error && <p className="error">{error}</p>}

      <MyDayCard schoolId={s.school_id} />
      {s.teaching && <MyLessonsCard schoolId={s.school_id} />}
      {s.teaching && <MarkingCard />}
      <ClubRequestsCard schoolId={s.school_id} />

      <div className="portal-grid">
        <MyDeskCards schoolId={s.school_id} />
        <MyCleaningCard schoolId={s.school_id} />
        {s.leave_waiting > 0 && <LeaveWaitingCard schoolId={s.school_id} count={s.leave_waiting} />}
        {s.to_review > 0 && <ToReviewCard schoolId={s.school_id} count={s.to_review} onChanged={reload} />}
        {s.runs_school && (
          <section className="card editor portal-card run-school" style={hue("indigo")}>
            <div className="card-head"><h2 className="with-glyph"><Glyph icon="shield-check" hue="indigo" size={34} />Run the school</h2></div>
            <p className="small muted">You can manage {s.school_name}: set-up, staff, students, uploads and logins.</p>
            <div className="quick-links">
              {([["overview", "Overview"], ["staff", "Staff"], ["staff-day", "Staff day"], ["growth", "Growth"], ["operations", "Operations"], ["students", "Students"], ["teaching", "Teaching"], ["attendance", "Attendance"], ["imports", "Bulk upload"], ["logins", "Logins"]] as const).map(([t, l]) => (
                <a key={t} className="quick-link" href={href({ page: "school", id: s.school_id, tab: t })}><Icon name={t === "imports" ? "layers" : t === "logins" ? "shield-check" : t} size={16} />{l}</a>
              ))}
            </div>
          </section>
        )}

        {s.form_classes.map((c) => {
          const look = STAGE_LOOK[stageOf(c.name)];
          return (
            <section key={c.id} className="card editor portal-card" style={hue(look.hue)}>
              <div className="card-head">
                <h2 className="with-glyph"><Glyph icon={look.icon} hue={look.hue} size={34} />My class: {c.name}</h2>
              </div>
              <div className="my-class">
                <Ring t={c.today} size={64} />
                <div className="grow">
                  <strong>{c.today.marked ? `${c.today.present} of ${c.today.total} in school today` : "Register not taken today"}</strong>
                  <span className="block small muted">{c.students} students · {c.boys} boys, {c.girls} girls{c.today.absent ? ` · ${c.today.absent} absent` : ""}</span>
                </div>
              </div>
              <div className="row wrap">
                <a className="button primary-link" href={href({ page: "register", kind: "school", id: c.id, date: today })}><Icon name="attendance" size={16} />{c.today.marked ? "Open register" : "Take register"}</a>
                <a className="button with-icon" href={href({ page: "class", id: c.id })}><Icon name="students" size={16} />Open my class</a>
              </div>
            </section>
          );
        })}

        {s.night_roll && (
          <section className="card editor portal-card" style={hue("indigo")}>
            <div className="card-head"><h2 className="with-glyph"><Glyph icon="moon" hue="indigo" size={34} />Night roll call</h2></div>
            <div className="my-class">
              <Ring t={s.night_roll} size={64} />
              <div className="grow">
                <strong>{s.night_roll.marked ? `${s.night_roll.present} of ${s.night_roll.total} boarders in` : "Not taken tonight"}</strong>
                <span className="block small muted">{s.night_roll.total} boarders</span>
              </div>
            </div>
            <a className="button primary-link" href={href({ page: "register", kind: "night", id: s.branch_id, date: today })}><Icon name="moon" size={16} />Take roll call</a>
          </section>
        )}

        {s.teaching && <section className="card editor portal-card wide-card" style={hue("sky")}>
          <div className="card-head"><h2 className="with-glyph"><Glyph icon="presentation" hue="sky" size={34} />What I teach</h2></div>
          {subjects.size === 0 && s.groups.length === 0 && <Empty icon="book">No classes yet. The principal or your head of department assigns them on the Teaching page.</Empty>}
          <div className="teach-list">
            {[...subjects].map(([name, list]) => {
              const l = subjectLook(name);
              return (
                <div key={name} className="teach-subject" style={hue(l.hue)}>
                  <span className="subject-chip-icon"><Icon name={l.icon} size={15} stroke={2.2} /></span>
                  <strong className="grow">{name}</strong>
                  <div className="chips">
                    {list.map((t) => <a key={t.slot_id} className="class-pill" href={href({ page: "class", id: t.class_id })}>{t.class_name}<span>{t.students}</span></a>)}
                  </div>
                </div>
              );
            })}
            {s.groups.map((g) => {
              const l = subjectLook(g.subject_name);
              return (
                <div key={g.id} className="teach-subject" style={hue(l.hue)}>
                  <span className="subject-chip-icon"><Icon name={l.icon} size={15} stroke={2.2} /></span>
                  <strong className="grow">{g.level} {g.subject_name} <span className="elective-tag">elective group</span></strong>
                  <button className="class-pill" onClick={() => setGroup(g)}>{g.count}{g.capacity ? `/${g.capacity}` : ""} students<span>Manage</span></button>
                </div>
              );
            })}
          </div>
        </section>}

        {s.team && (
          <section className="card editor portal-card" style={hue("cyan")}>
            <div className="card-head"><h2 className="with-glyph"><Glyph icon="users" hue="cyan" size={34} />My {s.team.kind}: {s.team.name}</h2></div>
            <p className="small muted">{s.team.head ? `Head: ${s.team.head}` : "No head yet"}</p>
            <div className="lead-staff">
              {s.team.people.map((p) => (
                <span key={p.user_id} className="lead-person"><Avatar name={p.name} size={30} /><span><strong>{p.name}</strong><span className="block small muted">{p.job_title ?? ""}</span></span></span>
              ))}
              {s.team.people.length === 0 && <span className="small muted">Nobody else yet.</span>}
            </div>
          </section>
        )}

        {s.leads.map((l) => (
          <section key={l.id} className="card editor portal-card wide-card" style={hue(l.kind === "department" ? "amber" : "orange")}>
            <div className="card-head">
              <h2 className="with-glyph"><Glyph icon="crown" hue={l.kind === "department" ? "amber" : "orange"} size={34} />{l.name} {l.kind}</h2>
              <span className="hue-chip">You are the head</span>
            </div>
            <div className="lead-figures">
              <span><strong>{l.staff.length}</strong> staff</span>
              {l.teaching && <span><strong>{l.subjects.length}</strong> subjects</span>}
              {l.teaching && <span><strong>{l.classes_covered}</strong> classes covered</span>}
              {l.teaching && <span className={l.gaps.length ? "bad" : ""}><strong>{l.gaps.length}</strong> without a teacher</span>}
            </div>
            {l.staff.length > 0 && (
              <div className="lead-staff">
                {l.staff.map((p) => (
                  <span key={p.user_id} className="lead-person"><Avatar name={p.name} size={30} /><span><strong>{p.name}</strong><span className="block small muted">{p.job_title ?? ""}</span></span></span>
                ))}
              </div>
            )}
            {l.gaps.length > 0 && (
              <>
                <p className="small"><strong>Needs a teacher:</strong> click to choose one.</p>
                <div className="chips">
                  {l.gaps.slice(0, 40).map((g) => (
                    <button key={g.slot_id} className="gap-pill" style={hue(subjectLook(g.subject_name).hue)} onClick={() => setPicking(g)}>{g.subject_name} · {g.class_name}</button>
                  ))}
                  {l.gaps.length > 40 && <span className="small muted">and {l.gaps.length - 40} more</span>}
                </div>
              </>
            )}
          </section>
        ))}

        <section className="card editor portal-card" style={hue("pink")}>
          <div className="card-head"><h2 className="with-glyph"><Glyph icon="calendar" hue="pink" size={34} />Coming up</h2></div>
          {s.events.length === 0 ? <Empty icon="calendar">Nothing on the calendar.</Empty> : (
            <ul className="agenda">
              {s.events.map((e, i) => {
                const lk = EVENT_LOOK[e.category] ?? EVENT_LOOK.other, d = new Date(e.starts_on + "T00:00:00");
                return (
                  <li key={i}>
                    <span className="date-badge" style={hue(lk.hue)}><span className="date-badge-month">{d.toLocaleDateString("en-GB", { month: "short" })}</span><span className="date-badge-day">{d.getDate()}</span></span>
                    <span><strong>{e.title}</strong></span>
                  </li>
                );
              })}
            </ul>
          )}
        </section>

        <section className="card editor portal-card" style={hue("blue")}>
          <div className="card-head"><h2 className="with-glyph"><Glyph icon="user" hue="blue" size={34} />My record</h2></div>
          <p className="small muted">Your personal details, next of kin, qualifications{s.teaching ? ", TRCN" : ""} and documents. Keep them up to date.</p>
          <div className="row wrap">
            <a className="button primary-link" href={`#/staff-record/${s.school_id}/${me.id}`}><Icon name="edit" size={16} />Open my record</a>
            <a className="button with-icon" href={`#/staff-cards/${s.school_id}/${me.id}`}><Icon name="clipboard" size={16} />My ID card</a>
          </div>
        </section>

        <HelpCard schoolId={s.school_id} />
        <MyLibraryCard schoolId={s.school_id} />
        <MyGrowthCard schoolId={s.school_id} meId={me.id} onChanged={reload} />
        <CheckInCard schoolId={s.school_id} />
        <KudosCard schoolId={s.school_id} meId={me.id} />
        <MyDutiesCard duties={s.duties} />
        <MyLeaveCard schoolId={s.school_id} />
        {s.teaching && <MyNotesCard schoolId={s.school_id} returned={s.notes_returned} />}


      </div>

      {list && <ClassListModal classId={list.id} title={list.title} onClose={() => setList(null)} />}
      {group && <GroupModal group={group} onClose={() => setGroup(null)} onChanged={reload} />}
      {picking && (
        <TeacherPicker title={`${picking.subject_name} in ${picking.class_name}`} teachers={teachers} current={null} department={null}
          onClose={() => setPicking(null)}
          onPick={(uid) => {
            const g = picking;
            setPicking(null);
            api.raw("PUT", `/api/class-subjects/${g.slot_id}`, { teacher_user_id: uid }).then(reload).catch((err) => setError(errorText(err)));
          }} />
      )}
    </div>
  );
}

export default function StaffHome({ me, onLogout }: { me: Me; onLogout: () => void }) {
  const [home, setHome] = useState<Home | null>(null);
  const [which, setWhich] = useState(0);
  const [pw, setPw] = useState(false);
  const [error, setError] = useState("");
  const load = useCallback(() => {
    api.raw<Home>("GET", `/api/me/home?date=${todayLocal()}`).then(setHome).catch((err) => setError(errorText(err)));
  }, []);
  useEffect(load, [load]);
  const s = home?.schools[which];
  return (
    <Layout wide me={me} onLogout={onLogout} crumbs={[]}>
      <div className="portal-top">
        {home && home.schools.length > 1 && (
          <div className="filter-chips">
            {home.schools.map((x, i) => <button key={x.school_id} className={i === which ? "on" : ""} onClick={() => setWhich(i)}>{x.school_name}</button>)}
          </div>
        )}
        <span className="grow" />
        {home?.owner && <a className="button" href="#/">Owner's dashboard</a>}
        <button className="with-icon" onClick={() => setPw(true)}><Icon name="shield-check" size={16} />Change password</button>
      </div>
      {error && <p className="error">{error}</p>}
      {!home && !error && <div className="skeleton"><span /><span /><span /></div>}
      {home && home.schools.length === 0 && <Empty icon="school">You're not on the staff of any school yet.</Empty>}
      {s && <SchoolPortal s={s} me={me} reload={load} />}
      {pw && <ChangePassword onClose={() => setPw(false)} />}
    </Layout>
  );
}
