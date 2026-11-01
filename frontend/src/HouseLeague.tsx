// The house league: merits minus demerits for each house, the top students, and sharing students fairly into houses.
import { useCallback, useEffect, useState } from "react";
import { api, errorText } from "./api";
import Icon from "./Icon";
import { useCan } from "./rightsApi";
import { StudentLink } from "./StudentLink";
import { Glyph, hue } from "./ui";

interface League { days: number; houses: { id: string; name: string; colour: string | null; points: number; students: number }[]; no_house: number;
  top: { id: string; name: string; points: number; class_name: string | null }[] }

export default function HouseLeague({ schoolId }: { schoolId: string }) {
  const can = useCan(schoolId);
  const [d, setD] = useState<League | null>(null);
  const [days, setDays] = useState(90);
  const [note, setNote] = useState("");
  const [busy, setBusy] = useState(false);
  const load = useCallback(() => { api.raw<League>("GET", `/api/schools/${schoolId}/house-points?days=${days}`).then(setD).catch(() => {}); }, [schoolId, days]);
  useEffect(load, [load]);
  if (!d || d.houses.length === 0) return null;
  const max = Math.max(1, ...d.houses.map((h) => Math.abs(h.points)));
  const spread = async () => {
    if (!confirm(`Put the ${d.no_house} students without a house into houses? Classes, boys and girls are shared evenly, and brothers and sisters stay together.`)) return;
    setBusy(true);
    try { const r = await api.raw<{ moved: number }>("POST", `/api/schools/${schoolId}/houses/spread`, { only_without: true }); setNote(`${r.moved} students put into houses.`); load(); }
    catch (e) { setNote(errorText(e)); } finally { setBusy(false); }
  };
  return (
    <section className="card g-card house-league" style={hue("amber")}>
      <h3 className="with-glyph"><Glyph icon="trophy" hue="amber" size={32} />House points
        <span className="push segmented small-seg">{[30, 90, 365].map((n) => <button key={n} className={days === n ? "on" : ""} onClick={() => setDays(n)}>{n === 365 ? "Year" : `${n} days`}</button>)}</span></h3>
      <div className="hl-bars">{d.houses.map((h, i) => (
        <div key={h.id} className="hl-row" style={{ ["--hc" as string]: h.colour || "#888" }}>
          <span className="hl-rank">{["🥇", "🥈", "🥉"][i] ?? i + 1}</span>
          <span className="hl-name"><span className="house-dot" />{h.name}<small>{h.students} students</small></span>
          <span className="hl-track"><i style={{ width: `${(Math.max(0, h.points) / max) * 100}%` }} /></span>
          <b className="hl-pts">{h.points}</b>
        </div>
      ))}</div>
      {d.top.length > 0 && <p className="small"><Icon name="star" size={13} /> Top this period: {d.top.slice(0, 5).map((t, i) => <span key={t.id}>{i > 0 && ", "}<StudentLink id={t.id} name={t.name} /> ({t.points})</span>)}</p>}
      {d.no_house > 0 && (
        <div className="row wrap"><span className="small muted">{d.no_house} students have no house yet.</span>
          {can("students.change") && <button className="with-icon small" disabled={busy} onClick={spread}><Icon name="sparkle" size={14} />Share them fairly into houses</button>}</div>
      )}
      {note && <p className="saved-note"><Icon name="check" size={15} />{note}</p>}
    </section>
  );
}
