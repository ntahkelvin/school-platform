// Read-only overview for board members (and owners previewing what boards see).
import { useEffect, useState } from "react";
import { errorText, type Me } from "./api";
import Layout from "./Layout";
import { org, type Board, type OrganisationSummary, type SchoolSummary } from "./orgApi";
import { EVENT_CATEGORY } from "./structureApi";
import { Empty } from "./ui";

function niceDate(iso: string): string {
  return new Date(iso + "T00:00:00").toLocaleDateString("en-GB", { day: "numeric", month: "short" });
}

export default function BoardView({ me, onLogout }: { me: Me; onLogout: () => void }) {
  const [data, setData] = useState<OrganisationSummary[] | null>(null);
  const [error, setError] = useState("");
  useEffect(() => {
    org.overview().then(setData).catch((err) => setError(errorText(err)));
  }, []);
  const isOwner = me.memberships.some((m) => m.role === "owner");

  return (
    <Layout me={me} onLogout={onLogout} crumbs={isOwner ? [{ label: "Home", href: "#/" }, { label: "Board view" }] : []}>
      <div className="page-head">
        <div>
          <h1>Board view</h1>
          <p className="muted">A read-only summary of the schools you oversee.</p>
        </div>
      </div>
      {error && <p className="error">{error}</p>}
      {data?.length === 0 && <Empty>You aren't on any board yet.</Empty>}
      {data?.map((o) => (
        <section key={o.id} className="stack board-org">
          <div className="row" style={{ alignItems: "center", gap: 12 }}>
            {o.logo && <img className="logo" src={o.logo} alt="" />}
            <h2 className="org-title">{o.name}</h2>
          </div>
          {o.schools.length > 1 && (
            <div className="stat-row">
              <Stat label="Schools" value={o.totals.schools} />
              <Stat label="Students" value={o.totals.students} />
              <Stat label="Boarders" value={o.totals.boarders} />
              <Stat label="Staff" value={o.totals.staff} />
            </div>
          )}
          {o.boards.map((b) => <BoardList key={b.id} board={b} />)}
          <div className="sections wide">
            {o.schools.map((s) => <SchoolPanel key={s.id} s={s} />)}
          </div>
        </section>
      ))}
    </Layout>
  );
}

function Stat({ label, value, note }: { label: string; value: string | number; note?: string }) {
  return (
    <div className="stat">
      <span className="stat-value">{value}</span>
      <span className="muted small">{label}</span>
      {note && <span className="muted small">{note}</span>}
    </div>
  );
}

function BoardList({ board }: { board: Board }) {
  if (board.members.length === 0) return null;
  return (
    <p className="small">
      <strong>{board.name}:</strong>{" "}
      {board.members.map((m) => `${m.full_name} (${m.position})`).join(", ")}
    </p>
  );
}

function SchoolPanel({ s }: { s: SchoolSummary }) {
  const rate = s.attendance_rate_30d;
  return (
    <div className="card">
      <div className="row" style={{ alignItems: "center", gap: 12 }}>
        {s.logo && <img className="logo" src={s.logo} alt="" />}
        <div>
          <h2>{s.name}</h2>
          {s.motto && <span className="muted small"><em>{s.motto}</em></span>}
        </div>
      </div>
      <div className="stat-row">
        <Stat label="Students" value={s.students} note={`${s.boys} boys · ${s.girls} girls`} />
        {s.boarders > 0 && <Stat label="Boarders" value={s.boarders} />}
        <Stat label="Staff" value={s.staff_total} />
        <Stat label="Attendance, 30 days" value={rate === null ? "n/a" : `${rate}%`} />
      </div>
      {Object.keys(s.by_section).length > 0 && (
        <p className="small"><span className="muted">By section: </span>{Object.entries(s.by_section).map(([k, v]) => `${k} ${v}`).join(" · ")}</p>
      )}
      {s.staff.length > 0 && (
        <p className="small"><span className="muted">Staff: </span>{s.staff.map((x) => `${x.count} ${x.role.toLowerCase()}`).join(" · ")}</p>
      )}
      <div>
        <h3>Coming up</h3>
        {s.upcoming.length === 0 ? (
          <span className="muted small">Nothing on the calendar.</span>
        ) : (
          <ul className="list small">
            {s.upcoming.map((e, i) => (
              <li key={i}>
                <span>{e.title}</span>
                <span className="muted">
                  {niceDate(e.starts_on)}{e.ends_on && e.ends_on !== e.starts_on ? ` to ${niceDate(e.ends_on)}` : ""} · {EVENT_CATEGORY[e.category as keyof typeof EVENT_CATEGORY] ?? e.category}
                </span>
              </li>
            ))}
          </ul>
        )}
      </div>
      <div className="coming-soon small muted">
        Fees collected and WAEC / NECO results will appear here once those parts of the platform are built.
      </div>
      {s.boards.map((b) => <BoardList key={b.id} board={b} />)}
    </div>
  );
}
