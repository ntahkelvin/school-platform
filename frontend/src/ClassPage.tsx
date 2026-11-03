// One class on one page: its students (with today's register), subjects and teachers, the week, and what to look out for.
import { useEffect, useState } from "react";
import { api, errorText, todayLocal, type Me } from "./api";
import { InsightList } from "./GrowthBits";
import type { Insight } from "./growthApi";
import Icon from "./Icon";
import Layout from "./Layout";
import { STAGE_LOOK, stageOf, subjectLook } from "./look";
import { href } from "./router";
import { PrintSheet } from "./Scanner";
import { IdCards, type ListRow } from "./StudentYear";
import { PhotoDay } from "./Profiles";
import { WeekGrid, type Grid } from "./Timetable";
import { Avatar, Glyph, hue, Stat } from "./ui";

interface Row extends ListRow { today: string | null }
interface ClassData {
  class: { id: string; name: string; level: string; branch_id: string }; school: { id: string; name: string; colour: string | null };
  form_teacher: { id: string; name: string } | null; why: string; full: boolean; can_mark: boolean; can_results: boolean; students: Row[]; boys: number; girls: number; boarders: number;
  today: { taken: boolean; present: number; absent: number; late: number; unmarked: number; date: string }; attendance: number | null; points: number;
  subjects: { subject: string; teacher: string | null; teacher_id: string | null; elective: boolean }[]; timetable: Grid | null; insights: Insight[];
}
const MARK: Record<string, { label: string; hue: string }> = { present: { label: "In", hue: "green" }, late: { label: "Late", hue: "amber" }, absent: { label: "Absent", hue: "red" }, excused: { label: "Excused", hue: "sky" } };

export default function ClassPage({ me, onLogout, classId }: { me: Me; onLogout: () => void; classId: string }) {
  const [d, setD] = useState<ClassData | null>(null);
  const [error, setError] = useState("");
  const [sort, setSort] = useState<"name" | "points" | "attendance">("name");
  const [print, setPrint] = useState<null | "list" | "cards" | "photos">(null);
  useEffect(() => { api.raw<ClassData>("GET", `/api/classes/${classId}/page`).then(setD).catch((e) => setError(errorText(e))); }, [classId]);
  if (error) return <Layout me={me} onLogout={onLogout} crumbs={[{ label: "Home", href: "#/" }, { label: "Class" }]}><NotYours text="This class isn't one of yours." /></Layout>;
  if (!d) return <Layout me={me} onLogout={onLogout} crumbs={[{ label: "Home", href: "#/" }]}><div className="skeleton"><span /><span /><span /></div></Layout>;
  const look = STAGE_LOOK[stageOf(d.class.level)];
  const crumbs = [{ label: "Home", href: "#/" }, ...(d.full ? [{ label: d.school.name, href: href({ page: "school", id: d.school.id, tab: "classes" }) }] : []), { label: d.class.name }];
  const rows = [...d.students].sort(sort === "points" ? (a, b) => b.points - a.points : sort === "attendance" ? (a, b) => (a.attendance ?? 101) - (b.attendance ?? 101) : () => 0);
  return (
    <Layout wide me={me} onLogout={onLogout} crumbs={crumbs}>
      <header className="class-hero" style={hue(look.hue)}>
        <span className="hero-pattern" aria-hidden="true" />
        <Glyph icon={look.icon} hue={look.hue} size={64} />
        <div className="grow">
          <h1>{d.class.name}</h1>
          <p>{d.form_teacher ? <>Form teacher: <b>{d.form_teacher.name}</b></> : "No form teacher yet"}{d.why !== "Students" ? ` · You are a ${d.why.toLowerCase()}` : ""}</p>
        </div>
        <div className="class-hero-actions">
          {d.can_mark && <a className="button on-band with-icon" href={href({ page: "register", kind: "school", id: d.class.id, date: todayLocal() })}><Icon name="attendance" size={15} />{d.today.taken ? "Register" : "Take register"}</a>}
          {d.can_results && <a className="button on-band with-icon" href={href({ page: "results", id: d.class.id })}><Icon name="chart" size={15} />Results</a>}
          <button className="on-band with-icon" onClick={() => setPrint("list")}><Icon name="printer" size={15} />Class list</button>
          {d.full && <button className="on-band with-icon" onClick={() => setPrint("cards")}><Icon name="id-card" size={15} />ID cards</button>}
          {d.full && <button className="on-band with-icon" onClick={() => setPrint("photos")}><Icon name="camera" size={15} />Photo day</button>}
        </div>
      </header>

      <div className="stat-strip">
        <Stat icon="students" hue="violet" value={d.students.length} label="students" note={`${d.boys} boys · ${d.girls} girls${d.boarders ? ` · ${d.boarders} boarders` : ""}`} />
        <Stat icon="attendance" hue={d.today.taken ? (d.today.absent ? "amber" : "green") : "slate"} value={d.today.taken ? `${d.today.present}/${d.students.length}` : "–"} label="in school today"
              note={d.today.taken ? `${d.today.absent} absent${d.today.late ? `, ${d.today.late} late` : ""}` : "Register not taken yet"} />
        <Stat icon="calendar-check" hue={d.attendance == null ? "slate" : d.attendance >= 90 ? "green" : "amber"} value={d.attendance == null ? "–" : `${d.attendance}%`} label="attendance, 30 days" />
        <Stat icon="star" hue="amber" value={d.points > 0 ? `+${d.points}` : d.points} label="merit points, 90 days" />
      </div>
      {d.insights.length > 0 && <InsightList items={d.insights} schoolId={d.school.id} />}

      <section className="card editor">
        <div className="row wrap"><h3 className="with-glyph grow"><Glyph icon="students" hue="violet" size={30} />Students</h3>
          <label className="sort-pick"><span className="small muted">Sort</span><select value={sort} onChange={(e) => setSort(e.target.value as typeof sort)}>
            <option value="name">Name</option><option value="points">Most merit points</option><option value="attendance">Lowest attendance</option></select></label></div>
        {rows.length === 0 ? <p className="muted">No students in this class yet.</p> : (
          <div className="face-wall class-faces">
            {rows.map((r) => (
              <a key={r.id} className="face-card" href={href({ page: "student", id: r.id })} style={{ ["--hc" as string]: r.house_colour || "var(--border)" }}>
                <span className="face-pic">
                  {r.thumb ? <img src={r.thumb} alt="" /> : <Avatar name={`${r.first_name} ${r.last_name}`} size={72} />}
                  {r.allergy && <span className="face-badge red" title={`Allergic: ${r.allergy}`}><Icon name="circle-x" size={12} /></span>}
                  {r.leadership && <span className="face-badge amber left" title={r.leadership}><Icon name="crown" size={12} /></span>}
                </span>
                <span className="face-name"><b>{r.nickname || r.first_name}</b> {r.last_name}<small>{r.house ?? r.admission_no}</small></span>
                <span className="face-meta">
                  {r.today && <span className="hue-chip" style={hue((MARK[r.today]?.hue ?? "slate") as never)}>{MARK[r.today]?.label ?? r.today}</span>}
                  {r.points !== 0 && <span className={`pts ${r.points > 0 ? "up" : "down"}`}>{r.points > 0 ? "+" : ""}{r.points}</span>}
                  {r.attendance != null && r.attendance < 85 && <span className="hue-chip" style={hue("red")}>{r.attendance}%</span>}
                </span>
              </a>
            ))}
          </div>
        )}
      </section>

      <div className="sections wide">
        <section className="card editor">
          <h3 className="with-glyph"><Glyph icon="presentation" hue="fuchsia" size={30} />Subjects and teachers</h3>
          <ul className="class-subjects">{d.subjects.map((s) => { const l = subjectLook(s.subject); return (
            <li key={s.subject}><Glyph icon={l.icon} hue={l.hue} size={28} /><span><b>{s.subject}</b>{s.elective && <span className="hue-chip" style={hue("violet")}>Elective</span>}<small className="muted block">{s.teacher ?? "No teacher yet"}</small></span></li>); })}</ul>
        </section>
      </div>
      {d.timetable && (
        <section className="card editor tt-card"><h3 className="with-glyph"><Glyph icon="calendar-days" hue="blue" size={30} />The week</h3><WeekGrid g={d.timetable} today={new Date().getDay() - 1} /></section>
      )}
      {print === "photos" && <PhotoDay classId={d.class.id} name={d.class.name} onClose={() => { setPrint(null); void api.raw<ClassData>("GET", `/api/classes/${classId}/page`).then(setD); }} />}
      {print === "cards" && <IdCards schoolId={d.school.id} query={`class_id=${d.class.id}`} onClose={() => setPrint(null)} />}
      {print === "list" && (
        <PrintSheet title={`${d.class.name} class list`} onClose={() => setPrint(null)} note={`${d.students.length} students`}>
          <div className="class-print">
            <h2>{d.school.name} · {d.class.name}</h2>
            {d.form_teacher && <p>Form teacher: {d.form_teacher.name}</p>}
            <table><thead><tr><th>#</th><th>Name</th><th>Admission no</th><th>Sex</th><th>House</th>{d.full && <th>Parent</th>}<th className="blank" /></tr></thead>
              <tbody>{d.students.map((r, i) => <tr key={r.id}><td>{i + 1}</td><td>{r.last_name}, {r.first_name} {r.middle_name ?? ""}</td><td>{r.admission_no}</td><td>{r.gender === "female" ? "F" : "M"}</td><td>{r.house ?? ""}</td>{d.full && <td>{r.parent ?? ""}</td>}<td className="blank" /></tr>)}</tbody></table>
          </div>
        </PrintSheet>
      )}
    </Layout>
  );
}

export function NotYours({ text }: { text: string }) {
  return (
    <div className="adm-empty not-yours"><span>🔒</span><p><b>{text}</b></p>
      <p className="muted small">You can open the students and classes you teach, look after or are form teacher of. Ask the principal if you need more.</p>
      <a className="button" href="#/">Back to my home page</a></div>
  );
}
