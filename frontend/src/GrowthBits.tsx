// Small drawings and pieces used across the Growth screens: radar, trend line, rings, score pickers, kudos cards.
import { useState, type ReactNode } from "react";
import { errorText } from "./api";
import { BADGE_LOOK, grow, type Card, type Criterion, type Insight, type Kudos, INSIGHT_HUE, LEVEL_LOOK, levelOf, timeAgo } from "./growthApi";
import Icon from "./Icon";
import { href } from "./router";
import { Avatar, Glyph, hue } from "./ui";

/** Spider chart of the teaching standards: this person (filled) against the school average (dashed). */
export function Radar({ criteria, values, compare, size = 300, compact = false }: {
  criteria: Criterion[]; values: Record<string, number>; compare?: Record<string, number>; size?: number; compact?: boolean;
}) {
  const n = criteria.length, cx = size / 2, cy = size / 2, r = size / 2 - (compact ? 14 : 58);
  const pt = (i: number, v: number) => {
    const a = -Math.PI / 2 + (i * 2 * Math.PI) / n;
    return [cx + Math.cos(a) * r * (v / 4), cy + Math.sin(a) * r * (v / 4)];
  };
  const poly = (vals: Record<string, number>) => criteria.map((c, i) => pt(i, vals[c.key] ?? 0).join(",")).join(" ");
  const has = Object.keys(values).length > 0;
  return (
    <svg className="radar" viewBox={`0 0 ${size} ${size}`} width="100%" style={{ maxWidth: size }} role="img"
      aria-label={criteria.map((c) => `${c.label}: ${values[c.key] ?? "not scored"}`).join(", ")}>
      {[1, 2, 3, 4].map((lv) => (
        <polygon key={lv} points={criteria.map((_, i) => pt(i, lv).join(",")).join(" ")} className={`radar-ring r${lv}`} />
      ))}
      {criteria.map((_, i) => { const [x, y] = pt(i, 4); return <line key={i} x1={cx} y1={cy} x2={x} y2={y} className="radar-spoke" />; })}
      {compare && Object.keys(compare).length > 0 && <polygon points={poly(compare)} className="radar-compare" />}
      {has && <polygon points={poly(values)} className="radar-shape" />}
      {has && criteria.map((c, i) => values[c.key] != null && (() => { const [x, y] = pt(i, values[c.key]); return <circle key={c.key} cx={x} cy={y} r={compact ? 2.5 : 4} className="radar-dot" />; })())}
      {!compact && criteria.map((c, i) => {
        const [x, y] = pt(i, 4.55);
        const anchor = Math.abs(x - cx) < 8 ? "middle" : x > cx ? "start" : "end";
        const words = c.label.split(" ");
        const lines = words.length > 2 ? [words.slice(0, 2).join(" "), words.slice(2).join(" ")] : [c.label];
        return (
          <text key={c.key} x={x} y={y - (lines.length - 1) * 6} textAnchor={anchor} className="radar-label">
            {lines.map((l, j) => <tspan key={j} x={x} dy={j ? 12 : 4}>{l}</tspan>)}
            {values[c.key] != null && <tspan x={x} dy={13} className="radar-value">{values[c.key].toFixed(1)}</tspan>}
          </text>
        );
      })}
    </svg>
  );
}

export function Ring({ value, max, size = 64, stroke = 8, label, colour }: { value: number; max: number; size?: number; stroke?: number; label?: ReactNode; colour?: string }) {
  const r = (size - stroke) / 2, c = 2 * Math.PI * r, pct = max ? Math.min(1, value / max) : 0;
  return (
    <span className="g-ring" style={{ width: size, height: size }}>
      <svg width={size} height={size} viewBox={`0 0 ${size} ${size}`} aria-hidden="true">
        <circle cx={size / 2} cy={size / 2} r={r} fill="none" stroke="var(--tint-2)" strokeWidth={stroke} />
        <circle cx={size / 2} cy={size / 2} r={r} fill="none" stroke={colour ?? "var(--hue)"} strokeWidth={stroke} strokeLinecap="round"
          strokeDasharray={`${c * pct} ${c}`} transform={`rotate(-90 ${size / 2} ${size / 2})`} />
      </svg>
      {label != null && <span className="g-ring-label">{label}</span>}
    </span>
  );
}

/** A small line of scores over time (1 to 4 or 1 to 5). */
export function Spark({ points, min = 1, max = 4, width = 220, height = 60 }: { points: number[]; min?: number; max?: number; width?: number; height?: number }) {
  if (points.length === 0) return null;
  const pad = 6;
  const xs = (i: number) => (points.length === 1 ? width / 2 : pad + (i * (width - pad * 2)) / (points.length - 1));
  const ys = (v: number) => height - pad - ((v - min) / (max - min)) * (height - pad * 2);
  const d = points.map((v, i) => `${i ? "L" : "M"}${xs(i)},${ys(v)}`).join(" ");
  return (
    <svg className="spark" width="100%" viewBox={`0 0 ${width} ${height}`} preserveAspectRatio="none" aria-hidden="true" style={{ maxWidth: width }}>
      <path d={`${d} L${xs(points.length - 1)},${height} L${xs(0)},${height} Z`} className="spark-fill" />
      <path d={d} className="spark-line" />
      {points.map((v, i) => <circle key={i} cx={xs(i)} cy={ys(v)} r={3} className="spark-dot" />)}
    </svg>
  );
}

/** Four buttons to choose a level 1-4 for one standard. */
export function ScorePicker({ value, onChange, compare, disabled }: { value?: number; onChange: (v: number | undefined) => void; compare?: number; disabled?: boolean }) {
  return (
    <div className="score-picker" role="radiogroup">
      {[1, 2, 3, 4].map((v) => {
        const l = LEVEL_LOOK[v];
        return (
          <button key={v} type="button" role="radio" aria-checked={value === v} disabled={disabled} title={l.label}
            className={`score-btn${value === v ? " on" : ""}${compare === v ? " was" : ""}`} style={hue(l.hue)} onClick={() => onChange(value === v ? undefined : v)}>
            {v}
          </button>
        );
      })}
    </div>
  );
}

export function LevelChip({ v, label = true }: { v: number | null | undefined; label?: boolean }) {
  const l = levelOf(v);
  if (!l || v == null) return <span className="hue-chip" style={hue("slate")}>Not scored</span>;
  return <span className="hue-chip level-chip" style={hue(l.hue)}><b>{Number.isInteger(v) ? v : v.toFixed(1)}</b>{label && l.label}</span>;
}

export function PersonLine({ p, schoolId, size = 34, sub }: { p: Card; schoolId?: string; size?: number; sub?: ReactNode }) {
  const inner = (
    <>
      {p.photo ? <img className="g-photo" src={p.photo} alt="" style={{ width: size, height: size }} /> : <Avatar name={p.name} size={size} />}
      <span className="g-person-text"><strong>{p.name}</strong><span className="muted small">{sub ?? p.job_title ?? "Staff"}</span></span>
    </>
  );
  return schoolId ? <a className="g-person" href={href({ page: "passport", school: schoolId, id: p.user_id })}>{inner}</a> : <span className="g-person">{inner}</span>;
}

export function InsightList({ items, schoolId }: { items: Insight[]; schoolId: string }) {
  if (items.length === 0) return <p className="muted small">Nothing to flag. Keep going!</p>;
  return (
    <ul className="insights">
      {items.map((t, i) => (
        <li key={i} className={`insight i-${t.kind}`} style={hue(INSIGHT_HUE[t.kind])}>
          <Glyph icon={t.icon} hue={INSIGHT_HUE[t.kind]} size={34} />
          <div>
            <p>{t.text}</p>
            {t.matches && t.matches.length > 0 && (
              <div className="insight-people"><span className="small muted">Could be mentored by:</span>
                {t.matches.map((m) => <a key={m.user_id} className="mini-person" href={href({ page: "passport", school: schoolId, id: m.user_id })}>
                  <Avatar name={m.name} size={22} />{m.name}<b>{m.score.toFixed(1)}</b>{m.same_department && <i title="Same department">●</i>}</a>)}
              </div>
            )}
            {t.people && t.people.length > 0 && (
              <div className="insight-people">
                {t.people.map((m) => <a key={m.user_id} className="mini-person" href={href({ page: "passport", school: schoolId, id: m.user_id })}><Avatar name={m.name} size={22} />{m.name}</a>)}
              </div>
            )}
          </div>
        </li>
      ))}
    </ul>
  );
}

export function KudosItem({ k, onChanged, compact = false }: { k: Kudos; onChanged?: (k: Kudos | null) => void; compact?: boolean }) {
  const look = BADGE_LOOK[k.badge] ?? BADGE_LOOK.spirit;
  const [busy, setBusy] = useState(false);
  return (
    <article className={`kudos${compact ? " compact" : ""}`} style={hue(look.hue)}>
      <span className="kudos-emoji" aria-hidden="true">{look.emoji}</span>
      <div className="kudos-body">
        <div className="kudos-head">
          <span className="kudos-badge"><Icon name={look.icon} size={13} />{k.badge_label}</span>
          <span className="muted small">{timeAgo(k.created_at)}</span>
        </div>
        <p className="kudos-to"><Avatar name={k.to.name} size={24} /><strong>{k.to.name}</strong></p>
        <p className="kudos-msg">“{k.message}”</p>
        <div className="kudos-foot">
          <span className="muted small">from {k.from?.name ?? "a colleague"}</span>
          <span className="grow" />
          <button className={`cheer${k.cheered ? " on" : ""}`} disabled={busy} aria-pressed={k.cheered}
            onClick={async () => { setBusy(true); try { onChanged?.(await grow.cheer(k.id)); } finally { setBusy(false); } }}>
            <Icon name="thumbs-up" size={14} />{k.cheers || ""}
          </button>
          {k.can_delete && !compact && <button className="text-link small" onClick={async () => { if (confirm("Remove this kudos?")) { await grow.removeKudos(k.id); onChanged?.(null); } }}>Remove</button>}
        </div>
      </div>
    </article>
  );
}

export function useBusy(): [boolean, string, (f: () => Promise<unknown>) => Promise<void>] {
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const run = async (f: () => Promise<unknown>) => {
    setBusy(true); setError("");
    try { await f(); } catch (e) { setError(errorText(e)); } finally { setBusy(false); }
  };
  return [busy, error, run];
}
