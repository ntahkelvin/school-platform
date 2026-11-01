// Cleaning rotas: today's cleaning with ticks and stars, the weekly rota, the places, and the league.
import { useCallback, useEffect, useState, type FormEvent } from "react";
import { errorText } from "./api";
import { iso, niceDate } from "./dayApi";
import { api } from "./api";
import type { Card } from "./growthApi";
import { InsightList, useBusy } from "./GrowthBits";
import Icon from "./Icon";
import { clean, loadCleanMeta, WEEKDAYS, type Area, type AreaIn, type CleanDay, type CleanMeta, type DayArea, type League } from "./threeApi";
import { Avatar, Empty, Field, Glyph, hue, Modal } from "./ui";

const KIND_HUE: Record<string, string> = { classroom: "orange", toilet: "cyan", hostel: "violet", compound: "green", office: "slate", hall: "indigo", kitchen: "lime", lab: "teal", other: "pink" };
function useMeta(): CleanMeta | null {
  const [m, setM] = useState<CleanMeta | null>(null);
  useEffect(() => { loadCleanMeta().then(setM).catch(() => {}); }, []);
  return m;
}

type Seg = "today" | "rota" | "places" | "league";
export function CleaningBoard({ schoolId }: { schoolId: string }) {
  const [seg, setSeg] = useState<Seg>("today");
  return (
    <section className="stack">
      <div className="segmented small-seg">
        {([["today", "Today", "sparkle"], ["rota", "Rota", "calendar"], ["places", "Places", "facilities"], ["league", "League", "trophy"]] as const).map(([k, l, ic]) => (
          <button key={k} className={seg === k ? "on" : ""} onClick={() => setSeg(k)}><Icon name={ic} size={14} />{l}</button>
        ))}
      </div>
      {seg === "today" && <CleaningToday schoolId={schoolId} />}
      {seg === "rota" && <RotaTab schoolId={schoolId} />}
      {seg === "places" && <PlacesTab schoolId={schoolId} />}
      {seg === "league" && <LeagueTab schoolId={schoolId} />}
    </section>
  );
}

export function CleaningToday({ schoolId }: { schoolId: string }) {
  const [date, setDate] = useState(iso(new Date()));
  const [d, setD] = useState<CleanDay | null>(null);
  const [error, setError] = useState("");
  const load = useCallback(() => { clean.day(schoolId, date).then((x) => { setD(x); setError(""); }).catch((e) => setError(errorText(e))); }, [schoolId, date]);
  useEffect(load, [load]);
  const shift = (n: number) => { const x = new Date(`${date}T12:00:00`); x.setDate(x.getDate() + n); setDate(iso(x)); };
  if (error) return <p className="muted">{error}</p>;
  if (!d) return <p className="muted">Loading…</p>;
  const pct = d.total ? Math.round((d.done / d.total) * 100) : 0;
  return (
    <section className="stack">
      <div className="day-toolbar">
        <button className="icon-button" aria-label="Day before" onClick={() => shift(-1)}><Icon name="chevron-left" size={18} /></button>
        <strong className="clean-date">{date === iso(new Date()) ? "Today" : niceDate(date, { weekday: "long", day: "numeric", month: "short" })}</strong>
        <button className="icon-button" aria-label="Next day" disabled={date >= iso(new Date())} onClick={() => shift(1)}><Icon name="chevron-right" size={18} /></button>
        <span className="grow" />
        <span className="setup-ring" style={{ ...hue(pct === 100 ? "green" : "teal"), ["--pct" as string]: `${pct}%` }}><b>{pct}%</b></span>
        <span className="small"><b>{d.done}</b> of {d.total} cleaned{d.average != null && <> · inspected average <b>{d.average}★</b></>}</span>
      </div>
      {d.insights.length > 0 && <InsightList items={d.insights} schoolId={schoolId} />}
      {d.areas.length === 0 && <Empty icon="sparkle">{d.manager ? "Nothing on the rota for this day. Add places and who cleans them." : "No cleaning for you on this day."}</Empty>}
      <div className="clean-grid">{d.areas.map((a) => <AreaCard key={a.id} a={a} date={date} onDone={load} />)}</div>
    </section>
  );
}

function AreaCard({ a, date, onDone }: { a: DayArea; date: string; onDone: () => void }) {
  const [ticks, setTicks] = useState<string[]>(a.log?.ticked ?? []);
  const [inspecting, setInspecting] = useState(false);
  const [busy, error, run] = useBusy();
  const done = !!a.log?.done_at;
  const wd = (new Date(`${date}T12:00:00`).getDay() + 6) % 7;
  const who = a.duties.filter((x) => x.weekday === wd);
  const tone = a.log?.score != null ? (a.log.score >= 4 ? "green" : a.log.score >= 3 ? "amber" : "red") : done ? "teal" : KIND_HUE[a.kind] ?? "slate";
  return (
    <article className={`clean-card${done ? " done" : ""}`} style={hue(tone)}>
      <header>
        <Glyph icon={a.icon} hue={KIND_HUE[a.kind] ?? "slate"} size={38} />
        <span className="grow"><h3>{a.name}</h3><small>{a.kind_label} · {a.shift}{a.place && a.place !== a.name ? ` · ${a.place}` : ""}</small></span>
        {a.log?.score != null && <span className="stars" aria-label={`${a.log.score} of 5`}>{"★".repeat(a.log.score)}<i>{"★".repeat(5 - a.log.score)}</i></span>}
      </header>
      <p className="clean-who">{who.length ? who.map((x) => <span key={`${x.user_id}${x.team}`} className="hue-chip" style={hue(x.user_id ? "blue" : "violet")}><Icon name={x.user_id ? "user" : "users"} size={12} />{x.name ?? x.team}</span>) : <span className="muted small">Nobody on the rota</span>}{a.mine && <span className="hue-chip" style={hue("green")}>You</span>}</p>
      <ul className="clean-checks">
        {a.checklist.map((c) => (
          <li key={c}><label className="check"><input type="checkbox" disabled={!a.can_tick || busy} checked={ticks.includes(c)} onChange={(e) => setTicks(e.target.checked ? [...ticks, c] : ticks.filter((x) => x !== c))} />{c}</label></li>
        ))}
      </ul>
      {done && <p className="small ok-line"><Icon name="circle-check" size={14} />Done {a.log!.done_by && `by ${a.log!.done_by}`} at {new Date(a.log!.done_at!).toLocaleTimeString("en-GB", { hour: "2-digit", minute: "2-digit" })}</p>}
      {a.log?.comment && <p className="small muted">“{a.log.comment}” – {a.log.inspected_by}</p>}
      {error && <p className="error">{error}</p>}
      <div className="row wrap">
        {a.can_tick && <button className={done ? "small" : "ok-button with-icon"} disabled={busy} onClick={() => run(async () => { await clean.done(a.id, date, ticks); onDone(); })}>
          <Icon name="check" size={15} />{done ? "Update" : ticks.length === a.checklist.length ? "All done" : "Mark as cleaned"}</button>}
        {a.can_inspect && <button className="with-icon small" onClick={() => setInspecting(true)}><Icon name="star" size={14} />{a.log?.score != null ? "Inspect again" : "Inspect"}</button>}
      </div>
      {inspecting && <InspectForm a={a} date={date} onClose={() => setInspecting(false)} onDone={() => { setInspecting(false); onDone(); }} />}
    </article>
  );
}

function InspectForm({ a, date, onClose, onDone }: { a: DayArea; date: string; onClose: () => void; onDone: () => void }) {
  const [score, setScore] = useState(a.log?.score ?? 0);
  const [comment, setComment] = useState(a.log?.comment ?? "");
  const [busy, error, run] = useBusy();
  const words = ["", "Very dirty", "Not good enough", "OK", "Clean", "Spotless"];
  return (
    <Modal title={`Inspect: ${a.name}`} onClose={onClose}>
      <div className="star-pick">{[1, 2, 3, 4, 5].map((n) => (
        <button key={n} type="button" className={n <= score ? "on" : ""} aria-label={`${n} stars`} onClick={() => setScore(n)}>★</button>
      ))}</div>
      <p className="center small"><b>{words[score] || "Tap the stars"}</b>{score > 0 && score <= 2 && " · a job goes to the cleaning team to put it right"}</p>
      <Field label="Comment (optional)"><input value={comment} onChange={(e) => setComment(e.target.value)} placeholder="e.g. Bins not emptied" /></Field>
      {error && <p className="error">{error}</p>}
      <div className="row"><span className="grow" /><button onClick={onClose}>Cancel</button>
        <button className="primary" disabled={busy || !score} onClick={() => run(async () => { await clean.inspect(a.id, date, score, comment || null); onDone(); })}>Save</button></div>
    </Modal>
  );
}

// ---------- Rota ----------

function RotaTab({ schoolId }: { schoolId: string }) {
  const [areas, setAreas] = useState<Area[] | null>(null);
  const [cell, setCell] = useState<{ a: Area; day: number } | null>(null);
  const [error, setError] = useState("");
  const [busy, err2, run] = useBusy();
  const load = useCallback(() => { clean.areas(schoolId).then(setAreas).catch((e) => setError(errorText(e))); }, [schoolId]);
  useEffect(load, [load]);
  if (error) return <p className="muted">{error}</p>;
  if (!areas) return <p className="muted">Loading…</p>;
  if (areas.length === 0) return <Empty icon="calendar">Add places first (the Places tab), then put people on the rota.</Empty>;
  return (
    <section className="stack">
      <div className="row wrap"><p className="muted small grow">Tap a box to choose who cleans that place on that day: a cleaner on the staff, or a group of students (for labour or dormitory duty).</p>
        <button className="with-icon small" disabled={busy} onClick={() => run(async () => { if (confirm("Use Monday's rota for Tuesday to Friday too?")) setAreas(await clean.copyDay(schoolId, 0, [1, 2, 3, 4])); })}><Icon name="copy" size={14} />Copy Monday to Tue–Fri</button></div>
      {err2 && <p className="error">{err2}</p>}
      <div className="rota-wrap">
        <table className="clean-rota">
          <thead><tr><th>Place</th>{WEEKDAYS.map((d) => <th key={d}>{d}</th>)}</tr></thead>
          <tbody>{areas.map((a) => (
            <tr key={a.id}>
              <th scope="row"><span className="rota-place" style={hue(KIND_HUE[a.kind] ?? "slate")}><Icon name={a.icon} size={14} />{a.name}</span></th>
              {WEEKDAYS.map((_, i) => {
                const on = a.days.includes(i);
                const ds = a.duties.filter((x) => x.weekday === i);
                return <td key={i} className={on ? "" : "off"}>{on && (
                  <button className={`rota-cell${ds.length ? "" : " empty"}`} onClick={() => setCell({ a, day: i })}>
                    {ds.length ? ds.map((x, k) => <span key={k} className={x.user_id ? "who" : "team"}>{(x.name ?? x.team ?? "").split(" ").slice(0, 2).join(" ")}</span>) : "+"}
                  </button>)}</td>;
              })}
            </tr>
          ))}</tbody>
        </table>
      </div>
      {cell && <DutyEditor schoolId={schoolId} area={cell.a} day={cell.day} onClose={() => setCell(null)} onDone={(x) => { setAreas(x); setCell(null); }} />}
    </section>
  );
}

function DutyEditor({ schoolId, area, day, onClose, onDone }: { schoolId: string; area: Area; day: number; onClose: () => void; onDone: (a: Area[]) => void }) {
  const [people, setPeople] = useState<Card[]>([]);
  const [chosen, setChosen] = useState<{ user_id: string | null; team: string | null; name: string | null }[]>(area.duties.filter((d) => d.weekday === day));
  const [team, setTeam] = useState("");
  const [q, setQ] = useState("");
  const [allDays, setAllDays] = useState(false);
  const [busy, error, run] = useBusy();
  useEffect(() => { api.raw<Card[]>("GET", `/api/schools/${schoolId}/cleaning/staff`).then(setPeople).catch(() => {}); }, [schoolId]);
  const shown = people.filter((p) => !chosen.some((c) => c.user_id === p.user_id) && (!q || `${p.name} ${p.job_title ?? ""}`.toLowerCase().includes(q.toLowerCase())))
    .sort((a, b) => Number(/clean|porter|labour/i.test(b.job_title ?? "")) - Number(/clean|porter|labour/i.test(a.job_title ?? "")) || a.name.localeCompare(b.name)).slice(0, 30);
  const save = () => run(async () => {
    const days = allDays ? area.days : [day];
    const keep = area.duties.filter((d) => !days.includes(d.weekday)).map((d) => ({ weekday: d.weekday, user_id: d.user_id, team: d.team }));
    const add = days.flatMap((wd) => chosen.map((c) => ({ weekday: wd, user_id: c.user_id, team: c.team })));
    onDone(await clean.setDuties(area.id, [...keep, ...add]));
  });
  return (
    <Modal title={`${area.name}, ${WEEKDAYS[day]}`} onClose={onClose}>
      <div className="chips">{chosen.length === 0 ? <span className="muted small">Nobody yet.</span> : chosen.map((c, i) => (
        <span key={i} className="hue-chip" style={hue(c.user_id ? "blue" : "violet")}><Icon name={c.user_id ? "user" : "users"} size={12} />{c.name ?? c.team}
          <button className="chip-x" aria-label="Remove" onClick={() => setChosen(chosen.filter((_, j) => j !== i))}><Icon name="close" size={11} /></button></span>))}</div>
      <Field label="A student team (labour or dormitory duty)">
        <div className="row"><input value={team} onChange={(e) => setTeam(e.target.value)} placeholder="e.g. JSS 3 boys, Room 4" />
          <button type="button" disabled={team.trim().length < 2} onClick={() => { setChosen([...chosen, { user_id: null, team: team.trim(), name: null }]); setTeam(""); }}>Add</button></div>
      </Field>
      <Field label="Or a member of staff"><input value={q} onChange={(e) => setQ(e.target.value)} placeholder="Find…" /></Field>
      <ul className="pick-list short">{shown.map((p) => (
        <li key={p.user_id}><button onClick={() => setChosen([...chosen, { user_id: p.user_id, team: null, name: p.name }])}><Avatar name={p.name} size={26} /><span className="grow"><strong>{p.name}</strong><small>{p.job_title}</small></span><Icon name="plus" size={14} /></button></li>
      ))}</ul>
      <label className="check"><input type="checkbox" checked={allDays} onChange={(e) => setAllDays(e.target.checked)} />The same on every cleaning day of this place</label>
      {error && <p className="error">{error}</p>}
      <div className="row"><span className="grow" /><button onClick={onClose}>Cancel</button><button className="primary" disabled={busy} onClick={save}>Save</button></div>
    </Modal>
  );
}

// ---------- Places ----------

function PlacesTab({ schoolId }: { schoolId: string }) {
  const meta = useMeta();
  const [areas, setAreas] = useState<Area[] | null>(null);
  const [edit, setEdit] = useState<Area | "new" | null>(null);
  const [note, setNote] = useState("");
  const [busy, error, run] = useBusy();
  const load = useCallback(() => { clean.areas(schoolId).then(setAreas).catch(() => setAreas([])); }, [schoolId]);
  useEffect(load, [load]);
  return (
    <section className="stack">
      <div className="row wrap"><span className="grow" />
        <button className="with-icon" disabled={busy} onClick={() => run(async () => { const r = await clean.suggest(schoolId); setAreas(r.areas); setNote(r.added ? `Added ${r.added} places from Facilities and hostels.` : "Everything in Facilities is already on the list."); })}>
          <Icon name="sparkle" size={15} />Add from Facilities</button>
        <button className="primary with-icon" onClick={() => setEdit("new")}><Icon name="plus" size={15} />Add a place</button></div>
      {note && <p className="saved-note"><Icon name="check" size={15} />{note}</p>}
      {error && <p className="error">{error}</p>}
      {areas && areas.length === 0 && <Empty icon="sparkle">No places yet. “Add from Facilities” makes one for every classroom, lab, hall and hostel, plus toilets and the compound.</Empty>}
      <div className="place-grid">{(areas ?? []).map((a) => (
        <button key={a.id} className="place-card" style={hue(KIND_HUE[a.kind] ?? "slate")} onClick={() => setEdit(a)}>
          <Glyph icon={a.icon} hue={KIND_HUE[a.kind] ?? "slate"} size={34} />
          <span className="grow"><strong>{a.name}</strong><small>{a.kind_label} · {a.shift} · {a.days.length === 7 ? "every day" : a.days.map((d) => WEEKDAYS[d]).join(" ")}</small>
            <small>{a.checklist.join(" · ")}</small></span>
        </button>
      ))}</div>
      {edit && meta && <AreaForm schoolId={schoolId} meta={meta} area={edit === "new" ? undefined : edit} onClose={() => setEdit(null)} onDone={(x) => { setAreas(x); setEdit(null); }} onRemoved={() => { setEdit(null); load(); }} />}
    </section>
  );
}

function AreaForm({ schoolId, meta, area, onClose, onDone, onRemoved }: { schoolId: string; meta: CleanMeta; area?: Area; onClose: () => void; onDone: (a: Area[]) => void; onRemoved: () => void }) {
  const [f, setF] = useState<AreaIn>(area ? { name: area.name, kind: area.kind, facility_id: area.facility_id, hostel_id: area.hostel_id, days: area.days, shift: area.shift, checklist: area.checklist }
    : { name: "", kind: "classroom", facility_id: null, hostel_id: null, days: [0, 1, 2, 3, 4], shift: "morning", checklist: [] });
  const [item, setItem] = useState("");
  const [busy, error, run] = useBusy();
  const submit = (e: FormEvent) => { e.preventDefault(); run(async () => onDone(area ? await clean.editArea(area.id, f) : await clean.addArea(schoolId, f))); };
  const list = f.checklist.length ? f.checklist : meta.checklists[f.kind] ?? [];
  return (
    <Modal title={area ? area.name : "Add a place to clean"} onClose={onClose}>
      <form className="stack" onSubmit={submit}>
        <Field label="Name"><input required minLength={2} value={f.name} onChange={(e) => setF({ ...f, name: e.target.value })} placeholder="e.g. Toilets block A, JSS classrooms" /></Field>
        <div className="kind-pick">{Object.entries(meta.kinds).map(([k, v]) => <button key={k} type="button" className={`chip pick${f.kind === k ? " on" : ""}`} onClick={() => setF({ ...f, kind: k })}><Icon name={v.icon} size={13} />{v.label}</button>)}</div>
        <Field label="Days"><div className="day-pick">{WEEKDAYS.map((d, i) => (
          <button key={d} type="button" className={f.days.includes(i) ? "on" : ""} onClick={() => setF({ ...f, days: f.days.includes(i) ? f.days.filter((x) => x !== i) : [...f.days, i].sort() })}>{d}</button>))}</div></Field>
        <Field label="When"><div className="segmented small-seg">{Object.entries(meta.shifts).map(([k, l]) => <button key={k} type="button" className={f.shift === k ? "on" : ""} onClick={() => setF({ ...f, shift: k })}>{l}</button>)}</div></Field>
        <Field label="What to do (the checklist)">
          <div className="chips">{list.map((c) => <span key={c} className="hue-chip">{c}<button type="button" className="chip-x" aria-label={`Remove ${c}`} onClick={() => setF({ ...f, checklist: list.filter((x) => x !== c) })}><Icon name="close" size={11} /></button></span>)}</div>
          <div className="row"><input value={item} onChange={(e) => setItem(e.target.value)} placeholder="Add a task…" /><button type="button" disabled={!item.trim()} onClick={() => { setF({ ...f, checklist: [...list, item.trim()] }); setItem(""); }}>Add</button></div>
        </Field>
        {error && <p className="error">{error}</p>}
        <div className="row">{area && <button type="button" className="danger-hover" onClick={() => run(async () => { if (confirm(`Take ${area.name} off the cleaning list?`)) { await clean.removeArea(area.id); onRemoved(); } })}>Remove</button>}
          <span className="grow" /><button type="button" onClick={onClose}>Cancel</button><button className="primary" disabled={busy}>Save</button></div>
      </form>
    </Modal>
  );
}

// ---------- League ----------

function LeagueTab({ schoolId }: { schoolId: string }) {
  const [l, setL] = useState<League | null>(null);
  const [days, setDays] = useState(14);
  useEffect(() => { clean.league(schoolId, days).then(setL).catch(() => {}); }, [schoolId, days]);
  if (!l) return <p className="muted">Loading…</p>;
  return (
    <section className="stack">
      <div className="row wrap"><div className="segmented small-seg">{[7, 14, 30].map((n) => <button key={n} className={days === n ? "on" : ""} onClick={() => setDays(n)}>{n} days</button>)}</div></div>
      {l.insights.length > 0 && <InsightList items={l.insights} schoolId={schoolId} />}
      {l.hostels.length > 0 && (
        <section className="card g-card" style={hue("violet")}>
          <h3 className="with-glyph"><Glyph icon="trophy" hue="violet" size={32} />Cleanest hostel</h3>
          <div className="hostel-podium">{l.hostels.slice(0, 3).map((h, i) => (
            <div key={h.id} className={`podium-step p${i + 1}`}><span className="medal">{["🥇", "🥈", "🥉"][i]}</span><strong>{h.name}</strong><b>{h.score}★</b></div>))}</div>
          {l.hostels.length > 3 && <ol start={4} className="reader-list">{l.hostels.slice(3).map((h) => <li key={h.id}><span className="grow">{h.name}</span><b>{h.score}★</b></li>)}</ol>}
        </section>
      )}
      <div className="growth-grid">
        <section className="card g-card" style={hue("teal")}>
          <h3 className="with-glyph"><Glyph icon="sparkle" hue="teal" size={32} />Every place</h3>
          <ul className="league-list">{l.areas.map((a) => (
            <li key={a.id}><span className="grow"><strong>{a.name}</strong><small>{a.rate != null ? `${a.done} of ${a.due} days cleaned` : "Not due yet"}</small></span>
              <span className="mini-bar wide"><i style={{ width: `${a.rate ?? 0}%`, background: (a.rate ?? 0) < 70 ? "var(--h-red)" : undefined }} /></span>
              <b className="league-score">{a.score != null ? `${a.score}★` : "–"}</b></li>))}</ul>
        </section>
        <section className="card g-card" style={hue("blue")}>
          <h3 className="with-glyph"><Glyph icon="users" hue="blue" size={32} />Cleaners</h3>
          {l.people.length === 0 ? <p className="muted small">No cleaners on the rota yet.</p> : (
            <ul className="league-list">{l.people.map((p, i) => (
              <li key={i}><Avatar name={p.name ?? "?"} size={28} /><span className="grow"><strong>{p.name}</strong><small>{p.done} of {p.due} ticked off</small></span><b className="league-score">{p.rate ?? "–"}%</b></li>))}</ul>
          )}
        </section>
      </div>
    </section>
  );
}

// ---------- On a cleaner's own page ----------

export function MyCleaningCard({ schoolId }: { schoolId: string }) {
  const [m, setM] = useState<Awaited<ReturnType<typeof clean.mine>> | null>(null);
  const [open, setOpen] = useState(false);
  const load = useCallback(() => { clean.mine(schoolId).then(setM).catch(() => {}); }, [schoolId]);
  useEffect(load, [load]);
  if (!m || (m.areas.length === 0 && !m.inspects)) return null;
  const done = m.areas.filter((a) => a.done).length;
  return (
    <section className="card editor portal-card" style={hue("teal")}>
      <div className="card-head"><h2 className="with-glyph"><Glyph icon="sparkle" hue="teal" size={34} />Cleaning today</h2></div>
      {m.areas.length > 0 ? <p className="desk-big"><b>{done}/{m.areas.length}</b>places done</p> : <p className="small">You inspect cleaning. Give each place its stars.</p>}
      <ul className="loan-mini">{m.areas.map((a) => <li key={a.id}><Icon name={a.done ? "circle-check" : "hourglass"} size={16} /><span className="grow"><strong>{a.name}</strong><small>{a.shift}</small></span>{a.score != null && <span className="stars">{"★".repeat(a.score)}</span>}</li>)}</ul>
      <button className="primary with-icon" onClick={() => setOpen(true)}><Icon name="sparkle" size={16} />Open my cleaning</button>
      {open && <Modal title="Cleaning today" onClose={() => { setOpen(false); load(); }}><CleaningToday schoolId={schoolId} /></Modal>}
    </section>
  );
}

