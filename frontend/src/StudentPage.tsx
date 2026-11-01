import { HealthModal } from "./SickBay";
import { ops, type Health } from "./opsApi";
import { useCallback, useEffect, useState, type FormEvent } from "react";
import {
  api, errorText,
  type BranchDetail, type GuardianInput, type Me, type NewLogin, type SchoolClass, type StudentAttendance,
  type StudentDetail,
} from "./api";
import Layout from "./Layout";
import { href } from "./router";
import StudentForm, { checkGuardian, emptyGuardian, GuardianFields } from "./StudentForm";
import { Empty, Glyph, hue, Modal, NewLoginNotice } from "./ui";
import Icon from "./Icon";
import { subjectLook } from "./look";

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

            <SubjectsCard studentId={student.id} classKey={student.class_id ?? ""} />
            <HealthCard studentId={student.id} />

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

interface SubjectLine { subject_id: string; name: string; compulsory: boolean; teacher_name: string | null; group_id: string | null; group_name: string | null }
interface Avail { subject_id: string; name: string; taking: boolean; groups: { id: string; name: string; teacher_name: string | null }[] }
interface StudentSubjects { senior: boolean; level: string | null; subjects: SubjectLine[]; available: Avail[] }

function SubjectsCard({ studentId, classKey }: { studentId: string; classKey: string }) {
  const [data, setData] = useState<StudentSubjects | null>(null);
  const [adding, setAdding] = useState(false);
  const [error, setError] = useState("");
  const load = useCallback(() => {
    api.raw<StudentSubjects>("GET", `/api/students/${studentId}/subjects`).then(setData).catch((err) => setError(errorText(err)));
  }, [studentId]);
  useEffect(load, [load, classKey]);
  const set = (subjectId: string, body: { taking: boolean; group_id?: string | null }) =>
    api.raw("PUT", `/api/students/${studentId}/electives/${subjectId}`, body).then(load).catch((err) => setError(errorText(err)));
  if (!data) return null;
  const notTaken = data.available.filter((a) => !a.taking);
  return (
    <section className="card">
      <div className="card-head">
        <h2>Subjects</h2>
        {data.senior && notTaken.length > 0 && <button className="with-icon" onClick={() => setAdding(true)}><Icon name="plus" size={15} />Add elective</button>}
      </div>
      {error && <p className="error">{error}</p>}
      {data.subjects.length === 0 && <Empty icon="book">No subjects yet. Choose the class's subjects on the Teaching page.</Empty>}
      <ul className="student-subjects">
        {data.subjects.map((x) => {
          const l = subjectLook(x.name);
          const avail = data.available.find((a) => a.subject_id === x.subject_id);
          return (
            <li key={x.subject_id} style={hue(l.hue)}>
              <span className="subject-chip-icon"><Icon name={l.icon} size={13} stroke={2.2} /></span>
              <span className="grow">
                {x.name}{!x.compulsory && <span className="elective-tag">elective</span>}
                <span className="block small muted">{x.teacher_name ?? (x.compulsory ? "No teacher yet" : "No group yet")}</span>
              </span>
              {!x.compulsory && avail && (
                <>
                  <select aria-label={`Teacher for ${x.name}`} value={x.group_id ?? ""} onChange={(e) => set(x.subject_id, { taking: true, group_id: e.target.value || null })}>
                    <option value="">No group yet</option>
                    {avail.groups.map((g) => <option key={g.id} value={g.id}>{g.teacher_name ?? g.name}</option>)}
                  </select>
                  <button className="ghost small" onClick={() => { if (window.confirm(`Drop ${x.name}?`)) set(x.subject_id, { taking: false }); }}>Drop</button>
                </>
              )}
            </li>
          );
        })}
      </ul>
      {data.senior && <p className="small muted">{data.level} students take the core subjects and choose electives. Each elective has one teacher.</p>}
      {adding && (
        <Modal title="Add an elective" onClose={() => setAdding(false)}>
          <ul className="pick-list">
            {notTaken.map((a) => {
              const l = subjectLook(a.name);
              return (
                <li key={a.subject_id}>
                  <button onClick={() => { setAdding(false); set(a.subject_id, { taking: true, group_id: a.groups.length === 1 ? a.groups[0].id : null }); }}>
                    <span className="subject-chip-icon" style={hue(l.hue)}><Icon name={l.icon} size={14} stroke={2.2} /></span>
                    <span className="grow"><strong>{a.name}</strong>
                      <span className="block small muted">{a.groups.length ? a.groups.map((g) => g.teacher_name ?? g.name).join(", ") : "No groups yet"}</span>
                    </span>
                  </button>
                </li>
              );
            })}
          </ul>
        </Modal>
      )}
    </section>
  );
}

function HealthCard({ studentId }: { studentId: string }) {
  const [h, setH] = useState<Health | null | undefined>(undefined);
  const [open, setOpen] = useState(false);
  useEffect(() => { ops.health(studentId).then((x) => setH(x.health)).catch(() => setH(null)); }, [studentId, open]);
  if (h === undefined) return null;
  const facts = h ? [h.genotype && `Genotype ${h.genotype}`, h.blood_group && `Blood ${h.blood_group}`, h.allergies && `Allergic to ${h.allergies}`, h.conditions].filter(Boolean) : [];
  return (
    <section className="card">
      <div className="card-head"><h2 className="with-glyph"><Glyph icon="heart-pulse" hue="rose" size={30} />Health</h2>
        <button className="text-link" onClick={() => setOpen(true)}>Open</button></div>
      {facts.length ? <div className="chips">{facts.map((f) => <span key={String(f)} className="hue-chip" style={hue("rose")}>{f}</span>)}</div>
        : <p className="muted small">Nothing recorded. The sick bay keeps this up to date.</p>}
      {open && <HealthModal studentId={studentId} onClose={() => setOpen(false)} />}
    </section>
  );
}
