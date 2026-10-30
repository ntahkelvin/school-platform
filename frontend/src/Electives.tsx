// SS electives: groups (one teacher each) per level and subject, and which students are in them.
import { useCallback, useEffect, useState } from "react";
import { api, errorText } from "./api";
import { ImportButton } from "./Bulk";
import Icon from "./Icon";
import { subjectLook } from "./look";
import type { Teacher } from "./Teaching";
import { TeacherPicker } from "./Teaching";
import { Avatar, Empty, Glyph, hue, IconButton, Modal } from "./ui";

interface Group {
  id: string; level: string; subject_id: string; name: string; teacher_user_id: string | null; teacher_name: string | null;
  capacity: number | null; count: number; can_manage: boolean;
}
interface ESubject { id: string; name: string; taking: number; without_group: number; can_manage: boolean }
interface Choice { id: string; name: string; admission_no: string; class_name: string | null; gender: string; choices: Record<string, string | null> }
interface LevelView { levels: string[]; level: string | null; subjects: ESubject[]; groups: Group[]; students: Choice[] }

const req = <T,>(method: string, path: string, body?: unknown) => api.raw<T>(method, path, body);

export default function ElectivesPanel({ branchId, teachers }: { branchId: string; teachers: Teacher[] }) {
  const [view, setView] = useState<LevelView | null>(null);
  const [subjectId, setSubjectId] = useState("");
  const [show, setShow] = useState<"all" | "taking" | "not">("taking");
  const [cls, setCls] = useState("");
  const [picking, setPicking] = useState<{ group?: Group } | null>(null);
  const [error, setError] = useState("");

  const load = useCallback((level?: string | null) => {
    req<LevelView>("GET", `/api/branches/${branchId}/electives${level ? `?level=${encodeURIComponent(level)}` : ""}`)
      .then((v) => { setView(v); setError(""); }).catch((err) => setError(errorText(err)));
  }, [branchId]);
  useEffect(() => load(), [load]);
  useEffect(() => {
    if (view && !view.subjects.some((s) => s.id === subjectId)) setSubjectId(view.subjects[0]?.id ?? "");
  }, [view, subjectId]);
  const run = (p: Promise<LevelView>) => p.then((v) => { setView(v); setError(""); }).catch((err) => setError(errorText(err)));

  if (error && !view) return <p className="error">{error}</p>;
  if (!view) return <div className="skeleton" aria-hidden="true"><span /><span /></div>;
  if (view.levels.length === 0) return <Empty icon="graduation-cap">No SS classes yet. Electives are for SS 1 to SS 3.</Empty>;

  const subject = view.subjects.find((s) => s.id === subjectId);
  const groups = view.groups.filter((g) => g.subject_id === subjectId);
  const classes = [...new Set(view.students.map((s) => s.class_name ?? ""))].filter(Boolean).sort();
  const rows = view.students
    .filter((s) => !cls || s.class_name === cls)
    .filter((s) => show === "all" || (show === "taking" ? subjectId in s.choices : !(subjectId in s.choices)));
  const look = subject ? subjectLook(subject.name) : null;

  const choose = (s: Choice, value: string) => {
    const body = value === "none" ? { taking: false } : value === "nogroup" ? { taking: true } : { taking: true, group_id: value };
    run(req<LevelView>("PUT", `/api/students/${s.id}/electives/${subjectId}`, body));
  };

  return (
    <div className="stack electives">
      <div className="filter-chips">
        {view.levels.map((l) => (
          <button key={l} className={view.level === l ? "on" : ""} style={hue("violet")} onClick={() => { setCls(""); load(l); }}>
            <span className="chip-dot" />{l}
          </button>
        ))}
        <span className="grow" />
        <ImportButton branchId={branchId} kind="elective-choices" label="Upload choices" onDone={() => load(view.level)} />
      </div>

      {view.subjects.length === 0 ? (
        <Empty icon="book">No electives for {view.level} yet. On the By class view, choose subjects for an {view.level} class and mark some as Elective.</Empty>
      ) : (
        <div className="elective-layout">
          <ul className="elective-subjects">
            {view.subjects.map((s) => {
              const l = subjectLook(s.name);
              const n = view.groups.filter((g) => g.subject_id === s.id).length;
              return (
                <li key={s.id}>
                  <button className={s.id === subjectId ? "on" : ""} style={hue(l.hue)} onClick={() => setSubjectId(s.id)}>
                    <span className="subject-chip-icon"><Icon name={l.icon} size={14} stroke={2.2} /></span>
                    <span className="grow">
                      <strong>{s.name}</strong>
                      <span className="block small muted">{s.taking} students · {n} {n === 1 ? "group" : "groups"}</span>
                    </span>
                    {s.without_group > 0 && <span className="warn-dot" title={`${s.without_group} without a group`}>{s.without_group}</span>}
                  </button>
                </li>
              );
            })}
          </ul>

          {subject && look && (
            <section className="elective-detail" style={hue(look.hue)}>
              <header className="elective-head">
                <Glyph icon={look.icon} hue={look.hue} size={46} />
                <div className="grow">
                  <h3>{view.level} {subject.name}</h3>
                  <span className="small muted">
                    {subject.taking} students take it{subject.without_group ? `, ${subject.without_group} not in a group yet` : ""}.
                    Each student has one teacher for it.
                  </span>
                </div>
                {subject.can_manage && (
                  <div className="row wrap">
                    {subject.without_group > 0 && groups.length > 0 && (
                      <button className="with-icon" onClick={() => run(req<LevelView>("POST", `/api/branches/${branchId}/electives/spread`, { level: view.level, subject_id: subject.id }))}>
                        <Icon name="users" size={15} />Share out evenly
                      </button>
                    )}
                    <button className="primary with-icon" onClick={() => setPicking({})}><Icon name="plus" size={15} />Add group</button>
                  </div>
                )}
              </header>

              <div className="group-cards">
                {groups.length === 0 && <p className="small muted">No groups yet. Add a group for each teacher who teaches {subject.name} in {view.level}.</p>}
                {groups.map((g) => (
                  <div key={g.id} className="group-card">
                    {g.teacher_name ? <Avatar name={g.teacher_name} size={38} /> : <span className="vacant-dot"><Icon name="user" size={15} /></span>}
                    <div className="grow">
                      <strong>{g.teacher_name ?? "No teacher yet"}</strong>
                      <span className="block small muted">{g.count}{g.capacity ? ` of ${g.capacity}` : ""} students</span>
                      {g.capacity ? <div className="teach-progress"><span style={{ width: `${Math.min(100, (100 * g.count) / g.capacity)}%` }} /></div> : null}
                    </div>
                    {subject.can_manage && (
                      <div className="item-actions">
                        <IconButton icon="edit" label="Change teacher" onClick={() => setPicking({ group: g })} />
                        <IconButton icon="trash" label="Delete group" danger onClick={() => {
                          if (window.confirm(`Delete this group? Its ${g.count} students keep ${subject.name} but need a new group.`))
                            req<void>("DELETE", `/api/groups/${g.id}`).then(() => load(view.level)).catch((err) => setError(errorText(err)));
                        }} />
                      </div>
                    )}
                  </div>
                ))}
              </div>

              <div className="toolbar">
                <div className="segmented small-seg">
                  {(["taking", "not", "all"] as const).map((k) => (
                    <button key={k} className={show === k ? "on" : ""} onClick={() => setShow(k)}>
                      {k === "taking" ? "Taking it" : k === "not" ? "Not taking it" : "Everyone"}
                    </button>
                  ))}
                </div>
                <select aria-label="Class" value={cls} onChange={(e) => setCls(e.target.value)} style={{ maxWidth: 160 }}>
                  <option value="">All arms</option>
                  {classes.map((c) => <option key={c}>{c}</option>)}
                </select>
              </div>
              {error && <p className="error">{error}</p>}
              {rows.length === 0 ? <Empty icon="students">Nobody here.</Empty> : (
                <div className="table-wrap plain people-table">
                  <table>
                    <thead><tr><th>Student</th><th className="hide-small">Class</th><th>{subject.name}</th></tr></thead>
                    <tbody>
                      {rows.map((s) => {
                        const v = !(subjectId in s.choices) ? "none" : s.choices[subjectId] ?? "nogroup";
                        return (
                          <tr key={s.id}>
                            <td>
                              <span className="person">
                                <Avatar name={s.name.split(", ").reverse().join(" ")} size={30} />
                                <span><strong>{s.name}</strong><span className="block small muted mono">{s.admission_no}</span></span>
                              </span>
                            </td>
                            <td className="hide-small"><span className="class-chip">{s.class_name}</span></td>
                            <td>
                              <select aria-label={`${subject.name} for ${s.name}`} className={`choice-select ${v === "none" ? "off" : v === "nogroup" ? "pending" : "on"}`}
                                      value={v} onChange={(e) => choose(s, e.target.value)}>
                                <option value="none">Not taking it</option>
                                <option value="nogroup">Taking it, no teacher yet</option>
                                {groups.map((g) => (
                                  <option key={g.id} value={g.id} disabled={!!g.capacity && g.count >= g.capacity && v !== g.id}>
                                    With {groups.filter((x) => x.teacher_user_id === g.teacher_user_id).length > 1 || !g.teacher_name ? g.name.split(": ").pop() : g.teacher_name}
                                    {g.capacity && g.count >= g.capacity ? " (full)" : ""}
                                  </option>
                                ))}
                              </select>
                            </td>
                          </tr>
                        );
                      })}
                    </tbody>
                  </table>
                </div>
              )}
            </section>
          )}
        </div>
      )}

      {picking && subject && (
        <GroupTeacher
          teachers={teachers}
          group={picking.group}
          title={picking.group ? `Teacher for ${picking.group.name}` : `New ${view.level} ${subject.name} group`}
          onClose={() => setPicking(null)}
          onSave={(teacherId, capacity) => {
            const p = picking;
            setPicking(null);
            run(p.group
              ? req<LevelView>("PATCH", `/api/groups/${p.group.id}`, { teacher_user_id: teacherId, capacity })
              : req<LevelView>("POST", `/api/branches/${branchId}/groups`, { level: view.level, subject_id: subject.id, teacher_user_id: teacherId, capacity }));
          }}
        />
      )}
    </div>
  );
}

function GroupTeacher({ teachers, group, title, onSave, onClose }: {
  teachers: Teacher[]; group?: Group; title: string; onSave: (teacherId: string | null, capacity: number | null) => void; onClose: () => void;
}) {
  const [teacher, setTeacher] = useState<string | null>(group?.teacher_user_id ?? null);
  const [capacity, setCapacity] = useState(group?.capacity ? String(group.capacity) : "");
  const [choosing, setChoosing] = useState(false);
  const t = teachers.find((x) => x.user_id === teacher);
  if (choosing)
    return <TeacherPicker title={title} teachers={teachers} current={teacher} onClose={() => setChoosing(false)} onPick={(id) => { setTeacher(id); setChoosing(false); }} />;
  return (
    <Modal title={title} onClose={onClose}>
      <div className="stack">
        <button className={`form-teacher${t ? "" : " empty"}`} onClick={() => setChoosing(true)}>
          {t ? <Avatar name={t.full_name} size={34} /> : <span className="vacant-dot"><Icon name="user-plus" size={15} /></span>}
          <span className="grow"><span className="position-name">Teacher</span><strong>{t ? [t.title, t.full_name].filter(Boolean).join(" ") : "Choose the teacher"}</strong></span>
        </button>
        <label>Most students (optional)
          <input inputMode="numeric" value={capacity} onChange={(e) => setCapacity(e.target.value.replace(/\D/g, ""))} placeholder="e.g. 40 (a lab's size)" />
        </label>
        <div className="row">
          <button className="primary" onClick={() => onSave(teacher, capacity ? Number(capacity) : null)}>{group ? "Save" : "Add group"}</button>
          <button onClick={onClose}>Cancel</button>
        </div>
      </div>
    </Modal>
  );
}
