// Transport: vehicles (papers, daily checks, trips, fuel, servicing) and bus routes with the bus register.
import { useCallback, useEffect, useState, type FormEvent } from "react";
import { iso, niceDate } from "./dayApi";
import { grow, type Card } from "./growthApi";
import { InsightList, Spark, useBusy } from "./GrowthBits";
import { StudentPicker } from "./Helpdesk";
import Icon from "./Icon";
import { StudentLink } from "./StudentLink";
import { loadLogiMeta, logi, naira, type Fleet, type LogiMeta, type Register, type Route, type Stop, type Vehicle } from "./logiApi";
import { dayTime, hhmm, type StudentCard } from "./opsApi";
import { Avatar, Empty, Field, Glyph, hue, Modal } from "./ui";

function useMeta(): LogiMeta | null {
  const [m, setM] = useState<LogiMeta | null>(null);
  useEffect(() => { loadLogiMeta().then(setM).catch(() => {}); }, []);
  return m;
}

type VModal = { v: Vehicle; kind: "check" | "trip" | "end" | "fuel" | "service" | "papers" | "history" };

export function TransportBoard({ schoolId }: { schoolId: string }) {
  const [tab, setTab] = useState<"fleet" | "routes">("fleet");
  return (
    <section className="stack">
      <div className="segmented small-seg">
        <button className={tab === "fleet" ? "on" : ""} onClick={() => setTab("fleet")}><Icon name="bus" size={14} />Vehicles</button>
        <button className={tab === "routes" ? "on" : ""} onClick={() => setTab("routes")}><Icon name="map" size={14} />Bus routes</button>
      </div>
      {tab === "fleet" ? <FleetBoard schoolId={schoolId} /> : <RoutesBoard schoolId={schoolId} />}
    </section>
  );
}

function paperHue(days: number | null): "red" | "amber" | "green" | "slate" {
  return days == null ? "slate" : days < 0 ? "red" : days <= 30 ? "amber" : "green";
}

function FleetBoard({ schoolId }: { schoolId: string }) {
  const [f, setF] = useState<Fleet | null>(null);
  const [modal, setModal] = useState<VModal | null>(null);
  const load = useCallback(() => { logi.fleet(schoolId).then(setF).catch(() => {}); }, [schoolId]);
  useEffect(load, [load]);
  if (!f) return <p className="muted">Loading…</p>;
  if (f.vehicles.length === 0) return <Empty icon="bus">No vehicles yet. Add them on the Facilities page (or Bulk upload → Vehicles).</Empty>;
  const done = () => { setModal(null); load(); };
  return (
    <>
      {f.insights.length > 0 && <InsightList items={f.insights} schoolId={schoolId} />}
      <div className="vehicle-grid">
        {f.vehicles.map((v) => {
          const bad = Object.values(v.papers).some((p) => p.days != null && p.days < 0);
          return (
            <article key={v.id} className={`vehicle-card${bad ? " bad" : ""}`} style={hue(bad ? "red" : v.open_trip ? "violet" : "teal")}>
              <header>
                <Glyph icon={v.kind === "bus" ? "bus" : "car"} hue={bad ? "red" : "teal"} size={48} />
                <span className="grow"><h3>{v.name}</h3><span className="plate">{v.plate_number ?? "No plate"}</span></span>
                <span className="odo"><b>{v.odometer_km != null ? v.odometer_km.toLocaleString() : "–"}</b>km</span>
              </header>
              {v.open_trip && <p className="day-banner" style={hue("violet")}><Icon name="log-out" size={15} />Out: {v.open_trip.purpose}{v.open_trip.destination && ` → ${v.open_trip.destination}`} since {hhmm(v.open_trip.started_at)}</p>}
              <div className="papers">
                {Object.values(v.papers).map((p) => (
                  <span key={p.label} className="paper" style={hue(paperHue(p.days))} title={p.date ? `Until ${niceDate(p.date, { day: "numeric", month: "short", year: "numeric" })}` : "Not recorded"}>
                    <small>{p.label}</small><b>{p.days == null ? "?" : p.days < 0 ? "Expired" : p.days <= 30 ? `${p.days} days` : "OK"}</b>
                  </span>
                ))}
              </div>
              <div className="v-row">
                <span className="v-check" style={hue(!v.check ? "slate" : v.check.all_ok ? "green" : "red")}>
                  <Icon name={!v.check ? "hourglass" : v.check.all_ok ? "circle-check" : "circle-x"} size={15} />{!v.check ? "Not checked today" : v.check.all_ok ? "Checked today: all OK" : "Check failed today"}
                </span>
                {v.since_service_km != null && v.service_every_km && (
                  <span className="v-service" title={`${v.since_service_km.toLocaleString()} km since the last service`}>
                    <small>Service</small><span className="mini-bar wide"><i style={{ width: `${Math.min(100, (v.since_service_km / v.service_every_km) * 100)}%`, background: v.service_due ? "var(--h-red)" : undefined }} /></span>
                  </span>
                )}
              </div>
              {v.efficiency.length > 1 && <div className="v-eff"><small>km per litre</small><Spark points={v.efficiency} min={Math.min(...v.efficiency) - 1} max={Math.max(...v.efficiency) + 1} width={160} height={36} /><b>{v.efficiency[v.efficiency.length - 1]}</b></div>}
              <p className="muted small">This month: fuel {naira(v.fuel_month)} · repairs {naira(v.service_month)}{v.driver_name && ` · ${v.driver_name}`}</p>
              <div className="v-actions">
                <button onClick={() => setModal({ v, kind: "check" })}><Icon name="clipboard" size={15} />Daily check</button>
                {v.open_trip ? <button className="primary" onClick={() => setModal({ v, kind: "end" })}><Icon name="log-in" size={15} />End trip</button>
                  : <button onClick={() => setModal({ v, kind: "trip" })}><Icon name="log-out" size={15} />Start trip</button>}
                <button onClick={() => setModal({ v, kind: "fuel" })}><Icon name="flame" size={15} />Fuel</button>
                <button onClick={() => setModal({ v, kind: "service" })}><Icon name="wrench" size={15} />Repair</button>
                <button onClick={() => setModal({ v, kind: "papers" })}><Icon name="file" size={15} />Papers</button>
                <button onClick={() => setModal({ v, kind: "history" })}><Icon name="history" size={15} />History</button>
              </div>
            </article>
          );
        })}
      </div>
      {modal?.kind === "check" && <CheckForm v={modal.v} items={f.check_items} onClose={() => setModal(null)} onDone={done} />}
      {modal?.kind === "trip" && <TripForm v={modal.v} onClose={() => setModal(null)} onDone={done} />}
      {modal?.kind === "end" && <EndTrip v={modal.v} onClose={() => setModal(null)} onDone={done} />}
      {modal?.kind === "fuel" && <FuelForm v={modal.v} onClose={() => setModal(null)} onDone={done} />}
      {modal?.kind === "service" && <ServiceForm v={modal.v} onClose={() => setModal(null)} onDone={done} />}
      {modal?.kind === "papers" && <PapersForm v={modal.v} onClose={() => setModal(null)} onDone={done} />}
      {modal?.kind === "history" && <History v={modal.v} onClose={() => setModal(null)} />}
    </>
  );
}

function CheckForm({ v, items, onClose, onDone }: { v: Vehicle; items: Record<string, string>; onClose: () => void; onDone: () => void }) {
  const [state, setState] = useState<Record<string, boolean>>(() => v.check?.items ?? Object.fromEntries(Object.keys(items).map((k) => [k, true])));
  const [odo, setOdo] = useState(v.odometer_km ? String(v.odometer_km) : "");
  const [notes, setNotes] = useState(v.check?.notes ?? "");
  const [busy, error, run] = useBusy();
  const bad = Object.entries(state).filter(([, ok]) => !ok).length;
  return (
    <Modal title={`Daily check: ${v.name}`} onClose={onClose}>
      <p className="muted small">Tap anything that is <b>not</b> right. A problem sends a job to the transport team straight away.</p>
      <div className="check-grid">
        {Object.entries(items).map(([k, l]) => (
          <button key={k} type="button" className={`check-tile ${state[k] ? "ok" : "bad"}`} onClick={() => setState({ ...state, [k]: !state[k] })}>
            <Icon name={state[k] ? "circle-check" : "circle-x"} size={22} />{l}
          </button>
        ))}
      </div>
      <div className="row wrap">
        <Field label="Odometer (km)"><input type="number" min={0} value={odo} onChange={(e) => setOdo(e.target.value)} /></Field>
        <Field label="Notes"><input value={notes} onChange={(e) => setNotes(e.target.value)} placeholder={bad ? "What's wrong?" : "Optional"} /></Field>
      </div>
      {error && <p className="error">{error}</p>}
      <div className="row"><span className="grow" /><button onClick={onClose}>Cancel</button>
        <button className={bad ? "primary" : "ok-button"} disabled={busy} onClick={() => run(async () => { await logi.check(v.id, { items: state, odometer: odo ? Number(odo) : null, notes: notes || null }); onDone(); })}>
          {bad ? `Save: ${bad} problem${bad > 1 ? "s" : ""}` : "All OK"}</button></div>
    </Modal>
  );
}

function TripForm({ v, onClose, onDone }: { v: Vehicle; onClose: () => void; onDone: () => void }) {
  const meta = useMeta();
  const [f, setF] = useState({ kind: "errand", purpose: "", destination: "", passengers: "", odometer_start: v.odometer_km ? String(v.odometer_km) : "" });
  const [busy, error, run] = useBusy();
  return (
    <Modal title={`Start a trip: ${v.name}`} onClose={onClose}>
      <form className="stack" onSubmit={(e: FormEvent) => { e.preventDefault(); run(async () => { await logi.startTrip(v.id, { kind: f.kind, purpose: f.purpose, destination: f.destination || null, passengers: f.passengers ? Number(f.passengers) : null, odometer_start: f.odometer_start ? Number(f.odometer_start) : null }); onDone(); }); }}>
        <div className="kind-pick">{meta && Object.entries(meta.trip_kinds).map(([k, l]) => <button key={k} type="button" className={`chip pick${f.kind === k ? " on" : ""}`} onClick={() => setF({ ...f, kind: k })}>{l}</button>)}</div>
        <Field label="What for"><input required minLength={2} value={f.purpose} onChange={(e) => setF({ ...f, purpose: e.target.value })} placeholder="e.g. Buy foodstuff" /></Field>
        <div className="row wrap">
          <Field label="Where to"><input value={f.destination} onChange={(e) => setF({ ...f, destination: e.target.value })} /></Field>
          <Field label="Passengers"><input type="number" min={0} value={f.passengers} onChange={(e) => setF({ ...f, passengers: e.target.value })} /></Field>
          <Field label="Odometer now (km)"><input type="number" min={0} value={f.odometer_start} onChange={(e) => setF({ ...f, odometer_start: e.target.value })} /></Field>
        </div>
        {error && <p className="error">{error}</p>}
        <div className="row"><span className="grow" /><button type="button" onClick={onClose}>Cancel</button><button className="primary" disabled={busy}>Start</button></div>
      </form>
    </Modal>
  );
}

function EndTrip({ v, onClose, onDone }: { v: Vehicle; onClose: () => void; onDone: () => void }) {
  const [odo, setOdo] = useState("");
  const [notes, setNotes] = useState("");
  const [busy, error, run] = useBusy();
  return (
    <Modal title={`Back: ${v.name}`} onClose={onClose}>
      <p className="small">{v.open_trip?.purpose}{v.open_trip?.destination && ` → ${v.open_trip.destination}`}, left {v.open_trip && hhmm(v.open_trip.started_at)}</p>
      <div className="row wrap">
        <Field label="Odometer now (km)"><input type="number" min={0} value={odo} onChange={(e) => setOdo(e.target.value)} /></Field>
        <Field label="Notes"><input value={notes} onChange={(e) => setNotes(e.target.value)} /></Field>
      </div>
      {error && <p className="error">{error}</p>}
      <div className="row"><span className="grow" /><button onClick={onClose}>Cancel</button>
        <button className="primary" disabled={busy} onClick={() => run(async () => { await logi.endTrip(v.open_trip!.id, { odometer_end: odo ? Number(odo) : null, notes: notes || null }); onDone(); })}>End trip</button></div>
    </Modal>
  );
}

function FuelForm({ v, onClose, onDone }: { v: Vehicle; onClose: () => void; onDone: () => void }) {
  const [f, setF] = useState({ on_date: iso(new Date()), litres: "", cost: "", odometer: v.odometer_km ? String(v.odometer_km) : "", station: "" });
  const [busy, error, run] = useBusy();
  return (
    <Modal title={`Fuel: ${v.name}`} onClose={onClose}>
      <form className="stack" onSubmit={(e) => { e.preventDefault(); run(async () => { await logi.fuel(v.id, { on_date: f.on_date, litres: Number(f.litres), cost: Number(f.cost), odometer: f.odometer ? Number(f.odometer) : null, station: f.station || null }); onDone(); }); }}>
        <div className="row wrap">
          <Field label="Date"><input type="date" required value={f.on_date} onChange={(e) => setF({ ...f, on_date: e.target.value })} /></Field>
          <Field label="Litres"><input type="number" required min={0.1} step="any" value={f.litres} onChange={(e) => setF({ ...f, litres: e.target.value })} /></Field>
          <Field label="Cost (₦)"><input type="number" required min={0} step="any" value={f.cost} onChange={(e) => setF({ ...f, cost: e.target.value })} /></Field>
        </div>
        <div className="row wrap">
          <Field label="Odometer (km)" hint="Needed to work out km per litre"><input type="number" min={0} value={f.odometer} onChange={(e) => setF({ ...f, odometer: e.target.value })} /></Field>
          <Field label="Filling station"><input value={f.station} onChange={(e) => setF({ ...f, station: e.target.value })} /></Field>
        </div>
        {f.litres && f.cost && <p className="muted small">{naira(Number(f.cost) / Number(f.litres))} per litre</p>}
        {error && <p className="error">{error}</p>}
        <div className="row"><span className="grow" /><button type="button" onClick={onClose}>Cancel</button><button className="primary" disabled={busy}>Save</button></div>
      </form>
    </Modal>
  );
}

function ServiceForm({ v, onClose, onDone }: { v: Vehicle; onClose: () => void; onDone: () => void }) {
  const meta = useMeta();
  const [f, setF] = useState({ on_date: iso(new Date()), kind: "service", description: "", cost: "", odometer: v.odometer_km ? String(v.odometer_km) : "", garage: "" });
  const [busy, error, run] = useBusy();
  return (
    <Modal title={`Repair or service: ${v.name}`} onClose={onClose}>
      <form className="stack" onSubmit={(e) => { e.preventDefault(); run(async () => { await logi.serviceLog(v.id, { on_date: f.on_date, kind: f.kind, description: f.description, cost: f.cost ? Number(f.cost) : null, odometer: f.odometer ? Number(f.odometer) : null, garage: f.garage || null }); onDone(); }); }}>
        <div className="kind-pick">{meta && Object.entries(meta.service_kinds).map(([k, l]) => <button key={k} type="button" className={`chip pick${f.kind === k ? " on" : ""}`} onClick={() => setF({ ...f, kind: k })}>{l}</button>)}</div>
        <Field label="What was done"><input required minLength={2} value={f.description} onChange={(e) => setF({ ...f, description: e.target.value })} placeholder="e.g. Oil and filter change, brake pads" /></Field>
        <div className="row wrap">
          <Field label="Date"><input type="date" value={f.on_date} onChange={(e) => setF({ ...f, on_date: e.target.value })} /></Field>
          <Field label="Cost (₦)"><input type="number" min={0} value={f.cost} onChange={(e) => setF({ ...f, cost: e.target.value })} /></Field>
          <Field label="Odometer (km)"><input type="number" min={0} value={f.odometer} onChange={(e) => setF({ ...f, odometer: e.target.value })} /></Field>
          <Field label="Garage"><input value={f.garage} onChange={(e) => setF({ ...f, garage: e.target.value })} /></Field>
        </div>
        {error && <p className="error">{error}</p>}
        <div className="row"><span className="grow" /><button type="button" onClick={onClose}>Cancel</button><button className="primary" disabled={busy}>Save</button></div>
      </form>
    </Modal>
  );
}

function PapersForm({ v, onClose, onDone }: { v: Vehicle; onClose: () => void; onDone: () => void }) {
  const [f, setF] = useState({ insurance_expiry: v.papers.insurance_expiry.date ?? "", roadworthiness_expiry: v.papers.roadworthiness_expiry.date ?? "", licence_expiry: v.papers.licence_expiry.date ?? "",
    odometer_km: v.odometer_km != null ? String(v.odometer_km) : "", service_every_km: v.service_every_km ? String(v.service_every_km) : "5000", last_service_km: v.last_service_km != null ? String(v.last_service_km) : "" });
  const [busy, error, run] = useBusy();
  const n = (s: string) => (s ? Number(s) : null);
  return (
    <Modal title={`Papers and servicing: ${v.name}`} onClose={onClose}>
      <form className="stack" onSubmit={(e) => { e.preventDefault(); run(async () => { await logi.papers(v.id, { insurance_expiry: f.insurance_expiry || null, roadworthiness_expiry: f.roadworthiness_expiry || null, licence_expiry: f.licence_expiry || null, odometer_km: n(f.odometer_km), service_every_km: n(f.service_every_km), last_service_km: n(f.last_service_km) }); onDone(); }); }}>
        <p className="muted small">You'll be warned 30 days before any of these run out.</p>
        <div className="row wrap">
          <Field label="Insurance until"><input type="date" value={f.insurance_expiry} onChange={(e) => setF({ ...f, insurance_expiry: e.target.value })} /></Field>
          <Field label="Roadworthiness until"><input type="date" value={f.roadworthiness_expiry} onChange={(e) => setF({ ...f, roadworthiness_expiry: e.target.value })} /></Field>
          <Field label="Vehicle licence until"><input type="date" value={f.licence_expiry} onChange={(e) => setF({ ...f, licence_expiry: e.target.value })} /></Field>
        </div>
        <div className="row wrap">
          <Field label="Odometer now (km)"><input type="number" min={0} value={f.odometer_km} onChange={(e) => setF({ ...f, odometer_km: e.target.value })} /></Field>
          <Field label="Service every (km)"><input type="number" min={500} value={f.service_every_km} onChange={(e) => setF({ ...f, service_every_km: e.target.value })} /></Field>
          <Field label="Last service at (km)"><input type="number" min={0} value={f.last_service_km} onChange={(e) => setF({ ...f, last_service_km: e.target.value })} /></Field>
        </div>
        {error && <p className="error">{error}</p>}
        <div className="row"><span className="grow" /><button type="button" onClick={onClose}>Cancel</button><button className="primary" disabled={busy}>Save</button></div>
      </form>
    </Modal>
  );
}

function History({ v, onClose }: { v: Vehicle; onClose: () => void }) {
  const [ev, setEv] = useState<{ at: string; kind: string; title: string; detail: string }[] | null>(null);
  useEffect(() => { logi.history(v.id).then((h) => setEv(h.events)).catch(() => setEv([])); }, [v.id]);
  const look: Record<string, { icon: string; hue: "violet" | "red" | "orange" | "green" }> = { trip: { icon: "log-out", hue: "violet" }, fuel: { icon: "flame", hue: "red" }, service: { icon: "wrench", hue: "orange" }, check: { icon: "clipboard", hue: "green" } };
  return (
    <Modal title={`${v.name}: last 3 months`} onClose={onClose}>
      {!ev ? <p className="muted">Loading…</p> : ev.length === 0 ? <Empty icon="history">Nothing yet.</Empty> : (
        <ol className="timeline single">{ev.map((e, i) => { const l = look[e.kind] ?? look.trip; return (
          <li key={i} style={hue(l.hue)}><span className="tl-dot"><Icon name={l.icon} size={14} /></span><span className="tl-date">{niceDate(e.at.slice(0, 10), { day: "numeric", month: "short" })}</span>
            <span className="tl-text"><strong>{e.title}</strong><span className="muted small">{e.detail}</span></span></li>); })}</ol>
      )}
    </Modal>
  );
}

// ---------- Bus routes ----------

function RoutesBoard({ schoolId }: { schoolId: string }) {
  const [list, setList] = useState<Route[] | null>(null);
  const [modal, setModal] = useState<null | "new" | { edit: Route } | { riders: Route } | { reg: Route; run: string }>(null);
  const load = useCallback(() => { logi.routes(schoolId).then(setList).catch(() => setList([])); }, [schoolId]);
  useEffect(load, [load]);
  const hour = Number(new Date().toLocaleTimeString("en-GB", { hour: "2-digit", timeZone: "Africa/Lagos" }));
  const run = hour < 12 ? "morning" : "afternoon";
  return (
    <section className="stack">
      <div className="day-toolbar"><p className="muted small grow">Tick each child as they get on. At the end of the run, check the bus and confirm it's empty, so no child is ever left behind on the bus.</p>
        <button className="primary with-icon" onClick={() => setModal("new")}><Icon name="plus" size={16} />New route</button></div>
      {list && list.length === 0 && <Empty icon="map">No bus routes yet.</Empty>}
      <div className="route-grid">
        {(list ?? []).map((r) => (
          <article key={r.id} className="route-card" style={hue("teal")}>
            <header><Glyph icon="bus" hue="teal" size={40} /><span className="grow"><h3>{r.name}</h3><span className="muted small">{r.vehicle_name ?? "No vehicle"}{r.driver && ` · ${r.driver.name}`}</span></span>
              <button className="icon-button" aria-label="Edit route" onClick={() => setModal({ edit: r })}><Icon name="edit" size={15} /></button></header>
            <ol className="stops">{r.stops.map((s, i) => <li key={i}><span className="stop-dot" /><b>{s.name}</b><span className="muted small">{[s.morning, s.afternoon].filter(Boolean).join(" · ")}</span>
              <span className="muted small grow-right">{r.riders.filter((x) => x.stop === s.name).length} riders</span></li>)}</ol>
            <div className="runs">
              {(["morning", "afternoon"] as const).map((k) => { const t = r.today[k]; return (
                <button key={k} className={`run ${t ? (t.all_off ? "done" : "open") : ""}${k === run ? " now" : ""}`} onClick={() => setModal({ reg: r, run: k })}>
                  <Icon name={t ? (t.all_off ? "circle-check" : "bus") : k === "morning" ? "sun" : "moon"} size={16} />
                  <span><strong>{k === "morning" ? "Morning run" : "Afternoon run"}</strong><small>{t ? `${t.boarded} on board${t.all_off ? " · bus empty ✓" : " · not confirmed empty"}` : "Not started"}</small></span>
                </button>); })}
            </div>
            <button className="text-link" onClick={() => setModal({ riders: r })}>{r.riders.length} students on this route · change</button>
          </article>
        ))}
      </div>
      {modal === "new" && <RouteForm schoolId={schoolId} onClose={() => setModal(null)} onDone={() => { setModal(null); load(); }} />}
      {modal && typeof modal === "object" && "edit" in modal && <RouteForm schoolId={schoolId} route={modal.edit} onClose={() => setModal(null)} onDone={() => { setModal(null); load(); }} />}
      {modal && typeof modal === "object" && "riders" in modal && <RidersForm schoolId={schoolId} route={modal.riders} onClose={() => setModal(null)} onDone={() => { setModal(null); load(); }} />}
      {modal && typeof modal === "object" && "reg" in modal && <BusRegisterModal route={modal.reg} run={modal.run} onClose={() => { setModal(null); load(); }} />}
    </section>
  );
}

function RouteForm({ schoolId, route, onClose, onDone }: { schoolId: string; route?: Route; onClose: () => void; onDone: () => void }) {
  const [vehicles, setVehicles] = useState<Vehicle[]>([]);
  const [people, setPeople] = useState<Card[]>([]);
  const [f, setF] = useState({ name: route?.name ?? "", vehicle_id: route?.vehicle_id ?? "", driver_id: route?.driver?.user_id ?? "", attendant_id: route?.attendant?.user_id ?? "" });
  const [stops, setStops] = useState<Stop[]>(route?.stops.length ? route.stops : [{ name: "", morning: null, afternoon: null }]);
  const [busy, error, run] = useBusy();
  useEffect(() => { logi.fleet(schoolId).then((x) => setVehicles(x.vehicles)).catch(() => {}); grow.people(schoolId).then((r) => setPeople(r.people)).catch(() => {}); }, [schoolId]);
  const body = () => ({ name: f.name, vehicle_id: f.vehicle_id || null, driver_id: f.driver_id || null, attendant_id: f.attendant_id || null, stops: stops.filter((s) => s.name.trim()).map((s) => ({ ...s, morning: s.morning || null, afternoon: s.afternoon || null })) });
  return (
    <Modal title={route ? route.name : "New bus route"} onClose={onClose}>
      <form className="stack" onSubmit={(e) => { e.preventDefault(); run(async () => { if (route) await logi.editRoute(route.id, body()); else await logi.addRoute(schoolId, body()); onDone(); }); }}>
        <Field label="Route name"><input required minLength={2} value={f.name} onChange={(e) => setF({ ...f, name: e.target.value })} placeholder="e.g. Route A: GRA and Rumuola" /></Field>
        <div className="row wrap">
          <Field label="Vehicle"><select value={f.vehicle_id} onChange={(e) => setF({ ...f, vehicle_id: e.target.value })}><option value="">Choose…</option>{vehicles.map((v) => <option key={v.id} value={v.id}>{v.name} ({v.plate_number})</option>)}</select></Field>
          <Field label="Driver"><select value={f.driver_id} onChange={(e) => setF({ ...f, driver_id: e.target.value })}><option value="">Choose…</option>{people.map((p) => <option key={p.user_id} value={p.user_id}>{p.name}</option>)}</select></Field>
          <Field label="Bus attendant (optional)"><select value={f.attendant_id} onChange={(e) => setF({ ...f, attendant_id: e.target.value })}><option value="">None</option>{people.map((p) => <option key={p.user_id} value={p.user_id}>{p.name}</option>)}</select></Field>
        </div>
        <div><span className="field-label">Stops, in order</span>
          {stops.map((s, i) => (
            <div key={i} className="stop-row">
              <span className="stop-n">{i + 1}</span>
              <input placeholder="Stop name" value={s.name} onChange={(e) => setStops(stops.map((x, j) => (j === i ? { ...x, name: e.target.value } : x)))} />
              <input type="time" aria-label="Morning pick-up" value={s.morning ?? ""} onChange={(e) => setStops(stops.map((x, j) => (j === i ? { ...x, morning: e.target.value } : x)))} />
              <input type="time" aria-label="Afternoon drop-off" value={s.afternoon ?? ""} onChange={(e) => setStops(stops.map((x, j) => (j === i ? { ...x, afternoon: e.target.value } : x)))} />
              <button type="button" className="chip-x" aria-label="Remove stop" onClick={() => setStops(stops.filter((_, j) => j !== i))}><Icon name="close" size={14} /></button>
            </div>
          ))}
          <p className="muted small">Times: morning pick-up, then afternoon drop-off.</p>
          <button type="button" className="with-icon small" onClick={() => setStops([...stops, { name: "", morning: null, afternoon: null }])}><Icon name="plus" size={14} />Add a stop</button>
        </div>
        {error && <p className="error">{error}</p>}
        <div className="row">{route && <button type="button" className="danger-hover" onClick={() => run(async () => { if (confirm("Delete this route?")) { await logi.removeRoute(route.id); onDone(); } })}>Delete</button>}
          <span className="grow" /><button type="button" onClick={onClose}>Cancel</button><button className="primary" disabled={busy}>Save</button></div>
      </form>
    </Modal>
  );
}

function RidersForm({ schoolId, route, onClose, onDone }: { schoolId: string; route: Route; onClose: () => void; onDone: () => void }) {
  const [riders, setRiders] = useState<(StudentCard & { stop: string | null })[]>(route.riders);
  const [busy, error, run] = useBusy();
  return (
    <Modal title={`Students on ${route.name}`} onClose={onClose}>
      <StudentPicker schoolId={schoolId} value={null} label="Add a student" onPick={(s) => s && !riders.some((r) => r.id === s.id) && setRiders([...riders, { ...s, stop: route.stops[0]?.name ?? null }])} />
      <ul className="rider-list">
        {riders.map((r) => (
          <li key={r.id}><Avatar name={r.name} size={28} /><span className="grow"><strong><StudentLink id={r.id} name={r.name} /></strong><span className="muted small">{r.class_name}</span></span>
            <select value={r.stop ?? ""} aria-label="Stop" onChange={(e) => setRiders(riders.map((x) => (x.id === r.id ? { ...x, stop: e.target.value || null } : x)))}>
              <option value="">No stop</option>{route.stops.map((s) => <option key={s.name}>{s.name}</option>)}</select>
            <button className="chip-x" aria-label={`Remove ${r.name}`} onClick={() => setRiders(riders.filter((x) => x.id !== r.id))}><Icon name="close" size={14} /></button></li>
        ))}
      </ul>
      {error && <p className="error">{error}</p>}
      <div className="row"><span className="muted small">{riders.length} students</span><span className="grow" /><button onClick={onClose}>Cancel</button>
        <button className="primary" disabled={busy} onClick={() => run(async () => { await logi.setRiders(route.id, riders.map((r) => ({ student_id: r.id, stop: r.stop }))); onDone(); })}>Save</button></div>
    </Modal>
  );
}

export function BusRegisterModal({ route, run: initialRun, onClose }: { route: Route; run: string; onClose: () => void }) {
  const [run, setRun] = useState(initialRun);
  const [reg, setReg] = useState<Register | null>(null);
  const [on, setOn] = useState<Set<string>>(new Set());
  const [busy, error, act] = useBusy();
  useEffect(() => { logi.register(route.id, run).then((r) => { setReg(r); setOn(new Set(r.boarded)); }).catch(() => {}); }, [route.id, run]);
  const save = (allOff: boolean) => act(async () => { const r = await logi.saveRegister(route.id, { run, boarded: [...on], all_off: allOff, notes: null }); setReg(r); });
  if (!reg) return <Modal title={route.name} onClose={onClose}><p className="muted">Loading…</p></Modal>;
  const byStop = new Map<string, typeof reg.route.riders>();
  for (const r of reg.route.riders) byStop.set(r.stop ?? "No stop", [...(byStop.get(r.stop ?? "No stop") ?? []), r]);
  return (
    <Modal title={`${route.name}`} onClose={onClose}>
      <div className="row wrap">
        <div className="segmented small-seg">{(["morning", "afternoon"] as const).map((k) => <button key={k} className={run === k ? "on" : ""} onClick={() => setRun(k)}>{k === "morning" ? "Morning run" : "Afternoon run"}</button>)}</div>
        <span className="grow" /><span className="bus-count"><b>{on.size}</b> of {reg.route.riders.length} on board</span>
      </div>
      {reg.all_off_at && <p className="day-banner" style={hue("green")}><Icon name="circle-check" size={18} />Bus checked empty at {hhmm(reg.all_off_at)}. Every child is off.</p>}
      {[...byStop].map(([stop, kids]) => (
        <div key={stop} className="reg-stop">
          <h4><Icon name="place" size={14} />{stop}</h4>
          <div className="reg-grid">
            {kids.map((k) => (
              <button key={k.id} className={`reg-kid${on.has(k.id) ? " on" : ""}`} disabled={!!reg.all_off_at} onClick={() => { const s = new Set(on); if (s.has(k.id)) s.delete(k.id); else s.add(k.id); setOn(s); }}>
                <Avatar name={k.name} size={34} /><span><strong>{k.name}</strong><small>{k.class_name}</small></span><Icon name={on.has(k.id) ? "circle-check" : "user"} size={20} />
              </button>
            ))}
          </div>
        </div>
      ))}
      {reg.route.riders.length === 0 && <Empty icon="users">No students on this route yet.</Empty>}
      {error && <p className="error">{error}</p>}
      <div className="row wrap">
        {reg.all_off_at ? <button onClick={() => save(false)} disabled={busy}>Undo “bus empty”</button> : (
          <>
            <button disabled={busy} onClick={() => save(false)}>Save who's on board</button>
            <span className="grow" />
            <button className="ok-button big-ok" disabled={busy || on.size === 0} onClick={() => { if (confirm("Have you walked to the back of the bus and checked every seat?")) save(true); }}>
              <Icon name="circle-check" size={18} /> Everyone is off: bus is empty
            </button>
          </>
        )}
      </div>
      {reg.started_at && <p className="muted small">Started {dayTime(reg.started_at)}</p>}
    </Modal>
  );
}
