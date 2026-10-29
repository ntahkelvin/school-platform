import { useCallback, useEffect, useState, type FormEvent } from "react";
import {
  api, errorText, ROLE_LABEL,
  type BranchDetail, type EmploymentType, type NewLogin, type SchoolClass, type StaffMember, type StaffProfileIn,
  type SchoolStats, type StaffRole, type StudentRow, todayLocal,
} from "./api";
import { ImportButton } from "./Bulk";
import { LoginPanel } from "./Logins";
import { records, type Item } from "./structureApi";
import { go, href } from "./router";
import StudentForm from "./StudentForm";
import { Avatar, Empty, Field, Glyph, hue, IconButton, Modal, NewLoginNotice, nicePhone, Stat } from "./ui";
import Icon from "./Icon";
import { departmentLook, ROLE_HUE, STAGE_LOOK, stageOf } from "./look";

const stageHue = (level: string) => STAGE_LOOK[stageOf(level)].hue;
const levelOfName = (name: string) => name.replace(/\s*[A-Za-z]+$/, "").trim() || name;


// ---------------- Students ----------------

export function StudentsTab({
  branch, classes, onClassesChanged,
}: { branch: BranchDetail; classes: SchoolClass[]; onClassesChanged: () => void }) {
  const [students, setStudents] = useState<StudentRow[] | null>(null);
  const [q, setQ] = useState("");
  const [classId, setClassId] = useState("");
  const [showLeft, setShowLeft] = useState(false);
  const [adding, setAdding] = useState(false);
  const [newLogin, setNewLogin] = useState<NewLogin | null>(null);
  const [error, setError] = useState("");

  const load = useCallback(() => {
    api.students(branch.id, { q, class_id: classId || undefined, include_inactive: showLeft })
      .then(setStudents)
      .catch((err) => setError(err.message));
  }, [branch.id, q, classId, showLeft]);

  useEffect(() => {
    const t = setTimeout(load, 250); // wait until the user stops typing
    return () => clearTimeout(t);
  }, [load]);

  // Whole-school figures (they include students not yet in a class), fetched fresh.
  const [totals, setTotals] = useState<SchoolStats | null>(null);
  const loadTotals = useCallback(() => {
    api.dashboardStats(todayLocal()).then((all) => setTotals(all[branch.school_id] ?? null)).catch(() => {});
  }, [branch.school_id]);
  useEffect(loadTotals, [loadTotals, classes]);
  const inClasses = classes.reduce((n, c) => n + c.student_count, 0);
  const t = totals ?? { students: inClasses, boys: 0, girls: 0, boarders: 0 };
  const noClass = totals ? totals.students - inClasses : 0;
  return (
    <section className="stack">
      <div className="stat-strip">
        <Stat icon="students" hue="violet" value={t.students} label="students"
              note={noClass > 0 ? `${noClass} not in a class yet` : `in ${classes.filter((c) => c.student_count).length} classes`} />
        <Stat icon="boys" hue="blue" value={t.boys} label="boys" />
        <Stat icon="girls" hue="pink" value={t.girls} label="girls" />
        {branch.has_boarding
          ? <Stat icon="bed" hue="indigo" value={t.boarders} label="boarders" note={`${t.students - t.boarders} day students`} />
          : <Stat icon="sun" hue="amber" value={t.students} label="day students" />}
      </div>
      <div className="toolbar students-toolbar">
        <label className="search">
          <Icon name="search" size={17} />
          <input aria-label="Search students" placeholder="Search by name or admission number" value={q} onChange={(e) => setQ(e.target.value)} />
        </label>
        <label className="check">
          <input type="checkbox" checked={showLeft} onChange={(e) => setShowLeft(e.target.checked)} />
          Include students who left
        </label>
        <ImportButton branchId={branch.id} kind="students" onDone={() => { load(); onClassesChanged(); }} />
        <button className="primary with-icon" onClick={() => setAdding(true)}><Icon name="plus" size={16} />Add student</button>
      </div>
      {classes.length > 0 && (
        <div className="filter-chips" role="group" aria-label="Filter by class">
          <button className={classId === "" ? "on" : ""} onClick={() => setClassId("")}>All classes</button>
          {classes.map((c) => (
            <button key={c.id} className={classId === c.id ? "on" : ""} style={hue(stageHue(c.level))} onClick={() => setClassId(c.id)}>
              <span className="chip-dot" />{c.name}<span className="chip-count">{c.student_count}</span>
            </button>
          ))}
        </div>
      )}

      {error && <p className="error">{error}</p>}
      {students === null && !error && <div className="skeleton" aria-hidden="true"><span /><span /><span /></div>}
      {students?.length === 0 && (
        <Empty icon="students">
          {q || classId ? "No students match." : "No students yet. Click Add student to enrol the first one."}
          {classes.length === 0 && !q && (
            <> Tip: <a href={href({ page: "school", id: branch.school_id, tab: "classes" })}>create classes</a> first.</>
          )}
        </Empty>
      )}
      {students && students.length > 0 && (
        <div className="table-wrap people-table">
          <table>
            <thead>
              <tr>
                <th>Student</th>
                <th>Class</th>
                <th className="hide-small">Gender</th>
                {branch.has_boarding && <th className="hide-small">Day or boarding</th>}
                {showLeft && <th>Status</th>}
              </tr>
            </thead>
            <tbody>
              {students.map((s) => (
                <tr key={s.id} className="clickable" onClick={() => go({ page: "student", id: s.id })}>
                  <td>
                    <span className="person">
                      <Avatar name={`${s.first_name} ${s.last_name}`} size={36} />
                      <span>
                        <a href={href({ page: "student", id: s.id })}>{s.last_name}, {s.first_name}{s.middle_name ? ` ${s.middle_name}` : ""}</a>
                        <span className="muted small block mono">{s.admission_no}</span>
                      </span>
                    </span>
                  </td>
                  <td>{s.class_name ? <span className="class-chip" style={hue(stageHue(levelOfName(s.class_name)))}>{s.class_name}</span> : <span className="muted">None</span>}</td>
                  <td className="hide-small">
                    <span className="hue-chip" style={hue(s.gender === "female" ? "pink" : "blue")}>
                      <Icon name={s.gender === "female" ? "girls" : "boys"} size={12} stroke={2.4} />{s.gender === "female" ? "Female" : "Male"}
                    </span>
                  </td>
                  {branch.has_boarding && (
                    <td className="hide-small">
                      {s.boarding_status === "boarder"
                        ? <span className="hue-chip" style={hue("indigo")}><Icon name="bed" size={12} stroke={2.4} />Boarder</span>
                        : <span className="hue-chip" style={hue("amber")}><Icon name="sun" size={12} stroke={2.4} />Day</span>}
                    </td>
                  )}
                  {showLeft && <td className="capitalize">{s.status}</td>}
                </tr>
              ))}
            </tbody>
          </table>
          <p className="muted small table-foot">{students.length} {students.length === 1 ? "student" : "students"}</p>
        </div>
      )}

      {adding && (
        <Modal title="Add student" onClose={() => setAdding(false)}>
          <StudentForm
            classes={classes}
            hasBoarding={branch.has_boarding}
            withGuardian
            submitLabel="Add student"
            onCancel={() => setAdding(false)}
            onSubmit={async (data, guardian) => {
              const res = await api.addStudent(branch.id, data, guardian);
              setAdding(false);
              load();
              onClassesChanged();
              if (res.new_login) setNewLogin(res.new_login);
            }}
          />
        </Modal>
      )}
      {newLogin && (
        <Modal title="Parent login" onClose={() => setNewLogin(null)}>
          <NewLoginNotice login={newLogin} onDone={() => setNewLogin(null)} />
        </Modal>
      )}
    </section>
  );
}

// ---------------- Classes ----------------

export function ClassesTab({
  branch, classes, onChanged, setClasses,
}: { branch: BranchDetail; classes: SchoolClass[]; onChanged: () => void; setClasses: (c: SchoolClass[]) => void }) {
  const [levels, setLevels] = useState<string[]>([]);
  const [level, setLevel] = useState("");
  const [arm, setArm] = useState("");
  const [error, setError] = useState("");

  useEffect(() => {
    api.levels().then(setLevels).catch(() => {});
  }, []);

  async function add(e: FormEvent) {
    e.preventDefault();
    if (!level) return setError("Choose a level.");
    try {
      setClasses(await api.addClass(branch.id, level, arm.trim()));
      setArm("");
      setError("");
    } catch (err) {
      setError(errorText(err));
    }
  }

  const stages: [string, SchoolClass[]][] = [];
  for (const c of classes) {
    const st = stageOf(c.level);
    const found = stages.find(([n]) => n === st);
    if (found) found[1].push(c); else stages.push([st, [c]]);
  }
  const total = classes.reduce((n, c) => n + c.student_count, 0);
  const biggest = Math.max(1, ...classes.map((c) => c.student_count));

  return (
    <div className="stack">
      <div className="stat-strip">
        <Stat icon="classes" hue="orange" value={classes.length} label={classes.length === 1 ? "class" : "classes"} note={`${stages.length} ${stages.length === 1 ? "stage" : "stages"}`} />
        <Stat icon="students" hue="violet" value={total} label="students" note={classes.length ? `About ${Math.round(total / classes.length)} per class` : undefined} />
        <Stat icon="boys" hue="blue" value={classes.reduce((n, c) => n + (c.boys ?? 0), 0)} label="boys" />
        <Stat icon="girls" hue="pink" value={classes.reduce((n, c) => n + (c.girls ?? 0), 0)} label="girls" />
      </div>
      <section className="card editor">
        <div className="card-head">
          <div>
            <h2>All classes</h2>
            <p className="muted small editor-intro">Each class is a level and an arm, for example JSS 1 and A.</p>
          </div>
          <form className="row wrap add-class" onSubmit={add} noValidate>
            <select aria-label="Level" value={level} onChange={(e) => { setLevel(e.target.value); setError(""); }}>
              <option value="">Level…</option>
              {levels.map((l) => <option key={l}>{l}</option>)}
            </select>
            <input aria-label="Arm" placeholder="Arm, e.g. A or Gold" value={arm} onChange={(e) => { setArm(e.target.value); setError(""); }} />
            <button className="primary with-icon"><Icon name="plus" size={16} />Add class</button>
          </form>
        </div>
        {error && <p className="error">{error}</p>}
        {classes.length === 0 ? (
          <Empty icon="classes">No classes yet. Add one for each class, for example JSS 1 arm A.</Empty>
        ) : (
          stages.map(([stage, list]) => {
            const look = STAGE_LOOK[stage];
            const n = list.reduce((x, c) => x + c.student_count, 0);
            return (
              <div key={stage} className="group stage" style={hue(look.hue)}>
                <h3 className="stage-title">
                  <Glyph icon={look.icon} hue={look.hue} size={34} />
                  <span>{stage}</span>
                  <span className="count">{list.length} {list.length === 1 ? "class" : "classes"} · {n} {n === 1 ? "student" : "students"}</span>
                </h3>
                <div className="class-grid">
                  {list.map((c) => {
                    const boys = c.boys ?? 0, girls = c.girls ?? 0;
                    return (
                      <div key={c.id} className="class-tile" data-class={c.name}>
                        <div className="class-top">
                          <strong className="class-name">{c.level}<span className="class-arm">{c.arm}</span></strong>
                          <span className="class-tile-actions">
                            <IconButton icon="trash" label={`Delete ${c.name}`} danger onClick={() => {
                              if (window.confirm(`Delete ${c.name}?`)) api.deleteClass(c.id).then(onChanged).catch((err) => setError(errorText(err)));
                            }} />
                          </span>
                        </div>
                        <div className="class-count">
                          <strong>{c.student_count}</strong> {c.student_count === 1 ? "student" : "students"}
                        </div>
                        <div className="split" title={`${boys} boys, ${girls} girls`}>
                          <span className="split-boys" style={{ width: `${(100 * boys) / biggest}%` }} />
                          <span className="split-girls" style={{ width: `${(100 * girls) / biggest}%` }} />
                        </div>
                        <div className="class-legend">
                          <span><i className="dot boys" />{boys} boys</span>
                          <span><i className="dot girls" />{girls} girls</span>
                          {branch.has_boarding && c.boarders ? <span><Icon name="bed" size={12} />{c.boarders}</span> : null}
                        </div>
                      </div>
                    );
                  })}
                </div>
              </div>
            );
          })
        )}
      </section>
    </div>
  );
}

// ---------------- Staff ----------------

const EMPLOYMENT: Record<EmploymentType, string> = {
  full_time: "Full time", part_time: "Part time", contract: "Contract", nysc: "NYSC corps member", volunteer: "Volunteer",
};
const TITLES = ["Mr", "Mrs", "Miss", "Ms", "Dr", "Rev Fr", "Fr", "Rev Sr", "Sr", "Br", "Prof", "Chief"];

const displayName = (p: StaffMember) => [p.title, p.full_name].filter(Boolean).join(" ");
const holds = (p: StaffMember, position: string) => {
  const j = (p.job_title ?? "").toLowerCase(), want = position.toLowerCase();
  return j === want || j.startsWith(want + " ") || j.startsWith(want + ",") || (want === "principal" && j === "head teacher");
};

export function StaffTab({ branch }: { branch: BranchDetail }) {
  const [staff, setStaff] = useState<StaffMember[] | null>(null);
  const [departments, setDepartments] = useState<Item[]>([]);
  const [options, setOptions] = useState<{ key_positions: string[]; job_titles: string[] }>({ key_positions: [], job_titles: [] });
  const [dept, setDept] = useState<string>("");
  const [editing, setEditing] = useState<StaffMember | { job_title: string } | null>(null);
  const [newLogin, setNewLogin] = useState<NewLogin | null>(null);
  const [error, setError] = useState("");

  const load = useCallback(() => {
    api.staff(branch.id).then(setStaff).catch((err) => setError(err.message));
  }, [branch.id]);
  useEffect(load, [load]);
  useEffect(() => {
    records("school", branch.school_id, "departments").list().then(setDepartments).catch(() => {});
    api.staffOptions().then(setOptions).catch(() => {});
  }, [branch.school_id]);

  const list = (staff ?? []).filter((p) => !dept || (dept === "none" ? !p.department_id : p.department_id === dept));
  const teaching = (staff ?? []).filter((p) => p.teaching).length;
  const deptLook = (name: string | null, kind?: string) => (name ? departmentLook(name, kind) : { icon: "users", hue: "slate" as const });

  return (
    <div className="stack">
      {staff && (
        <div className="stat-strip">
          <Stat icon="staff" hue="cyan" value={staff.length} label={staff.length === 1 ? "person" : "people"} note="working at the school" />
          <Stat icon="book" hue="blue" value={teaching} label="teaching staff" />
          <Stat icon="wrench" hue="orange" value={staff.length - teaching} label="non-teaching staff" />
          <Stat icon="network" hue="violet" value={departments.filter((d) => d.head_user_id).length} label="heads of department"
                note={`${departments.length} departments`} />
        </div>
      )}

      {staff && options.key_positions.length > 0 && (
        <section className="card editor">
          <div className="card-head">
            <div>
              <h2>Key positions</h2>
              <p className="muted small editor-intro">Who holds each main post. Click an empty post to fill it.</p>
            </div>
            <span className="hue-chip" style={hue("green")}>
              {options.key_positions.filter((k) => staff.some((p) => holds(p, k))).length} of {options.key_positions.length} filled
            </span>
          </div>
          <div className="positions">
            {options.key_positions.map((k) => {
              const who = staff.filter((p) => holds(p, k));
              return who.length ? (
                <button key={k} className="position filled" onClick={() => setEditing(who[0])}>
                  <Avatar name={who[0].full_name} size={38} />
                  <span className="grow">
                    <span className="position-name">{k}</span>
                    <strong>{displayName(who[0])}{who.length > 1 ? ` +${who.length - 1}` : ""}</strong>
                  </span>
                </button>
              ) : (
                <button key={k} className="position vacant" onClick={() => setEditing({ job_title: k })}>
                  <span className="vacant-dot"><Icon name="plus" size={16} /></span>
                  <span className="grow">
                    <span className="position-name">{k}</span>
                    <span className="muted">Vacant</span>
                  </span>
                </button>
              );
            })}
          </div>
        </section>
      )}

      <section className="card editor">
        <div className="card-head">
          <div>
            <h2>Everyone</h2>
            <p className="muted small editor-intro">Click a person to see or change their record.</p>
          </div>
          <div className="row wrap">
            <ImportButton branchId={branch.id} kind="staff" onDone={load} />
            <button className="primary with-icon" onClick={() => setEditing({ job_title: "" })}><Icon name="user-plus" size={16} />Add staff</button>
          </div>
        </div>
        {departments.length > 0 && staff && staff.length > 0 && (
          <div className="filter-chips" role="group" aria-label="Filter by department">
            <button className={dept === "" ? "on" : ""} onClick={() => setDept("")}>Everyone<span className="chip-count">{staff.length}</span></button>
            {departments.map((d) => {
              const n = staff.filter((p) => p.department_id === d.id).length;
              return n ? (
                <button key={d.id} className={dept === d.id ? "on" : ""} style={hue(deptLook(String(d.name), String(d.kind)).hue)} onClick={() => setDept(d.id)}>
                  <span className="chip-dot" />{String(d.name)}<span className="chip-count">{n}</span>
                </button>
              ) : null;
            })}
            {staff.some((p) => !p.department_id) && (
              <button className={dept === "none" ? "on" : ""} onClick={() => setDept("none")}>No department<span className="chip-count">{staff.filter((p) => !p.department_id).length}</span></button>
            )}
          </div>
        )}
        {error && <p className="error">{error}</p>}
        {staff === null && !error && <div className="skeleton" aria-hidden="true"><span /><span /></div>}
        {staff?.length === 0 && <Empty icon="staff">No staff yet. Add them one by one, or upload a list from Excel.</Empty>}
        {list.length > 0 && (
          <div className="people-grid">
            {list.map((p) => {
              const dl = deptLook(p.department_name);
              return (
                <button key={p.user_id} className="person-card" onClick={() => setEditing(p)}>
                  <Avatar name={p.full_name} size={54} />
                  <div className="person-info">
                    <strong>{displayName(p)}</strong>
                    <span className="job">{p.job_title || (p.teaching ? "Teacher" : "Staff")}</span>
                    <div className="chips">
                      {p.department_name && <span className="hue-chip" style={hue(dl.hue)}><Icon name={dl.icon} size={12} stroke={2.3} />{p.department_name}</span>}
                      {p.heads_departments.map((h) => <span key={h} className="hue-chip" style={hue("amber")}><Icon name="crown" size={12} stroke={2.3} />Head of {h}</span>)}
                      {!p.teaching && <span className="hue-chip" style={hue("orange")}>Non-teaching</span>}
                      {p.employment_type === "nysc" && <span className="hue-chip" style={hue("green")}>NYSC</span>}
                    </div>
                    {p.phone && <span className="small contact"><Icon name="phone" size={13} />{nicePhone(p.phone)}</span>}
                  </div>
                </button>
              );
            })}
          </div>
        )}
      </section>

      {editing && (
        <Modal title={"user_id" in editing ? displayName(editing) : "Add staff"} onClose={() => setEditing(null)}>
          <StaffForm
            schoolId={branch.school_id}
            person={"user_id" in editing ? editing : null}
            jobTitle={"user_id" in editing ? undefined : editing.job_title}
            departments={departments}
            jobTitles={options.job_titles}
            onCancel={() => setEditing(null)}
            onRemoveRole={(membershipId) => api.removeStaffRole(membershipId).then(() => { load(); setEditing(null); })}
            onSubmit={async (data, extra) => {
              if ("user_id" in editing) {
                setStaff(await api.updateStaff(branch.id, editing.user_id, data));
                if (extra.role) {
                  await api.addStaff(branch.id, { ...data, phone: editing.phone ?? "", email: editing.email ?? "", role: extra.role });
                  load();
                }
              } else {
                const res = await api.addStaff(branch.id, { ...data, phone: extra.phone, email: extra.email, role: extra.role ?? "teacher" });
                setStaff(res.staff);
                if (res.new_login) setNewLogin(res.new_login);
              }
              setEditing(null);
            }}
          />
        </Modal>
      )}
      {newLogin && (
        <Modal title="Staff login" onClose={() => setNewLogin(null)}>
          <NewLoginNotice login={newLogin} onDone={() => setNewLogin(null)} />
        </Modal>
      )}
    </div>
  );
}

function guessRole(job: string, teaching: boolean): StaffRole {
  const j = job.toLowerCase();
  if (!/vice|deputy/.test(j) && /principal|head ?teacher|head ?master|head ?mistress|rector/.test(j)) return "head";
  if (/bursar|accountant|cashier/.test(j)) return "bursar";
  if (/boarding|house ?master|house ?mistress|matron|house ?parent|hostel/.test(j)) return "house_parent";
  return teaching ? "teacher" : "support";
}
const NON_TEACHING = /bursar|account|cook|driver|security|cleaner|gardener|nurse|matron|secretary|admin|store|electric|plumb|carpenter|librarian|technician|registrar|ict officer|porter|cashier/;

function StaffForm({
  schoolId, person, jobTitle, departments, jobTitles, onSubmit, onCancel, onRemoveRole,
}: {
  schoolId: string;
  person: StaffMember | null;
  jobTitle?: string;
  departments: Item[];
  jobTitles: string[];
  onSubmit: (data: StaffProfileIn, extra: { phone: string; email: string; role: StaffRole | null }) => Promise<void>;
  onCancel: () => void;
  onRemoveRole: (membershipId: string) => Promise<void>;
}) {
  const [v, setV] = useState({
    title: person?.title ?? "", full_name: person?.full_name ?? "", gender: person?.gender ?? "",
    phone: "", email: "", job_title: person?.job_title ?? jobTitle ?? "", department_id: person?.department_id ?? "",
    teaching: person ? person.teaching : !NON_TEACHING.test((jobTitle ?? "").toLowerCase()),
    staff_no: person?.staff_no ?? "", employment_type: person?.employment_type ?? "full_time",
    date_joined: person?.date_joined ?? "", qualification: person?.qualification ?? "",
  });
  const [role, setRole] = useState<StaffRole | "">(person ? "" : guessRole(jobTitle ?? "", !NON_TEACHING.test((jobTitle ?? "").toLowerCase())));
  const [roleTouched, setRoleTouched] = useState(false);
  const [error, setError] = useState("");
  const [busy, setBusy] = useState(false);
  const set = (k: keyof typeof v, value: string | boolean) => {
    setV((old) => {
      const next = { ...old, [k]: value };
      if (!person && !roleTouched && (k === "job_title" || k === "teaching")) setRole(guessRole(String(next.job_title), Boolean(next.teaching)));
      return next;
    });
    setError("");
  };

  async function submit(e: FormEvent) {
    e.preventDefault();
    if (v.full_name.trim().length < 2) return setError("Enter the staff member's name.");
    if (!person && !v.phone.trim() && !v.email.trim()) return setError("Enter a phone number or email, so they can log in.");
    if (v.email.trim() && !/^\S+@\S+\.\S+$/.test(v.email.trim())) return setError("That email address doesn't look right.");
    setBusy(true);
    try {
      await onSubmit({
        full_name: v.full_name.trim(), title: v.title.trim() || null, gender: (v.gender || null) as StaffProfileIn["gender"],
        job_title: v.job_title.trim() || null, department_id: v.department_id || null, teaching: v.teaching,
        staff_no: v.staff_no.trim() || null, employment_type: v.employment_type as EmploymentType,
        date_joined: v.date_joined || null, qualification: v.qualification.trim() || null,
      }, { phone: v.phone.trim(), email: v.email.trim(), role: role || null });
    } catch (err) {
      setError(errorText(err));
      setBusy(false);
    }
  }

  return (
    <form className="stack" onSubmit={submit} noValidate>
      {person && (
        <div className="staff-summary">
          <Avatar name={person.full_name} size={56} />
          <div className="grow">
            <strong>{displayName(person)}</strong>
            <span className="block small muted">{[nicePhone(person.phone), person.email].filter(Boolean).join(" · ")}</span>
            <div className="chips" style={{ marginTop: 6 }}>
              {person.roles.map((r) => (
                <span key={r.membership_id} className="hue-chip role" style={hue(ROLE_HUE[r.role] ?? "slate")}>
                  {ROLE_LABEL[r.role]}
                  <button type="button" className="chip-x" aria-label={`Remove ${ROLE_LABEL[r.role]} role`} onClick={() => {
                    if (window.confirm(`Remove ${person.full_name} as ${ROLE_LABEL[r.role]}?`)) onRemoveRole(r.membership_id).catch((err) => setError(errorText(err)));
                  }}><Icon name="close" size={12} stroke={2.4} /></button>
                </span>
              ))}
            </div>
          </div>
        </div>
      )}
      {person && <LoginPanel schoolId={schoolId} userId={person.user_id} />}
      <div className="form-grid">
        <Field label="Title">
          <input list="staff-titles" value={v.title} onChange={(e) => set("title", e.target.value)} placeholder="Mr, Mrs, Rev Fr…" />
        </Field>
        <Field label="Full name"><input value={v.full_name} onChange={(e) => set("full_name", e.target.value)} autoFocus={!person} /></Field>
        {!person && <Field label="Phone number"><input type="tel" value={v.phone} onChange={(e) => set("phone", e.target.value)} placeholder="0803 123 4567" /></Field>}
        {!person && <Field label="Email (optional)"><input type="email" value={v.email} onChange={(e) => set("email", e.target.value)} /></Field>}
        <Field label="Gender">
          <select value={v.gender} onChange={(e) => set("gender", e.target.value)}>
            <option value="">Not set</option><option value="male">Male</option><option value="female">Female</option>
          </select>
        </Field>
        <Field label="Position / job title">
          <input list="staff-jobs" value={v.job_title} onChange={(e) => set("job_title", e.target.value)} placeholder="e.g. Chemistry Teacher" />
        </Field>
        <Field label="Department">
          <select value={v.department_id} onChange={(e) => set("department_id", e.target.value)}>
            <option value="">No department</option>
            {departments.map((d) => <option key={d.id} value={d.id}>{String(d.name)}</option>)}
          </select>
        </Field>
        <Field label={person ? "Give another role (optional)" : "App access"} hint={person ? undefined : "What they can do in the app. Worked out from the position."}>
          <select value={role} onChange={(e) => { setRole(e.target.value as StaffRole | ""); setRoleTouched(true); }}>
            {person && <option value="">No new role</option>}
            {(Object.keys(ROLE_LABEL) as StaffRole[]).filter((r) => !person?.roles.some((x) => x.role === r)).map((r) => (
              <option key={r} value={r}>{ROLE_LABEL[r]}</option>
            ))}
          </select>
        </Field>
        <Field label="Staff number"><input value={v.staff_no} onChange={(e) => set("staff_no", e.target.value)} /></Field>
        <Field label="Employment">
          <select value={v.employment_type} onChange={(e) => set("employment_type", e.target.value)}>
            {(Object.keys(EMPLOYMENT) as EmploymentType[]).map((k) => <option key={k} value={k}>{EMPLOYMENT[k]}</option>)}
          </select>
        </Field>
        <Field label="Date joined"><input type="date" value={v.date_joined} onChange={(e) => set("date_joined", e.target.value)} /></Field>
        <Field label="Qualification"><input value={v.qualification} onChange={(e) => set("qualification", e.target.value)} placeholder="e.g. B.Sc. Ed, NCE" /></Field>
      </div>
      <label className="check">
        <input type="checkbox" checked={v.teaching} onChange={(e) => set("teaching", e.target.checked)} />
        Teaching staff
      </label>
      <datalist id="staff-titles">{TITLES.map((t) => <option key={t} value={t} />)}</datalist>
      <datalist id="staff-jobs">{jobTitles.map((t) => <option key={t} value={t} />)}</datalist>
      {error && <p className="error">{error}</p>}
      <div className="row">
        <button className="primary" disabled={busy}>{busy ? "Saving…" : person ? "Save changes" : "Add staff"}</button>
        <button type="button" onClick={onCancel}>Cancel</button>
      </div>
    </form>
  );
}
