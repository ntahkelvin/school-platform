import { useCallback, useEffect, useState, type FormEvent } from "react";
import {
  api, errorText,
  type BranchDetail, type GuardianInput, type Me, type NewLogin, type SchoolClass, type StudentAttendance,
  type StudentDetail,
} from "./api";
import Layout from "./Layout";
import { href } from "./router";
import StudentForm, { checkGuardian, emptyGuardian, GuardianFields } from "./StudentForm";
import { Empty, Modal, NewLoginNotice } from "./ui";

function age(dob: string | null): string {
  if (!dob) return "";
  const b = new Date(dob + "T00:00:00");
  const now = new Date();
  let years = now.getFullYear() - b.getFullYear();
  if (now < new Date(now.getFullYear(), b.getMonth(), b.getDate())) years--;
  return `${years} years old`;
}

export default function StudentPage({ me, onLogout, studentId }: { me: Me; onLogout: () => void; studentId: string }) {
  const [student, setStudent] = useState<StudentDetail | null>(null);
  const [branch, setBranch] = useState<BranchDetail | null>(null);
  const [classes, setClasses] = useState<SchoolClass[]>([]);
  const [error, setError] = useState("");
  const [editing, setEditing] = useState(false);
  const [addingGuardian, setAddingGuardian] = useState(false);
  const [newLogin, setNewLogin] = useState<NewLogin | null>(null);

  const load = useCallback(async () => {
    try {
      const s = await api.student(studentId);
      setStudent(s);
      const [b, c] = await Promise.all([api.branch(s.branch_id), api.classes(s.branch_id)]);
      setBranch(b);
      setClasses(c);
    } catch (err) {
      setError(errorText(err));
    }
  }, [studentId]);
  useEffect(() => {
    load();
  }, [load]);

  const crumbs = [
    { label: "Home", href: "#/" },
    ...(branch
      ? [
          { label: branch.school_name, href: href({ page: "school", id: branch.school_id, tab: "students" }) },
        ]
      : []),
    { label: student?.full_name ?? "Student" },
  ];

  return (
    <Layout me={me} onLogout={onLogout} crumbs={crumbs}>
      {error && <p className="error">{error}</p>}
      {student && branch && (
        <>
          <div className="page-head">
            <div>
              <h1>{student.full_name}</h1>
              <p className="muted">
                <span className="mono">{student.admission_no}</span> · {student.class_name ?? "No class"}
                {branch.has_boarding && ` · ${student.boarding_status === "boarder" ? "Boarder" : "Day student"}`}
                {student.status !== "active" && <span className="tag warn">{student.status}</span>}
              </p>
            </div>
            <button onClick={() => setEditing(true)}>Edit student</button>
          </div>

          <div className="sections">
            <section className="card">
              <h2>Details</h2>
              <dl className="details">
                <dt>Gender</dt><dd>{student.gender === "female" ? "Female" : "Male"}</dd>
                <dt>Date of birth</dt>
                <dd>{student.date_of_birth ? `${new Date(student.date_of_birth + "T00:00:00").toLocaleDateString("en-GB", { day: "numeric", month: "long", year: "numeric" })} (${age(student.date_of_birth)})` : "Not set"}</dd>
                <dt>State of origin</dt><dd>{student.state_of_origin ?? "Not set"}</dd>
              </dl>
            </section>

            <AttendanceCard studentId={student.id} />

            <section className="card">
              <div className="card-head">
                <h2>Parents and guardians</h2>
                <button onClick={() => setAddingGuardian(true)}>Add</button>
              </div>
              {student.guardians.length === 0 && <Empty>No parent or guardian linked yet.</Empty>}
              {student.guardians.map((g) => (
                <div key={g.link_id} className="guardian">
                  <div className="card-head">
                    <div>
                      <strong>{g.full_name}</strong> <span className="muted">({g.relationship})</span>
                      <span className="muted small block">{[g.phone, g.email].filter(Boolean).join(" · ")}</span>
                    </div>
                    <button
                      className="ghost"
                      onClick={() => {
                        if (window.confirm(`Unlink ${g.full_name} from ${student.first_name}?`))
                          api.removeGuardian(student.id, g.link_id).then(load).catch((err) => setError(errorText(err)));
                      }}
                    >
                      Unlink
                    </button>
                  </div>
                  {g.other_children.length > 0 && (
                    <div className="small">
                      <span className="muted">Also parent of: </span>
                      {g.other_children.map((c, i) => (
                        <span key={c.id}>
                          {i > 0 && ", "}
                          <a href={href({ page: "student", id: c.id })}>{c.full_name}</a>
                          <span className="muted"> ({[c.class_name, c.branch_name].filter(Boolean).join(", ")})</span>
                        </span>
                      ))}
                    </div>
                  )}
                </div>
              ))}
            </section>
          </div>

          {editing && (
            <Modal title="Edit student" onClose={() => setEditing(false)}>
              <StudentForm
                initial={student}
                classes={classes}
                hasBoarding={branch.has_boarding}
                withGuardian={false}
                submitLabel="Save changes"
                onCancel={() => setEditing(false)}
                onSubmit={async (data) => {
                  setStudent(await api.updateStudent(student.id, data));
                  setEditing(false);
                }}
              />
            </Modal>
          )}
          {addingGuardian && (
            <Modal title="Add parent or guardian" onClose={() => setAddingGuardian(false)}>
              <AddGuardianForm
                onCancel={() => setAddingGuardian(false)}
                onSubmit={async (g) => {
                  const res = await api.addGuardian(student.id, g);
                  setStudent(res.student);
                  setAddingGuardian(false);
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
        </>
      )}
    </Layout>
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
    try {
      await onSubmit(g);
    } catch (err) {
      setError(errorText(err));
      setBusy(false);
    }
  }
  return (
    <form className="stack" onSubmit={submit} noValidate>
      <GuardianFields value={g} onChange={(v) => { setG(v); setError(""); }} />
      {error && <p className="error">{error}</p>}
      <div className="row">
        <button className="primary" disabled={busy}>Link parent</button>
        <button type="button" onClick={onCancel}>Cancel</button>
      </div>
    </form>
  );
}

const STATUS_LABEL = { present: "Present", absent: "Absent", late: "Late", excused: "Excused" } as const;

function AttendanceCard({ studentId }: { studentId: string }) {
  const [data, setData] = useState<StudentAttendance | null>(null);
  useEffect(() => {
    api.studentAttendance(studentId, 30).then(setData).catch(() => {});
  }, [studentId]);
  if (!data) return null;
  const c = data.school;
  return (
    <section className="card">
      <h2>Attendance, last 30 days</h2>
      {c.marked === 0 ? (
        <Empty>No registers taken yet.</Empty>
      ) : (
        <>
          <div className="big-stat">
            <span className={data.rate !== null && data.rate < 85 ? "c-absent" : "c-present"}>
              {data.rate === null ? "n/a" : `${data.rate}%`}
            </span>
            <span className="muted small">attendance</span>
          </div>
          <p className="small">
            {c.present} present · {c.late} late · {c.absent} absent · {c.excused} excused
          </p>
          {data.not_present.length > 0 && (
            <ul className="list small">
              {data.not_present.map((r, i) => (
                <li key={i}>
                  <span>
                    {new Date(r.on_date + "T00:00:00").toLocaleDateString("en-GB", { weekday: "short", day: "numeric", month: "short" })}
                    {r.kind === "night" && <span className="muted"> (night)</span>}
                  </span>
                  <span>
                    <span className={`c-${r.status}`}>{STATUS_LABEL[r.status]}</span>
                    {r.note && <span className="muted"> · {r.note}</span>}
                  </span>
                </li>
              ))}
            </ul>
          )}
        </>
      )}
    </section>
  );
}
