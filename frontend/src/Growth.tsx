// "Growth" in the school menu: how the staff are doing and growing.
// Overview with insights, people, observations, appraisals, training, mentoring, recognition, strengths, wellbeing, workload.
import { useCallback, useEffect, useMemo, useState, type FormEvent } from "react";
import { errorText } from "./api";
import { niceDate } from "./dayApi";
import {
  APP_STATUS, BADGE_LOOK, CPD_LOOK, grow, LEVEL_LOOK, MOOD, OBS_KIND, OBS_STATUS, SKILL_GROUP_LOOK,
  type Appraisal, type Cpd, type GrowthSettings, type Kudos, type LoadRow, type Mentoring, type Observation, type Overview, type PersonRow,
  type StrengthMap, type Wellbeing,
} from "./growthApi";
import { InsightList, KudosItem, LevelChip, PersonLine, Radar, Ring, useBusy } from "./GrowthBits";
import { AppraisalModal, CpdForm, KudosForm, MentoringForm, MentoringView, ObservationForm, ObservationView, usePeople } from "./GrowthForms";
import Icon from "./Icon";
import { href } from "./router";
import { Avatar, Empty, Field, Glyph, hue, Modal } from "./ui";

type Seg = "overview" | "people" | "observations" | "appraisals" | "training" | "mentoring" | "recognition" | "strengths" | "wellbeing" | "workload" | "settings";
const SEGS: { key: Seg; label: string; icon: string }[] = [
  { key: "overview", label: "Overview", icon: "sparkle" },
  { key: "people", label: "People", icon: "users" },
  { key: "observations", label: "Observations", icon: "eye" },
  { key: "appraisals", label: "Appraisals", icon: "clipboard-list" },
  { key: "training", label: "Training", icon: "graduation-cap" },
  { key: "mentoring", label: "Mentoring", icon: "handshake" },
  { key: "recognition", label: "Recognition", icon: "trophy" },
  { key: "strengths", label: "Strengths map", icon: "star" },
  { key: "wellbeing", label: "Wellbeing", icon: "heart-pulse" },
  { key: "workload", label: "Workload", icon: "scale" },
  { key: "settings", label: "Settings", icon: "settings" },
];

export default function GrowthPage({ schoolId }: { schoolId: string }) {
  const [seg, setSeg] = useState<Seg>(() => { try { return (sessionStorage.getItem("growth-seg") as Seg) || "overview"; } catch { return "overview"; } });
  const pick = (s: Seg) => { setSeg(s); try { sessionStorage.setItem("growth-seg", s); } catch { /* private mode */ } };
  return (
    <div className="growth">
      <div className="segmented day-segs growth-segs" role="tablist">
        {SEGS.map((s) => (
          <button key={s.key} role="tab" aria-selected={seg === s.key} className={seg === s.key ? "on" : ""} onClick={() => pick(s.key)}>
            <Icon name={s.icon} size={16} />{s.label}
          </button>
        ))}
      </div>
      {seg === "overview" && <OverviewTab schoolId={schoolId} go={pick} />}
      {seg === "people" && <PeopleTab schoolId={schoolId} />}
      {seg === "observations" && <ObservationsTab schoolId={schoolId} />}
      {seg === "appraisals" && <AppraisalsTab schoolId={schoolId} />}
      {seg === "training" && <TrainingTab schoolId={schoolId} />}
      {seg === "mentoring" && <MentoringTab schoolId={schoolId} />}
      {seg === "recognition" && <RecognitionTab schoolId={schoolId} />}
      {seg === "strengths" && <StrengthsTab schoolId={schoolId} />}
      {seg === "wellbeing" && <WellbeingTab schoolId={schoolId} />}
      {seg === "workload" && <WorkloadTab schoolId={schoolId} />}
      {seg === "settings" && <SettingsTab schoolId={schoolId} />}
    </div>
  );
}

// ---------------- Overview ----------------

function OverviewTab({ schoolId, go }: { schoolId: string; go: (s: Seg) => void }) {
  const [o, setO] = useState<Overview | null>(null);
  const [error, setError] = useState("");
  useEffect(() => { grow.overview(schoolId).then(setO).catch((e) => setError(errorText(e))); }, [schoolId]);
  if (error) return <p className="error">{error}</p>;
  if (!o) return <p className="muted">Working it out…</p>;
  const done = o.appraisals.counts.done ?? 0;
  const wb = o.wellbeing.latest;
  const mood = wb?.mood != null ? MOOD[Math.round(wb.mood) - 1] : null;
  const shownWeeks = o.wellbeing.weeks.filter((w) => w.shown);
  return (
    <section className="stack">
      <div className="stat-strip growth-stats">
        <button className="stat-tile as-button" style={hue("indigo")} onClick={() => go("observations")}>
          <Ring value={o.observations.observed} max={o.teachers} size={56} stroke={7} label={`${o.teachers ? Math.round((o.observations.observed / o.teachers) * 100) : 0}%`} />
          <div className="stat-text"><strong>{o.observations.observed}<small> of {o.teachers}</small></strong><span>Teachers observed</span><span className="stat-note">{o.observations.this_year} observations this year</span></div>
        </button>
        <button className="stat-tile as-button" style={hue("violet")} onClick={() => go("appraisals")}>
          <Ring value={done} max={o.appraisals.total} size={56} stroke={7} label={o.appraisals.total ? `${Math.round((done / o.appraisals.total) * 100)}%` : "–"} />
          <div className="stat-text"><strong>{done}<small> of {o.appraisals.total}</small></strong><span>Appraisals complete</span><span className="stat-note">{o.appraisals.period ?? "None started"}</span></div>
        </button>
        <button className="stat-tile as-button" style={hue("teal")} onClick={() => go("training")}>
          <Ring value={o.cpd.met} max={o.staff} size={56} stroke={7} label={`${o.staff ? Math.round((o.cpd.met / o.staff) * 100) : 0}%`} />
          <div className="stat-text"><strong>{o.cpd.hours.toLocaleString()}<small> h</small></strong><span>Training this year</span><span className="stat-note">{o.cpd.met} reached {o.cpd.target} h</span></div>
        </button>
        <button className="stat-tile as-button" style={hue(mood?.hue ?? "slate")} onClick={() => go("wellbeing")}>
          <span className="mood-big" aria-hidden="true">{mood?.emoji ?? "🤍"}</span>
          <div className="stat-text"><strong>{wb?.mood != null ? wb.mood.toFixed(1) : "–"}<small> / 5</small></strong><span>Staff mood</span><span className="stat-note">{wb ? `${wb.answers} answered this week` : "Not enough answers yet"}</span></div>
        </button>
      </div>

      <div className="growth-grid">
        <section className="card g-card wide" style={hue("violet")}>
          <h3 className="with-glyph"><Glyph icon="sparkle" hue="violet" size={32} />What the data says<span className="ai-tag" title="Worked out on this device's server from your school's records. Works without internet.">Offline insights</span></h3>
          <InsightList items={o.insights} schoolId={schoolId} />
        </section>
        <section className="card g-card" style={hue("indigo")}>
          <h3 className="with-glyph"><Glyph icon="eye" hue="indigo" size={32} />Teaching across the school</h3>
          {Object.keys(o.school_averages).length ? <Radar criteria={o.criteria} values={o.school_averages} size={320} />
            : <Empty icon="eye">Observe some lessons to see the school's teaching shape.</Empty>}
          <p className="muted small center-text">Average of all shared observations, 1 to 4</p>
        </section>
        <section className="card g-card" style={hue("pink")}>
          <h3 className="with-glyph"><Glyph icon="trophy" hue="pink" size={32} />Most appreciated this month</h3>
          {o.kudos.top.length === 0 ? <Empty icon="trophy">No kudos yet this month.</Empty> : (
            <ol className="podium">
              {o.kudos.top.map((p, i) => (
                <li key={p.user_id}><span className={`place p${i + 1}`}>{i + 1}</span><PersonLine p={p} schoolId={schoolId} /><b>{p.count} {p.count === 1 ? "kudos" : "kudos"}</b></li>
              ))}
            </ol>
          )}
          <button className="text-link" onClick={() => go("recognition")}>See the recognition wall →</button>
        </section>
        <section className="card g-card" style={hue("amber")}>
          <h3 className="with-glyph"><Glyph icon="clipboard-list" hue="amber" size={32} />Appraisals {o.appraisals.period ?? ""}</h3>
          {o.appraisals.total === 0 ? <Empty icon="clipboard-list">No appraisals started yet.</Empty> : (
            <>
              <div className="pipeline">
                {(["self", "review", "sign", "done"] as const).map((k) => (
                  <i key={k} style={{ ...hue(APP_STATUS[k].hue), flexGrow: o.appraisals.counts[k] ?? 0 }} title={`${APP_STATUS[k].label}: ${o.appraisals.counts[k] ?? 0}`} />
                ))}
              </div>
              <ul className="pipeline-key">
                {(["self", "review", "sign", "done"] as const).map((k) => <li key={k} style={hue(APP_STATUS[k].hue)}><i />{APP_STATUS[k].label}<b>{o.appraisals.counts[k] ?? 0}</b></li>)}
              </ul>
            </>
          )}
        </section>
        <section className="card g-card" style={hue("rose")}>
          <h3 className="with-glyph"><Glyph icon="heart-pulse" hue="rose" size={32} />Staff mood, last 12 weeks</h3>
          {shownWeeks.length === 0 ? <Empty icon="heart-pulse">Once staff do the weekly check-in, the trend shows here.</Empty> : <MoodBars weeks={o.wellbeing.weeks} />}
        </section>
        <section className="card g-card" style={hue("teal")}>
          <h3 className="with-glyph"><Glyph icon="scale" hue="teal" size={32} />Workload and support</h3>
          <div className="mini-figs">
            <button onClick={() => go("workload")} style={hue(o.workload.over ? "red" : "green")}><b>{o.workload.over}</b>above the workload limit</button>
            <button onClick={() => go("mentoring")} style={hue("pink")}><b>{o.mentoring}</b>mentoring pairs</button>
            <button onClick={() => go("observations")} style={hue("sky")}><b>{o.observations.planned}</b>observations planned</button>
          </div>
        </section>
      </div>
    </section>
  );
}

export function MoodBars({ weeks }: { weeks: Wellbeing["weeks"] }) {
  return (
    <div className="mood-bars">
      {weeks.map((w) => {
        const m = w.mood != null ? MOOD[Math.round(w.mood) - 1] : null;
        return (
          <div key={w.week_start} className="mood-col" title={w.shown ? `Week of ${niceDate(w.week_start)}: mood ${w.mood}, workload ${w.workload}, ${w.answers} answers` : `Week of ${niceDate(w.week_start)}: fewer than 3 answers (hidden)`}>
            <span className="mood-emoji">{m?.emoji ?? "·"}</span>
            <span className="mood-track"><i style={{ ...hue(m?.hue ?? "slate"), height: `${w.mood ? (w.mood / 5) * 100 : 4}%` }} /></span>
            <small>{niceDate(w.week_start, { day: "numeric", month: "numeric" })}</small>
          </div>
        );
      })}
    </div>
  );
}

// ---------------- People ----------------

function PeopleTab({ schoolId }: { schoolId: string }) {
  const [data, setData] = useState<{ cpd_target: number; people: PersonRow[] } | null>(null);
  const [q, setQ] = useState("");
  const [sort, setSort] = useState("name");
  useEffect(() => { grow.people(schoolId).then(setData).catch(() => {}); }, [schoolId]);
  if (!data) return <p className="muted">Loading…</p>;
  const rows = data.people.filter((p) => p.visible && (!q || `${p.name} ${p.job_title ?? ""} ${p.department_name ?? ""}`.toLowerCase().includes(q.toLowerCase())))
    .sort((a, b) => sort === "obs" ? (b.observation_average ?? -1) - (a.observation_average ?? -1) : sort === "cpd" ? (b.cpd_hours ?? 0) - (a.cpd_hours ?? 0)
      : sort === "kudos" ? (b.kudos ?? 0) - (a.kudos ?? 0) : a.name.localeCompare(b.name));
  return (
    <section className="stack">
      <div className="day-toolbar">
        <input className="day-search" placeholder="Find a name, department or position…" value={q} onChange={(e) => setQ(e.target.value)} />
        <span className="grow" />
        <div className="segmented small-seg">
          {[["name", "A to Z"], ["obs", "Teaching score"], ["cpd", "Training"], ["kudos", "Kudos"]].map(([k, l]) => <button key={k} className={sort === k ? "on" : ""} onClick={() => setSort(k)}>{l}</button>)}
        </div>
      </div>
      <div className="people-grid">
        {rows.map((p) => {
          const lv = p.observation_average != null ? LEVEL_LOOK[Math.round(p.observation_average)] : null;
          return (
            <a key={p.user_id} className="person-tile" href={href({ page: "passport", school: schoolId, id: p.user_id })} style={hue(lv?.hue ?? "slate")}>
              {p.photo ? <img className="g-photo" src={p.photo} alt="" style={{ width: 52, height: 52 }} /> : <Avatar name={p.name} size={52} />}
              <span className="person-tile-text"><strong>{p.name}</strong><span className="muted small">{p.job_title ?? "Staff"}</span></span>
              <span className="person-figs">
                <span title="Average observation score">{p.observation_average != null ? <b className="lv">{p.observation_average.toFixed(1)}</b> : <b className="none">–</b>}<small>teaching</small></span>
                <span title={`Training hours this school year (target ${data.cpd_target})`}><b className={(p.cpd_hours ?? 0) >= data.cpd_target ? "ok" : ""}>{p.cpd_hours ?? 0}</b><small>hours</small></span>
                <span title="Kudos received"><b>{p.kudos ?? 0}</b><small>kudos</small></span>
              </span>
            </a>
          );
        })}
      </div>
    </section>
  );
}

// ---------------- Observations ----------------

export function ObservationsTab({ schoolId, compact = false }: { schoolId: string; compact?: boolean }) {
  const { people } = usePeople(schoolId);
  const [list, setList] = useState<Observation[] | null>(null);
  const [filter, setFilter] = useState("all");
  const [editing, setEditing] = useState<Observation | "new" | null>(null);
  const [viewing, setViewing] = useState<Observation | null>(null);
  const load = useCallback(() => { grow.observations(schoolId).then(setList).catch(() => setList([])); }, [schoolId]);
  useEffect(load, [load]);
  const counts = (list ?? []).reduce<Record<string, number>>((a, o) => ({ ...a, [o.status]: (a[o.status] ?? 0) + 1 }), {});
  const rows = (list ?? []).filter((o) => filter === "all" || o.status === filter);
  return (
    <section className="stack">
      <div className="day-toolbar">
        <div className="day-filters">
          <button className={`hue-chip pick-chip${filter === "all" ? " on" : ""}`} style={hue("blue")} onClick={() => setFilter("all")}>All <b>{list?.length ?? 0}</b></button>
          {Object.entries(OBS_STATUS).filter(([k]) => counts[k]).map(([k, v]) => (
            <button key={k} className={`hue-chip pick-chip${filter === k ? " on" : ""}`} style={hue(v.hue)} onClick={() => setFilter(k)}><Icon name={v.icon} size={13} />{v.label} <b>{counts[k]}</b></button>
          ))}
        </div>
        <span className="grow" />
        <button className="primary with-icon" onClick={() => setEditing("new")}><Icon name="eye" size={16} />Observe a lesson</button>
      </div>
      {list && rows.length === 0 && <Empty icon="eye">No observations here yet. Observing lessons, with kind and specific feedback, is the fastest way to better teaching.</Empty>}
      <div className={`obs-grid${compact ? " compact" : ""}`}>
        {rows.map((o) => <ObsCard key={o.id} o={o} onOpen={() => (o.status === "planned" && o.can_edit ? setEditing(o) : setViewing(o))} />)}
      </div>
      {editing && <ObservationForm schoolId={schoolId} people={people} obs={editing === "new" ? null : editing} onClose={() => setEditing(null)} onDone={() => { setEditing(null); load(); }} />}
      {viewing && <ObservationView o={viewing} onClose={() => setViewing(null)} onChanged={() => { setViewing(null); load(); }} onEdit={() => { setEditing(viewing); setViewing(null); }} />}
    </section>
  );
}

export function ObsCard({ o, onOpen }: { o: Observation; onOpen: () => void }) {
  const st = OBS_STATUS[o.status];
  const lv = o.average != null ? LEVEL_LOOK[Math.round(o.average)] : null;
  return (
    <button className="obs-card" style={hue(lv?.hue ?? st.hue)} onClick={onOpen}>
      <span className="obs-card-top">
        {o.teacher.photo ? <img className="g-photo" src={o.teacher.photo} alt="" style={{ width: 40, height: 40 }} /> : <Avatar name={o.teacher.name} size={40} />}
        <span className="obs-card-who"><strong>{o.teacher.name}</strong><span className="muted small">{o.class_label ?? o.teacher.job_title}</span></span>
        {o.average != null ? <span className="obs-score">{o.average.toFixed(1)}</span> : <span className="obs-score none"><Icon name={st.icon} size={18} /></span>}
      </span>
      <span className="obs-card-meta">
        <span className="hue-chip" style={hue(st.hue)}><Icon name={st.icon} size={12} />{st.label}</span>
        <span className="muted small">{niceDate(o.on_date)} · {o.observer}{o.kind !== "formal" ? ` · ${OBS_KIND[o.kind]}` : ""}</span>
      </span>
      {o.next_steps && <span className="obs-next"><Icon name="target" size={13} />{o.next_steps}</span>}
    </button>
  );
}

// ---------------- Appraisals ----------------

function AppraisalsTab({ schoolId }: { schoolId: string }) {
  const [data, setData] = useState<{ periods: string[]; appraisals: Appraisal[] } | null>(null);
  const [period, setPeriod] = useState<string>("");
  const [open, setOpen] = useState<string | null>(null);
  const [starting, setStarting] = useState(false);
  const [filter, setFilter] = useState("all");
  const [q, setQ] = useState("");
  const load = useCallback(() => {
    grow.appraisals(schoolId, period || undefined).then((d) => { setData(d); if (!period && d.periods[0]) setPeriod(d.periods[0]); }).catch(() => {});
  }, [schoolId, period]);
  useEffect(load, [load]);
  const list = (data?.appraisals ?? []).filter((a) => !period || a.period_label === period);
  const counts = list.reduce<Record<string, number>>((x, a) => ({ ...x, [a.status]: (x[a.status] ?? 0) + 1 }), {});
  const rows = list.filter((a) => (filter === "all" || a.status === filter) && (!q || a.person.name.toLowerCase().includes(q.toLowerCase()) || a.appraiser.toLowerCase().includes(q.toLowerCase())));
  return (
    <section className="stack">
      <div className="day-toolbar">
        {data && data.periods.length > 0 && (
          <select value={period} onChange={(e) => setPeriod(e.target.value)} aria-label="Appraisal year">{data.periods.map((p) => <option key={p}>{p}</option>)}</select>
        )}
        <input className="day-search" placeholder="Find a person or appraiser…" value={q} onChange={(e) => setQ(e.target.value)} />
        <span className="grow" />
        <button className="primary with-icon" onClick={() => setStarting(true)}><Icon name="plus" size={16} />Start appraisals</button>
      </div>
      {list.length > 0 && (
        <div className="app-pipeline">
          {(["self", "review", "sign", "done"] as const).map((k) => (
            <button key={k} className={`app-stage${filter === k ? " on" : ""}`} style={hue(APP_STATUS[k].hue)} onClick={() => setFilter(filter === k ? "all" : k)}>
              <Glyph icon={APP_STATUS[k].icon} hue={APP_STATUS[k].hue} size={36} />
              <span><b>{counts[k] ?? 0}</b>{APP_STATUS[k].label}</span>
            </button>
          ))}
        </div>
      )}
      {data && list.length === 0 && <Empty icon="clipboard-list">No appraisals yet. Start them for the whole staff: each person rates themselves, their appraiser reviews, and both sign.</Empty>}
      <div className="app-list">
        {rows.map((a) => {
          const st = APP_STATUS[a.status];
          const prog = a.goals.length ? Math.round(a.goals.reduce((s, g) => s + g.progress, 0) / a.goals.length) : null;
          return (
            <button key={a.id} className="app-item" onClick={() => setOpen(a.id)}>
              <PersonLine p={a.person} />
              <span className="app-appraiser muted small"><Icon name="user-check" size={13} />{a.appraiser || "No appraiser"}</span>
              <span className="hue-chip" style={hue(st.hue)}><Icon name={st.icon} size={12} />{st.label}</span>
              <span className="app-goals" title="Goal progress">{prog != null ? <><span className="mini-bar"><i style={{ width: `${prog}%` }} /></span>{a.goals.length} goals</> : <span className="muted small">No goals</span>}</span>
              <span>{a.overall ? <LevelChip v={a.overall} /> : <span className="muted small">–</span>}</span>
            </button>
          );
        })}
      </div>
      {open && <AppraisalModal id={open} onClose={() => setOpen(null)} onChanged={load} />}
      {starting && <StartAppraisals schoolId={schoolId} onClose={() => setStarting(false)} onDone={(p) => { setStarting(false); setPeriod(p); load(); }} />}
    </section>
  );
}

function StartAppraisals({ schoolId, onClose, onDone }: { schoolId: string; onClose: () => void; onDone: (p: string) => void }) {
  const y = new Date().getMonth() >= 8 ? new Date().getFullYear() : new Date().getFullYear() - 1;
  const [label, setLabel] = useState(`${y}/${y + 1}`);
  const [due, setDue] = useState("");
  const [result, setResult] = useState<{ started: number; already: number } | null>(null);
  const [busy, error, run] = useBusy();
  return (
    <Modal title="Start appraisals" onClose={onClose}>
      {result ? (
        <div className="stack">
          <p className="day-banner" style={hue("green")}><Icon name="circle-check" size={18} />Started {result.started} appraisals{result.already ? ` (${result.already} already had one)` : ""}. Everyone now sees “Self-review” on their page.</p>
          <div className="row"><span className="grow" /><button className="primary" onClick={() => onDone(label)}>Done</button></div>
        </div>
      ) : (
        <form className="stack" onSubmit={(e: FormEvent) => { e.preventDefault(); run(async () => setResult(await grow.startAppraisals(schoolId, { period_label: label, due_on: due || null }))); }}>
          <p className="small">Each staff member gets an appraisal. Their appraiser is chosen for them: the head of their unit, else their head of department, else the principal. You can change it afterwards.</p>
          <div className="row wrap">
            <Field label="Year or term"><input required minLength={3} value={label} onChange={(e) => setLabel(e.target.value)} /></Field>
            <Field label="Finish by (optional)"><input type="date" value={due} onChange={(e) => setDue(e.target.value)} /></Field>
          </div>
          {error && <p className="error">{error}</p>}
          <div className="row"><span className="grow" /><button type="button" onClick={onClose}>Cancel</button><button className="primary" disabled={busy}>Start for all staff</button></div>
        </form>
      )}
    </Modal>
  );
}

// ---------------- Training ----------------

function TrainingTab({ schoolId }: { schoolId: string }) {
  const { people } = usePeople(schoolId);
  const [list, setList] = useState<Cpd[] | null>(null);
  const [target, setTarget] = useState(30);
  const [adding, setAdding] = useState<"me" | "many" | null>(null);
  const [editing, setEditing] = useState<Cpd | null>(null);
  const [view, setView] = useState<"people" | "records">("people");
  const load = useCallback(() => {
    grow.cpd(schoolId).then(setList).catch(() => setList([]));
    grow.settings(schoolId).then((s) => setTarget(s.cpd_target_hours)).catch(() => {});
  }, [schoolId]);
  useEffect(load, [load]);
  const yearStart = (() => { const d = new Date(); const y = d.getMonth() >= 8 ? d.getFullYear() : d.getFullYear() - 1; return `${y}-09-01`; })();
  const per = useMemo(() => {
    const m = new Map<string, { hours: number; n: number }>();
    for (const c of list ?? []) if (c.on_date >= yearStart) { const x = m.get(c.person.user_id) ?? { hours: 0, n: 0 }; x.hours += c.hours; x.n += 1; m.set(c.person.user_id, x); }
    return people.map((p) => ({ p, ...(m.get(p.user_id) ?? { hours: 0, n: 0 }) })).sort((a, b) => b.hours - a.hours);
  }, [list, people, yearStart]);
  const kinds = useMemo(() => {
    const m: Record<string, number> = {};
    for (const c of list ?? []) if (c.on_date >= yearStart) m[c.kind] = (m[c.kind] ?? 0) + c.hours;
    return Object.entries(m).sort((a, b) => b[1] - a[1]);
  }, [list, yearStart]);
  const total = kinds.reduce((s, [, h]) => s + h, 0);
  return (
    <section className="stack">
      <div className="day-toolbar">
        <div className="segmented small-seg">
          <button className={view === "people" ? "on" : ""} onClick={() => setView("people")}>By person</button>
          <button className={view === "records" ? "on" : ""} onClick={() => setView("records")}>All records</button>
        </div>
        <span className="grow" />
        <button className="with-icon" onClick={() => setAdding("me")}><Icon name="plus" size={16} />Log my training</button>
        <button className="primary with-icon" onClick={() => setAdding("many")}><Icon name="users" size={16} />Record training for staff</button>
      </div>
      {total > 0 && (
        <div className="kind-strip">
          {kinds.map(([k, h]) => { const l = CPD_LOOK[k] ?? CPD_LOOK.other; return (
            <span key={k} style={{ ...hue(l.hue), flexGrow: h }} title={`${k}: ${h} h`}><Icon name={l.icon} size={14} />{Math.round((h / total) * 100) >= 8 && `${Math.round(h)} h`}</span>); })}
        </div>
      )}
      {view === "people" ? (
        <div className="cpd-people">
          {per.map(({ p, hours, n }) => (
            <a key={p.user_id} className="cpd-person" href={href({ page: "passport", school: schoolId, id: p.user_id })} style={hue(hours >= target ? "green" : hours >= target / 2 ? "teal" : hours ? "amber" : "red")}>
              <Ring value={hours} max={target} size={46} stroke={6} label={<b>{Math.round(hours)}</b>} />
              <span className="g-person-text"><strong>{p.name}</strong><span className="muted small">{n} record{n === 1 ? "" : "s"} · {hours >= target ? "target reached" : `${Math.max(0, target - hours)} h to go`}</span></span>
            </a>
          ))}
        </div>
      ) : (
        <div className="cpd-list">
          {(list ?? []).slice(0, 300).map((c) => { const l = CPD_LOOK[c.kind] ?? CPD_LOOK.other; return (
            <div key={c.id} className="cpd-row" style={hue(l.hue)}>
              <Glyph icon={l.icon} hue={l.hue} size={34} />
              <span className="cpd-main"><strong>{c.title}</strong><span className="muted small">{c.person.name} · {c.kind_label}{c.provider ? ` · ${c.provider}` : ""} · {niceDate(c.on_date)}</span>
                {c.impact && <span className="cpd-impact"><Icon name="sprout" size={13} />{c.impact}</span>}</span>
              <b className="cpd-hours">{c.hours} h</b>
              <button className={`verify${c.verified ? " on" : ""}`} title={c.verified ? `Confirmed by ${c.verified_by}` : "Confirm this training"}
                onClick={async () => { await grow.verifyCpd(c.id); load(); }}><Icon name={c.verified ? "circle-check" : "check"} size={15} />{c.verified ? "Confirmed" : "Confirm"}</button>
              {c.can_edit && <button className="icon-button" aria-label="Edit" onClick={() => setEditing(c)}><Icon name="edit" size={15} /></button>}
            </div>); })}
        </div>
      )}
      {adding && <CpdForm schoolId={schoolId} people={people} many={adding === "many"} onClose={() => setAdding(null)} onDone={() => { setAdding(null); load(); }} />}
      {editing && <CpdForm schoolId={schoolId} record={editing} onClose={() => setEditing(null)} onDone={() => { setEditing(null); load(); }} />}
    </section>
  );
}

// ---------------- Mentoring ----------------

function MentoringTab({ schoolId }: { schoolId: string }) {
  const { people } = usePeople(schoolId);
  const [list, setList] = useState<Mentoring[] | null>(null);
  const [adding, setAdding] = useState(false);
  const [open, setOpen] = useState<Mentoring | null>(null);
  const load = useCallback(() => { grow.mentoring(schoolId).then(setList).catch(() => setList([])); }, [schoolId]);
  useEffect(load, [load]);
  return (
    <section className="stack">
      <div className="day-toolbar">
        <p className="muted small grow">Pair a colleague who is strong in an area with one who wants to grow in it. Open a person's growth passport to see suggested mentors.</p>
        <button className="primary with-icon" onClick={() => setAdding(true)}><Icon name="handshake" size={16} />Start mentoring</button>
      </div>
      {list && list.length === 0 && <Empty icon="handshake">No mentoring yet.</Empty>}
      <div className="mentor-grid">
        {(list ?? []).map((m) => (
          <button key={m.id} className={`mentor-card${m.status === "ended" ? " ended" : ""}`} style={hue("pink")} onClick={() => setOpen(m)}>
            <span className="mentor-faces"><Avatar name={m.mentor.name} size={44} /><span className="mentor-link"><Icon name="handshake" size={16} /></span><Avatar name={m.mentee.name} size={44} /></span>
            <strong>{m.focus}</strong>
            <span className="small">{m.mentor.name} <span className="muted">mentors</span> {m.mentee.name}</span>
            <span className="muted small">{m.meetings.length} meeting{m.meetings.length === 1 ? "" : "s"} · since {niceDate(m.started_on, { day: "numeric", month: "short" })}{m.status === "ended" ? " · ended" : ""}</span>
          </button>
        ))}
      </div>
      {adding && <MentoringForm schoolId={schoolId} people={people} onClose={() => setAdding(false)} onDone={() => { setAdding(false); load(); }} />}
      {open && <MentoringView m={open} onClose={() => setOpen(null)} onChanged={(m) => { setOpen(m); load(); }} />}
    </section>
  );
}

// ---------------- Recognition ----------------

export function RecognitionTab({ schoolId, meId }: { schoolId: string; meId?: string }) {
  const { people } = usePeople(schoolId);
  const [list, setList] = useState<Kudos[] | null>(null);
  const [giving, setGiving] = useState(false);
  const [badge, setBadge] = useState("all");
  const load = useCallback(() => { grow.kudos(schoolId, undefined, 200).then(setList).catch(() => setList([])); }, [schoolId]);
  useEffect(load, [load]);
  const counts = (list ?? []).reduce<Record<string, number>>((a, k) => ({ ...a, [k.badge]: (a[k.badge] ?? 0) + 1 }), {});
  const rows = (list ?? []).filter((k) => badge === "all" || k.badge === badge);
  return (
    <section className="stack">
      <div className="kudos-hero">
        <div><h3>Recognition wall</h3><p>Notice the good work around you. A short, specific thank-you means more than you think.</p></div>
        <button className="primary with-icon" onClick={() => setGiving(true)}><Icon name="heart" size={16} />Give kudos</button>
      </div>
      <div className="day-filters">
        <button className={`hue-chip pick-chip${badge === "all" ? " on" : ""}`} style={hue("blue")} onClick={() => setBadge("all")}>All <b>{list?.length ?? 0}</b></button>
        {Object.entries(BADGE_LOOK).filter(([k]) => counts[k]).map(([k, l]) => (
          <button key={k} className={`hue-chip pick-chip${badge === k ? " on" : ""}`} style={hue(l.hue)} onClick={() => setBadge(k)}>{l.emoji} {list?.find((x) => x.badge === k)?.badge_label} <b>{counts[k]}</b></button>
        ))}
      </div>
      <div className="kudos-wall">
        {rows.map((k) => <KudosItem key={k.id} k={k} onChanged={(n) => setList((l) => (n ? l!.map((x) => (x.id === n.id ? n : x)) : l!.filter((x) => x.id !== k.id)))} />)}
      </div>
      {list && list.length === 0 && <Empty icon="trophy">No kudos yet. Be the first!</Empty>}
      {giving && <KudosForm schoolId={schoolId} people={people} me={meId ?? ""} onClose={() => setGiving(false)} onDone={() => { setGiving(false); load(); }} />}
    </section>
  );
}

// ---------------- Strengths map ----------------

export function StrengthsTab({ schoolId }: { schoolId: string }) {
  const [map, setMap] = useState<StrengthMap | null>(null);
  const [q, setQ] = useState("");
  const [skill, setSkill] = useState<string | null>(null);
  const load = useCallback(() => { grow.strengths(schoolId).then(setMap).catch(() => {}); }, [schoolId]);
  useEffect(load, [load]);
  if (!map) return <p className="muted">Loading…</p>;
  const groups = Object.keys(SKILL_GROUP_LOOK);
  const found = map.skills.filter((s) => !q || s.skill.toLowerCase().includes(q.toLowerCase()) || s.people.some((p) => p.name.toLowerCase().includes(q.toLowerCase())));
  const sel = map.skills.find((s) => s.skill === skill);
  const max = Math.max(1, ...map.skills.map((s) => s.people.length));
  return (
    <section className="stack">
      <div className="who-can">
        <Icon name="search" size={20} />
        <input placeholder="Who can… coach football? speak Hausa? set exam questions?" value={q} onChange={(e) => setQ(e.target.value)} />
      </div>
      <div className="strength-layout">
        <div className="strength-groups">
          {groups.map((g) => {
            const items = found.filter((s) => s.group === g);
            if (!items.length) return null;
            const l = SKILL_GROUP_LOOK[g];
            return (
              <div key={g} className="strength-group" style={hue(l.hue)}>
                <h4 className="with-glyph"><Glyph icon={l.icon} hue={l.hue} size={28} />{g}</h4>
                <div className="skill-cloud">
                  {items.map((s) => (
                    <button key={s.skill} className={`skill-bubble${skill === s.skill ? " on" : ""}`} onClick={() => setSkill(s.skill)}
                      style={{ fontSize: `${12 + (s.people.length / max) * 6}px` }}>
                      {s.skill}<b>{s.people.length}</b>
                    </button>
                  ))}
                </div>
              </div>
            );
          })}
          {found.length === 0 && <Empty icon="star">Nobody has listed that yet.</Empty>}
        </div>
        <aside className="card strength-detail" style={hue(sel ? SKILL_GROUP_LOOK[sel.group]?.hue ?? "slate" : "slate")}>
          {!sel ? <Empty icon="star">Choose a strength to see who has it. Staff add their own strengths on their page; colleagues endorse them.</Empty> : (
            <>
              <h3>{sel.skill}</h3>
              <p className="muted small">{sel.people.length} {sel.people.length === 1 ? "person" : "people"} · most endorsed first</p>
              <ul className="strength-people">
                {sel.people.map((p) => (
                  <li key={p.id}>
                    <PersonLine p={p} schoolId={schoolId} />
                    <button className={`cheer${p.endorsed ? " on" : ""}`} disabled={p.mine} title={p.mine ? "That's you" : p.endorsed ? "Remove your endorsement" : "I can vouch for this"}
                      onClick={async () => { await grow.endorse(p.id); load(); }}><Icon name="thumbs-up" size={14} />{p.endorsements}</button>
                  </li>
                ))}
              </ul>
            </>
          )}
          {map.people_with_none.length > 0 && <p className="muted small">{map.people_with_none.length} staff haven't added any strengths yet.</p>}
        </aside>
      </div>
    </section>
  );
}

// ---------------- Wellbeing ----------------

function WellbeingTab({ schoolId }: { schoolId: string }) {
  const [w, setW] = useState<Wellbeing | null>(null);
  const [error, setError] = useState("");
  useEffect(() => { grow.wellbeing(schoolId).then(setW).catch((e) => setError(errorText(e))); }, [schoolId]);
  if (error) return <p className="error">{error}</p>;
  if (!w) return <p className="muted">Loading…</p>;
  const latest = [...w.weeks].reverse().find((x) => x.shown);
  const line = (k: "mood" | "workload" | "supported") => w.weeks.map((x) => x[k]);
  return (
    <section className="stack">
      <p className="day-banner" style={hue("indigo")}><Icon name="shield-check" size={18} />
        Private by design: you only ever see totals. A week or group with fewer than {w.min_group} answers is hidden, and nobody sees anyone's own answers or notes.
        People who tick “I'd like a chat” are the only names shown.</p>
      <div className="stat-strip">
        {(["mood", "workload", "supported"] as const).map((k) => {
          const v = latest?.[k] ?? null;
          const look = k === "mood" ? { icon: "heart", hue: "rose" as const, label: "Mood" } : k === "workload" ? { icon: "scale", hue: "amber" as const, label: "Workload (5 = too much)" } : { icon: "handshake", hue: "teal" as const, label: "Feel supported" };
          return <div key={k} className="stat-tile" style={hue(look.hue)}><Glyph icon={look.icon} hue={look.hue} size={44} /><div className="stat-text"><strong>{v != null ? v.toFixed(1) : "–"}<small> / 5</small></strong><span>{look.label}</span><span className="stat-note">latest week shown</span></div></div>;
        })}
        <div className="stat-tile" style={hue("blue")}><Glyph icon="users" hue="blue" size={44} /><div className="stat-text"><strong>{latest?.answers ?? 0}<small> of {w.staff}</small></strong><span>Answered</span><span className="stat-note">in that week</span></div></div>
      </div>
      <div className="growth-grid">
        <section className="card g-card wide" style={hue("rose")}>
          <h3 className="with-glyph"><Glyph icon="heart-pulse" hue="rose" size={32} />Mood each week</h3>
          <MoodBars weeks={w.weeks} />
          <div className="well-lines">
            {(["workload", "supported"] as const).map((k) => (
              <div key={k} className="well-line" style={hue(k === "workload" ? "amber" : "teal")}>
                <span>{k === "workload" ? "Workload" : "Feel supported"}</span>
                <span className="well-dots">{line(k).map((v, i) => <i key={i} style={{ height: v ? `${(v / 5) * 100}%` : "6%", opacity: v ? 1 : 0.25 }} title={v ? v.toFixed(1) : "hidden"} />)}</span>
              </div>
            ))}
          </div>
        </section>
        {latest && (
          <section className="card g-card" style={hue("violet")}>
            <h3 className="with-glyph"><Glyph icon="gauge" hue="violet" size={32} />How people feel this week</h3>
            <div className="mood-dist">
              {[...MOOD].reverse().map((m) => { const n = latest.moods[String(m.v)] ?? 0; return (
                <div key={m.v} className="mood-row" style={hue(m.hue)}><span>{m.emoji} {m.label}</span><span className="mood-row-bar"><i style={{ width: `${latest.answers ? (n / latest.answers) * 100 : 0}%` }} /></span><b>{n}</b></div>); })}
            </div>
          </section>
        )}
        <section className="card g-card" style={hue("teal")}>
          <h3 className="with-glyph"><Glyph icon="network" hue="teal" size={32} />By department (last 4 weeks)</h3>
          {w.by_group.length === 0 ? <p className="muted small">Shown once a department has at least {w.min_group * 2} answers.</p> : (
            <ul className="by-group">{w.by_group.map((g) => { const m = MOOD[Math.round(g.mood) - 1]; return (
              <li key={g.name} style={hue(m.hue)}><span>{m.emoji}</span><strong>{g.name}</strong><span className="muted small">mood {g.mood.toFixed(1)} · workload {g.workload.toFixed(1)} · {g.answers} answers</span></li>); })}</ul>
          )}
        </section>
        <section className="card g-card" style={hue("pink")}>
          <h3 className="with-glyph"><Glyph icon="message" hue="pink" size={32} />Asked for a chat</h3>
          {w.chats.length === 0 ? <p className="muted small">Nobody in the last two weeks.</p> : (
            <ul className="strength-people">{w.chats.map((c, i) => <li key={i}><PersonLine p={c.person} schoolId={schoolId} sub={`Week of ${niceDate(c.week_start, { day: "numeric", month: "short" })}`} /></li>)}</ul>
          )}
          <p className="muted small">They chose to share their name so someone can check in. Please reach out kindly and privately.</p>
        </section>
      </div>
    </section>
  );
}

// ---------------- Workload ----------------

function WorkloadTab({ schoolId }: { schoolId: string }) {
  const [d, setD] = useState<{ limit: number; average: number; rows: LoadRow[] } | null>(null);
  const [q, setQ] = useState("");
  useEffect(() => { grow.workload(schoolId).then(setD).catch(() => {}); }, [schoolId]);
  if (!d) return <p className="muted">Loading…</p>;
  const max = Math.max(d.limit * 1.25, ...d.rows.map((r) => r.points));
  const parts: [keyof LoadRow, string, string, number][] = [["classes", "Classes", "sky", 3], ["groups", "Elective groups", "violet", 3], ["form", "Own class", "orange", 2],
    ["lead", "Leading", "amber", 1], ["duties", "Duties this week", "teal", 1], ["mentoring", "Mentoring", "pink", 1]];
  const rows = d.rows.filter((r) => !q || r.name.toLowerCase().includes(q.toLowerCase()) || (r.job_title ?? "").toLowerCase().includes(q.toLowerCase()));
  const lv = { over: { label: "Overloaded", hue: "red" }, high: { label: "Busy", hue: "amber" }, ok: { label: "Fine", hue: "green" }, light: { label: "Light", hue: "sky" } } as const;
  return (
    <section className="stack">
      <div className="day-toolbar">
        <input className="day-search" placeholder="Find…" value={q} onChange={(e) => setQ(e.target.value)} />
        <span className="grow" />
        <span className="muted small">Limit {d.limit} points · teachers' average {d.average}</span>
      </div>
      <div className="load-key">{parts.map(([k, l, h, w]) => <span key={k} style={hue(h)}><i />{l}{w > 1 ? ` (×${w})` : ""}</span>)}</div>
      <p className="muted small">Points are a rough guide until timetables arrive: each class or group taught counts 3, a class of your own 2, heading a department 3 (a unit 2), each duty this week 1, each person you mentor 1.</p>
      <div className="load-list">
        {rows.map((r) => (
          <a key={r.user_id} className="load-row" href={href({ page: "passport", school: schoolId, id: r.user_id })}>
            <PersonLine p={r} />
            <span className="load-bar">
              {parts.map(([k, , h, w]) => { const v = (r[k] as number) * w; return v ? <i key={k} style={{ ...hue(h), width: `${(v / max) * 100}%` }} title={`${k}: ${v}`} /> : null; })}
              <span className="load-limit" style={{ left: `${(d.limit / max) * 100}%` }} title={`Limit ${d.limit}`} />
            </span>
            <b className="load-points">{r.points}</b>
            <span className="hue-chip" style={hue(lv[r.level].hue)}>{lv[r.level].label}</span>
          </a>
        ))}
      </div>
    </section>
  );
}

// ---------------- Settings ----------------

function SettingsTab({ schoolId }: { schoolId: string }) {
  const [s, setS] = useState<GrowthSettings | null>(null);
  const [saved, setSaved] = useState(false);
  const [busy, error, run] = useBusy();
  useEffect(() => { grow.settings(schoolId).then(setS).catch(() => {}); }, [schoolId]);
  if (!s) return <p className="muted">Loading…</p>;
  return (
    <form className="card settings-card growth-settings" onSubmit={(e) => { e.preventDefault(); run(async () => { setS(await grow.saveSettings(schoolId, s)); setSaved(true); }); }}>
      <h3 className="with-glyph"><Glyph icon="settings" hue="slate" size={34} />Growth settings</h3>
      <Field label="Training hours each person should reach in a school year"><input type="number" min={0} max={500} value={s.cpd_target_hours} onChange={(e) => { setS({ ...s, cpd_target_hours: Number(e.target.value) }); setSaved(false); }} /></Field>
      <Field label="Workload limit (points)" hint="Above this, someone shows as overloaded. About the number of periods a week."><input type="number" min={5} max={100} value={s.workload_limit} onChange={(e) => { setS({ ...s, workload_limit: Number(e.target.value) }); setSaved(false); }} /></Field>
      <Field label="Observations each teacher should have per term"><input type="number" min={0} max={10} value={s.observations_per_term} onChange={(e) => { setS({ ...s, observations_per_term: Number(e.target.value) }); setSaved(false); }} /></Field>
      {error && <p className="error">{error}</p>}
      <div className="row"><span className="grow" />{saved && <span className="saved-note"><Icon name="check" size={15} />Saved</span>}<button className="primary" disabled={busy}>Save</button></div>
    </form>
  );
}
