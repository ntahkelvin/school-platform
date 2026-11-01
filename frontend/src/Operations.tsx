// "Operations" in the school menu: the non-teaching side of the school at a glance,
// plus the helpdesk, gate, sick bay, incidents and who works on each desk.
import { useCallback, useEffect, useState } from "react";
import type { Me } from "./api";
import { GateBoard } from "./GateDesk";
import { grow, type Card } from "./growthApi";
import { InsightList, useBusy } from "./GrowthBits";
import { HelpdeskBoard, useOpsMeta } from "./Helpdesk";
import Icon from "./Icon";
import { IncidentsBoard } from "./Incidents";
import Layout from "./Layout";
import { api } from "./api";
import { ops, type Desk, type OpsOverview } from "./opsApi";
import { href } from "./router";
import { ClinicBoard } from "./SickBay";
import { Avatar, Empty, Glyph, hue, Modal } from "./ui";
import { niceDate } from "./dayApi";
import { KitchenBoard } from "./Kitchen";
import { logi, naira, type LogiOverview } from "./logiApi";
import { StoreBoard } from "./Store";
import { TransportBoard } from "./Transport";
import { AskAccess } from "./Rights";
import { CleaningBoard } from "./Cleaning";
import LibraryPage from "./Library";
import { useCan } from "./rightsApi";

type Seg = "overview" | "helpdesk" | "gate" | "sickbay" | "incidents" | "kitchen" | "transport" | "store" | "cleaning" | "teams";
const SEGS: { key: Seg; label: string; icon: string }[] = [
  { key: "overview", label: "Overview", icon: "sparkle" }, { key: "helpdesk", label: "Helpdesk", icon: "wrench" },
  { key: "gate", label: "Gate", icon: "shield" }, { key: "sickbay", label: "Sick bay", icon: "stethoscope" },
  { key: "incidents", label: "Incidents", icon: "flame" },
  { key: "kitchen", label: "Kitchen", icon: "cooking-pot" }, { key: "transport", label: "Transport", icon: "bus" }, { key: "store", label: "Store", icon: "store" }, { key: "cleaning", label: "Cleaning", icon: "sparkle" },
  { key: "teams", label: "Teams", icon: "users" },
];

export default function OperationsPage({ schoolId }: { schoolId: string }) {
  const [seg, setSeg] = useState<Seg>(() => { try { return (sessionStorage.getItem("ops-seg") as Seg) || "overview"; } catch { return "overview"; } });
  const pick = (s: Seg) => { setSeg(s); try { sessionStorage.setItem("ops-seg", s); } catch { /* private mode */ } };
  const can = useCan(schoolId);
  return (
    <div className="growth">
      <div className="segmented day-segs" role="tablist">
        {SEGS.map((s) => <button key={s.key} role="tab" aria-selected={seg === s.key} className={seg === s.key ? "on" : ""} onClick={() => pick(s.key)}><Icon name={s.icon} size={16} />{s.label}</button>)}
      </div>
      {seg === "overview" && <OpsOverviewTab schoolId={schoolId} go={pick} />}
      {seg === "helpdesk" && <HelpdeskBoard schoolId={schoolId} manager />}
      {seg === "gate" && <GateBoard schoolId={schoolId} />}
      {seg === "sickbay" && (can("private.health") ? <ClinicBoard schoolId={schoolId} /> : <AskAccess schoolId={schoolId} right="private.health" what="Medical records" />)}
      {seg === "incidents" && <>{!can("private.safeguarding") && <AskAccess schoolId={schoolId} right="private.safeguarding" what="Incident reports" />}<IncidentsBoard schoolId={schoolId} /></>}
      {seg === "kitchen" && <KitchenBoard schoolId={schoolId} />}
      {seg === "transport" && <TransportBoard schoolId={schoolId} />}
      {seg === "store" && <StoreBoard schoolId={schoolId} store="main" />}
      {seg === "cleaning" && <CleaningBoard schoolId={schoolId} />}
      {seg === "teams" && <TeamsTab schoolId={schoolId} />}
    </div>
  );
}

function OpsOverviewTab({ schoolId, go }: { schoolId: string; go: (s: Seg) => void }) {
  const meta = useOpsMeta();
  const [o, setO] = useState<OpsOverview | null>(null);
  const [l, setL] = useState<LogiOverview | null>(null);
  useEffect(() => { ops.overview(schoolId).then(setO).catch(() => {}); logi.overview(schoolId).then(setL).catch(() => {}); }, [schoolId]);
  if (!o || !meta) return <p className="muted">Loading…</p>;
  const open = Object.values(o.tickets).reduce((a, t) => a + t.open, 0);
  const overdue = Object.values(o.tickets).reduce((a, t) => a + t.overdue, 0);
  const max = Math.max(1, ...o.clinic.trend.map((t) => t.visits));
  return (
    <section className="stack">
      <OpsSetup schoolId={schoolId} go={go} />
      <div className="stat-strip ops-stats">
        <button className="stat-tile as-button" style={hue("orange")} onClick={() => go("helpdesk")}><Glyph icon="wrench" hue="orange" size={44} /><div className="stat-text"><strong>{open}</strong><span>Open jobs</span><span className="stat-note">{overdue} overdue</span></div></button>
        <button className="stat-tile as-button" style={hue("indigo")} onClick={() => go("gate")}><Glyph icon="shield" hue="indigo" size={44} /><div className="stat-text"><strong>{o.gate.inside}</strong><span>Visitors inside</span><span className="stat-note">{o.gate.out} students out · {o.gate.visitors_today} visitors today</span></div></button>
        <button className="stat-tile as-button" style={hue("rose")} onClick={() => go("sickbay")}><Glyph icon="stethoscope" hue="rose" size={44} /><div className="stat-text"><strong>{o.clinic.today}</strong><span>Sick bay today</span><span className="stat-note">{o.clinic.lying_in} kept in · {o.clinic.low_stock} stock warnings</span></div></button>
        <button className="stat-tile as-button" style={hue(o.incidents.serious ? "red" : "amber")} onClick={() => go("incidents")}><Glyph icon="flame" hue={o.incidents.serious ? "red" : "amber"} size={44} /><div className="stat-text"><strong>{o.incidents.open}</strong><span>Open incidents</span><span className="stat-note">{o.incidents.serious} serious</span></div></button>
      </div>
      <section className="card g-card" style={hue("violet")}>
        <h3 className="with-glyph"><Glyph icon="sparkle" hue="violet" size={32} />What needs attention<span className="ai-tag">Offline insights</span></h3>
        <InsightList items={[...o.insights, ...(l?.insights ?? [])]} schoolId={schoolId} />
      </section>
      {l && (
        <div className="stat-strip ops-stats">
          <button className="stat-tile as-button" style={hue("lime")} onClick={() => go("kitchen")}><Glyph icon="cooking-pot" hue="lime" size={44} /><div className="stat-text"><strong>{l.meals.reduce((a, m) => Math.max(a, m.expected), 0)}</strong><span>Eating today</span><span className="stat-note">{l.meals.find((m) => m.dishes)?.dishes ?? "Menu not planned"} · {l.diets} special diets</span></div></button>
          <button className="stat-tile as-button" style={hue("teal")} onClick={() => go("transport")}><Glyph icon="bus" hue="teal" size={44} /><div className="stat-text"><strong>{l.fleet.checked}/{l.fleet.vehicles}</strong><span>Vehicles checked</span><span className="stat-note">{l.fleet.out} out now · fuel {naira(l.fleet.fuel_month)} this month</span></div></button>
          <button className="stat-tile as-button" style={hue(l.store.low + l.food.low ? "amber" : "blue")} onClick={() => go("store")}><Glyph icon="store" hue={l.store.low + l.food.low ? "amber" : "blue"} size={44} /><div className="stat-text"><strong>{l.store.low + l.food.low}</strong><span>Running low</span><span className="stat-note">Store {naira(l.store.value)} · food {naira(l.food.value)}</span></div></button>
        </div>
      )}
      <div className="growth-grid">
        {Object.entries(o.tickets).filter(([k]) => !["gate", "sickbay"].includes(k)).map(([k, t]) => { const d = meta.desks[k]; return (
          <section key={k} className="card g-card desk-card" style={hue(d.hue)}>
            <h3 className="with-glyph"><Glyph icon={d.icon} hue={d.hue} size={32} />{d.label}</h3>
            <div className="desk-figs">
              <span><b>{t.open}</b>open</span><span className={t.overdue ? "bad" : ""}><b>{t.overdue}</b>overdue</span>
              <span><b>{t.done_30}</b>fixed (30 days)</span><span><b>{t.avg_hours != null ? (t.avg_hours < 24 ? `${Math.round(t.avg_hours)}h` : `${Math.round(t.avg_hours / 24)}d`) : "–"}</b>to fix</span>
              <span><b>{t.rating ?? "–"}</b>★ rating</span>
            </div>
            <a className="text-link" href={href({ page: "desk", school: schoolId, desk: k })}>Open the desk →</a>
          </section>); })}
        <section className="card g-card" style={hue("rose")}>
          <h3 className="with-glyph"><Glyph icon="chart" hue="rose" size={32} />Sick bay, last 14 days</h3>
          <div className="clinic-bars">
            {o.clinic.trend.map((t) => (
              <div key={t.date} className="clinic-col" title={`${niceDate(t.date)}: ${t.visits} visits, ${t.fever} with fever`}>
                <span className="clinic-track"><i className="all" style={{ height: `${(t.visits / max) * 100}%` }} /><i className="fever" style={{ height: `${(t.fever / max) * 100}%` }} /></span>
                <small>{niceDate(t.date, { day: "numeric" })}</small>
              </div>
            ))}
          </div>
          <p className="radar-key"><span className="bar-all" />All visits<span className="bar-fever" />With fever</p>
        </section>
      </div>
    </section>
  );
}

function TeamsTab({ schoolId }: { schoolId: string }) {
  const canChange = useCan(schoolId)("operations.change");
  const [desks, setDesks] = useState<Desk[] | null>(null);
  const [editing, setEditing] = useState<Desk | null>(null);
  const load = useCallback(() => { ops.desks(schoolId).then(setDesks).catch(() => {}); }, [schoolId]);
  useEffect(load, [load]);
  return (
    <section className="stack">
      <p className="muted small">Each desk is a team. Members see that desk's work on their own page and can open the full-screen desk (for example on a tablet at the gate). The principal, vice principals and IT team can use every desk.</p>
      <div className="growth-grid">
        {(desks ?? []).map((d) => (
          <section key={d.key} className="card g-card" style={hue(d.hue)}>
            <h3 className="with-glyph"><Glyph icon={d.icon} hue={d.hue} size={32} />{d.label}<span className="count">{d.members.length}</span></h3>
            {d.members.length === 0 ? <Empty icon={d.icon}>Nobody yet.</Empty> : (
              <ul className="strength-people">{d.members.map((m) => (
                <li key={m.user_id}><span className="who-inline"><Avatar name={m.name ?? "?"} size={30} /><span><strong>{m.name}</strong><span className="muted small block">{m.job_title}</span></span></span>
                  {m.lead && <span className="hue-chip" style={hue(d.hue)}>Lead</span>}</li>))}</ul>
            )}
            <div className="row"><a className="text-link" href={href({ page: "desk", school: schoolId, desk: d.key })}>Open desk</a><span className="grow" />{canChange && <button className="with-icon" onClick={() => setEditing(d)}><Icon name="edit" size={15} />Change</button>}</div>
          </section>
        ))}
      </div>
      {editing && <DeskEditor schoolId={schoolId} desk={editing} onClose={() => setEditing(null)} onDone={(x) => { setDesks(x); setEditing(null); }} />}
    </section>
  );
}

function DeskEditor({ schoolId, desk, onClose, onDone }: { schoolId: string; desk: Desk; onClose: () => void; onDone: (d: Desk[]) => void }) {
  const [people, setPeople] = useState<Card[]>([]);
  const [chosen, setChosen] = useState<Set<string>>(new Set(desk.members.map((m) => m.user_id)));
  const [leads, setLeads] = useState<Set<string>>(new Set(desk.members.filter((m) => m.lead).map((m) => m.user_id)));
  const [q, setQ] = useState("");
  const [busy, error, run] = useBusy();
  useEffect(() => { grow.people(schoolId).then((r) => setPeople(r.people)).catch(() => {}); }, [schoolId]);
  const shown = people.filter((p) => chosen.has(p.user_id) || !q || `${p.name} ${p.job_title ?? ""}`.toLowerCase().includes(q.toLowerCase()))
    .sort((a, b) => Number(chosen.has(b.user_id)) - Number(chosen.has(a.user_id)) || a.name.localeCompare(b.name));
  return (
    <Modal title={desk.label} onClose={onClose}>
      <input placeholder="Find staff…" value={q} onChange={(e) => setQ(e.target.value)} />
      <ul className="desk-pick">
        {shown.slice(0, 80).map((p) => (
          <li key={p.user_id} className={chosen.has(p.user_id) ? "on" : ""}>
            <label className="check"><input type="checkbox" checked={chosen.has(p.user_id)} onChange={(e) => { const s = new Set(chosen); if (e.target.checked) s.add(p.user_id); else s.delete(p.user_id); setChosen(s); }} />
              <span><strong>{p.name}</strong> <span className="muted small">{p.job_title}</span></span></label>
            {chosen.has(p.user_id) && <label className="check small"><input type="checkbox" checked={leads.has(p.user_id)} onChange={(e) => { const s = new Set(leads); if (e.target.checked) s.add(p.user_id); else s.delete(p.user_id); setLeads(s); }} />Lead</label>}
          </li>
        ))}
      </ul>
      {error && <p className="error">{error}</p>}
      <div className="row"><span className="muted small">{chosen.size} on this desk</span><span className="grow" /><button onClick={onClose}>Cancel</button>
        <button className="primary" disabled={busy} onClick={() => run(async () => onDone(await ops.setDesk(schoolId, desk.key, [...chosen], [...leads].filter((x) => chosen.has(x)))))}>Save</button></div>
    </Modal>
  );
}

/** Full-screen desk for the people who work it: the gate tablet, the sick bay, the maintenance team's jobs. */
export function DeskPage({ me, onLogout, schoolId, desk }: { me: Me; onLogout: () => void; schoolId: string; desk: string }) {
  const meta = useOpsMeta();
  const d = meta?.desks[desk];
  return (
    <Layout wide me={me} onLogout={onLogout} crumbs={[{ label: "Home", href: "#/" }, { label: d?.label ?? "Desk" }]}>
      <div className="desk-page" style={hue(d?.hue ?? "slate")}>
        <h1 className="desk-title"><Glyph icon={d?.icon ?? "wrench"} hue={d?.hue ?? "slate"} size={48} />{d?.label ?? "Desk"}</h1>
        {desk === "gate" ? <GateBoard schoolId={schoolId} big /> : desk === "sickbay" ? <ClinicBoard schoolId={schoolId} />
          : desk === "kitchen" ? <KitchenBoard schoolId={schoolId} />
          : desk === "library" ? <LibraryPage schoolId={schoolId} />
          : desk === "maintenance" ? <><HelpdeskBoard schoolId={schoolId} desk={desk} /><h3 className="section-title">Cleaning</h3><CleaningBoard schoolId={schoolId} /></>
          : desk === "transport" ? <><TransportBoard schoolId={schoolId} /><h3 className="section-title">Transport jobs</h3><HelpdeskBoard schoolId={schoolId} desk={desk} /></>
          : desk === "store" ? <><StoreBoard schoolId={schoolId} store="main" /><h3 className="section-title">Requests for the store</h3><HelpdeskBoard schoolId={schoolId} desk={desk} /></>
          : <HelpdeskBoard schoolId={schoolId} desk={desk} />}
      </div>
    </Layout>
  );
}


// ---------- Getting operations set up ----------

interface SetupStep { key: string; label: string; icon: string; done: boolean; optional?: boolean; detail: string; hint: string; go?: string; tab?: string }

function OpsSetup({ schoolId, go }: { schoolId: string; go: (s: Seg) => void }) {
  const [st, setSt] = useState<{ steps: SetupStep[]; done: number; total: number } | null>(null);
  const [open, setOpen] = useState<boolean | null>(null);
  useEffect(() => { api.raw<{ steps: SetupStep[]; done: number; total: number }>("GET", `/api/schools/${schoolId}/ops-setup`).then(setSt).catch(() => {}); }, [schoolId]);
  if (!st) return null;
  const finished = st.done >= st.total;
  const show = open ?? !finished;
  const pct = Math.round((st.done / Math.max(1, st.total)) * 100);
  return (
    <section className={`card g-card ops-setup${finished ? " finished" : ""}`} style={hue(finished ? "green" : "violet")}>
      <button className="setup-head" onClick={() => setOpen(!show)} aria-expanded={show}>
        <Glyph icon={finished ? "circle-check" : "rocket"} hue={finished ? "green" : "violet"} size={36} />
        <span className="grow"><strong>{finished ? "Operations are set up" : "Set up operations, step by step"}</strong>
          <small>{st.done} of {st.total} done{finished ? "" : ". Each step ticks itself off when it's in place."}</small></span>
        <span className="setup-ring" style={{ ["--pct" as string]: `${pct}%` }}><b>{pct}%</b></span>
        <Icon name={show ? "chevron-up" : "chevron-down"} size={18} />
      </button>
      {show && (
        <ol className="setup-steps">
          {st.steps.map((x, i) => (
            <li key={x.key} className={x.done ? "done" : x.optional ? "optional" : ""}>
              <span className="step-n">{x.done ? <Icon name="check" size={15} /> : i + 1}</span>
              <span className="grow"><strong>{x.label}</strong>{x.optional && !x.done && <span className="hue-chip" style={hue("slate")}>If needed</span>}
                <small className="block">{x.detail}</small>{!x.done && <small className="block muted">{x.hint}</small>}</span>
              {!x.done && (x.go ? <button className="with-icon small" onClick={() => go(x.go as Seg)}>Go<Icon name="chevron-right" size={14} /></button>
                : x.tab ? <a className="button small" href={href({ page: "school", id: schoolId, tab: x.tab as "facilities" })}>Go<Icon name="chevron-right" size={14} /></a> : null)}
            </li>
          ))}
        </ol>
      )}
    </section>
  );
}
