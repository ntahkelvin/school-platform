// The timetable: set it up, build it automatically, change it by hand, print it, and find cover for absent teachers.
import { useEffect, useState } from "react";
import { api, errorText } from "./api";
import { useBusy } from "./GrowthBits";
import Icon from "./Icon";
import { subjectLook } from "./look";
import { useCanChange } from "./rightsApi";
import { href } from "./router";
import { PrintSheet } from "./Scanner";
import { Avatar, Field, Glyph, hue, Modal, Stat } from "./ui";

export interface Cell { kind: "lesson" | "block" | "free"; subject?: string; subject_id?: string | null; teacher?: string | null; teacher_id?: string | null; class?: string; class_id?: string;
  group?: string | boolean; block?: string | null; subjects?: string[]; locked?: boolean }
export interface PeriodRow { id: string; name: string; kind: string; starts_at: string; ends_at: string }
export interface Grid { title: string; form_teacher: string | null; days: { n: number; name: string }[]; periods: PeriodRow[]; cells: Record<string, Cell>; count: number }
interface GridOut extends Grid { options: { classes: { id: string; name: string; level: string }[]; teachers: { id: string; name: string }[] }; choices?: { subject_id: string; subject: string; teacher: string | null }[]; class_id?: string }
interface Need { id: string; subject_id: string; subject: string; teacher_id: string | null; teacher: string | null; set: number | null; periods: number; double: boolean; auto: boolean; core: boolean }
interface Setup { days: number[]; max_same_day: number; bells: (PeriodRow & { section: string | null })[]; week: number; built_at: string | null; published_at: string | null;
  classes: { id: string; name: string; level: string; subjects: Need[]; blocks: { name: string; periods: number; subjects: string[] }[]; need: number; room: number; no_teacher: string[] }[];
  teachers: { id: string; name: string; periods: number; free: number }[]; warnings: string[];
  report: { placed?: number; units?: number; missing?: { what: string; teacher: string | null; why: string; length: number }[]; seconds?: number; blocks?: number } }
export interface Today { today: (PeriodRow & { cell: Cell | null; state: "done" | "now" | "next" })[]; now: (PeriodRow & { cell: Cell | null }) | null; next: (PeriodRow & { cell: Cell | null }) | null }
interface CoverDay { date: string; weekday: string; away_count: number; covered: number; to_cover: number;
  away: { teacher_id: string; teacher: string; why: string; lessons: { period_id: string; period: string; starts_at: string; class_id: string | null; group_id: string | null; class: string;
    subject: string | null; subject_id: string | null; cover: { id: string; cover: string | null } | null; free: { id: string; name: string; same_department: boolean; covers_this_week: number; lessons_today: number }[] }[] }[] }

export const tapi = {
  setup: (sid: string) => api.raw<Setup>("GET", `/api/schools/${sid}/timetable/setup`),
  standard: (sid: string) => api.raw("POST", `/api/schools/${sid}/timetable/standard-day`),
  settings: (sid: string, days: number[], max_same_day: number) => api.raw("PUT", `/api/schools/${sid}/timetable/settings`, { days, max_same_day }),
  load: (sid: string, b: unknown) => api.raw("PUT", `/api/schools/${sid}/timetable/loads`, b),
  build: (sid: string, keep_locked: boolean) => api.raw<Setup["report"]>("POST", `/api/schools/${sid}/timetable/build`, { keep_locked }),
  publish: (sid: string) => api.raw<{ told: number }>("POST", `/api/schools/${sid}/timetable/publish`),
  grid: (sid: string, q: string) => api.raw<GridOut>("GET", `/api/schools/${sid}/timetable?${q}`),
  all: (sid: string) => api.raw<{ school: { name: string; logo: string | null; colour: string | null }; classes: Grid[] }>("GET", `/api/schools/${sid}/timetable/all`),
  choices: (cid: string, wd: number, pid: string) => api.raw<{ subject_id: string; subject: string; teacher: string | null; busy: string | null }[]>("GET", `/api/classes/${cid}/timetable/${wd}/${pid}/choices`),
  cell: (cid: string, wd: number, pid: string, b: unknown) => api.raw<GridOut>("PUT", `/api/classes/${cid}/timetable/${wd}/${pid}`, b),
  mine: (sid: string) => api.raw<Grid & Today & { covers: { id: string; date: string; period: string; starts_at: string | null; class: string; subject: string | null; absent: string | null }[]; published: boolean }>("GET", `/api/me/schools/${sid}/timetable`),
  covers: (sid: string, on: string) => api.raw<CoverDay>("GET", `/api/schools/${sid}/covers?on=${on}`),
  addCover: (sid: string, b: unknown) => api.raw("POST", `/api/schools/${sid}/covers`, b),
  removeCover: (id: string) => api.raw("DELETE", `/api/covers/${id}`),
};

const DAY = ["Mon", "Tue", "Wed", "Thu", "Fri", "Sat", "Sun"];
const short = (s: string) => s.replace("Language", "").replace("Studies", "St.").replace("Religious", "Rel.").replace("Mathematics", "Maths").replace("Education", "Ed.").replace("Cultural and Creative Arts", "CCA").replace("Physical and Health", "PHE").trim();
const todayIso = () => { const d = new Date(); return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`; };

/** A week grid: days down the side on phones, across the top on wide screens. */
export function WeekGrid({ g, onCell, today, compact = false }: { g: Grid; onCell?: (day: number, p: PeriodRow, c: Cell | undefined) => void; today?: number; compact?: boolean }) {
  const [day, setDay] = useState(() => (g.days.some((d) => d.n === today) ? today! : g.days[0]?.n ?? 0));
  return (
    <>
    <div className="tt-phone">
      <div className="tt-phone-days">{g.days.map((d) => <button key={d.n} className={day === d.n ? "on" : ""} onClick={() => setDay(d.n)}>{DAY[d.n]}{today === d.n && <i />}</button>)}</div>
      <ol className="today-lessons">
        {g.periods.map((p) => {
          if (p.kind !== "lesson") return <li key={p.id} className="free tt-phone-break"><span className="tl-time">{p.starts_at}</span><span className="muted">{p.kind === "break" ? "☕ " : "🔔 "}{p.name}</span></li>;
          const c = g.cells[`${day}:${p.id}`];
          const look = c?.subject ? subjectLook(c.subject) : null;
          const body = !c ? <span className="muted">Free</span> : c.kind === "block" ? <><b>{c.block}</b><span className="muted">{(c.subjects ?? []).map(short).join(" · ")}</span></>
            : c.kind === "free" ? <span className="muted">Private study</span> : <><b>{c.subject}</b><span className="muted">{c.class ?? c.teacher ?? ""}</span></>;
          return <li key={p.id} className={c ? "" : "free"} style={look ? hue(look.hue) : undefined} onClick={onCell ? () => onCell(day, p, c) : undefined}><span className="tl-time">{p.starts_at}</span>{body}</li>;
        })}
      </ol>
    </div>
    <div className={`tt-wrap${compact ? " compact" : ""}`}>
      <table className="tt">
        <thead><tr><th className="tt-day" />{g.periods.map((p) => p.kind !== "lesson"
          ? <th key={p.id} className="tt-break" title={`${p.name} ${p.starts_at}–${p.ends_at}`}><span aria-label={p.name}>{p.kind === "break" ? "☕" : p.kind === "assembly" ? "🔔" : "·"}</span></th>
          : <th key={p.id}><b>{p.name.replace("Lesson ", "")}</b><small>{p.starts_at}</small></th>)}</tr></thead>
        <tbody>
          {g.days.map((d) => (
            <tr key={d.n} className={today === d.n ? "tt-today" : ""}>
              <th className="tt-day">{DAY[d.n]}</th>
              {g.periods.map((p) => {
                if (p.kind !== "lesson") return <td key={p.id} className="tt-break" aria-label={p.name} />;
                const c = g.cells[`${d.n}:${p.id}`];
                const look = c?.subject ? subjectLook(c.subject) : null;
                const inner = !c ? <span className="tt-empty">{onCell ? "+" : ""}</span>
                  : c.kind === "block" ? <span className="tt-block"><b>{c.block}</b><small>{(c.subjects ?? []).map(short).join(" · ")}</small></span>
                  : c.kind === "free" ? <span className="tt-free"><small>Study</small></span>
                  : <span className="tt-lesson"><b>{short(c.subject ?? "")}</b><small>{c.class ?? (c.teacher ? c.teacher.split(" ").slice(-1)[0] : "")}</small>{c.locked && <i className="tt-lock" title="Placed by hand"><Icon name="lock" size={9} /></i>}</span>;
                return (
                  <td key={p.id} className={`tt-cell${c ? ` k-${c.kind}` : ""}`} style={look ? hue(look.hue) : undefined} title={c ? `${c.subject ?? c.block ?? ""}${c.teacher ? ` · ${c.teacher}` : ""}${c.class ? ` · ${c.class}` : ""}` : undefined}>
                    {onCell ? <button onClick={() => onCell(d.n, p, c)}>{inner}</button> : inner}
                  </td>
                );
              })}
            </tr>
          ))}
        </tbody>
      </table>
    </div>
    </>
  );
}

export default function TimetablePage({ schoolId }: { schoolId: string }) {
  const [view, setView] = useState<"week" | "setup" | "cover">("week");
  const [s, setS] = useState<Setup | null>(null);
  const [error, setError] = useState("");
  const load = () => tapi.setup(schoolId).then(setS).catch((e) => setError(errorText(e)));
  useEffect(() => { void load(); }, [schoolId]); // eslint-disable-line react-hooks/exhaustive-deps
  useEffect(() => { if (s && !s.built_at && view === "week") setView("setup"); }, [s]); // eslint-disable-line react-hooks/exhaustive-deps
  return (
    <div className="stack">
      <div className="segmented day-segs" role="tablist">
        {([["week", "The week", "calendar-days"], ["setup", "Set up and build", "settings"], ["cover", "Cover", "users"]] as const).map(([k, l, ic]) =>
          <button key={k} className={view === k ? "on" : ""} onClick={() => setView(k)}><Icon name={ic} size={15} />{l}</button>)}
      </div>
      {error && <p className="error">{error}</p>}
      {view === "week" && s && <Week schoolId={schoolId} s={s} reload={load} />}
      {view === "setup" && s && <SetUp schoolId={schoolId} s={s} reload={load} onBuilt={() => { void load(); setView("week"); }} />}
      {view === "cover" && <Cover schoolId={schoolId} />}
    </div>
  );
}

// ---------- The week ----------

function Week({ schoolId, s, reload }: { schoolId: string; s: Setup; reload: () => void }) {
  const [q, setQ] = useState("");
  const [g, setG] = useState<GridOut | null>(null);
  const [error, setError] = useState("");
  const [edit, setEdit] = useState<{ day: number; p: PeriodRow; c: Cell | undefined } | null>(null);
  const [print, setPrint] = useState(false);
  const canChange = useCanChange();
  useEffect(() => { tapi.grid(schoolId, q).then(setG).catch((e) => setError(errorText(e))); }, [schoolId, q]);
  if (!s.built_at) return <div className="adm-empty"><span>🗓️</span><p>No timetable yet. Go to <b>Set up and build</b>.</p></div>;
  const [kind, id] = q ? q.split("=") : ["class_id", g?.class_id ?? ""];
  return (
    <>
      {!s.published_at && <p className="hint-line warn"><Icon name="info" size={14} />Teachers and families can't see this timetable yet. Publish it in “Set up and build” when you're happy.</p>}
      <div className="toolbar">
        <select value={kind === "class_id" ? id : ""} onChange={(e) => setQ(`class_id=${e.target.value}`)} aria-label="Class">
          <option value="" disabled>Class…</option>{g?.options.classes.map((c) => <option key={c.id} value={c.id}>{c.name}</option>)}</select>
        <select value={kind === "teacher_id" ? id : ""} onChange={(e) => setQ(`teacher_id=${e.target.value}`)} aria-label="Teacher">
          <option value="" disabled>Teacher…</option>{g?.options.teachers.map((t) => <option key={t.id} value={t.id}>{t.name}</option>)}</select>
        <span className="grow" />
        <button className="with-icon" onClick={() => setPrint(true)}><Icon name="printer" size={15} />Print every class</button>
      </div>
      {error && <p className="error">{error}</p>}
      {g && (
        <section className="card editor tt-card">
          <div className="row tt-title"><h2>{g.title}</h2>{g.form_teacher && <span className="muted small">Form teacher: {g.form_teacher}</span>}<span className="grow" /><span className="muted small">{g.count} lessons a week</span></div>
          <WeekGrid g={g} today={new Date().getDay() - 1} onCell={canChange && g.class_id ? (day, p, c) => setEdit({ day, p, c }) : undefined} />
          {canChange && g.class_id && <p className="muted small">Tap a lesson to change it. Lessons you change are locked <Icon name="lock" size={11} />, so building again keeps them.</p>}
        </section>
      )}
      {edit && g?.class_id && (
        <CellEdit g={g} edit={edit} onClose={() => setEdit(null)} onDone={(x) => { setG(x); setEdit(null); reload(); }} />
      )}
      {print && <PrintAll schoolId={schoolId} onClose={() => setPrint(false)} />}
    </>
  );
}

function CellEdit({ g, edit, onClose, onDone }: { g: GridOut; edit: { day: number; p: PeriodRow; c: Cell | undefined }; onClose: () => void; onDone: (x: GridOut) => void }) {
  const [busy, error, run] = useBusy();
  const [choices, setChoices] = useState<Awaited<ReturnType<typeof tapi.choices>> | null>(null);
  useEffect(() => { void tapi.choices(g.class_id!, edit.day, edit.p.id).then(setChoices); }, [g.class_id, edit.day, edit.p.id]);
  const set = (b: unknown) => run(async () => onDone(await tapi.cell(g.class_id!, edit.day, edit.p.id, b)));
  return (
    <Modal title={`${g.title}: ${DAY[edit.day]}, ${edit.p.name} (${edit.p.starts_at})`} onClose={onClose}>
      {edit.c?.kind === "block" ? <p>This is <b>{edit.c.block}</b>: the whole level splits into its elective groups ({(edit.c.subjects ?? []).join(", ")}). Build again to move it.</p> : (
        <div className="stack">
          <div className="tt-choices">
            {!choices && <p className="muted">Loading…</p>}
            {choices?.map((x) => { const look = subjectLook(x.subject); return (
              <button key={x.subject_id} disabled={busy || !!x.busy} className={`${edit.c?.subject_id === x.subject_id ? "on" : ""}${x.busy ? " busy" : ""}`} style={hue(look.hue)} onClick={() => set({ subject_id: x.subject_id })}>
                <Glyph icon={look.icon} hue={look.hue} size={26} /><span><b>{x.subject}</b><small>{x.busy ? `${x.teacher} is ${x.busy}` : x.teacher ?? "No teacher yet"}</small></span></button>); })}
          </div>
          <div className="row">
            {edit.c && <button className="danger-soft small-btn" disabled={busy} onClick={() => set({})}>Make it a free period</button>}
            {edit.c && <button className="small-btn" disabled={busy} onClick={() => set({ locked: !edit.c!.locked })}>{edit.c.locked ? "Unlock" : "Lock"}</button>}
          </div>
        </div>
      )}
      {error && <p className="error">{error}</p>}
    </Modal>
  );
}

function PrintAll({ schoolId, onClose }: { schoolId: string; onClose: () => void }) {
  const [d, setD] = useState<Awaited<ReturnType<typeof tapi.all>> | null>(null);
  useEffect(() => { void tapi.all(schoolId).then(setD); }, [schoolId]);
  return (
    <PrintSheet title="Class timetables" onClose={onClose} note={d ? `${d.classes.length} classes, one a page. Print in landscape.` : "Loading…"}>
      <div className="tt-print">
        {d?.classes.map((g) => (
          <section key={g.title} className="tt-page" style={{ ["--card" as string]: d.school.colour || "#0f7a4f" }}>
            <header>{d.school.logo && <img src={d.school.logo} alt="" />}<b>{d.school.name}</b><span className="grow" /><h2>{g.title}</h2>{g.form_teacher && <small>Form teacher: {g.form_teacher}</small>}</header>
            <WeekGrid g={g} />
          </section>
        ))}
      </div>
    </PrintSheet>
  );
}

// ---------- Set up and build ----------

function SetUp({ schoolId, s, reload, onBuilt }: { schoolId: string; s: Setup; reload: () => void; onBuilt: () => void }) {
  const [busy, error, run] = useBusy();
  const [building, setBuilding] = useState(false);
  const [level, setLevel] = useState(s.classes[0]?.level ?? "");
  const canChange = useCanChange();
  const levels = [...new Set(s.classes.map((c) => c.level))];
  const first = s.classes.find((c) => c.level === level);
  const lessons = s.bells.filter((b) => b.kind === "lesson").length;
  const build = () => run(async () => { setBuilding(true); try { await tapi.build(schoolId, true); onBuilt(); } finally { setBuilding(false); } });
  const most = Math.max(1, s.week);
  return (
    <div className="stack">
      <div className="stat-strip">
        <Stat icon="clock" hue="sky" value={lessons} label="lessons a day" note={`${s.days.length} days a week`} />
        <Stat icon="classes" hue="orange" value={s.classes.length} label="classes" />
        <Stat icon="users" hue="violet" value={s.teachers.length} label="teachers with lessons" />
        <Stat icon="calendar-check" hue={s.published_at ? "green" : "amber"} value={s.published_at ? "Yes" : "No"} label="published" note={s.built_at ? `Built ${new Date(s.built_at).toLocaleDateString("en-GB")}` : "Not built yet"} />
      </div>
      {s.warnings.map((w) => <p key={w} className="hint-line warn"><Icon name="info" size={14} />{w}</p>)}

      {canChange && (
        <section className={`tt-build${building ? " busy" : ""}`}>
          <div className="grow">
            <strong>{s.built_at ? "Build again" : "Build the timetable"}</strong>
            <span className="small">Every class gets its lessons, and no teacher or class is in two places at once. English and maths go in the mornings. Lessons you placed by hand stay put.</span>
          </div>
          <button className="primary with-icon big-btn" disabled={busy || !lessons} onClick={build}><Icon name="sparkle" size={17} />{building ? "Building…" : s.built_at ? "Build again" : "Build it"}</button>
          {s.built_at && !s.published_at && <button className="with-icon" disabled={busy} onClick={() => run(async () => { await tapi.publish(schoolId); reload(); })}><Icon name="send" size={15} />Publish to teachers and families</button>}
        </section>
      )}
      {s.report?.missing && s.built_at && (
        <section className="card editor" style={hue(s.report.missing.length ? "amber" : "green")}>
          <h3 className="with-glyph"><Glyph icon={s.report.missing.length ? "info" : "circle-check"} hue={s.report.missing.length ? "amber" : "green"} size={30} />
            {s.report.missing.length ? `${s.report.missing.length} lesson${s.report.missing.length > 1 ? "s" : ""} would not fit` : "Every lesson fitted"}</h3>
          {s.report.missing.length > 0 && <>
            <ul className="mini-list">{s.report.missing.slice(0, 12).map((m, i) => <li key={i}><Icon name="clock" size={15} /><span><b>{m.what}</b>{m.length === 2 ? " (double)" : ""}<small className="muted block">{m.why}</small></span></li>)}</ul>
            <p className="muted small">Tip: give a busy teacher fewer classes in Teaching, or lower that subject's lessons a week below, then build again.</p>
          </>}
        </section>
      )}
      {error && <p className="error">{error}</p>}

      <section className="card editor">
        <h3 className="with-glyph"><Glyph icon="bell" hue="amber" size={30} />The school day</h3>
        {s.bells.length === 0 ? (
          <div className="row wrap"><p className="grow">No bell times yet.</p>{canChange && <button className="primary" disabled={busy} onClick={() => run(async () => { await tapi.standard(schoolId); reload(); })}>Use a standard school day</button>}</div>
        ) : (
          <div className="tt-bells">{s.bells.map((b) => <span key={b.id} className={`tt-bell k-${b.kind}`}><b>{b.starts_at}</b>{b.name}{b.section ? <small> · {b.section}</small> : null}</span>)}</div>
        )}
        <p className="muted small">Change bell times in <a href={href({ page: "school", id: schoolId, tab: "calendar" })}>Calendar</a>.</p>
        {canChange && <Days schoolId={schoolId} s={s} reload={reload} />}
      </section>

      <section className="card editor">
        <h3 className="with-glyph"><Glyph icon="book-text" hue="blue" size={30} />Lessons a week</h3>
        <div className="filter-chips">{levels.map((l) => <button key={l} className={level === l ? "on" : ""} onClick={() => setLevel(l)}>{l}</button>)}</div>
        {first && <>
          <p className="muted small">For every {level} class. Blank means the usual number, trimmed so the week fits.</p>
          <div className="tt-loads">
            {first.subjects.map((x) => <LoadRow key={x.subject_id} schoolId={schoolId} level={level} x={x} canChange={canChange} reload={reload} />)}
          </div>
          {first.blocks.length > 0 && <div className="tt-blocks">{first.blocks.map((b) => <span key={b.name}><b>{b.name}</b> · {b.periods} a week<small>{b.subjects.join(", ")}</small></span>)}</div>}
          <div className="tt-fit">
            {s.classes.filter((c) => c.level === level).map((c) => <span key={c.id} className={c.need > c.room ? "over" : ""}><b>{c.name}</b> {c.need} of {c.room}<i style={{ width: `${Math.min(100, (100 * c.need) / Math.max(1, c.room))}%` }} /></span>)}
          </div>
        </>}
      </section>

      <section className="card editor">
        <h3 className="with-glyph"><Glyph icon="users" hue="violet" size={30} />Teachers' week</h3>
        <div className="tt-teachers">
          {s.teachers.map((t) => (
            <div key={t.id} className={`tt-teacher${t.free <= 2 ? " full" : ""}`}><Avatar name={t.name} size={28} /><span className="grow"><b>{t.name}</b>
              <span className="tt-tbar"><i style={{ width: `${Math.min(100, (100 * t.periods) / most)}%` }} /></span></span><small>{t.periods}/{s.week}</small></div>
          ))}
        </div>
      </section>
    </div>
  );
}

function Days({ schoolId, s, reload }: { schoolId: string; s: Setup; reload: () => void }) {
  const [days, setDays] = useState(s.days);
  const [max, setMax] = useState(s.max_same_day);
  const [busy, , run] = useBusy();
  const dirty = days.join() !== s.days.join() || max !== s.max_same_day;
  return (
    <div className="row wrap tt-days">
      <span className="small muted">School days:</span>
      {DAY.map((d, i) => <button key={d} className={`small-btn${days.includes(i) ? " primary" : ""}`} onClick={() => setDays(days.includes(i) ? days.filter((x) => x !== i) : [...days, i].sort())}>{d}</button>)}
      <label className="sort-pick"><span className="small muted">Most of one subject a day</span><select value={max} onChange={(e) => setMax(Number(e.target.value))}>{[1, 2, 3].map((n) => <option key={n}>{n}</option>)}</select></label>
      {dirty && <button className="small-btn primary" disabled={busy || !days.length} onClick={() => run(async () => { await tapi.settings(schoolId, days, max); reload(); })}>Save</button>}
    </div>
  );
}

function LoadRow({ schoolId, level, x, canChange, reload }: { schoolId: string; level: string; x: Need; canChange: boolean; reload: () => void }) {
  const look = subjectLook(x.subject);
  const [v, setV] = useState(x.set == null ? "" : String(x.set));
  const save = async (periods: string, double = x.double) => { await tapi.load(schoolId, { level, subject_id: x.subject_id, periods: periods === "" ? null : Number(periods), double }); reload(); };
  return (
    <div className="tt-load" style={hue(look.hue)}>
      <Glyph icon={look.icon} hue={look.hue} size={28} />
      <span className="grow"><b>{x.subject}</b><small className="muted">{x.teacher ?? "No teacher yet"}</small></span>
      <input type="number" min={0} max={12} placeholder={String(x.periods)} value={v} disabled={!canChange} aria-label={`Lessons a week for ${x.subject}`}
        onChange={(e) => setV(e.target.value)} onBlur={() => { if (v !== (x.set == null ? "" : String(x.set))) void save(v); }} />
      <label className="tt-double" title="One double lesson a week (practicals)"><input type="checkbox" checked={x.double} disabled={!canChange} onChange={(e) => void save(v, e.target.checked)} />Double</label>
    </div>
  );
}

// ---------- Cover ----------

function Cover({ schoolId }: { schoolId: string }) {
  const [on, setOn] = useState(todayIso());
  const [d, setD] = useState<CoverDay | null>(null);
  const [error, setError] = useState("");
  const [busy, err2, run] = useBusy();
  const canChange = useCanChange();
  const load = () => tapi.covers(schoolId, on).then(setD).catch((e) => setError(errorText(e)));
  useEffect(() => { void load(); }, [schoolId, on]); // eslint-disable-line react-hooks/exhaustive-deps
  return (
    <div className="stack">
      <div className="toolbar"><Field label="Day"><input type="date" value={on} onChange={(e) => setOn(e.target.value)} /></Field></div>
      {error && <p className="error">{error}</p>}
      {d && (
        <div className="stat-strip">
          <Stat icon="user-x" hue="red" value={d.away_count} label="teachers away" note={d.weekday} />
          <Stat icon="clock" hue="amber" value={d.to_cover} label="lessons need cover" />
          <Stat icon="circle-check" hue="green" value={d.covered} label="covered" />
        </div>
      )}
      {d && d.away.length === 0 && <div className="adm-empty"><span>🙌</span><p>Nobody with lessons is away {on === todayIso() ? "today" : "that day"}. Absences come from Staff day sign-ins and approved leave.</p></div>}
      {err2 && <p className="error">{err2}</p>}
      {d?.away.map((a) => (
        <section key={a.teacher_id} className="card editor cover-card" style={hue("red")}>
          <div className="row"><Avatar name={a.teacher} size={40} /><span className="grow"><b>{a.teacher}</b><small className="muted block">{a.why} · {a.lessons.length} lesson{a.lessons.length > 1 ? "s" : ""}</small></span></div>
          <ul className="cover-list">
            {a.lessons.map((l) => (
              <li key={l.period_id + (l.class_id ?? l.group_id)} className={l.cover ? "done" : ""}>
                <span className="cover-when"><b>{l.starts_at}</b><small>{l.period}</small></span>
                <span className="cover-what"><b>{l.class}</b><small>{l.subject ?? ""}</small></span>
                {l.cover ? (
                  <span className="cover-who"><Icon name="circle-check" size={14} />{l.cover.cover}{canChange && <button className="text-link danger-hover" disabled={busy} onClick={() => run(async () => { await tapi.removeCover(l.cover!.id); await load(); })}>Undo</button>}</span>
                ) : (
                  <span className="cover-free">{l.free.length === 0 ? <small className="muted">Nobody is free then</small> : l.free.map((f) => (
                    <button key={f.id} className="small-btn" disabled={busy || !canChange} title={`${f.lessons_today} lessons today, ${f.covers_this_week} covers this week`}
                      onClick={() => run(async () => { await tapi.addCover(schoolId, { on_date: on, period_id: l.period_id, class_id: l.class_id, group_id: l.group_id, subject_id: l.subject_id, absent_user_id: a.teacher_id, cover_user_id: f.id }); await load(); })}>
                      {f.name}{f.same_department && <i className="cover-dept" title="Same department">●</i>}</button>))}</span>
                )}
              </li>
            ))}
          </ul>
        </section>
      ))}
    </div>
  );
}

// ---------- On a teacher's home page ----------

export function MyLessonsCard({ schoolId }: { schoolId: string }) {
  const [d, setD] = useState<Awaited<ReturnType<typeof tapi.mine>> | null>(null);
  const [week, setWeek] = useState(false);
  useEffect(() => { tapi.mine(schoolId).then(setD).catch(() => setD(null)); }, [schoolId]);
  if (!d || !d.published || (d.count === 0 && d.covers.length === 0)) return null;
  const lessons = d.today.filter((p) => p.kind === "lesson");
  const left = lessons.filter((p) => p.cell && p.state !== "done").length;
  const n = d.now?.cell, x = d.next?.cell;
  return (
    <section className="card editor portal-card my-lessons" style={hue("blue")}>
      <div className="card-head"><h2 className="with-glyph"><Glyph icon="calendar-days" hue="blue" size={34} />My lessons today</h2><span className="grow" />
        <button className="small-btn with-icon" onClick={() => setWeek(true)}><Icon name="calendar" size={13} />My week</button></div>
      {(n || x) && (
        <div className="now-next">
          {n && n.kind !== "free" && <div className="nn now" style={hue(subjectLook(n.subject ?? "").hue)}><small>Now · until {d.now!.ends_at}</small><b>{n.subject}</b><span>{n.class}</span></div>}
          {x && <div className="nn" style={hue(subjectLook(x.subject ?? "").hue)}><small>Next · {d.next!.starts_at}</small><b>{x.subject}</b><span>{x.class}</span></div>}
        </div>
      )}
      {lessons.some((p) => p.cell) ? (
        <ol className="today-lessons">
          {lessons.map((p) => <li key={p.id} className={`s-${p.state}${p.cell ? "" : " free"}`} style={p.cell ? hue(subjectLook(p.cell.subject ?? "").hue) : undefined}>
            <span className="tl-time">{p.starts_at}</span>{p.cell ? <><b>{p.cell.subject}</b><span className="muted">{p.cell.class}</span></> : <span className="muted">Free</span>}</li>)}
        </ol>
      ) : <p className="muted">No lessons today. 🎉</p>}
      {left > 0 && <p className="small muted">{left} lesson{left > 1 ? "s" : ""} to go today · {d.count} this week</p>}
      {d.covers.length > 0 && (
        <div className="my-covers"><b className="small">Cover you're doing</b>
          {d.covers.map((c) => <p key={c.id} className="hint-line warn"><Icon name="users" size={14} />{new Date(`${c.date}T12:00:00`).toLocaleDateString("en-GB", { weekday: "short", day: "numeric" })} {c.starts_at} · {c.class}{c.subject ? ` ${c.subject}` : ""}{c.absent ? ` for ${c.absent}` : ""}</p>)}</div>
      )}
      {week && <Modal title="My week" onClose={() => setWeek(false)} wide><WeekGrid g={d} today={new Date().getDay() - 1} /></Modal>}
    </section>
  );
}
