// The asset register: everything valuable with a tag and QR label, its value now, repairs, and stock-takes.
import { useCallback, useEffect, useMemo, useState, type FormEvent } from "react";
import { errorText } from "./api";
import { InsightList, useBusy } from "./GrowthBits";
import Icon from "./Icon";
import { useCanChange } from "./rightsApi";
import { PrintSheet, Qr, ScanBox, beep } from "./Scanner";
import { structure, type PersonOption } from "./structureApi";
import { assets, loadAssetMeta, naira, nairaShort, type AssetDetail, type AssetIn, type AssetList, type AssetMeta, type AssetRow, type StockTake } from "./threeApi";
import { Empty, Field, Glyph, hue, Modal, Stat } from "./ui";

const CAT_HUE: Record<string, string> = { furniture: "amber", ict: "blue", lab: "teal", kitchen: "lime", electrical: "orange", sports: "green", office: "slate", music: "pink", other: "violet" };
const STATUS_HUE: Record<string, string> = { in_use: "green", in_store: "sky", repair: "orange", lost: "red", disposed: "slate" };
const COND_HUE: Record<string, string> = { new: "green", good: "teal", fair: "amber", poor: "orange", broken: "red" };
const nice = (d: string | null) => (d ? new Date(d.length === 10 ? `${d}T12:00:00` : d).toLocaleDateString("en-GB", { day: "numeric", month: "short", year: "numeric" }) : "–");

function useMeta(): AssetMeta | null {
  const [m, setM] = useState<AssetMeta | null>(null);
  useEffect(() => { loadAssetMeta().then(setM).catch(() => {}); }, []);
  return m;
}

export default function AssetsPage({ schoolId }: { schoolId: string }) {
  const meta = useMeta();
  const canChange = useCanChange();
  const [d, setD] = useState<AssetList | null>(null);
  const [q, setQ] = useState("");
  const [cat, setCat] = useState("");
  const [place, setPlace] = useState("");
  const [stat, setStat] = useState("");
  const [picked, setPicked] = useState<Set<string>>(new Set());
  const [grouped, setGrouped] = useState(true);
  const [modal, setModal] = useState<null | "add" | "labels" | "counts" | "scan" | { id: string } | { count: string } | { group: AssetRow[] }>(null);
  const load = useCallback(() => { assets.list(schoolId).then(setD).catch(() => {}); }, [schoolId]);
  useEffect(load, [load]);
  const rows = useMemo(() => (d?.assets ?? []).filter((a) => (!cat || a.category === cat) && (!place || (a.facility_id ?? "none") === place) && (stat ? a.status === stat : a.status !== "disposed")
    && (!q || `${a.name} ${a.tag} ${a.make_model ?? ""} ${a.serial_no ?? ""} ${a.place ?? ""} ${a.assigned_to ?? ""}`.toLowerCase().includes(q.toLowerCase()))), [d, q, cat, place, stat]);
  const groups = useMemo(() => {
    const m = new Map<string, AssetRow[]>();
    for (const a of rows) { const k = `${a.name}|${a.category}|${a.place ?? ""}|${a.status}`; m.set(k, [...(m.get(k) ?? []), a]); }
    return [...m.values()];
  }, [rows]);
  if (!d || !meta) return <p className="muted">Loading…</p>;
  const toggle = (id: string) => { const s = new Set(picked); if (s.has(id)) s.delete(id); else s.add(id); setPicked(s); };
  return (
    <section className="stack assets">
      <div className="stat-strip">
        <Stat icon="layers" hue="indigo" value={d.totals.count} label="items" note={`Cost ${naira(d.totals.cost)}`} />
        <Stat icon="coins" hue="green" value={nairaShort(d.totals.value)} label="worth now" note={`${naira(d.totals.value)} after wear and age`} />
        <Stat icon="wrench" hue="orange" value={d.totals.repair} label="being repaired" note={`${d.totals.poor} poor or broken`} />
        <Stat icon="search" hue={d.totals.missing ? "red" : "teal"} value={d.totals.missing} label="missing" note="From stock-takes" />
      </div>
      {d.insights.length > 0 && <InsightList items={d.insights} schoolId={schoolId} />}
      <div className="row wrap">
        <label className="search grow"><Icon name="search" size={16} /><input placeholder="Name, tag, serial number, place or person…" value={q} onChange={(e) => setQ(e.target.value)} /></label>
        <button className="with-icon" onClick={() => setModal("scan")}><Icon name="scan-qr" size={16} />Scan a label</button>
        <button className="with-icon" onClick={() => setModal("counts")}><Icon name="clipboard" size={16} />Stock-take</button>
        {canChange && <button className="primary with-icon" onClick={() => setModal("add")}><Icon name="plus" size={16} />Add items</button>}
      </div>
      <div className="row wrap">
        <div className="chips">{[["", "All"], ...Object.entries(meta.categories).map(([k, v]) => [k, v.label])].map(([k, l]) => (
          <button key={k} className={`chip pick${cat === k ? " on" : ""}`} style={k ? hue(CAT_HUE[k]) : undefined} onClick={() => setCat(k)}>{l}</button>))}</div>
        <span className="grow" />
        <select aria-label="Place" value={place} onChange={(e) => setPlace(e.target.value)}><option value="">Every place</option><option value="none">No place</option>{d.facilities.map((f) => <option key={f.id} value={f.id}>{f.name}</option>)}</select>
        <select aria-label="Status" value={stat} onChange={(e) => setStat(e.target.value)}><option value="">In the school</option>{Object.entries(meta.statuses).map(([k, l]) => <option key={k} value={k}>{l}</option>)}</select>
      </div>
      {picked.size > 0 && (
        <div className="pick-bar"><b>{picked.size}</b> picked<span className="grow" />
          <button className="with-icon small" onClick={() => setModal("labels")}><Icon name="scan-qr" size={14} />Print labels</button>
          <button className="small" onClick={() => setPicked(new Set())}>Clear</button></div>
      )}
      {rows.length === 0 ? <Empty icon="layers">{d.assets.length ? "Nothing matches." : "Nothing on the register yet. Add projectors, computers, generators, lab equipment, furniture…"}</Empty> : (
        <>
          <div className="row wrap"><button className="text-link small" onClick={() => setPicked(new Set(rows.map((r) => r.id)))}>Pick all {rows.length} shown (for labels)</button><span className="grow" />
            <label className="check small"><input type="checkbox" checked={grouped} onChange={(e) => setGrouped(e.target.checked)} />Put identical items together</label></div>
          <div className="asset-grid">{grouped
            ? groups.map((g) => g.length === 1
              ? <AssetCard key={g[0].id} a={g[0]} picked={picked.has(g[0].id)} onPick={() => toggle(g[0].id)} onOpen={() => setModal({ id: g[0].id })} />
              : <GroupCard key={g[0].id} g={g} picked={g.every((x) => picked.has(x.id))} onPick={() => { const s2 = new Set(picked); const all = g.every((x) => s2.has(x.id)); g.forEach((x) => (all ? s2.delete(x.id) : s2.add(x.id))); setPicked(s2); }} onOpen={() => setModal({ group: g })} />)
            : rows.map((a) => <AssetCard key={a.id} a={a} picked={picked.has(a.id)} onPick={() => toggle(a.id)} onOpen={() => setModal({ id: a.id })} />)}</div>
        </>
      )}
      {modal === "add" && <AssetForm schoolId={schoolId} meta={meta} list={d} onClose={() => setModal(null)} onDone={(x, tags) => { setD(x); setModal(null); setPicked(new Set(x.assets.filter((a) => tags.includes(a.tag)).map((a) => a.id))); }} />}
      {modal === "labels" && <AssetLabels schoolId={schoolId} ids={[...picked]} onClose={() => setModal(null)} />}
      {modal === "scan" && <ScanFind schoolId={schoolId} onClose={() => setModal(null)} onFound={(id) => setModal({ id })} />}
      {modal === "counts" && <CountsList schoolId={schoolId} list={d} onClose={() => setModal(null)} onOpen={(id) => setModal({ count: id })} />}
      {modal && typeof modal === "object" && "id" in modal && <AssetView id={modal.id} schoolId={schoolId} meta={meta} list={d} onClose={() => { setModal(null); load(); }} />}
      {modal && typeof modal === "object" && "group" in modal && (
        <Modal title={`${modal.group[0].name} × ${modal.group.length}`} onClose={() => setModal(null)}>
          <p className="muted small">{modal.group[0].place ?? "No place"} · worth {naira(modal.group.reduce((n, x) => n + (x.value ?? 0), 0))} together</p>
          <ul className="pick-list">{modal.group.map((x) => (
            <li key={x.id}><button onClick={() => setModal({ id: x.id })}><span className="asset-tag">{x.tag}</span><span className="grow"><strong>{x.condition}</strong><small>{x.assigned_to ?? ""}{x.repairs ? ` · ${x.repairs} repairs` : ""}</small></span><Icon name="chevron-right" size={14} /></button></li>
          ))}</ul>
        </Modal>
      )}
      {modal && typeof modal === "object" && "count" in modal && <CountScreen id={modal.count} onClose={() => { setModal(null); load(); }} />}
    </section>
  );
}

function AssetCard({ a, picked, onPick, onOpen }: { a: AssetRow; picked: boolean; onPick: () => void; onOpen: () => void }) {
  return (
    <article className={`asset-card s-${a.status}${picked ? " picked" : ""}`} style={hue(CAT_HUE[a.category] ?? "slate")}>
      <label className="asset-pick" aria-label={`Pick ${a.name}`}><input type="checkbox" checked={picked} onChange={onPick} /></label>
      <button className="asset-body" onClick={onOpen}>
        <span className="asset-top">{a.photo ? <img className="asset-photo" src={a.photo} alt="" /> : <Glyph icon={a.icon} hue={CAT_HUE[a.category] ?? "slate"} size={40} />}
          <span className="grow"><strong>{a.name}</strong><span className="asset-tag">{a.tag}</span></span></span>
        <span className="small muted">{[a.place, a.assigned_to].filter(Boolean).join(" · ") || "No place yet"}</span>
        <span className="pill-row">
          <span className="mini-pill" style={hue(STATUS_HUE[a.status])}>{a.status_label}</span>
          <span className="mini-pill" style={hue(COND_HUE[a.condition])}>{a.condition}</span>
          {a.repairs > 0 && <span className="mini-pill" style={hue("orange")}><Icon name="wrench" size={11} />{a.repairs}</span>}
          {a.warranty_days != null && a.warranty_days >= 0 && a.warranty_days <= 60 && <span className="mini-pill" style={hue("amber")}>Warranty {a.warranty_days}d</span>}
        </span>
        {a.cost != null && <span className="asset-value"><b>{naira(a.value)}</b><small>of {naira(a.cost)}</small><span className="value-bar"><i style={{ width: `${a.cost ? Math.round(((a.value ?? 0) / a.cost) * 100) : 0}%` }} /></span></span>}
      </button>
    </article>
  );
}

function GroupCard({ g, picked, onPick, onOpen }: { g: AssetRow[]; picked: boolean; onPick: () => void; onOpen: () => void }) {
  const a = g[0];
  const value = g.reduce((n, x) => n + (x.value ?? 0), 0);
  const cost = g.reduce((n, x) => n + (x.cost ?? 0), 0);
  const poor = g.filter((x) => x.condition === "poor" || x.condition === "broken").length;
  return (
    <article className={`asset-card group${picked ? " picked" : ""}`} style={hue(CAT_HUE[a.category] ?? "slate")}>
      <label className="asset-pick" aria-label={`Pick all ${a.name}`}><input type="checkbox" checked={picked} onChange={onPick} /></label>
      <button className="asset-body" onClick={onOpen}>
        <span className="asset-top"><span className="stack-glyph"><Glyph icon={a.icon} hue={CAT_HUE[a.category] ?? "slate"} size={40} /><b>×{g.length}</b></span>
          <span className="grow"><strong>{a.name}</strong><span className="asset-tag">{g[0].tag} … {g[g.length - 1].tag.split("-").pop()}</span></span></span>
        <span className="small muted">{a.place ?? "No place yet"}</span>
        <span className="pill-row">
          <span className="mini-pill" style={hue(STATUS_HUE[a.status])}>{a.status_label}</span>
          {poor > 0 && <span className="mini-pill" style={hue("orange")}>{poor} poor or broken</span>}
        </span>
        {cost > 0 && <span className="asset-value"><b>{naira(value)}</b><small>of {naira(cost)}</small><span className="value-bar"><i style={{ width: `${Math.round((value / cost) * 100)}%` }} /></span></span>}
      </button>
    </article>
  );
}

const EMPTY: AssetIn = { name: "", category: "ict", make_model: null, serial_no: null, facility_id: null, location: null, assigned_to_id: null, supplier: null, purchase_date: null,
  cost: null, life_years: null, warranty_until: null, condition: "good", status: "in_use", photo: null, notes: null, quantity: 1 };

function AssetForm({ schoolId, meta, list, asset, onClose, onDone, onSaved }: {
  schoolId: string; meta: AssetMeta; list: AssetList; asset?: AssetDetail; onClose: () => void; onDone?: (x: AssetList, tags: string[]) => void; onSaved?: (a: AssetDetail) => void;
}) {
  const [f, setF] = useState<AssetIn>(asset ? { ...EMPTY, ...asset, quantity: 1 } : EMPTY);
  const [people, setPeople] = useState<PersonOption[]>([]);
  const [busy, error, run] = useBusy();
  useEffect(() => { structure.staffOptions(schoolId).then(setPeople).catch(() => {}); }, [schoolId]);
  const s = (k: keyof AssetIn, v: string) => setF({ ...f, [k]: ["cost", "life_years"].includes(k) ? (v ? Number(v) : null) : v || null });
  const submit = (e: FormEvent) => {
    e.preventDefault();
    run(async () => {
      if (asset) onSaved?.(await assets.edit(asset.id, f));
      else { const r = await assets.add(schoolId, f); onDone?.(r, r.tags); }
    });
  };
  const photo = (file: File | undefined) => {
    if (!file) return;
    const img = new Image(); const url = URL.createObjectURL(file);
    img.onload = () => { const c = document.createElement("canvas"); const sc = Math.min(1, 480 / Math.max(img.width, img.height)); c.width = img.width * sc; c.height = img.height * sc;
      c.getContext("2d")?.drawImage(img, 0, 0, c.width, c.height); setF((x) => ({ ...x, photo: c.toDataURL("image/jpeg", 0.75) })); URL.revokeObjectURL(url); };
    img.src = url;
  };
  const life = meta.categories[f.category]?.life;
  return (
    <Modal title={asset ? `Edit ${asset.tag}` : "Add items to the register"} onClose={onClose}>
      <form className="stack" onSubmit={submit}>
        <div className="kind-pick">{Object.entries(meta.categories).map(([k, v]) => <button key={k} type="button" className={`chip pick${f.category === k ? " on" : ""}`} onClick={() => setF({ ...f, category: k })}><Icon name={v.icon} size={13} />{v.label}</button>)}</div>
        <div className="row wrap">
          <Field label="What is it"><input required minLength={2} value={f.name} onChange={(e) => setF({ ...f, name: e.target.value })} placeholder="e.g. Projector, Office chair, Microscope" /></Field>
          {!asset && <Field label="How many" hint="Each gets its own tag"><input type="number" min={1} max={300} value={f.quantity} onChange={(e) => setF({ ...f, quantity: Number(e.target.value) || 1 })} /></Field>}
        </div>
        <div className="row wrap">
          <Field label="Make and model"><input value={f.make_model ?? ""} onChange={(e) => s("make_model", e.target.value)} /></Field>
          <Field label="Serial number"><input value={f.serial_no ?? ""} onChange={(e) => s("serial_no", e.target.value)} /></Field>
        </div>
        <div className="row wrap">
          <Field label="Where"><select value={f.facility_id ?? ""} onChange={(e) => s("facility_id", e.target.value)}><option value="">Not in a facility</option>{list.facilities.map((x) => <option key={x.id} value={x.id}>{x.name}</option>)}</select></Field>
          {!f.facility_id && <Field label="Or describe the place"><input value={f.location ?? ""} onChange={(e) => s("location", e.target.value)} placeholder="e.g. Principal's office" /></Field>}
          <Field label="Kept by (optional)"><select value={f.assigned_to_id ?? ""} onChange={(e) => s("assigned_to_id", e.target.value)}><option value="">Nobody</option>{people.map((p) => <option key={p.id} value={p.id}>{p.full_name}</option>)}</select></Field>
        </div>
        <div className="row wrap">
          <Field label="Bought on"><input type="date" value={f.purchase_date ?? ""} onChange={(e) => s("purchase_date", e.target.value)} /></Field>
          <Field label="Cost each (₦)"><input type="number" min={0} value={f.cost ?? ""} onChange={(e) => s("cost", e.target.value)} /></Field>
          <Field label="Lasts (years)" hint={life ? `Usually about ${life}` : undefined}><input type="number" min={1} max={60} value={f.life_years ?? ""} placeholder={life ? String(life) : ""} onChange={(e) => s("life_years", e.target.value)} /></Field>
        </div>
        <div className="row wrap">
          <Field label="Supplier"><input value={f.supplier ?? ""} onChange={(e) => s("supplier", e.target.value)} /></Field>
          <Field label="Warranty until"><input type="date" value={f.warranty_until ?? ""} onChange={(e) => s("warranty_until", e.target.value)} /></Field>
        </div>
        <div className="row wrap">
          <Field label="Condition"><select value={f.condition} onChange={(e) => setF({ ...f, condition: e.target.value })}>{Object.entries(meta.conditions).map(([k, l]) => <option key={k} value={k}>{l}</option>)}</select></Field>
          <Field label="Status"><select value={f.status} onChange={(e) => setF({ ...f, status: e.target.value })}>{Object.entries(meta.statuses).map(([k, l]) => <option key={k} value={k}>{l}</option>)}</select></Field>
          <Field label="Photo (optional)"><input type="file" accept="image/*" capture="environment" onChange={(e) => photo(e.target.files?.[0])} /></Field>
        </div>
        <Field label="Notes"><textarea rows={2} value={f.notes ?? ""} onChange={(e) => s("notes", e.target.value)} /></Field>
        {!asset && <p className="muted small">Tags look like <b>{list.prefix}-{meta.categories[f.category]?.code}-0001</b>. You can print QR labels for them straight after.</p>}
        {error && <p className="error">{error}</p>}
        <div className="row"><span className="grow" /><button type="button" onClick={onClose}>Cancel</button><button className="primary" disabled={busy}>{asset ? "Save" : `Add ${f.quantity > 1 ? `${f.quantity} items` : "item"}`}</button></div>
      </form>
    </Modal>
  );
}

function AssetView({ id, schoolId, meta, list, onClose }: { id: string; schoolId: string; meta: AssetMeta; list: AssetList; onClose: () => void }) {
  const canChange = useCanChange();
  const [a, setA] = useState<AssetDetail | null>(null);
  const [mode, setMode] = useState<null | "edit" | "fault" | "label">(null);
  const [busy, error, run] = useBusy();
  useEffect(() => { assets.one(id).then(setA).catch(() => {}); }, [id]);
  if (!a) return <Modal title="Item" onClose={onClose}><p className="muted">Loading…</p></Modal>;
  if (mode === "edit") return <AssetForm schoolId={schoolId} meta={meta} list={list} asset={a} onClose={() => setMode(null)} onSaved={(x) => { setA(x); setMode(null); }} />;
  return (
    <Modal title={a.name} onClose={onClose}>
      <div className="asset-head">
        {a.photo ? <img className="asset-photo big" src={a.photo} alt="" /> : <Glyph icon={a.icon} hue={CAT_HUE[a.category] ?? "slate"} size={64} />}
        <div className="grow">
          <p><span className="asset-tag">{a.tag}</span> {a.category_label}{a.make_model && ` · ${a.make_model}`}</p>
          <p className="pill-row"><span className="mini-pill" style={hue(STATUS_HUE[a.status])}>{a.status_label}</span><span className="mini-pill" style={hue(COND_HUE[a.condition])}>{meta.conditions[a.condition]}</span></p>
          <p className="small">{a.place ?? "No place"}{a.assigned_to && ` · kept by ${a.assigned_to}`}</p>
        </div>
        <Qr text={a.code} size={84} />
      </div>
      <dl className="asset-facts">
        <dt>Bought</dt><dd>{nice(a.purchase_date)}{a.supplier && ` from ${a.supplier}`}</dd>
        <dt>Cost</dt><dd>{naira(a.cost)}</dd>
        <dt>Worth now</dt><dd><b>{naira(a.value)}</b>{a.end_of_life && <span className="muted"> · useful until about {nice(a.end_of_life)}</span>}</dd>
        <dt>Warranty</dt><dd>{a.warranty_until ? `${nice(a.warranty_until)}${a.warranty_days! < 0 ? " (ended)" : ` (${a.warranty_days} days left)`}` : "–"}</dd>
        <dt>Serial</dt><dd>{a.serial_no ?? "–"}</dd>
        <dt>Last seen</dt><dd>{a.last_seen_at ? nice(a.last_seen_at) : "Not in a stock-take yet"}</dd>
        <dt>Repairs</dt><dd>{a.repairs} this year{a.repair_cost ? `, ${naira(a.repair_cost)} on parts` : ""}</dd>
      </dl>
      {a.notes && <p className="small">{a.notes}</p>}
      <div className="row wrap">
        <button className="with-icon" onClick={() => setMode("fault")}><Icon name="wrench" size={15} />Report a fault</button>
        <button className="with-icon" onClick={() => setMode("label")}><Icon name="scan-qr" size={15} />Print its label</button>
        {canChange && <button className="with-icon" onClick={() => setMode("edit")}><Icon name="edit" size={15} />Edit or move</button>}
        {canChange && <button className="text-link danger-hover" disabled={busy} onClick={() => run(async () => { if (confirm(`Delete ${a.tag}? To keep its record, set its status to “Disposed of” instead.`)) { await assets.remove(a.id); onClose(); } })}>Delete</button>}
      </div>
      {a.jobs.length > 0 && <><h4 className="goals-title"><Icon name="wrench" size={16} />Jobs and repairs</h4>
        <ul className="fac-jobs">{a.jobs.map((j) => <li key={j.number} className={j.status === "done" || j.status === "closed" ? "done" : ""}><span className="job-no">#{j.number}</span>
          <span className="grow"><strong>{j.title}</strong><small className="block muted">{nice(j.created_at)}{j.fixed_by && ` · ${j.fixed_by}`}{j.cost ? ` · ${naira(j.cost)}` : ""}</small></span>
          <span className="hue-chip" style={hue(j.status === "done" || j.status === "closed" ? "green" : "orange")}>{j.status}</span></li>)}</ul></>}
      {a.history.length > 0 && <><h4 className="goals-title"><Icon name="history" size={16} />History</h4>
        <ul className="audit-list">{a.history.map((h, i) => <li key={i}><span className="grow">{h.text}<small className="block muted">{h.by}</small></span><small>{nice(h.at)}</small></li>)}</ul></>}
      {error && <p className="error">{error}</p>}
      {mode === "fault" && <FaultForm a={a} onClose={() => setMode(null)} onDone={(x) => { setA(x); setMode(null); }} />}
      {mode === "label" && <AssetLabels schoolId={schoolId} ids={[a.id]} onClose={() => setMode(null)} />}
    </Modal>
  );
}

function FaultForm({ a, onClose, onDone }: { a: AssetDetail; onClose: () => void; onDone: (x: AssetDetail) => void }) {
  const [title, setTitle] = useState("");
  const [details, setDetails] = useState("");
  const [priority, setPriority] = useState("normal");
  const [busy, error, run] = useBusy();
  return (
    <Modal title={`Fault: ${a.name}`} onClose={onClose}>
      <p className="muted small">This goes to the {a.category === "ict" ? "IT team" : "maintenance team"} as a job, linked to {a.tag}, so its repairs and costs add up here.</p>
      <Field label="What's wrong"><input autoFocus value={title} onChange={(e) => setTitle(e.target.value)} placeholder="e.g. Won't switch on" /></Field>
      <Field label="More details (optional)"><textarea rows={2} value={details} onChange={(e) => setDetails(e.target.value)} /></Field>
      <div className="segmented small-seg">{[["low", "Can wait"], ["normal", "Normal"], ["urgent", "Urgent"]].map(([k, l]) => <button key={k} type="button" className={priority === k ? "on" : ""} onClick={() => setPriority(k)}>{l}</button>)}</div>
      {error && <p className="error">{error}</p>}
      <div className="row"><span className="grow" /><button onClick={onClose}>Cancel</button><button className="primary" disabled={busy || title.trim().length < 3} onClick={() => run(async () => onDone(await assets.fault(a.id, { title, details: details || null, priority })))}>Send</button></div>
    </Modal>
  );
}

function AssetLabels({ schoolId, ids, onClose }: { schoolId: string; ids: string[]; onClose: () => void }) {
  const [d, setD] = useState<Awaited<ReturnType<typeof assets.labels>> | null>(null);
  useEffect(() => { assets.labels(schoolId, ids).then(setD).catch(() => {}); }, [schoolId, ids]);
  return (
    <PrintSheet title={`Asset labels (${ids.length})`} note="Print on sticker paper, or on plain paper and tape them on." onClose={onClose}>
      <div className="label-sheet">{(d?.labels ?? []).map((l) => (
        <div key={l.tag} className="qr-label"><Qr text={l.code} size={64} /><span><b>{l.tag}</b><small>{l.name}</small><small>Property of {d?.school}</small></span></div>
      ))}</div>
    </PrintSheet>
  );
}

function ScanFind({ schoolId, onClose, onFound }: { schoolId: string; onClose: () => void; onFound: (id: string) => void }) {
  const [error, setError] = useState("");
  return (
    <Modal title="Scan an asset label" onClose={onClose}>
      <ScanBox placeholder={"Scan the label, or type the tag"} onCode={(c) => assets.find(schoolId, c).then((a) => onFound(a.id)).catch((e) => { setError(errorText(e)); beep(false); })} />
      {error && <p className="error">{error}</p>}
    </Modal>
  );
}

// ---------- Stock-takes ----------

function CountsList({ schoolId, list, onClose, onOpen }: { schoolId: string; list: AssetList; onClose: () => void; onOpen: (id: string) => void }) {
  const [rows, setRows] = useState<Awaited<ReturnType<typeof assets.counts>> | null>(null);
  const [name, setName] = useState(`Stock-take ${new Date().toLocaleDateString("en-GB", { month: "long", year: "numeric" })}`);
  const [fac, setFac] = useState("");
  const [busy, error, run] = useBusy();
  useEffect(() => { assets.counts(schoolId).then(setRows).catch(() => setRows([])); }, [schoolId]);
  return (
    <Modal title="Stock-takes" onClose={onClose}>
      <p className="muted small">Walk round with a phone. Scan each label (or tick it). When you finish, anything not found is marked missing.</p>
      <div className="row wrap">
        <Field label="Name"><input value={name} onChange={(e) => setName(e.target.value)} /></Field>
        <Field label="Where"><select value={fac} onChange={(e) => setFac(e.target.value)}><option value="">The whole school</option>{list.facilities.map((f) => <option key={f.id} value={f.id}>{f.name}</option>)}</select></Field>
      </div>
      <button className="primary with-icon" disabled={busy || name.trim().length < 2} onClick={() => run(async () => { const c = await assets.startCount(schoolId, name, fac || null); onOpen(c.id); })}><Icon name="clipboard" size={15} />Start</button>
      {error && <p className="error">{error}</p>}
      {rows && rows.length > 0 && <ul className="count-list">{rows.map((c) => (
        <li key={c.id}><button onClick={() => onOpen(c.id)}><span className="grow"><strong>{c.name}</strong><small>{c.place} · {c.started_by} · {nice(c.created_at)}</small></span>
          <span className="hue-chip" style={hue(c.closed_at ? "green" : "amber")}>{c.closed_at ? "Finished" : "Open"}</span><b>{c.found}/{c.expected}</b></button></li>))}</ul>}
    </Modal>
  );
}

function CountScreen({ id, onClose }: { id: string; onClose: () => void }) {
  const [c, setC] = useState<StockTake | null>(null);
  const [msg, setMsg] = useState<{ tone: "good" | "bad" | "info"; text: string } | null>(null);
  const [filter, setFilter] = useState<"todo" | "found" | "all">("todo");
  const [busy, error, run] = useBusy();
  useEffect(() => { assets.count(id).then(setC).catch(() => {}); }, [id]);
  if (!c) return <Modal title="Stock-take" onClose={onClose}><p className="muted">Loading…</p></Modal>;
  const scan = (code: string) => run(async () => {
    try {
      const r = await assets.seen(c.id, code);
      setC(r); beep(true);
      setMsg({ tone: r.moved ? "info" : "good", text: r.moved ?? `Found: ${r.asset.name} (${r.asset.tag})` });
    } catch (e) { setMsg({ tone: "bad", text: errorText(e) }); beep(false); }
  });
  const pct = c.expected.length ? Math.round((c.found / c.expected.length) * 100) : 0;
  const shown = c.expected.filter((e) => filter === "all" || (filter === "found" ? e.found : !e.found));
  return (
    <Modal title={c.name} onClose={onClose}>
      <div className="row"><span className="setup-ring" style={{ ...hue(pct === 100 ? "green" : "indigo"), ["--pct" as string]: `${pct}%` }}><b>{pct}%</b></span>
        <span className="grow"><b>{c.found}</b> of {c.expected.length} found · {c.place}{c.elsewhere > 0 && ` · ${c.elsewhere} from other places`}</span></div>
      {!c.closed_at && <ScanBox placeholder="Scan a label or type a tag" onCode={scan} busy={busy} />}
      {msg && <p className={`desk-msg ${msg.tone}`}><Icon name={msg.tone === "bad" ? "circle-x" : "circle-check"} size={16} />{msg.text}</p>}
      <div className="segmented small-seg">{([["todo", "Not found yet"], ["found", "Found"], ["all", "All"]] as const).map(([k, l]) => <button key={k} className={filter === k ? "on" : ""} onClick={() => setFilter(k)}>{l}</button>)}</div>
      <ul className="count-items">{shown.map((e) => (
        <li key={e.id} className={e.found ? "found" : ""}>
          <label className="check"><input type="checkbox" disabled={!!c.closed_at || busy} checked={!!e.found} onChange={(ev) => run(async () => setC(await assets.seen(c.id, e.tag, null, !ev.target.checked)))} />
            <span><strong>{e.name}</strong> <span className="asset-tag">{e.tag}</span><small className="block muted">{e.place ?? "No place"}</small></span></label>
        </li>))}</ul>
      {error && <p className="error">{error}</p>}
      {!c.closed_at && <div className="row"><span className="grow" />
        <button className="primary" disabled={busy} onClick={() => run(async () => {
          const missing = c.expected.length - c.found;
          if (confirm(missing ? `Finish? ${missing} item${missing > 1 ? "s" : ""} not found will be marked missing.` : "Finish the stock-take?")) setC(await assets.closeCount(c.id, true));
        })}>Finish the stock-take</button></div>}
      {c.closed_at && <p className="saved-note"><Icon name="check" size={15} />Finished on {nice(c.closed_at)}.</p>}
    </Modal>
  );
}
