import { useCallback, useEffect, useState, type FormEvent } from "react";
import {
  api, errorText, ROLE_LABEL,
  type BranchDetail, type Me, type NewLogin, type SchoolClass, type StaffMember, type StaffRole, type StudentRow,
} from "./api";
import Layout from "./Layout";
import { BranchForm } from "./forms";
import AttendanceTab from "./AttendanceTab";
import FacilitiesTab from "./FacilitiesTab";
import { go, href, type BranchTab } from "./router";
import StudentForm from "./StudentForm";
import { Empty, Field, Modal, NewLoginNotice } from "./ui";

type Tab = BranchTab;
const TAB_LABEL: Record<Tab, string> = { students: "Students", classes: "Classes", staff: "Staff", attendance: "Attendance", facilities: "Facilities" };

export default function BranchPage({
  me, onLogout, branchId, tab,
}: { me: Me; onLogout: () => void; branchId: string; tab: Tab }) {
  const [branch, setBranch] = useState<BranchDetail | null>(null);
  const [classes, setClasses] = useState<SchoolClass[]>([]);
  const [error, setError] = useState("");
  const [editing, setEditing] = useState(false);

  const loadClasses = useCallback(() => {
    api.classes(branchId).then(setClasses).catch(() => {});
  }, [branchId]);

  useEffect(() => {
    api.branch(branchId).then(setBranch).catch((err) => setError(err.message));
    loadClasses();
  }, [branchId, loadClasses]);

  const crumbs = [
    { label: "Home", href: "#/" },
    ...(branch ? [{ label: branch.school_name, href: href({ page: "school", id: branch.school_id, tab: "overview" }) }] : []),
    { label: branch?.name ?? "Branch" },
  ];

  return (
    <Layout me={me} onLogout={onLogout} crumbs={crumbs}>
      {error && <p className="error">{error}</p>}
      {branch && (
        <>
          <div className="page-head">
            <div>
              <h1>
                {branch.name}
                {branch.has_boarding && <span className="tag">Boarding</span>}
              </h1>
              <p className="muted">{branch.address ?? branch.school_name}</p>
            </div>
            <button onClick={() => setEditing(true)}>Edit branch</button>
          </div>

          {editing && (
            <Modal title="Edit branch" onClose={() => setEditing(false)}>
              <BranchForm
                initial={branch}
                submitLabel="Save changes"
                onCancel={() => setEditing(false)}
                onSubmit={async (name, address, boarding, phone, email) => {
                  setBranch(await api.updateBranch(branch.id, name, address, boarding, phone, email));
                  setEditing(false);
                }}
              />
            </Modal>
          )}

          <nav className="tabs" role="tablist">
            {(["students", "attendance", "classes", "staff", "facilities"] as Tab[]).map((t) => (
              <a key={t} role="tab" aria-selected={tab === t} className={tab === t ? "active" : ""}
                 href={href({ page: "branch", id: branch.id, tab: t })}>
                {TAB_LABEL[t]}
              </a>
            ))}
          </nav>

          {tab === "students" && <StudentsTab branch={branch} classes={classes} onClassesChanged={loadClasses} />}
          {tab === "classes" && <ClassesTab branch={branch} classes={classes} onChanged={loadClasses} setClasses={setClasses} />}
          {tab === "staff" && <StaffTab branch={branch} />}
          {tab === "attendance" && <AttendanceTab branch={branch} />}
          {tab === "facilities" && <FacilitiesTab branch={branch} />}
        </>
      )}
    </Layout>
  );
}

// ---------------- Students ----------------

function StudentsTab({
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
      <div className="toolbar">
        <input aria-label="Search students" placeholder="Search name or admission number" value={q} onChange={(e) => setQ(e.target.value)} />
        <select aria-label="Filter by class" value={classId} onChange={(e) => setClassId(e.target.value)}>
          <option value="">All classes</option>
          {classes.map((c) => <option key={c.id} value={c.id}>{c.name}</option>)}
        </select>
        <label className="check">
          <input type="checkbox" checked={showLeft} onChange={(e) => setShowLeft(e.target.checked)} />
          Include students who left
        </label>
        <button className="primary" onClick={() => setAdding(true)}>Add student</button>
      </div>

      {error && <p className="error">{error}</p>}
      {students === null && !error && <p className="muted">Loading…</p>}
      {students?.length === 0 && (
        <Empty>
          {q || classId ? "No students match." : "No students yet. Click Add student to enrol the first one."}
          {classes.length === 0 && !q && (
            <> Tip: <a href={href({ page: "branch", id: branch.id, tab: "classes" })}>create classes</a> first.</>
          )}
        </Empty>
      )}
      {students && students.length > 0 && (
        <div className="table-wrap">
          <table>
            <thead>
              <tr>
                <th>Name</th>
                <th>Admission no.</th>
                <th>Class</th>
                <th className="hide-small">Gender</th>
                {branch.has_boarding && <th className="hide-small">Day/boarder</th>}
                {showLeft && <th>Status</th>}
              </tr>
            </thead>
            <tbody>
              {students.map((s) => (
                <tr key={s.id} className="clickable" onClick={() => go({ page: "student", id: s.id })}>
                  <td><a href={href({ page: "student", id: s.id })}>{s.last_name}, {s.first_name}{s.middle_name ? ` ${s.middle_name}` : ""}</a></td>
                  <td className="mono small">{s.admission_no}</td>
                  <td>{s.class_name ?? <span className="muted">None</span>}</td>
                  <td className="hide-small">{s.gender === "female" ? "F" : "M"}</td>
                  {branch.has_boarding && <td className="hide-small">{s.boarding_status === "boarder" ? "Boarder" : "Day"}</td>}
                  {showLeft && <td>{s.status}</td>}
                </tr>
              ))}
            </tbody>
          </table>
          <p className="muted small">{students.length} {students.length === 1 ? "student" : "students"}</p>
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

function ClassesTab({
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

  return (
    <section className="card">
      <form className="row wrap" onSubmit={add} noValidate>
        <select aria-label="Level" value={level} onChange={(e) => { setLevel(e.target.value); setError(""); }}>
          <option value="">Level…</option>
          {levels.map((l) => <option key={l}>{l}</option>)}
        </select>
        <input aria-label="Arm" placeholder="Arm, e.g. A or Gold (optional)" value={arm} onChange={(e) => { setArm(e.target.value); setError(""); }} />
        <button className="primary">Add class</button>
      </form>
      {error && <p className="error">{error}</p>}
      {classes.length === 0 ? (
        <Empty>No classes yet. Add one for each class at this branch, for example JSS 1 arm A.</Empty>
      ) : (
        <ul className="list">
          {classes.map((c) => (
            <li key={c.id}>
              <div>
                <strong>{c.name}</strong>
                <span className="muted small block">
                  {c.student_count} {c.student_count === 1 ? "student" : "students"}
                </span>
              </div>
              <button
                className="ghost"
                onClick={() => api.deleteClass(c.id).then(onChanged).catch((err) => setError(errorText(err)))}
              >
                Delete
              </button>
            </li>
          ))}
        </ul>
      )}
    </section>
  );
}

// ---------------- Staff ----------------

function StaffTab({ branch }: { branch: BranchDetail }) {
  const [staff, setStaff] = useState<StaffMember[] | null>(null);
  const [adding, setAdding] = useState(false);
  const [newLogin, setNewLogin] = useState<NewLogin | null>(null);
  const [error, setError] = useState("");

  const load = useCallback(() => {
    api.staff(branch.id).then(setStaff).catch((err) => setError(err.message));
  }, [branch.id]);
  useEffect(load, [load]);

  return (
    <section className="card">
      <div className="card-head">
        <h2>Staff at {branch.name}</h2>
        <button className="primary" onClick={() => setAdding(true)}>Add staff</button>
      </div>
      {error && <p className="error">{error}</p>}
      {staff?.length === 0 && <Empty>No staff yet.</Empty>}
      {staff && staff.length > 0 && (
        <ul className="list">
          {staff.map((p) => (
            <li key={p.user_id}>
              <div>
                {p.full_name}
                <span className="muted small block">{[p.phone, p.email].filter(Boolean).join(" · ")}</span>
              </div>
              <div className="chips">
                {p.roles.map((r) => (
                  <span key={r.membership_id} className="chip">
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
            </li>
          ))}
        </ul>
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
