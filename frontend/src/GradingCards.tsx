import { useCallback, useEffect, useState, type FormEvent } from "react";
import { errorText } from "./api";
import { structure, type Band, type Component, type Scale, type Scheme, type SchemeMethod, type SchemePreset } from "./structureApi";

type PartRow = { name: string; max_score: string; weight: string };
import { Empty, Field, Glyph, hue, IconButton, Modal } from "./ui";
import Icon from "./Icon";

/** Best grades green, then through blue and amber to red for a fail. */
const LADDER = ["green", "lime", "teal", "sky", "blue", "indigo", "amber", "orange", "red"] as const;
const bandHue = (i: number, n: number) => LADDER[Math.min(LADDER.length - 1, Math.round((i / Math.max(1, n - 1)) * (LADDER.length - 1)))];
const PART_HUES = ["blue", "violet", "teal", "pink", "amber", "cyan"] as const;

// ---------------- Grading scales ----------------

type BandRow = { grade: string; min_score: string; max_score: string; remark: string };
const toRows = (bands: Band[]): BandRow[] =>
  bands.map((b) => ({ grade: b.grade, min_score: String(b.min_score), max_score: String(b.max_score), remark: b.remark }));

export function GradingCard({ schoolId }: { schoolId: string }) {
  const [scales, setScales] = useState<Scale[] | null>(null);
  const [presets, setPresets] = useState<Record<string, Band[]>>({});
  const [editing, setEditing] = useState<Scale | "new" | null>(null);
  const [error, setError] = useState("");

  const load = useCallback(() => {
    structure.scales(schoolId).then(setScales).catch((err) => setError(errorText(err)));
  }, [schoolId]);
  useEffect(() => {
    load();
    structure.gradingPresets().then(setPresets).catch(() => {});
  }, [load]);

  return (
    <section className="card editor">
      <div className="card-head">
        <div>
          <h2>Grading scales</h2>
          <p className="muted small editor-intro">Turns a score out of 100 into a grade. Each section chooses its scale on the Sections tab.</p>
        </div>
        <button className="primary with-icon" onClick={() => setEditing("new")}><Icon name="plus" size={16} />Add grading scale</button>
      </div>
      {error && <p className="error">{error}</p>}
      {scales?.length === 0 && <Empty>No grading scales yet. Add one, starting from the WAEC A1 to F9 scale if you like.</Empty>}
      {scales?.map((s) => (
        <div key={s.id} className="scale">
          <div className="scale-head">
            <Glyph icon="award" hue="amber" size={36} soft />
            <strong className="grow">{s.name}</strong>
            <IconButton icon="edit" label={`Edit ${s.name}`} onClick={() => setEditing(s)} />
            <IconButton icon="trash" label={`Delete ${s.name}`} danger onClick={() => {
              if (window.confirm(`Delete the ${s.name} grading scale?`))
                structure.deleteScale(s.id).then(load).catch((err) => setError(errorText(err)));
            }} />
          </div>
          <div className="grade-ladder">
            {s.bands.map((b, i) => (
              <div key={b.grade} className="grade" style={hue(bandHue(i, s.bands.length))}>
                <strong className={b.grade.length > 4 ? "word" : ""}>{b.grade}</strong>
                <span className="grade-range">{b.min_score}–{b.max_score}</span>
                <span className="grade-remark">{b.remark}</span>
              </div>
            ))}
          </div>
        </div>
      ))}
      {editing && (
        <Modal title={editing === "new" ? "Add grading scale" : `Edit ${editing.name}`} onClose={() => setEditing(null)}>
          <ScaleForm
            scale={editing === "new" ? null : editing}
            presets={presets}
            onCancel={() => setEditing(null)}
            onSubmit={async (name, bands) => {
              if (editing === "new") await structure.addScale(schoolId, name, bands);
              else await structure.saveScale(editing.id, name, bands);
              setEditing(null);
              load();
            }}
          />
        </Modal>
      )}
    </section>
  );
}

function ScaleForm({
  scale, presets, onSubmit, onCancel,
}: {
  scale: Scale | null;
  presets: Record<string, Band[]>;
  onSubmit: (name: string, bands: Band[]) => Promise<void>;
  onCancel: () => void;
}) {
  const first = Object.keys(presets)[0];
  const [name, setName] = useState(scale?.name ?? (first ? first.split(" (")[0] : ""));
  const [rows, setRows] = useState<BandRow[]>(scale ? toRows(scale.bands) : first ? toRows(presets[first]) : []);
  const [error, setError] = useState("");
  const [busy, setBusy] = useState(false);

  const setCell = (i: number, k: keyof BandRow, v: string) => {
    setRows(rows.map((r, j) => (j === i ? { ...r, [k]: v } : r)));
    setError("");
  };

  async function submit(e: FormEvent) {
    e.preventDefault();
    if (name.trim().length < 2) return setError("Give the scale a name.");
    if (rows.length === 0) return setError("Add at least one grade.");
    for (const r of rows) {
      if (!r.grade.trim()) return setError("Every row needs a grade.");
      if (!/^\d+$/.test(r.min_score) || !/^\d+$/.test(r.max_score)) return setError(`${r.grade}: scores must be whole numbers.`);
    }
    setBusy(true);
    try {
      await onSubmit(name.trim(), rows.map((r) => ({
        grade: r.grade.trim(), min_score: Number(r.min_score), max_score: Number(r.max_score), remark: r.remark.trim(),
      })));
    } catch (err) {
      setError(errorText(err));
      setBusy(false);
    }
  }

  return (
    <form className="stack" onSubmit={submit} noValidate>
      <div className="form-grid">
        <Field label="Name"><input value={name} onChange={(e) => { setName(e.target.value); setError(""); }} /></Field>
        <Field label="Start from">
          <select value="" onChange={(e) => e.target.value && setRows(toRows(presets[e.target.value]))}>
            <option value="">Choose a ready-made scale…</option>
            {Object.keys(presets).map((p) => <option key={p}>{p}</option>)}
          </select>
        </Field>
      </div>
      <div className="table-wrap plain">
        <table className="edit-table">
          <thead><tr><th>Grade</th><th>From</th><th>To</th><th>Remark</th><th /></tr></thead>
          <tbody>
            {rows.map((r, i) => (
              <tr key={i}>
                <td><input aria-label="Grade" value={r.grade} onChange={(e) => setCell(i, "grade", e.target.value)} /></td>
                <td><input aria-label="From score" inputMode="numeric" value={r.min_score} onChange={(e) => setCell(i, "min_score", e.target.value)} /></td>
                <td><input aria-label="To score" inputMode="numeric" value={r.max_score} onChange={(e) => setCell(i, "max_score", e.target.value)} /></td>
                <td><input aria-label="Remark" value={r.remark} onChange={(e) => setCell(i, "remark", e.target.value)} /></td>
                <td><button type="button" className="ghost" aria-label="Remove row" onClick={() => setRows(rows.filter((_, j) => j !== i))}>✕</button></td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
      <button type="button" onClick={() => setRows([...rows, { grade: "", min_score: "", max_score: "", remark: "" }])}>Add a grade</button>
      <p className="muted small">Every score from 0 to 100 must fall into exactly one grade.</p>
      {error && <p className="error">{error}</p>}
      <div className="row">
        <button className="primary" disabled={busy}>{scale ? "Save changes" : "Add grading scale"}</button>
        <button type="button" onClick={onCancel}>Cancel</button>
      </div>
    </form>
  );
}

// ---------------- Assessment schemes (CA / exam split) ----------------

type CompRow = { name: string; max_score: string; parts: PartRow[] };

export function SchemesCard({ schoolId }: { schoolId: string }) {
  const [schemes, setSchemes] = useState<Scheme[] | null>(null);
  const [presets, setPresets] = useState<Record<string, SchemePreset>>({});
  const [editing, setEditing] = useState<Scheme | "new" | null>(null);
  const [error, setError] = useState("");

  const load = useCallback(() => {
    structure.schemes(schoolId).then(setSchemes).catch((err) => setError(errorText(err)));
  }, [schoolId]);
  useEffect(() => {
    load();
    structure.assessmentPresets().then(setPresets).catch(() => {});
  }, [load]);

  return (
    <section className="card editor">
      <div className="card-head">
        <div>
          <h2>CA and exam split</h2>
          <p className="muted small editor-intro">How each subject's term score is made up: marks that add up to 100 (two CAs of 20 and an exam of 60), or weighted blocks that are averaged (Block 1 = 20% CE1 + 20% CE2 + 60% CA1). Each section chooses one.</p>
        </div>
        <button className="primary with-icon" onClick={() => setEditing("new")}><Icon name="plus" size={16} />Add CA / exam split</button>
      </div>
      {error && <p className="error">{error}</p>}
      {schemes?.length === 0 && <Empty>None yet.</Empty>}
      {schemes?.map((s) => (
        <div key={s.id} className="scale">
          <div className="scale-head">
            <Glyph icon="clipboard" hue="violet" size={36} soft />
            <strong className="grow">{s.name}{s.method === "weighted" && <small className="pill-soft"> Weighted blocks · average</small>}</strong>
            <IconButton icon="edit" label={`Edit ${s.name}`} onClick={() => setEditing(s)} />
            <IconButton icon="trash" label={`Delete ${s.name}`} danger onClick={() => {
              if (window.confirm(`Delete ${s.name}?`)) structure.deleteScheme(s.id).then(load).catch((err) => setError(errorText(err)));
            }} />
          </div>
          <div className="split-bar">
            {s.components.map((c, i) => (
              <span key={c.name} style={{ flexGrow: s.method === "weighted" ? 1 : c.max_score, ...hue(/exam/i.test(c.name) ? "rose" : PART_HUES[i % PART_HUES.length]) }}
                    className={/exam/i.test(c.name) ? "exam" : ""}>
                <span className="split-name">{c.name}</span>
                <strong>{s.method === "weighted" ? `${Math.round(1000 / s.components.length) / 10}%` : c.max_score}</strong>
                {c.parts.length > 0 && (
                  <span className="parts">
                    {c.parts.map((p) => (s.method === "weighted" ? `${p.name} ${p.weight}%` : `${p.name} ${p.max_score}`)).join(" · ")}
                  </span>
                )}
              </span>
            ))}
          </div>
        </div>
      ))}
      {editing && (
        <Modal title={editing === "new" ? "Add CA / exam split" : `Edit ${editing.name}`} onClose={() => setEditing(null)}>
          <SchemeForm
            scheme={editing === "new" ? null : editing}
            presets={presets}
            onCancel={() => setEditing(null)}
            onSubmit={async (name, comps, method) => {
              if (editing === "new") await structure.addScheme(schoolId, name, comps, method);
              else await structure.saveScheme(editing.id, name, comps, method);
              setEditing(null);
              load();
            }}
          />
        </Modal>
      )}
    </section>
  );
}

function SchemeForm({
  scheme, presets, onSubmit, onCancel,
}: {
  scheme: Scheme | null;
  presets: Record<string, SchemePreset>;
  onSubmit: (name: string, components: Component[], method: SchemeMethod) => Promise<void>;
  onCancel: () => void;
}) {
  const first = Object.keys(presets)[0];
  const asRows = (c: Component[]): CompRow[] =>
    c.map((x) => ({ name: x.name, max_score: String(x.max_score), parts: x.parts.map((p) => ({ name: p.name, max_score: String(p.max_score), weight: p.weight == null ? "" : String(p.weight) })) }));
  const [name, setName] = useState(scheme?.name ?? "");
  const [method, setMethod] = useState<SchemeMethod>(scheme?.method ?? (first ? presets[first].method : "add"));
  const [rows, setRows] = useState<CompRow[]>(scheme ? asRows(scheme.components) : first ? asRows(presets[first].components) : []);
  const [error, setError] = useState("");
  const [busy, setBusy] = useState(false);
  const weighted = method === "weighted";
  const total = rows.reduce((n, r) => n + (Number(r.max_score) || 0), 0);
  const update = (i: number, patch: Partial<CompRow>) => {
    setRows(rows.map((x, j) => (j === i ? { ...x, ...patch } : x)));
    setError("");
  };
  const setPart = (i: number, k: number, patch: Partial<PartRow>) =>
    update(i, { parts: rows[i].parts.map((p, m) => (m === k ? { ...p, ...patch } : p)) });
  const pick = (key: string) => {
    if (!presets[key]) return;
    setMethod(presets[key].method);
    setRows(asRows(presets[key].components));
  };
  const switchTo = (m: SchemeMethod) => {
    setMethod(m);
    setError("");
    if (m === "weighted") setRows(rows.map((r) => ({ ...r, max_score: "100", parts: r.parts.map((p) => ({ ...p, max_score: "100", weight: p.weight || "" })) })));
  };

  async function submit(e: FormEvent) {
    e.preventDefault();
    if (name.trim().length < 2) return setError("Give it a name, for example Secondary or Primary.");
    if (weighted) {
      if (rows.some((r) => !r.name.trim())) return setError("Every block needs a name.");
      for (const r of rows) {
        if (r.parts.some((p) => !p.name.trim() || !/^\d+$/.test(p.max_score) || p.weight === "" || Number.isNaN(Number(p.weight))))
          return setError(`${r.name}: every score needs a name, what it is marked out of, and a weight (%).`);
        const w = Math.round(r.parts.reduce((n, p) => n + Number(p.weight || 0), 0) * 100) / 100;
        if (r.parts.length && w !== 100) return setError(`${r.name}: the weights add up to ${w}%. They must add up to 100%.`);
      }
    } else {
      if (rows.some((r) => !r.name.trim() || !/^\d+$/.test(r.max_score))) return setError("Every part needs a name and a whole-number mark.");
      if (total !== 100) return setError(`The parts must add up to 100. They add up to ${total}.`);
      for (const r of rows) {
        if (r.parts.length === 0) continue;
        if (r.parts.some((p) => !p.name.trim() || !/^\d+$/.test(p.max_score))) return setError(`${r.name}: every piece needs a name and a whole-number mark.`);
        const sub = r.parts.reduce((n, p) => n + Number(p.max_score), 0);
        if (sub !== Number(r.max_score)) return setError(`${r.name}: its pieces add up to ${sub}, but ${r.name} is worth ${r.max_score}.`);
      }
    }
    setBusy(true);
    try {
      await onSubmit(name.trim(), rows.map((r) => ({
        name: r.name.trim(),
        max_score: weighted ? 100 : Number(r.max_score),
        parts: r.parts.map((p) => ({ name: p.name.trim(), max_score: Number(p.max_score), weight: weighted ? Number(p.weight) : null })),
      })), method);
    } catch (err) {
      setError(errorText(err));
      setBusy(false);
    }
  }

  return (
    <form className="stack" onSubmit={submit} noValidate>
      <div className="form-grid">
        <Field label="Name"><input value={name} placeholder="e.g. Secondary" onChange={(e) => { setName(e.target.value); setError(""); }} autoFocus /></Field>
        <Field label="Start from">
          <select value="" onChange={(e) => e.target.value && pick(e.target.value)}>
            <option value="">Choose a common split…</option>
            {Object.keys(presets).map((p) => <option key={p}>{p}</option>)}
          </select>
        </Field>
      </div>
      <div className="segmented wrap-seg" role="radiogroup" aria-label="How the term score is worked out">
        <button type="button" role="radio" aria-checked={!weighted} className={!weighted ? "on" : ""} onClick={() => switchTo("add")}>Marks add up to 100</button>
        <button type="button" role="radio" aria-checked={weighted} className={weighted ? "on" : ""} onClick={() => switchTo("weighted")}>Weighted blocks, averaged</button>
      </div>
      <p className="muted small">{weighted
        ? "Each block is a percentage made from its scores by weight. Every score is marked out of its own number (often 100). The term score is the plain average of the blocks."
        : "Each part has marks; together they make 100. Split a part when it is made of smaller pieces (CA1 = test + assignment + classwork)."}</p>
      <div className="table-wrap plain">
        <table className="edit-table">
          <thead><tr><th>{weighted ? "Block / score" : "Part"}</th><th>{weighted ? "Out of" : "Marks"}</th>{weighted && <th>Weight</th>}<th /></tr></thead>
          <tbody>
            {rows.flatMap((r, i) => {
              const sub = r.parts.reduce((n, p) => n + (Number(p.max_score) || 0), 0);
              const wsum = Math.round(r.parts.reduce((n, p) => n + (Number(p.weight) || 0), 0) * 100) / 100;
              return [
                <tr key={`c${i}`}>
                  <td><input aria-label={weighted ? "Block name" : "Part name"} value={r.name} onChange={(e) => update(i, { name: e.target.value })} /></td>
                  <td>{weighted ? <span className="muted small">100%</span> : <input aria-label="Marks" inputMode="numeric" value={r.max_score} onChange={(e) => update(i, { max_score: e.target.value })} />}</td>
                  {weighted && <td className="muted small">{rows.length ? `${Math.round(1000 / rows.length) / 10}% of term` : ""}</td>}
                  <td className="nowrap">
                    {r.parts.length === 0 && (
                      <button type="button" className="ghost small" onClick={() => update(i, { parts: weighted
                        ? [{ name: "", max_score: "100", weight: "" }, { name: "", max_score: "100", weight: "" }]
                        : [{ name: "Test", max_score: "", weight: "" }, { name: "Assignment", max_score: "", weight: "" }] })}>
                        Split
                      </button>
                    )}
                    <button type="button" className="ghost" aria-label="Remove part" onClick={() => setRows(rows.filter((_, j) => j !== i))}>✕</button>
                  </td>
                </tr>,
                ...r.parts.map((p, k) => (
                  <tr key={`c${i}p${k}`} className="sub-row">
                    <td><input aria-label={`${r.name} piece name`} value={p.name} placeholder={weighted ? "e.g. CE1" : ""} onChange={(e) => setPart(i, k, { name: e.target.value })} /></td>
                    <td><input aria-label={`${r.name} piece marks`} inputMode="numeric" value={p.max_score} onChange={(e) => setPart(i, k, { max_score: e.target.value })} /></td>
                    {weighted && <td><span className="pct-input"><input aria-label={`${r.name} piece weight`} inputMode="decimal" value={p.weight} onChange={(e) => setPart(i, k, { weight: e.target.value })} />%</span></td>}
                    <td><button type="button" className="ghost" aria-label="Remove piece" onClick={() => update(i, { parts: r.parts.filter((_, m) => m !== k) })}>✕</button></td>
                  </tr>
                )),
                ...(r.parts.length > 0
                  ? [
                      <tr key={`c${i}add`} className="sub-row">
                        <td>
                          <button type="button" className="ghost small" onClick={() => update(i, { parts: [...r.parts, { name: "", max_score: weighted ? "100" : "", weight: "" }] })}>+ Add a {weighted ? "score" : "piece"}</button>
                          <button type="button" className="ghost small" onClick={() => update(i, { parts: [] })}>Don't split</button>
                        </td>
                        {weighted
                          ? <><td /><td className={wsum === 100 ? "c-present small" : "c-absent small"}>{wsum}% / 100%</td></>
                          : <td className={sub === Number(r.max_score) ? "c-present small" : "c-absent small"}>{sub} / {r.max_score || 0}</td>}
                        <td />
                      </tr>,
                    ]
                  : []),
              ];
            })}
          </tbody>
          {!weighted && <tfoot><tr><td><strong>Total</strong></td><td className={total === 100 ? "c-present" : "c-absent"}><strong>{total}</strong> / 100</td><td /></tr></tfoot>}
          {weighted && <tfoot><tr><td colSpan={4} className="small"><strong>Term score</strong> = ({rows.map((r) => r.name || "?").join(" + ")}) ÷ {rows.length}</td></tr></tfoot>}
        </table>
      </div>
      <button type="button" onClick={() => setRows([...rows, { name: weighted ? `Block ${rows.length + 1}` : "", max_score: weighted ? "100" : "", parts: [] }])}>{weighted ? "Add a block" : "Add a part"}</button>
      {error && <p className="error">{error}</p>}
      <div className="row">
        <button className="primary" disabled={busy}>{scheme ? "Save changes" : "Add"}</button>
        <button type="button" onClick={onCancel}>Cancel</button>
      </div>
    </form>
  );
}
