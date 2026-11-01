// The store (and the kitchen's food store): items, deliveries in, issues out, counts and the shopping list.
import { useCallback, useEffect, useState, type FormEvent } from "react";
import { InsightList, useBusy } from "./GrowthBits";
import Icon from "./Icon";
import { CAT_LOOK, logi, naira, units, type Item, type ItemIn, type Move, type Shopping, type Stock } from "./logiApi";
import { dayTime, ops, type Ticket } from "./opsApi";
import { Empty, Field, Glyph, hue, Modal } from "./ui";

export function StoreBoard({ schoolId, store }: { schoolId: string; store: "main" | "kitchen" }) {
  const [s, setS] = useState<Stock | null>(null);
  const [q, setQ] = useState("");
  const [cat, setCat] = useState("all");
  const [modal, setModal] = useState<null | "add" | "shop" | "issue" | { item: Item }>(null);
  const [error, setError] = useState("");
  const load = useCallback(() => { logi.stock(schoolId, store).then(setS).catch((e) => setError(String(e.message ?? e))); }, [schoolId, store]);
  useEffect(load, [load]);
  if (error) return <p className="error">{error}</p>;
  if (!s) return <p className="muted">Loading…</p>;
  const rows = s.items.filter((i) => (cat === "all" || i.category === cat || (cat === "attention" && i.status !== "ok")) && (!q || i.name.toLowerCase().includes(q.toLowerCase())));
  const low = s.items.filter((i) => i.status !== "ok").length;
  return (
    <section className="stack">
      <div className="stat-strip">
        <div className="stat-tile" style={hue("blue")}><Glyph icon="store" hue="blue" size={44} /><div className="stat-text"><strong>{s.items.length}</strong><span>Items</span><span className="stat-note">in the {store === "kitchen" ? "food store" : "store"}</span></div></div>
        <button className="stat-tile as-button" style={hue(low ? "red" : "green")} onClick={() => setCat("attention")}><Glyph icon="circle-x" hue={low ? "red" : "green"} size={44} /><div className="stat-text"><strong>{low}</strong><span>Low or out</span><span className="stat-note">tap to see them</span></div></button>
        <div className="stat-tile" style={hue("green")}><Glyph icon="banknote" hue="green" size={44} /><div className="stat-text"><strong>{naira(s.value)}</strong><span>Stock value</span><span className="stat-note">at the last price paid</span></div></div>
        <button className="stat-tile as-button" style={hue("violet")} onClick={() => setModal("shop")}><Glyph icon="clipboard-list" hue="violet" size={44} /><div className="stat-text"><strong>List</strong><span>Shopping list</span><span className="stat-note">what to buy next</span></div></button>
      </div>
      {s.insights.length > 0 && <InsightList items={s.insights} schoolId={schoolId} />}
      <div className="day-toolbar">
        <input className="day-search" placeholder="Find an item…" value={q} onChange={(e) => setQ(e.target.value)} />
        <span className="grow" />
        {store === "main" && <button className="with-icon" onClick={() => setModal("issue")}><Icon name="log-out" size={16} />Give out items</button>}
        <button className="primary with-icon" onClick={() => setModal("add")}><Icon name="plus" size={16} />New item</button>
      </div>
      <div className="day-filters">
        <button className={`hue-chip pick-chip${cat === "all" ? " on" : ""}`} style={hue("blue")} onClick={() => setCat("all")}>All <b>{s.items.length}</b></button>
        {Object.entries(s.categories).filter(([k]) => s.items.some((i) => i.category === k)).map(([k, l]) => { const lk = CAT_LOOK[k] ?? CAT_LOOK.other; return (
          <button key={k} className={`hue-chip pick-chip${cat === k ? " on" : ""}`} style={hue(lk.hue)} onClick={() => setCat(k)}><Icon name={lk.icon} size={13} />{l} <b>{s.items.filter((i) => i.category === k).length}</b></button>); })}
      </div>
      {rows.length === 0 ? <Empty icon="store">{s.items.length ? "Nothing matches." : "No items yet. Add what's in the store, with how many you have now."}</Empty> : (
        <div className="item-grid">
          {rows.map((i) => { const lk = CAT_LOOK[i.category] ?? CAT_LOOK.other; const pct = Math.min(100, i.reorder_level ? (i.quantity / (i.reorder_level * 2)) * 100 : 100); return (
            <button key={i.id} className={`item-card s-${i.status}`} style={hue(i.status === "out" ? "red" : i.status === "low" ? "amber" : lk.hue)} onClick={() => setModal({ item: i })}>
              <span className="item-top"><Glyph icon={lk.icon} hue={lk.hue} size={34} soft /><span className="item-name"><strong>{i.name}</strong><span className="muted small">{i.category_label}</span></span></span>
              <span className="item-qty"><b>{Number.isInteger(i.quantity) ? i.quantity : i.quantity.toFixed(1)}</b> {units(i.quantity, i.unit).split(" ").slice(1).join(" ")}</span>
              <span className="item-bar"><i style={{ width: `${pct}%` }} /><span className="item-mark" style={{ left: "50%" }} title={`Reorder at ${i.reorder_level}`} /></span>
              <span className="item-foot">
                {i.status === "out" ? <span className="hue-chip" style={hue("red")}>Out of stock</span> : i.status === "low" ? <span className="hue-chip" style={hue("amber")}>Low</span>
                  : i.days_left != null ? <span className="muted small">~{i.days_left} days left</span> : <span className="muted small">Not used lately</span>}
                <span className="grow" /><span className="muted small">{naira(i.unit_cost)}</span>
              </span>
            </button>); })}
        </div>
      )}
      {modal === "add" && <ItemForm schoolId={schoolId} store={store} categories={s.categories} onClose={() => setModal(null)} onDone={() => { setModal(null); load(); }} />}
      {modal === "shop" && <ShoppingList schoolId={schoolId} store={store} onClose={() => setModal(null)} />}
      {modal === "issue" && <IssueForm schoolId={schoolId} store={store} items={s.items} onClose={() => setModal(null)} onDone={() => { setModal(null); load(); }} />}
      {modal && typeof modal === "object" && <ItemView schoolId={schoolId} item={modal.item} categories={s.categories} onClose={() => setModal(null)} onChanged={load} />}
    </section>
  );
}

function ItemForm({ schoolId, store, categories, item, onClose, onDone }: { schoolId: string; store: string; categories: Record<string, string>; item?: Item; onClose: () => void; onDone: () => void }) {
  const [f, setF] = useState<ItemIn>({ store, name: item?.name ?? "", category: item?.category ?? Object.keys(categories)[0], unit: item?.unit ?? "piece", quantity: item?.quantity ?? 0,
    reorder_level: item?.reorder_level ?? 0, unit_cost: item?.unit_cost ?? null, location: item?.location ?? "", notes: item?.notes ?? "" });
  const [busy, error, run] = useBusy();
  return (
    <Modal title={item ? `Edit ${item.name}` : "New item"} onClose={onClose}>
      <form className="stack" onSubmit={(e: FormEvent) => { e.preventDefault(); run(async () => { const b = { ...f, location: f.location || null, notes: f.notes || null }; if (item) await logi.editItem(item.id, b); else await logi.addItem(schoolId, b); onDone(); }); }}>
        <Field label="Name"><input required minLength={2} value={f.name} onChange={(e) => setF({ ...f, name: e.target.value })} placeholder={store === "kitchen" ? "e.g. Rice (50 kg bag)" : "e.g. Chalk (box)"} /></Field>
        <div className="row wrap">
          <Field label="Category"><select value={f.category} onChange={(e) => setF({ ...f, category: e.target.value })}>{Object.entries(categories).map(([k, l]) => <option key={k} value={k}>{l}</option>)}</select></Field>
          <Field label="Counted in"><input value={f.unit} onChange={(e) => setF({ ...f, unit: e.target.value })} placeholder="bag, box, carton, piece…" list="unit-list" />
            <datalist id="unit-list">{["piece", "box", "carton", "bag", "pack", "ream", "dozen", "litre", "keg", "gallon", "crate", "cylinder", "kg", "tin", "roll"].map((u) => <option key={u} value={u} />)}</datalist></Field>
        </div>
        <div className="row wrap">
          {!item && <Field label="How many now"><input type="number" min={0} step="any" value={f.quantity} onChange={(e) => setF({ ...f, quantity: Number(e.target.value) })} /></Field>}
          <Field label="Warn me below"><input type="number" min={0} step="any" value={f.reorder_level} onChange={(e) => setF({ ...f, reorder_level: Number(e.target.value) })} /></Field>
          <Field label="Price each (₦)"><input type="number" min={0} step="any" value={f.unit_cost ?? ""} onChange={(e) => setF({ ...f, unit_cost: e.target.value ? Number(e.target.value) : null })} /></Field>
        </div>
        <Field label="Where it's kept (optional)"><input value={f.location ?? ""} onChange={(e) => setF({ ...f, location: e.target.value })} /></Field>
        {error && <p className="error">{error}</p>}
        <div className="row"><span className="grow" /><button type="button" onClick={onClose}>Cancel</button><button className="primary" disabled={busy}>Save</button></div>
      </form>
    </Modal>
  );
}

function ItemView({ schoolId, item: initial, categories, onClose, onChanged }: { schoolId: string; item: Item; categories: Record<string, string>; onClose: () => void; onChanged: () => void }) {
  const [item, setItem] = useState(initial);
  const [moves, setMoves] = useState<Move[]>([]);
  const [mode, setMode] = useState<"in" | "out" | "count">("out");
  const [qty, setQty] = useState("");
  const [cost, setCost] = useState(initial.unit_cost ? String(initial.unit_cost) : "");
  const [who, setWho] = useState("");
  const [editing, setEditing] = useState(false);
  const [busy, error, run] = useBusy();
  const loadMoves = useCallback(() => { logi.moves(item.id).then(setMoves).catch(() => {}); }, [item.id]);
  useEffect(loadMoves, [loadMoves]);
  if (editing) return <ItemForm schoolId={schoolId} store={item.store} categories={categories} item={item} onClose={() => setEditing(false)} onDone={() => { setEditing(false); onChanged(); onClose(); }} />;
  const lk = CAT_LOOK[item.category] ?? CAT_LOOK.other;
  function submit(e: FormEvent) {
    e.preventDefault();
    run(async () => {
      const x = await logi.move(item.id, { kind: mode, quantity: Number(qty), unit_cost: mode === "in" && cost ? Number(cost) : null, supplier: mode === "in" ? who || null : null, issued_to: mode === "out" ? who || null : null });
      setItem(x); setQty(""); setWho(""); loadMoves(); onChanged();
    });
  }
  return (
    <Modal title={item.name} onClose={onClose}>
      <div className="ticket-head" style={hue(lk.hue)}>
        <Glyph icon={lk.icon} hue={lk.hue} size={44} />
        <div className="grow"><h3>{units(item.quantity, item.unit)}</h3><p className="muted small">{item.category_label} · warn below {item.reorder_level} · {naira(item.unit_cost)} each · worth {naira(item.value)}{item.location && ` · ${item.location}`}</p></div>
        <button className="icon-button" aria-label="Edit item" onClick={() => setEditing(true)}><Icon name="edit" size={16} /></button>
      </div>
      <p className="small">{item.used_30 ? <>Used <b>{units(item.used_30, item.unit)}</b> in the last 30 days{item.days_left != null && <>: enough for about <b>{item.days_left} days</b></>}.</> : "Not used in the last 30 days."}</p>
      <form className="move-box" onSubmit={submit}>
        <div className="segmented small-seg">
          <button type="button" className={mode === "out" ? "on" : ""} onClick={() => setMode("out")}><Icon name="log-out" size={14} />Give out</button>
          <button type="button" className={mode === "in" ? "on" : ""} onClick={() => setMode("in")}><Icon name="log-in" size={14} />Delivery in</button>
          <button type="button" className={mode === "count" ? "on" : ""} onClick={() => setMode("count")}><Icon name="clipboard" size={14} />Count</button>
        </div>
        <div className="row wrap">
          <Field label={mode === "count" ? "How many are really there?" : "How many"}><input type="number" min={0} step="any" required value={qty} onChange={(e) => setQty(e.target.value)} /></Field>
          {mode === "out" && <Field label="Given to"><input required value={who} onChange={(e) => setWho(e.target.value)} placeholder="e.g. JSS 1A, Sciences dept, Mr Okafor" /></Field>}
          {mode === "in" && <><Field label="Supplier"><input value={who} onChange={(e) => setWho(e.target.value)} placeholder="e.g. Mile 1 market" /></Field>
            <Field label="Price each (₦)"><input type="number" min={0} step="any" value={cost} onChange={(e) => setCost(e.target.value)} /></Field></>}
        </div>
        {error && <p className="error">{error}</p>}
        <div className="row"><span className="grow" /><button className="primary" disabled={busy || qty === ""}>{mode === "out" ? "Give out" : mode === "in" ? "Add delivery" : "Save count"}</button></div>
      </form>
      <h4 className="goals-title"><Icon name="history" size={16} />History</h4>
      <ul className="move-list">
        {moves.map((m) => (
          <li key={m.id} className={`mv-${m.kind}`}>
            <span className="mv-qty">{m.kind === "in" ? "+" : m.kind === "out" ? "−" : "="}{m.kind === "count" ? m.balance : m.quantity}</span>
            <span className="grow"><strong>{m.kind === "in" ? `From ${m.supplier ?? "delivery"}` : m.kind === "out" ? `To ${m.issued_to ?? "?"}` : "Counted"}</strong>
              <span className="muted small">{dayTime(m.at)} · {m.by}{m.note && ` · ${m.note}`}{m.unit_cost && m.kind === "in" ? ` · ${naira(m.unit_cost)} each` : ""}</span></span>
            <span className="muted small">left {m.balance}</span>
          </li>
        ))}
      </ul>
      <div className="row"><button className="text-link danger-hover" onClick={() => run(async () => { if (confirm(`Remove ${item.name} from the store list?`)) { await logi.removeItem(item.id); onChanged(); onClose(); } })}>Remove item</button></div>
    </Modal>
  );
}

function ShoppingList({ schoolId, store, onClose }: { schoolId: string; store: string; onClose: () => void }) {
  const [s, setS] = useState<Shopping | null>(null);
  useEffect(() => { logi.shopping(schoolId, store).then(setS).catch(() => {}); }, [schoolId, store]);
  const text = s ? `Shopping list (${store === "kitchen" ? "kitchen" : "store"}), ${new Date().toLocaleDateString("en-GB")}\n` + s.items.map((i) => `- ${units(i.buy, i.unit)} ${i.name}${i.cost ? ` (about ${naira(i.cost)})` : ""}`).join("\n") + `\nTotal about ${naira(s.total)}` : "";
  return (
    <Modal title="Shopping list" onClose={onClose}>
      {!s ? <p className="muted">Working it out…</p> : s.items.length === 0 ? <Empty icon="circle-check">Nothing to buy right now.</Empty> : (
        <>
          <p className="muted small">Worked out from what is low and what was used in the last 30 days, to cover about a month.</p>
          <table className="shop-table">
            <thead><tr><th>Item</th><th>Have</th><th>Used (30 days)</th><th>Buy</th><th>About</th></tr></thead>
            <tbody>{s.items.map((i) => <tr key={i.id}><td><strong>{i.name}</strong><span className="muted small block">{i.category}</span></td><td>{i.have}</td><td>{i.used_30 || "–"}</td><td><b>{units(i.buy, i.unit)}</b></td><td>{naira(i.cost)}</td></tr>)}</tbody>
            <tfoot><tr><td colSpan={4}><b>Total</b>{!s.priced && <span className="muted small"> (some items have no price yet)</span>}</td><td><b>{naira(s.total)}</b></td></tr></tfoot>
          </table>
          <div className="row"><span className="grow" />
            <button className="with-icon" onClick={() => navigator.clipboard?.writeText(text)}><Icon name="copy" size={15} />Copy for WhatsApp</button>
            <button className="primary with-icon" onClick={() => window.print()}><Icon name="clipboard" size={15} />Print</button></div>
        </>
      )}
    </Modal>
  );
}

function IssueForm({ schoolId, store, items, onClose, onDone }: { schoolId: string; store: string; items: Item[]; onClose: () => void; onDone: () => void }) {
  const [requests, setRequests] = useState<Ticket[]>([]);
  const [ticket, setTicket] = useState<Ticket | null>(null);
  const [lines, setLines] = useState<{ item_id: string; quantity: number }[]>([{ item_id: "", quantity: 1 }]);
  const [to, setTo] = useState("");
  const [busy, error, run] = useBusy();
  useEffect(() => { ops.tickets(schoolId, "desk", "store").then((t) => setRequests(t.filter((x) => !["done", "closed"].includes(x.status)))).catch(() => {}); }, [schoolId]);
  return (
    <Modal title="Give out items" onClose={onClose}>
      <form className="stack" onSubmit={(e) => { e.preventDefault(); run(async () => { await logi.issue(schoolId, { store, lines: lines.filter((l) => l.item_id), issued_to: to, note: null, ticket_id: ticket?.id ?? null }); onDone(); }); }}>
        {requests.length > 0 && (
          <Field label="Answering a request? (optional)">
            <select value={ticket?.id ?? ""} onChange={(e) => { const t = requests.find((x) => x.id === e.target.value) ?? null; setTicket(t); if (t && !to) setTo(t.raised_by?.name ?? ""); }}>
              <option value="">No, just giving out</option>{requests.map((t) => <option key={t.id} value={t.id}>#{t.number} {t.title} ({t.raised_by?.name})</option>)}
            </select>
          </Field>
        )}
        {ticket && <p className="day-banner" style={hue("amber")}><Icon name="inbox" size={16} />“{ticket.title}”{ticket.details && ` · ${ticket.details}`}. The request is marked done when you give these out.</p>}
        {lines.map((l, i) => (
          <div key={i} className="med-row">
            <select required value={l.item_id} onChange={(e) => setLines(lines.map((x, j) => (j === i ? { ...x, item_id: e.target.value } : x)))}>
              <option value="">Choose an item…</option>{items.filter((it) => it.quantity > 0).map((it) => <option key={it.id} value={it.id}>{it.name} ({units(it.quantity, it.unit)} left)</option>)}
            </select>
            <input type="number" min={0.5} step="any" value={l.quantity} aria-label="How many" onChange={(e) => setLines(lines.map((x, j) => (j === i ? { ...x, quantity: Number(e.target.value) } : x)))} />
            <span />
            <button type="button" className="chip-x" aria-label="Remove line" onClick={() => setLines(lines.filter((_, j) => j !== i))}><Icon name="close" size={14} /></button>
          </div>
        ))}
        <button type="button" className="with-icon small" onClick={() => setLines([...lines, { item_id: "", quantity: 1 }])}><Icon name="plus" size={14} />Another item</button>
        <Field label="Given to"><input required minLength={2} value={to} onChange={(e) => setTo(e.target.value)} placeholder="e.g. Mrs Eze, JSS 2B" /></Field>
        {error && <p className="error">{error}</p>}
        <div className="row"><span className="grow" /><button type="button" onClick={onClose}>Cancel</button><button className="primary" disabled={busy}>Give out</button></div>
      </form>
    </Modal>
  );
}
