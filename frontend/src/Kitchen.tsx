// The kitchen: how many to cook for, the week's menu, special diets and allergies, what was served, and the food store.
import { useCallback, useEffect, useState } from "react";
import { addDays, DAY_SHORT, iso, monday, niceDate } from "./dayApi";
import { InsightList, useBusy } from "./GrowthBits";
import Icon from "./Icon";
import { LEFT_LOOK, loadLogiMeta, logi, MEAL_LOOK, type KitchenDay, type LogiMeta, type MealDay, type Menu } from "./logiApi";
import { StoreBoard } from "./Store";
import { Avatar, Empty, Field, Glyph, hue, IconButton, Modal } from "./ui";

function useLogiMeta(): LogiMeta | null {
  const [m, setM] = useState<LogiMeta | null>(null);
  useEffect(() => { loadLogiMeta().then(setM).catch(() => {}); }, []);
  return m;
}

export function KitchenBoard({ schoolId }: { schoolId: string }) {
  const [tab, setTab] = useState<"today" | "menu" | "food">("today");
  return (
    <section className="stack">
      <div className="segmented small-seg">
        <button className={tab === "today" ? "on" : ""} onClick={() => setTab("today")}><Icon name="utensils" size={14} />Today</button>
        <button className={tab === "menu" ? "on" : ""} onClick={() => setTab("menu")}><Icon name="calendar-range" size={14} />Menu</button>
        <button className={tab === "food" ? "on" : ""} onClick={() => setTab("food")}><Icon name="store" size={14} />Food store</button>
      </div>
      {tab === "today" && <KitchenToday schoolId={schoolId} />}
      {tab === "menu" && <MenuPlanner schoolId={schoolId} />}
      {tab === "food" && <StoreBoard schoolId={schoolId} store="kitchen" />}
    </section>
  );
}

function KitchenToday({ schoolId }: { schoolId: string }) {
  const [date, setDate] = useState(iso(new Date()));
  const [k, setK] = useState<KitchenDay | null>(null);
  const [modal, setModal] = useState<null | "settings" | { meal: MealDay }>(null);
  const load = useCallback(() => { logi.kitchenDay(schoolId, date).then(setK).catch(() => {}); }, [schoolId, date]);
  useEffect(load, [load]);
  if (!k) return <p className="muted">Loading…</p>;
  const today = iso(new Date());
  return (
    <>
      <div className="day-toolbar">
        <div className="date-nav">
          <IconButton icon="chevron-left" label="Day before" onClick={() => setDate(addDays(date, -1))} />
          <label className="date-nav-pick"><Icon name="calendar-days" size={16} /><strong>{date === today ? "Today" : niceDate(date, { weekday: "long", day: "numeric", month: "long" })}</strong>
            <input type="date" value={date} onChange={(e) => e.target.value && setDate(e.target.value)} aria-label="Choose a day" /></label>
          <IconButton icon="chevron-right" label="Next day" onClick={() => setDate(addDays(date, 1))} />
        </div>
        <span className="grow" />
        {k.can_edit && <button className="with-icon" onClick={() => setModal("settings")}><Icon name="settings" size={15} />Meals and numbers</button>}
      </div>
      <div className="headcount">
        <span style={hue("indigo")}><b>{k.count.boarders}</b>boarders</span>
        <span style={hue("violet")}><b>−{k.count.boarders_out}</b>out of school</span>
        <span style={hue("rose")}><b>−{k.count.sick_bay}</b>in the sick bay</span>
        <span style={hue("green")} className="hc-total"><b>{k.count.dining_boarders}</b>boarders eating</span>
        <span style={hue("sky")}><b>{k.count.day_present}</b>day students<small>{k.count.day_source}</small></span>
      </div>
      {k.insights.length > 0 && <InsightList items={k.insights} schoolId={schoolId} />}
      <div className="meal-grid">
        {k.meals.map((m) => { const lk = MEAL_LOOK[m.meal] ?? MEAL_LOOK.lunch; return (
          <article key={m.meal} className="meal-card" style={hue(lk.hue)}>
            <header><span className="meal-emoji">{lk.emoji}</span><h3>{m.label}</h3></header>
            <div className="meal-number"><b>{m.cook_for}</b><span>plates to cook<small>{m.expected} expected + a little spare</small></span></div>
            <div className="chips">{m.made_of.map((p) => <span key={p} className="hue-chip" style={hue(lk.hue)}>{p}</span>)}
              {m.sick_bay_trays > 0 && <span className="hue-chip" style={hue("rose")}><Icon name="bed" size={12} />{m.sick_bay_trays} trays to the sick bay</span>}</div>
            <p className="meal-dish">{m.dishes ? <><Icon name="utensils" size={14} /> {m.dishes}</> : <span className="muted">Nothing on the menu yet</span>}</p>
            {m.served != null ? (
              <p className="meal-served"><Icon name="circle-check" size={14} /> Served {m.served}
                <span className="hue-chip" style={hue(LEFT_LOOK[m.leftover ?? "little"])}>Left over: {m.leftover}</span>{m.rating && <span className="small">★{m.rating}</span>}</p>
            ) : k.can_edit && date <= today && <button className="with-icon small" onClick={() => setModal({ meal: m })}><Icon name="check" size={14} />Record what was served</button>}
          </article>); })}
      </div>
      <section className="card g-card" style={hue("red")}>
        <h3 className="with-glyph"><Glyph icon="heart-pulse" hue="red" size={30} />Special diets and food allergies<span className="count">{k.diets.length}</span></h3>
        {!k.can_edit ? <p className="muted small">Only the kitchen team sees this list.</p> : k.diets.length === 0 ? <p className="muted small">None recorded. The sick bay adds these in each student's health record.</p> : (
          <div className="diet-grid">
            {k.diets.map((d) => (
              <div key={d.id} className="diet-row" style={hue(d.allergies ? "red" : "amber")}>
                <Avatar name={d.name} size={32} />
                <span className="grow"><strong>{d.name}</strong><span className="muted small">{d.class_name}{d.boarder ? " · boarder" : " · day"}</span></span>
                <span className="diet-tags">{d.allergies && <span className="hue-chip" style={hue("red")}><Icon name="circle-x" size={12} />Allergic: {d.allergies}</span>}
                  {d.diet && <span className="hue-chip" style={hue("amber")}>{d.diet}</span>}</span>
              </div>
            ))}
          </div>
        )}
      </section>
      {modal === "settings" && <KitchenSettingsForm schoolId={schoolId} k={k} onClose={() => setModal(null)} onDone={() => { setModal(null); load(); }} />}
      {modal && typeof modal === "object" && <ServedForm schoolId={schoolId} date={date} meal={modal.meal} onClose={() => setModal(null)} onDone={() => { setModal(null); load(); }} />}
    </>
  );
}

function ServedForm({ schoolId, date, meal, onClose, onDone }: { schoolId: string; date: string; meal: MealDay; onClose: () => void; onDone: () => void }) {
  const meta = useLogiMeta();
  const [served, setServed] = useState(meal.expected);
  const [left, setLeft] = useState("little");
  const [rating, setRating] = useState<number | null>(4);
  const [notes, setNotes] = useState("");
  const [busy, error, run] = useBusy();
  return (
    <Modal title={`${meal.label}: what was served`} onClose={onClose}>
      <div className="stack">
        <Field label={`Plates served (expected ${meal.expected})`}><input type="number" min={0} value={served} onChange={(e) => setServed(Number(e.target.value))} /></Field>
        <div><span className="field-label">Food left over</span>
          <div className="kind-pick">{meta && Object.entries(meta.leftover).map(([k, l]) => (
            <button key={k} type="button" className={`mark-choice${left === k ? " on" : ""}`} style={hue(LEFT_LOOK[k])} onClick={() => setLeft(k)}>{l}</button>))}</div></div>
        <div><span className="field-label">How did it go?</span>
          <div className="kind-pick">{[1, 2, 3, 4, 5].map((r) => <button key={r} type="button" className={`chip pick${rating === r ? " on" : ""}`} onClick={() => setRating(r)}>{"★".repeat(r)}</button>)}</div></div>
        <Field label="Notes (optional)"><input value={notes} onChange={(e) => setNotes(e.target.value)} placeholder="e.g. Gas finished halfway, rice was late" /></Field>
        {error && <p className="error">{error}</p>}
        <div className="row"><span className="grow" /><button onClick={onClose}>Cancel</button>
          <button className="primary" disabled={busy} onClick={() => run(async () => { await logi.service(schoolId, { on_date: date, meal: meal.meal, served, leftover: left, rating, notes: notes || null }); onDone(); })}>Save</button></div>
      </div>
    </Modal>
  );
}

function KitchenSettingsForm({ schoolId, k, onClose, onDone }: { schoolId: string; k: KitchenDay; onClose: () => void; onDone: () => void }) {
  const meta = useLogiMeta();
  const [meals, setMeals] = useState(k.settings.meals);
  const [dayLunch, setDayLunch] = useState(k.settings.day_students_lunch);
  const [staff, setStaff] = useState(k.settings.staff_meals);
  const [busy, error, run] = useBusy();
  return (
    <Modal title="Meals and numbers" onClose={onClose}>
      <div className="stack">
        <div><span className="field-label">Meals the kitchen serves</span>
          <div className="chips">{meta && Object.entries(meta.meals).map(([m, l]) => (
            <label key={m} className={`chip pick${meals.includes(m) ? " on" : ""}`}><input type="checkbox" checked={meals.includes(m)} onChange={(e) => setMeals(e.target.checked ? [...meals, m] : meals.filter((x) => x !== m))} />{l}</label>))}</div></div>
        <label className="check"><input type="checkbox" checked={dayLunch} onChange={(e) => setDayLunch(e.target.checked)} />Day students eat lunch at school</label>
        <Field label="Staff plates at lunch"><input type="number" min={0} value={staff} onChange={(e) => setStaff(Number(e.target.value))} /></Field>
        {error && <p className="error">{error}</p>}
        <div className="row"><span className="grow" /><button onClick={onClose}>Cancel</button>
          <button className="primary" disabled={busy || meals.length === 0} onClick={() => run(async () => { await logi.saveKitchenSettings(schoolId, { meals, day_students_lunch: dayLunch, staff_meals: staff }); onDone(); })}>Save</button></div>
      </div>
    </Modal>
  );
}

export function MenuPlanner({ schoolId }: { schoolId: string }) {
  const meta = useLogiMeta();
  const [week, setWeek] = useState(monday(iso(new Date())));
  const [m, setM] = useState<Menu | null>(null);
  const [edit, setEdit] = useState<{ date: string; meal: string; value: string } | null>(null);
  const [msg, setMsg] = useState("");
  const load = useCallback(() => { logi.menu(schoolId, week).then(setM).catch(() => {}); }, [schoolId, week]);
  useEffect(load, [load]);
  if (!m || !meta) return <p className="muted">Loading…</p>;
  const days = Array.from({ length: 7 }, (_, i) => addDays(week, i));
  const get = (d: string, meal: string) => m.plan.find((p) => p.on_date === d && p.meal === meal);
  const today = iso(new Date());
  async function save() {
    if (!edit) return;
    await logi.setMenu(schoolId, { on_date: edit.date, meal: edit.meal, dishes: edit.value.trim() });
    setEdit(null); load();
  }
  return (
    <section className="stack">
      <div className="day-toolbar">
        <div className="date-nav">
          <IconButton icon="chevron-left" label="Week before" onClick={() => setWeek(addDays(week, -7))} />
          <span className="date-nav-pick"><Icon name="calendar-range" size={16} /><strong>Week of {niceDate(week, { day: "numeric", month: "long" })}</strong></span>
          <IconButton icon="chevron-right" label="Next week" onClick={() => setWeek(addDays(week, 7))} />
        </div>
        <span className="grow" />
        {msg && <span className="saved-note"><Icon name="check" size={14} />{msg}</span>}
        {m.can_edit && <button className="with-icon" onClick={async () => { const r = await logi.copyMenu(schoolId, addDays(week, -7), week); setMsg(`${r.copied} meals copied from last week`); load(); }}>
          <Icon name="copy" size={15} />Copy last week</button>}
        <button className="with-icon" onClick={() => window.print()}><Icon name="clipboard" size={15} />Print</button>
      </div>
      {m.plan.length === 0 && <Empty icon="utensils">No menu for this week yet.{m.can_edit ? " Click a box to add what's cooking, or copy last week." : ""}</Empty>}
      <div className="menu-wrap">
        <table className="menu-table">
          <thead><tr><th />{days.map((d, i) => <th key={d} className={d === today ? "today" : ""}><span>{DAY_SHORT[i]}</span><strong>{niceDate(d, { day: "numeric", month: "short" })}</strong></th>)}</tr></thead>
          <tbody>
            {m.meals.map((meal) => { const lk = MEAL_LOOK[meal] ?? MEAL_LOOK.lunch; return (
              <tr key={meal} style={hue(lk.hue)}>
                <th scope="row" className="menu-meal"><span>{lk.emoji}</span>{meta.meals[meal]}</th>
                {days.map((d) => { const p = get(d, meal); const editing = edit?.date === d && edit.meal === meal; return (
                  <td key={d} className={d === today ? "today" : ""}>
                    {editing ? (
                      <form onSubmit={(e) => { e.preventDefault(); save(); }}><textarea autoFocus rows={3} value={edit.value} onChange={(e) => setEdit({ ...edit, value: e.target.value })}
                        onBlur={save} onKeyDown={(e) => { if (e.key === "Enter" && !e.shiftKey) { e.preventDefault(); save(); } if (e.key === "Escape") setEdit(null); }} /></form>
                    ) : (
                      <button className={`menu-cell${p ? "" : " empty"}`} disabled={!m.can_edit} onClick={() => setEdit({ date: d, meal, value: p?.dishes ?? "" })}>{p?.dishes ?? (m.can_edit ? "+" : "–")}</button>
                    )}
                  </td>); })}
              </tr>); })}
          </tbody>
        </table>
      </div>
    </section>
  );
}
