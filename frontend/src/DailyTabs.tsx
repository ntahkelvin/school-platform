import { useCallback, useEffect, useState, type FormEvent } from "react";
import {
  api, errorText, ROLE_LABEL,
  type BranchDetail, type NewLogin, type SchoolClass, type StaffMember, type StaffRole, type StudentRow,
} from "./api";
import { go, href } from "./router";
import StudentForm from "./StudentForm";
import { Avatar, Empty, Field, IconButton, Modal, NewLoginNotice } from "./ui";
import Icon from "./Icon";


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

  return (
    <section className="stack">
      <div className="toolbar students-toolbar">
        <label className="search">
          <Icon name="search" size={17} />
          <input aria-label="Search students" placeholder="Search by name or admission number" value={q} onChange={(e) => setQ(e.target.value)} />
        </label>
        <label className="check">
          <input type="checkbox" checked={showLeft} onChange={(e) => setShowLeft(e.target.checked)} />
          Include students who left
        </label>
        <button className="primary with-icon" onClick={() => setAdding(true)}><Icon name="plus" size={16} />Add student</button>
      </div>
      {classes.length > 0 && (
        <div className="filter-chips" role="group" aria-label="Filter by class">
          <button className={classId === "" ? "on" : ""} onClick={() => setClassId("")}>All classes</button>
          {classes.map((c) => (
            <button key={c.id} className={classId === c.id ? "on" : ""} onClick={() => setClassId(c.id)}>
              {c.name}<span className="chip-count">{c.student_count}</span>
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
                  <td>{s.class_name ? <span className="class-chip">{s.class_name}</span> : <span className="muted">None</span>}</td>
                  <td className="hide-small">{s.gender === "female" ? "Female" : "Male"}</td>
                  {branch.has_boarding && (
                    <td className="hide-small">
                      <span className={`badge ${s.boarding_status === "boarder" ? "badge-boarder" : ""}`}>{s.boarding_status === "boarder" ? "Boarder" : "Day"}</span>
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

  const stageOf = (level: string) =>
    /^(creche|pre-nursery|nursery|kg)/i.test(level) ? "Nursery" : /^primary/i.test(level) ? "Primary"
      : /^jss/i.test(level) ? "Junior Secondary" : /^ss/i.test(level) ? "Senior Secondary" : "Other";
  const stages: [string, SchoolClass[]][] = [];
  for (const c of classes) {
    const st = stageOf(c.level);
    const found = stages.find(([n]) => n === st);
    if (found) found[1].push(c); else stages.push([st, [c]]);
  }
  const total = classes.reduce((n, c) => n + c.student_count, 0);

  return (
    <section className="card editor">
      <div className="card-head">
        <p className="editor-lead">{classes.length} {classes.length === 1 ? "class" : "classes"} with {total} {total === 1 ? "student" : "students"}</p>
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
        stages.map(([stage, list]) => (
          <div key={stage} className="group">
            <h3 className="group-title">{stage}<span className="count">{list.length}</span></h3>
            <div className="class-grid">
              {list.map((c) => (
                <div key={c.id} className="class-tile">
                  <strong className="class-name">{c.name}</strong>
                  <span className="muted small">{c.student_count} {c.student_count === 1 ? "student" : "students"}</span>
                  <span className="class-tile-actions">
                    <IconButton icon="trash" label={`Delete ${c.name}`} danger onClick={() => {
                      if (window.confirm(`Delete ${c.name}?`)) api.deleteClass(c.id).then(onChanged).catch((err) => setError(errorText(err)));
                    }} />
                  </span>
                </div>
              ))}
            </div>
          </div>
        ))
      )}
    </section>
  );
}

// ---------------- Staff ----------------

export function StaffTab({ branch }: { branch: BranchDetail }) {
  const [staff, setStaff] = useState<StaffMember[] | null>(null);
  const [adding, setAdding] = useState(false);
  const [newLogin, setNewLogin] = useState<NewLogin | null>(null);
  const [error, setError] = useState("");

  const load = useCallback(() => {
    api.staff(branch.id).then(setStaff).catch((err) => setError(err.message));
  }, [branch.id]);
  useEffect(load, [load]);

  return (
    <section className="card editor">
      <div className="card-head">
        <p className="editor-lead">{staff ? `${staff.length} ${staff.length === 1 ? "person" : "people"} working at the school` : "\u00a0"}</p>
        <button className="primary with-icon" onClick={() => setAdding(true)}><Icon name="plus" size={16} />Add staff</button>
      </div>
      {error && <p className="error">{error}</p>}
      {staff === null && !error && <div className="skeleton" aria-hidden="true"><span /><span /></div>}
      {staff?.length === 0 && <Empty icon="staff">No staff yet.</Empty>}
      {staff && staff.length > 0 && (
        <div className="people-grid">
          {staff.map((p) => (
            <div key={p.user_id} className="person-card">
              <Avatar name={p.full_name} size={48} />
              <div className="person-info">
                <strong>{p.full_name}</strong>
                {p.phone && <a className="small" href={`tel:${p.phone}`}>{p.phone}</a>}
                {p.email && <a className="small" href={`mailto:${p.email}`}>{p.email}</a>}
                <div className="chips">
                  {p.roles.map((r) => (
                    <span key={r.membership_id} className="chip role-chip">
                      {ROLE_LABEL[r.role]}
                      <button
                        className="chip-x"
                        aria-label={`Remove ${ROLE_LABEL[r.role]} role`}
                        onClick={() => {
                          if (window.confirm(`Remove ${p.full_name} as ${ROLE_LABEL[r.role]}?`))
                            api.removeStaffRole(r.membership_id).then(load).catch((err) => setError(errorText(err)));
                        }}
                      >
                        ✕
                      </button>
                    </span>
                  ))}
                </div>
              </div>
            </div>
          ))}
        </div>
      )}
      {adding && (
        <Modal title="Add staff" onClose={() => setAdding(false)}>
          <AddStaffForm
            onCancel={() => setAdding(false)}
            onSubmit={async (name, phone, email, role) => {
              const res = await api.addStaff(branch.id, name, phone, email, role);
              setStaff(res.staff);
              setAdding(false);
              if (res.new_login) setNewLogin(res.new_login);
            }}
          />
        </Modal>
      )}
      {newLogin && (
        <Modal title="Staff login" onClose={() => setNewLogin(null)}>
          <NewLoginNotice login={newLogin} onDone={() => setNewLogin(null)} />
        </Modal>
      )}
    </section>
  );
}

function AddStaffForm({
  onSubmit, onCancel,
}: { onSubmit: (name: string, phone: string, email: string, role: StaffRole) => Promise<void>; onCancel: () => void }) {
  const [name, setName] = useState("");
  const [phone, setPhone] = useState("");
  const [email, setEmail] = useState("");
  const [role, setRole] = useState<StaffRole>("teacher");
  const [error, setError] = useState("");
  const [busy, setBusy] = useState(false);

  async function submit(e: FormEvent) {
    e.preventDefault();
    if (name.trim().length < 2) return setError("Enter the staff member's name.");
    if (!phone.trim() && !email.trim()) return setError("Enter a phone number or email, so they can log in.");
    if (email.trim() && !/^\S+@\S+\.\S+$/.test(email.trim())) return setError("That email address doesn't look right.");
    setBusy(true);
    try {
      await onSubmit(name.trim(), phone.trim(), email.trim(), role);
    } catch (err) {
      setError(errorText(err));
      setBusy(false);
    }
  }

  return (
    <form className="stack" onSubmit={submit} noValidate>
      <Field label="Full name"><input value={name} onChange={(e) => { setName(e.target.value); setError(""); }} autoFocus /></Field>
      <Field label="Phone number"><input type="tel" value={phone} onChange={(e) => { setPhone(e.target.value); setError(""); }} placeholder="0803 123 4567" /></Field>
      <Field label="Email (optional)"><input type="email" value={email} onChange={(e) => { setEmail(e.target.value); setError(""); }} /></Field>
      <Field label="Role" hint="One person can have several roles. Add them again to give another role.">
        <select value={role} onChange={(e) => setRole(e.target.value as StaffRole)}>
          {(Object.keys(ROLE_LABEL) as StaffRole[]).map((r) => <option key={r} value={r}>{ROLE_LABEL[r]}</option>)}
        </select>
      </Field>
      {error && <p className="error">{error}</p>}
      <div className="row">
        <button className="primary" disabled={busy}>Add staff</button>
        <button type="button" onClick={onCancel}>Cancel</button>
      </div>
    </form>
  );
}
