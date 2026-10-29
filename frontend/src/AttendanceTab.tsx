import { useEffect, useState } from "react";
import { api, longDate, todayLocal, type BranchDetail, type Counts, type DaySummary } from "./api";
import { href } from "./router";
import Icon from "./Icon";
import { Empty } from "./ui";

function Line({ c }: { c: Counts }) {
  if (c.total === 0) return <span className="muted small">No students</span>;
  if (c.marked === 0) return <span className="muted small">Not taken yet · {c.total} students</span>;
  return (
    <span className="small">
      {c.marked}/{c.total} marked · <span className="c-present">{c.present} present</span>
      {c.absent > 0 && <> · <span className="c-absent">{c.absent} absent</span></>}
      {c.late > 0 && <> · <span className="c-late">{c.late} late</span></>}
      {c.excused > 0 && <> · <span className="c-excused">{c.excused} excused</span></>}
    </span>
  );
}

function MiniRing({ c }: { c: Counts }) {
  const r = 22, len = 2 * Math.PI * r;
  const pct = c.total ? (c.present + c.late) / c.total : 0;
  const marked = c.total ? c.marked / c.total : 0;
  return (
    <svg width="56" height="56" viewBox="0 0 56 56" aria-hidden="true" className="mini-ring">
      <circle cx="28" cy="28" r={r} fill="none" stroke="var(--border)" strokeWidth="6" />
      <circle cx="28" cy="28" r={r} fill="none" stroke="var(--border-strong, #bbb)" strokeWidth="6" strokeDasharray={`${len * marked} ${len}`} transform="rotate(-90 28 28)" opacity="0.5" />
      <circle cx="28" cy="28" r={r} fill="none" stroke="var(--school, var(--accent))" strokeWidth="6" strokeLinecap="round"
              strokeDasharray={`${len * pct} ${len}`} transform="rotate(-90 28 28)" />
      <text x="28" y="28" textAnchor="middle" dominantBaseline="central" className="mini-ring-text">
        {c.marked ? `${Math.round(pct * 100)}%` : "–"}
      </text>
    </svg>
  );
}

export default function AttendanceTab({ branch }: { branch: BranchDetail }) {
  const [date, setDate] = useState(todayLocal());
  const [summary, setSummary] = useState<DaySummary | null>(null);
  const [error, setError] = useState("");

  useEffect(() => {
    setSummary(null);
    api.daySummary(branch.id, date).then(setSummary).catch((err) => setError(err.message));
  }, [branch.id, date]);

  const s = summary?.school;
  return (
    <section className="stack attendance-page">
      <div className="attendance-head">
        <div className="date-pick">
          <Icon name="calendar" size={18} />
          <input type="date" aria-label="Date" value={date} max={todayLocal()} onChange={(e) => e.target.value && setDate(e.target.value)} />
          <span className="muted">{longDate(date)}</span>
          {date !== todayLocal() && <button className="ghost small" onClick={() => setDate(todayLocal())}>Back to today</button>}
        </div>
      </div>
      {error && <p className="error">{error}</p>}
      {summary === null && !error && <div className="skeleton" aria-hidden="true"><span /><span /></div>}
      {summary && s && (
        <>
          <div className="summary-strip">
            <div><MiniRing c={s} /><span><strong className="block">{s.marked ? `${s.present + s.late} present` : "Not taken"}</strong>{s.marked} of {s.total} marked</span></div>
            <div><Icon name="students" size={20} /><strong>{s.absent}</strong><span>absent</span></div>
            <div><Icon name="attendance" size={20} /><strong>{s.late}</strong><span>late</span></div>
            <div><Icon name="sick_bay" size={20} /><strong>{s.excused}</strong><span>excused</span></div>
          </div>

          <div className="card editor">
            <div className="card-head"><h2>Class registers</h2></div>
            {summary.classes.length === 0 ? (
              <Empty icon="classes">
                No classes yet. <a href={href({ page: "school", id: branch.school_id, tab: "classes" })}>Create classes</a> first.
              </Empty>
            ) : (
              <div className="register-grid">
                {summary.classes.map((c) => (
                  <a key={c.class_id} className={`register-card${c.marked === 0 && c.total > 0 ? " pending" : ""}`}
                     href={href({ page: "register", kind: "school", id: c.class_id, date })}>
                    <MiniRing c={c} />
                    <span className="register-info">
                      <strong className="class-name">{c.class_name}</strong>
                      <Line c={c} />
                    </span>
                    <span className="register-cta">{c.total === 0 ? "" : c.marked === 0 ? "Take register" : "Open"}</span>
                  </a>
                ))}
              </div>
            )}
          </div>

          {summary.night && (
            <a className="card night-card" href={href({ page: "register", kind: "night", id: branch.id, date })}>
              <MiniRing c={summary.night} />
              <span className="register-info">
                <strong className="class-name">Night roll call</strong>
                <Line c={summary.night} />
                <span className="muted small">All boarders at the school.</span>
              </span>
              <span className="register-cta">{summary.night.marked === 0 ? "Take roll call" : "Open"}</span>
            </a>
          )}
        </>
      )}
    </section>
  );
}
