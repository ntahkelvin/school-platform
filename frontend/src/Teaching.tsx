// Who teaches what: class teachers, the subjects each class takes, and each subject's teacher.
import { useCallback, useEffect, useMemo, useState } from "react";
import { api, errorText, type Subject } from "./api";
import { ImportButton } from "./Bulk";
import Icon from "./Icon";
import { departmentLook, STAGE_LOOK, stageOf, subjectLook } from "./look";
import { Avatar, Empty, hue, Modal, Stat } from "./ui";

export interface Slot {
  id: string; subject_id: string; subject_name: string; department_name: string | null;
  teacher_user_id: string | null; teacher_name: string | null; compulsory: boolean;
}
export interface TClass {
  id: string; name: string; level: string; arm: string; student_count: number;
  form_teacher_id: string | null; form_teacher_name: string | null; subjects: Slot[];
}
export interface Teacher {
  user_id: string; full_name: string; title: string | null; job_title: string | null; department_name: string | null; teaching: boolean;
}
interface View { classes: TClass[]; teachers: Teacher[] }

const req = <T,>(method: string, path: string, body?: unknown) => api.raw<T>(method, path, body);
const nameOf = (t: Teacher) => [t.title, t.full_name].filter(Boolean).join(" ");

/** Choose a teacher, with the subject's own department first. */
function TeacherPicker({ title, teachers, current, department, onPick, onClose }: {
  title: string; teachers: Teacher[]; current: string | null; department?: string | null;
  onPick: (userId: string | null) => void; onClose: () => void;
}) {
  const [q, setQ] = useState("");
  const [all, setAll] = useState(false);
  const list = teachers
    .filter((t) => all || t.teaching || t.user_id === current)
    .filter((t) => !q || `${t.title ?? ""} ${t.full_name} ${t.job_title ?? ""} ${t.department_name ?? ""}`.toLowerCase().includes(q.toLowerCase()))
    .sort((a, b) => Number(b.department_name === department && !!department) - Number(a.department_name === department && !!department)
      || a.full_name.localeCompare(b.full_name));
  return (
    <Modal title={title} onClose={onClose}>
      <div className="stack">
        <label className="search">
          <Icon name="search" size={17} />
          <input aria-label="Find a teacher" placeholder="Find by name, subject or department" value={q} onChange={(e) => setQ(e.target.value)} autoFocus />
        </label>
        <ul className="pick-list">
          {current && (
            <li><button onClick={() => onPick(null)}><span className="vacant-dot"><Icon name="close" size={15} /></span><span className="grow">Nobody for now</span></button></li>
          )}
          {list.slice(0, 120).map((t) => (
            <li key={t.user_id}>
              <button className={t.user_id === current ? "picked" : ""} onClick={() => onPick(t.user_id)}>
                <Avatar name={t.full_name} size={34} />
                <span className="grow">
                  <strong>{nameOf(t)}</strong>
                  <span className="small muted block">{[t.job_title, t.department_name].filter(Boolean).join(" · ") || "Staff"}</span>
                </span>
                {department && t.department_name === department && <span className="bed-status free">Same department</span>}
                {t.user_id === current && <span className="bed-status">Now</span>}
              </button>
            </li>
          ))}
        </ul>
        <label className="check small"><input type="checkbox" checked={all} onChange={(e) => setAll(e.target.checked)} />Show non-teaching staff too</label>
      </div>
    </Modal>
  );
}

/** Tick the subjects a class takes, and copy them to its other arms. */
function SubjectChooser({ cls, classes, subjects, onSave, onClose }: {
  cls: TClass; classes: TClass[]; subjects: Subject[]; onSave: (picked: { subject_id: string; compulsory: boolean }[], also: string[]) => Promise<void>; onClose: () => void;
}) {
  const [picked, setPicked] = useState<Record<string, boolean>>(() => Object.fromEntries(cls.subjects.map((s) => [s.subject_id, s.compulsory])));
  const siblings = classes.filter((c) => c.level === cls.level && c.id !== cls.id);
  const [also, setAlso] = useState<string[]>(siblings.filter((c) => c.subjects.length === 0).map((c) => c.id));
  const [error, setError] = useState("");
  const [busy, setBusy] = useState(false);
  return (
    <Modal title={`Subjects for ${cls.name}`} onClose={onClose}>
      <div className="stack">
        <p className="small muted">Tick what {cls.name} takes. Mark a subject as an elective if only some students take it.</p>
        <div className="chooser">
          {subjects.map((s) => {
            const on = s.id in picked, l = subjectLook(s.name);
            return (
              <div key={s.id} className={`choose-row${on ? " on" : ""}`} style={hue(l.hue)}>
                <label className="check grow">
                  <input type="checkbox" checked={on} onChange={(e) => setPicked((p) => {
                    const n = { ...p };
                    if (e.target.checked) n[s.id] = true; else delete n[s.id];
                    return n;
                  })} />
                  <span className="subject-chip-icon"><Icon name={l.icon} size={14} stroke={2.2} /></span>
                  {s.name}
                </label>
                {on && (
                  <button className={`elective-toggle${picked[s.id] ? "" : " elective"}`} onClick={() => setPicked((p) => ({ ...p, [s.id]: !p[s.id] }))}>
                    {picked[s.id] ? "Everyone" : "Elective"}
                  </button>
                )}
              </div>
            );
          })}
        </div>
        {siblings.length > 0 && (
          <fieldset>
            <legend>Same subjects for</legend>
            <div className="chips">
              {siblings.map((c) => (
                <label key={c.id} className={`chip pick${also.includes(c.id) ? " on" : ""}`}>
                  <input type="checkbox" checked={also.includes(c.id)} onChange={(e) => setAlso(e.target.checked ? [...also, c.id] : also.filter((x) => x !== c.id))} />
                  {c.name}
                </label>
              ))}
            </div>
          </fieldset>
        )}
        {error && <p className="error">{error}</p>}
        <div className="row">
          <button className="primary" disabled={busy} onClick={() => {
            setBusy(true);
            onSave(Object.entries(picked).map(([subject_id, compulsory]) => ({ subject_id, compulsory })), also)
              .catch((err) => { setError(errorText(err)); setBusy(false); });
          }}>{busy ? "Saving…" : `Save ${Object.keys(picked).length} subjects`}</button>
          <button onClick={onClose}>Cancel</button>
        </div>
      </div>
    </Modal>
  );
}

function ClassCard({ c, onPickForm, onPickSlot, onChoose }: {
  c: TClass; onPickForm: () => void; onPickSlot: (s: Slot) => void; onChoose: () => void;
}) {
  const look = STAGE_LOOK[stageOf(c.level)];
  const filled = c.subjects.filter((s) => s.teacher_user_id).length;
  return (
    <article className="teach-card" style={hue(look.hue)}>
      <header className="teach-head">
        <strong className="class-name">{c.level}<span className="class-arm">{c.arm}</span></strong>
        <span className="grow" />
        <span className="small muted">{c.student_count} students</span>
      </header>
      <button className={`form-teacher${c.form_teacher_id ? "" : " empty"}`} onClick={onPickForm}>
        {c.form_teacher_name ? <Avatar name={c.form_teacher_name} size={32} /> : <span className="vacant-dot"><Icon name="user-plus" size={15} /></span>}
        <span className="grow">
          <span className="position-name">Class teacher</span>
          <strong>{c.form_teacher_name ?? "Choose a class teacher"}</strong>
        </span>
      </button>
      {c.subjects.length === 0 ? (
        <Empty icon="book">No subjects yet.</Empty>
      ) : (
        <>
          <div className="teach-progress" title={`${filled} of ${c.subjects.length} subjects have a teacher`}>
            <span style={{ width: `${(100 * filled) / c.subjects.length}%` }} />
          </div>
          <ul className="slots">
            {c.subjects.map((s) => {
              const l = subjectLook(s.subject_name);
              return (
                <li key={s.id} className={s.teacher_user_id ? "" : "no-teacher"}>
                  <span className="subject-chip-icon" style={hue(l.hue)}><Icon name={l.icon} size={13} stroke={2.2} /></span>
                  <span className="slot-subject">{s.subject_name}{!s.compulsory && <span className="elective-tag">elective</span>}</span>
                  <button className="slot-teacher" onClick={() => onPickSlot(s)}>
                    {s.teacher_name ?? <span className="needs">Choose teacher</span>}
                  </button>
                </li>
              );
            })}
          </ul>
        </>
      )}
      <button className="ghost small with-icon choose-subjects" onClick={onChoose}><Icon name="edit" size={14} />Choose subjects</button>
    </article>
  );
}

export default function TeachingPage({ branchId, schoolId }: { branchId: string; schoolId: string }) {
  const [view, setView] = useState<View | null>(null);
  const [subjects, setSubjects] = useState<Subject[]>([]);
  const [mode, setMode] = useState<"class" | "teacher">("class");
  const [level, setLevel] = useState("");
  const [picking, setPicking] = useState<{ kind: "form"; c: TClass } | { kind: "slot"; c: TClass; s: Slot } | null>(null);
  const [choosing, setChoosing] = useState<TClass | null>(null);
  const [error, setError] = useState("");

  const load = useCallback(() => {
    req<View>("GET", `/api/branches/${branchId}/teaching`).then(setView).catch((err) => setError(errorText(err)));
  }, [branchId]);
  useEffect(load, [load]);
  useEffect(() => { api.subjects(schoolId).then(setSubjects).catch(() => {}); }, [schoolId]);
  const run = (p: Promise<View>) => p.then((v) => { setView(v); setError(""); }).catch((err) => setError(errorText(err)));

  const classes = view?.classes ?? [];
  const levels = [...new Set(classes.map((c) => c.level))];
  const shown = classes.filter((c) => !level || c.level === level);
  const slots = classes.flatMap((c) => c.subjects);
  const load_ = useMemo(() => {
    const m = new Map<string, { slots: { subject: string; cls: string }[]; forms: string[] }>();
    for (const c of classes) {
      if (c.form_teacher_id) (m.get(c.form_teacher_id) ?? m.set(c.form_teacher_id, { slots: [], forms: [] }).get(c.form_teacher_id)!).forms.push(c.name);
      for (const s of c.subjects) if (s.teacher_user_id)
        (m.get(s.teacher_user_id) ?? m.set(s.teacher_user_id, { slots: [], forms: [] }).get(s.teacher_user_id)!).slots.push({ subject: s.subject_name, cls: c.name });
    }
    return m;
  }, [classes]);
  const teachingStaff = (view?.teachers ?? []).filter((t) => t.teaching);
  const busyTeachers = teachingStaff.filter((t) => load_.get(t.user_id)?.slots.length);

  return (
    <div className="stack">
      {view && (
        <div className="stat-strip">
          <Stat icon="user" hue="orange" value={`${classes.filter((c) => c.form_teacher_id).length}/${classes.length}`} label="classes have a class teacher" />
          <Stat icon="presentation" hue="sky" value={`${slots.filter((s) => s.teacher_user_id).length}/${slots.length}`} label="subjects have a teacher" />
          <Stat icon="staff" hue="cyan" value={`${busyTeachers.length}/${teachingStaff.length}`} label="teachers have classes" />
          <Stat icon="book" hue="red" value={slots.filter((s) => !s.teacher_user_id).length} label="need a teacher" />
        </div>
      )}

      <section className="card editor">
        <div className="card-head">
          <div className="segmented" role="tablist">
            <button role="tab" aria-selected={mode === "class"} className={mode === "class" ? "on" : ""} onClick={() => setMode("class")}><Icon name="classes" size={15} />By class</button>
            <button role="tab" aria-selected={mode === "teacher"} className={mode === "teacher" ? "on" : ""} onClick={() => setMode("teacher")}><Icon name="staff" size={15} />By teacher</button>
          </div>
          <div className="row wrap">
            <ImportButton branchId={branchId} kind="subject-teachers" label="Upload" onDone={load} />
            {classes.some((c) => c.subjects.length === 0) && (
              <button className="with-icon" onClick={() => run(req<View>("POST", `/api/branches/${branchId}/teaching/standard`, {}))}>
                <Icon name="sparkle" size={16} />Give empty classes the usual subjects
              </button>
            )}
          </div>
        </div>
        {error && <p className="error">{error}</p>}
        {view === null && !error && <div className="skeleton" aria-hidden="true"><span /><span /><span /></div>}
        {view && classes.length === 0 && <Empty icon="classes">No classes yet. Add them on the Classes page first.</Empty>}

        {view && mode === "class" && classes.length > 0 && (
          <>
            <div className="filter-chips">
              <button className={level === "" ? "on" : ""} onClick={() => setLevel("")}>All classes<span className="chip-count">{classes.length}</span></button>
              {levels.map((l) => (
                <button key={l} className={level === l ? "on" : ""} style={hue(STAGE_LOOK[stageOf(l)].hue)} onClick={() => setLevel(l)}>
                  <span className="chip-dot" />{l}<span className="chip-count">{classes.filter((c) => c.level === l).length}</span>
                </button>
              ))}
            </div>
            <div className="teach-grid">
              {shown.map((c) => (
                <ClassCard key={c.id} c={c}
                           onPickForm={() => setPicking({ kind: "form", c })}
                           onPickSlot={(s) => setPicking({ kind: "slot", c, s })}
                           onChoose={() => setChoosing(c)} />
              ))}
            </div>
          </>
        )}

        {view && mode === "teacher" && (
          <div className="load-list">
            {[...teachingStaff].sort((a, b) => (load_.get(b.user_id)?.slots.length ?? 0) - (load_.get(a.user_id)?.slots.length ?? 0)).map((t) => {
              const l = load_.get(t.user_id);
              const bySubject = new Map<string, string[]>();
              for (const x of l?.slots ?? []) bySubject.set(x.subject, [...(bySubject.get(x.subject) ?? []), x.cls]);
              const dl = t.department_name ? departmentLook(t.department_name) : null;
              return (
                <div key={t.user_id} className={`load-row${l?.slots.length ? "" : " idle"}`}>
                  <Avatar name={t.full_name} size={42} />
                  <div className="grow">
                    <strong>{nameOf(t)}</strong>
                    <span className="small muted block">{[t.job_title, t.department_name].filter(Boolean).join(" · ")}</span>
                    <div className="chips" style={{ marginTop: 6 }}>
                      {l?.forms.map((f) => <span key={f} className="hue-chip" style={hue("orange")}><Icon name="user" size={12} />Class teacher {f}</span>)}
                      {[...bySubject].map(([subj, cls]) => (
                        <span key={subj} className="hue-chip" style={hue(subjectLook(subj).hue)}>
                          <Icon name={subjectLook(subj).icon} size={12} />{subj}: {cls.join(", ")}
                        </span>
                      ))}
                      {!l?.slots.length && !l?.forms.length && <span className="muted small">No classes yet</span>}
                      {(l?.slots.length ?? 0) > 15 && <span className="hue-chip" style={hue("red")}>Heavy load: share some classes</span>}
                    </div>
                  </div>
                  <span className="load-count" style={dl ? hue(dl.hue) : undefined}>
                    <strong>{l?.slots.length ?? 0}</strong>
                    <span>classes</span>
                  </span>
                </div>
              );
            })}
          </div>
        )}
      </section>

      {picking && view && (
        <TeacherPicker
          title={picking.kind === "form" ? `Class teacher for ${picking.c.name}` : `${picking.s.subject_name} in ${picking.c.name}`}
          teachers={view.teachers}
          current={picking.kind === "form" ? picking.c.form_teacher_id : picking.s.teacher_user_id}
          department={picking.kind === "slot" ? picking.s.department_name : null}
          onClose={() => setPicking(null)}
          onPick={(userId) => {
            const p = picking;
            setPicking(null);
            run(p.kind === "form"
              ? req<View>("PUT", `/api/classes/${p.c.id}/form-teacher`, { user_id: userId })
              : req<View>("PUT", `/api/class-subjects/${p.s.id}`, { teacher_user_id: userId }));
          }}
        />
      )}
      {choosing && (
        <SubjectChooser cls={choosing} classes={classes} subjects={subjects} onClose={() => setChoosing(null)}
          onSave={async (picked, also) => {
            setView(await req<View>("PUT", `/api/classes/${choosing.id}/subjects`, { subjects: picked, also_class_ids: also }));
            setChoosing(null);
          }} />
      )}
    </div>
  );
}
