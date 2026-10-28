import { useCallback, useEffect, useState } from "react";
import {
  api, errorText, SCHOOL_TYPE_LABEL, todayLocal,
  type Group, type Me, type School, type SchoolStats,
} from "./api";
import Layout from "./Layout";
import { SchoolForm } from "./forms";
import { org } from "./orgApi";
import { go, href } from "./router";

// Classic Nigerian school-uniform colours, used when a school hasn't chosen its own.
const UNIFORM = ["#7a1f2b", "#1f3a6b", "#1d5e3a", "#5b2a86", "#8a5a12", "#215f7a", "#6b2440", "#2f4f2f"];

export function schoolColour(s: School): string {
  if (s.colour) return s.colour;
  let h = 0;
  for (const ch of s.name) h = (h * 31 + ch.charCodeAt(0)) >>> 0;
  return UNIFORM[h % UNIFORM.length];
}

export function initials(name: string): string {
  const words = name.replace(/\(.*?\)/g, "").split(/\s+/).filter((w) => /^[A-Za-z]/.test(w) && !/^(of|the|and)$/i.test(w));
  return (words[0]?.[0] ?? "") + (words[1]?.[0] ?? "");
}

const n = (x: number) => x.toLocaleString("en-NG");
const plural = (x: number, one: string, many = `${one}s`) => `${n(x)} ${x === 1 ? one : many}`;

function greeting(): string {
  const h = new Date().getHours();
  return h < 12 ? "Good morning" : h < 17 ? "Good afternoon" : "Good evening";
}

export default function Dashboard({ me, onLogout }: { me: Me; onLogout: () => void }) {
  const [groups, setGroups] = useState<Group[] | null>(null);
  const [stats, setStats] = useState<Record<string, SchoolStats>>({});
  const [error, setError] = useState("");

  const load = useCallback(() => {
    api.groups().then(setGroups).catch((err) => setError(err.message));
    api.dashboardStats(todayLocal()).then(setStats).catch(() => {});
  }, []);
  useEffect(load, [load]);

  const schools = (groups ?? []).flatMap((g) => g.schools);
  const totalStudents = schools.reduce((t, s) => t + (stats[s.id]?.students ?? 0), 0);
  const totalStaff = schools.reduce((t, s) => t + (stats[s.id]?.staff ?? 0), 0);
  const firstName = me.full_name.split(" ")[0];

  return (
    <Layout me={me} onLogout={onLogout} crumbs={[]}>
      <header className="home-head">
        <div>
          <h1 className="home-greeting">{greeting()}, {firstName}</h1>
          <p className="muted">
            {new Date().toLocaleDateString("en-GB", { weekday: "long", day: "numeric", month: "long", year: "numeric" })}
            {groups && groups.length > 0 && (
              <>. {plural(groups.length, "organisation")}, {plural(schools.length, "school")}, {plural(totalStudents, "student")} and {n(totalStaff)} staff.</>
            )}
          </p>
        </div>
        {groups && (
          <div className="row wrap">
            <a className="button" href={href({ page: "board" })}>Board view</a>
            <button onClick={() => {
              const name = window.prompt("Name of the new organisation (the proprietor, society or company that runs the schools)");
              if (name && name.trim().length >= 2) org.create(name.trim()).then(load).catch((err) => setError(errorText(err)));
            }}>New organisation</button>
          </div>
        )}
      </header>

      {error && <p className="error">{error}</p>}
      {groups === null && !error && <p className="muted">Loading your schools…</p>}
      {groups?.length === 0 && <p className="muted">No organisations yet. Click New organisation to start.</p>}
      {groups?.map((g) => <OrganisationSection key={g.id} group={g} stats={stats} onChanged={load} />)}
    </Layout>
  );
}

function OrganisationSection({ group, stats, onChanged }: {
  group: Group; stats: Record<string, SchoolStats>; onChanged: () => void;
}) {
  const students = group.schools.reduce((t, s) => t + (stats[s.id]?.students ?? 0), 0);
  return (
    <section className="org">
      <div className="org-bar">
        <div className="row" style={{ alignItems: "center", gap: 12 }}>
          {group.logo && <img className="logo" src={group.logo} alt="" />}
          <div>
            <h2 className="org-name">{group.name}</h2>
            <p className="muted small">{plural(group.schools.length, "school")}, {plural(students, "student")}</p>
          </div>
        </div>
        <a className="button" href={href({ page: "org", id: group.id })}>Organisation and board</a>
      </div>
      <div className="school-grid">
        {group.schools.map((s) => <SchoolCard key={s.id} school={s} stats={stats[s.id]} />)}
        <AddSchoolCard groupId={group.id} onAdded={onChanged} />
      </div>
    </section>
  );
}

function TodayLine({ stats }: { stats?: SchoolStats }) {
  if (!stats) return <p className="today muted">&nbsp;</p>;
  const t = stats.today;
  if (t.in_classes === 0) return <p className="today muted">No students in classes yet</p>;
  if (t.marked === 0) return <p className="today muted">Register not taken yet today</p>;
  const pct = Math.round((100 * t.present) / t.in_classes);
  return (
    <div className="today">
      <p>
        Today: <strong>{n(t.present)}</strong> of {n(t.in_classes)} present
        {t.absent > 0 && <span className="c-absent">, {n(t.absent)} absent</span>}
        {t.marked < t.in_classes && <span className="muted">, {n(t.in_classes - t.marked)} not marked</span>}
      </p>
      <div className="today-bar" aria-hidden="true"><span style={{ width: `${pct}%` }} /></div>
    </div>
  );
}

function SchoolCard({ school, stats }: { school: School; stats?: SchoolStats }) {
  const to = (tab: "overview" | "students" | "attendance") => href({ page: "school", id: school.id, tab });
  const boarding = school.school_type !== "day";
  return (
    <article className="school" style={{ "--school": schoolColour(school) } as React.CSSProperties}>
      <div className="school-band" />
      <a className="school-head" href={to("overview")}>
        <span className="crest">
          {school.logo ? <img src={school.logo} alt="" /> : <span className="crest-initials">{initials(school.name)}</span>}
        </span>
        <span className="school-title">
          <h3>{school.name}</h3>
          <span className="school-type">
            {SCHOOL_TYPE_LABEL[school.school_type]}
            {boarding && stats && stats.boarders > 0 && `, ${plural(stats.boarders, "boarder")}`}
          </span>
          {school.motto && <span className="school-motto">{school.motto}</span>}
        </span>
      </a>
      <dl className="figures">
        <div title={stats ? `${n(stats.boys)} boys, ${n(stats.girls)} girls` : undefined}>
          <dd>{stats ? n(stats.students) : "–"}</dd>
          <dt>students</dt>
        </div>
        <div><dd>{stats ? n(stats.staff) : "–"}</dd><dt>staff</dt></div>
        <div><dd>{stats ? n(stats.classes) : "–"}</dd><dt>classes</dt></div>
        <div><dd>{stats ? n(stats.departments) : "–"}</dd><dt>departments</dt></div>
      </dl>
      <TodayLine stats={stats} />
      <nav className="school-links" aria-label={`${school.name} shortcuts`}>
        <a href={to("students")}>Students</a>
        <a href={to("attendance")}>Attendance</a>
        <a href={to("overview")}>Set up</a>
      </nav>
    </article>
  );
}

function AddSchoolCard({ groupId, onAdded }: { groupId: string; onAdded: () => void }) {
  const [open, setOpen] = useState(false);
  if (!open) {
    return (
      <button className="add-school" onClick={() => setOpen(true)}>
        <span aria-hidden="true">+</span> Add a school
      </button>
    );
  }
  return (
    <div className="card">
      <h3>New school</h3>
      <SchoolForm
        submitLabel="Save school"
        onCancel={() => setOpen(false)}
        onSubmit={async (name, type) => {
          const s = await api.addSchool(groupId, name, type);
          setOpen(false);
          onAdded();
          go({ page: "school", id: s.id, tab: "overview" });
        }}
      />
    </div>
  );
}
