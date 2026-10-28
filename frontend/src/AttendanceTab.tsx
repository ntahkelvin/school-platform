import { useEffect, useState } from "react";
import { api, longDate, todayLocal, type BranchDetail, type Counts, type DaySummary } from "./api";
import { href } from "./router";
import { Empty } from "./ui";

function Progress({ c }: { c: Counts }) {
  const pct = (n: number) => (c.total ? `${(100 * n) / c.total}%` : "0%");
  return (
    <div className="progress" aria-hidden="true">
      <span className="p-present" style={{ width: pct(c.present) }} />
      <span className="p-late" style={{ width: pct(c.late) }} />
      <span className="p-excused" style={{ width: pct(c.excused) }} />
      <span className="p-absent" style={{ width: pct(c.absent) }} />
    </div>
  );
}

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

export default function AttendanceTab({ branch }: { branch: BranchDetail }) {
  const [date, setDate] = useState(todayLocal());
  const [summary, setSummary] = useState<DaySummary | null>(null);
  const [error, setError] = useState("");

  useEffect(() => {
    setSummary(null);
    api.daySummary(branch.id, date).then(setSummary).catch((err) => setError(err.message));
  }, [branch.id, date]);

  return (
    <section className="stack">
      <div className="toolbar">
        <input
          type="date"
          aria-label="Date"
          value={date}
          max={todayLocal()}
          onChange={(e) => e.target.value && setDate(e.target.value)}
          style={{ flex: "0 0 auto" }}
        />
        <span className="muted">{longDate(date)}</span>
      </div>
      {error && <p className="error">{error}</p>}
      {summary === null && !error && <p className="muted">Loading…</p>}
      {summary && (
        <div className="sections">
          <div className="card">
            <div className="card-head">
              <h2>Class registers</h2>
            </div>
            <Line c={summary.school} />
            <Progress c={summary.school} />
            {summary.classes.length === 0 ? (
              <Empty>
                No classes yet. <a href={href({ page: "school", id: branch.school_id, tab: "classes" })}>Create classes</a> first.
              </Empty>
            ) : (
              <ul className="list">
                {summary.classes.map((c) => (
                  <li key={c.class_id}>
                    <div className="grow">
                      <strong>{c.class_name}</strong>
                      <span className="block"><Line c={c} /></span>
                    </div>
                    <a className="button" href={href({ page: "register", kind: "school", id: c.class_id, date })}>
                      {c.marked === 0 ? "Take register" : "Open"}
                    </a>
                  </li>
                ))}
              </ul>
            )}
          </div>

          {summary.night && (
            <div className="card">
              <div className="card-head">
                <h2>Night roll call</h2>
                <a className="button" href={href({ page: "register", kind: "night", id: branch.id, date })}>
                  {summary.night.marked === 0 ? "Take roll call" : "Open"}
                </a>
              </div>
              <Line c={summary.night} />
              <Progress c={summary.night} />
              <p className="muted small">All boarders at the school.</p>
            </div>
          )}
        </div>
      )}
    </section>
  );
}
