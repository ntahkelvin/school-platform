import { useCallback, useEffect, useState, type FormEvent } from "react";
import { errorText } from "./api";
import { structure, type Band, type Component, type Scale, type Scheme } from "./structureApi";

type PartRow = { name: string; max_score: string };
import { Empty, Field, Modal } from "./ui";

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
    <section className="card">
      <div className="card-head">
        <h2>Grading scales</h2>
        <button className="primary" onClick={() => setEditing("new")}>Add grading scale</button>
      </div>
      <p className="muted small">Turns a score out of 100 into a grade. Each section chooses its scale on the Sections tab.</p>
      {error && <p className="error">{error}</p>}
      {scales?.length === 0 && <Empty>No grading scales yet. Add one, starting from the WAEC A1 to F9 scale if you like.</Empty>}
      {scales?.map((s) => (
        <div key={s.id} className="sub-card">
          <div className="card-head">
            <strong>{s.name}</strong>
            <div className="row">
              <button className="ghost" onClick={() => setEditing(s)}>Edit</button>
              <button
                className="ghost"
                onClick={() => {
                  if (window.confirm(`Delete the ${s.name} grading scale?`))
                    structure.deleteScale(s.id).then(load).catch((err) => setError(errorText(err)));
                }}
              >
                Delete
              </button>
            </div>
          </div>
          <div className="table-wrap plain">
            <table>
              <thead><tr><th>Grade</th><th>Score</th><th>Remark</th></tr></thead>
              <tbody>
                {s.bands.map((b) => (
                  <tr key={b.grade}><td><strong>{b.grade}</strong></td><td>{b.min_score} to {b.max_score}</td><td>{b.remark}</td></tr>
                ))}
              </tbody>
            </table>
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
  const [presets, setPresets] = useState<Record<string, Component[]>>({});
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
    <section className="card">
      <div className="card-head">
        <h2>CA and exam split</h2>
        <button className="primary" onClick={() => setEditing("new")}>Add CA / exam split</button>
      </div>
      <p className="muted small">How each subject's 100 marks are made up, e.g. two CAs of 20 and an exam of 60. Each section chooses one.</p>
      {error && <p className="error">{error}</p>}
      {schemes?.length === 0 && <Empty>None yet.</Empty>}
      {schemes?.map((s) => (
        <div key={s.id} className="sub-card">
          <div className="card-head">
            <strong>{s.name}</strong>
            <div className="row">
              <button className="ghost" onClick={() => setEditing(s)}>Edit</button>
              <button
                className="ghost"
                onClick={() => {
                  if (window.confirm(`Delete ${s.name}?`)) structure.deleteScheme(s.id).then(load).catch((err) => setError(errorText(err)));
                }}
              >
                Delete
              </button>
            </div>
          </div>
          <div className="split-bar">
            {s.components.map((c) => (
              <span key={c.name} style={{ flexGrow: c.max_score }} className={/exam/i.test(c.name) ? "exam" : ""}>
                {c.name} <strong>{c.max_score}</strong>
                {c.parts.length > 0 && (
                  <span className="parts">
                    {c.parts.map((p) => `${p.name} ${p.max_score}`).join(" · ")}
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
            onSubmit={async (name, comps) => {
              if (editing === "new") await structure.addScheme(schoolId, name, comps);
              else await structure.saveScheme(editing.id, name, comps);
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
  presets: Record<string, Component[]>;
  onSubmit: (name: string, components: Component[]) => Promise<void>;
  onCancel: () => void;
}) {
  const first = Object.keys(presets)[0];
  const asRows = (c: Component[]): CompRow[] =>
    c.map((x) => ({ name: x.name, max_score: String(x.max_score), parts: x.parts.map((p) => ({ name: p.name, max_score: String(p.max_score) })) }));
  const [name, setName] = useState(scheme?.name ?? "");
  const [rows, setRows] = useState<CompRow[]>(scheme ? asRows(scheme.components) : first ? asRows(presets[first]) : []);
  const [error, setError] = useState("");
  const [busy, setBusy] = useState(false);
  const total = rows.reduce((n, r) => n + (Number(r.max_score) || 0), 0);
  const update = (i: number, patch: Partial<CompRow>) => {
    setRows(rows.map((x, j) => (j === i ? { ...x, ...patch } : x)));
    setError("");
  };
  const setPart = (i: number, k: number, patch: Partial<PartRow>) =>
    update(i, { parts: rows[i].parts.map((p, m) => (m === k ? { ...p, ...patch } : p)) });

  async function submit(e: FormEvent) {
    e.preventDefault();
    if (name.trim().length < 2) return setError("Give it a name, for example Secondary or Primary.");
    if (rows.some((r) => !r.name.trim() || !/^\d+$/.test(r.max_score))) return setError("Every part needs a name and a whole-number mark.");
    if (total !== 100) return setError(`The parts must add up to 100. They add up to ${total}.`);
    for (const r of rows) {
      if (r.parts.length === 0) continue;
      if (r.parts.some((p) => !p.name.trim() || !/^\d+$/.test(p.max_score))) return setError(`${r.name}: every piece needs a name and a whole-number mark.`);
      const sub = r.parts.reduce((n, p) => n + Number(p.max_score), 0);
      if (sub !== Number(r.max_score)) return setError(`${r.name}: its pieces add up to ${sub}, but ${r.name} is worth ${r.max_score}.`);
    }
    setBusy(true);
    try {
      await onSubmit(name.trim(), rows.map((r) => ({
        name: r.name.trim(),
        max_score: Number(r.max_score),
        parts: r.parts.map((p) => ({ name: p.name.trim(), max_score: Number(p.max_score) })),
      })));
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
          <select value="" onChange={(e) => e.target.value && setRows(asRows(presets[e.target.value]))}>
            <option value="">Choose a common split…</option>
            {Object.keys(presets).map((p) => <option key={p}>{p}</option>)}
          </select>
        </Field>
      </div>
      <div className="table-wrap plain">
        <table className="edit-table">
          <thead><tr><th>Part</th><th>Marks</th><th /></tr></thead>
          <tbody>
            {rows.flatMap((r, i) => {
              const sub = r.parts.reduce((n, p) => n + (Number(p.max_score) || 0), 0);
              return [
                <tr key={`c${i}`}>
                  <td><input aria-label="Part name" value={r.name} onChange={(e) => update(i, { name: e.target.value })} /></td>
                  <td><input aria-label="Marks" inputMode="numeric" value={r.max_score} onChange={(e) => update(i, { max_score: e.target.value })} /></td>
                  <td className="nowrap">
                    {r.parts.length === 0 && (
                      <button type="button" className="ghost small" onClick={() => update(i, { parts: [{ name: "Test", max_score: "" }, { name: "Assignment", max_score: "" }] })}>
                        Split
                      </button>
                    )}
                    <button type="button" className="ghost" aria-label="Remove part" onClick={() => setRows(rows.filter((_, j) => j !== i))}>✕</button>
                  </td>
                </tr>,
                ...r.parts.map((p, k) => (
                  <tr key={`c${i}p${k}`} className="sub-row">
                    <td><input aria-label={`${r.name} piece name`} value={p.name} onChange={(e) => setPart(i, k, { name: e.target.value })} /></td>
                    <td><input aria-label={`${r.name} piece marks`} inputMode="numeric" value={p.max_score} onChange={(e) => setPart(i, k, { max_score: e.target.value })} /></td>
                    <td><button type="button" className="ghost" aria-label="Remove piece" onClick={() => update(i, { parts: r.parts.filter((_, m) => m !== k) })}>✕</button></td>
                  </tr>
                )),
                ...(r.parts.length > 0
                  ? [
                      <tr key={`c${i}add`} className="sub-row">
                        <td>
                          <button type="button" className="ghost small" onClick={() => update(i, { parts: [...r.parts, { name: "", max_score: "" }] })}>+ Add a piece</button>
                          <button type="button" className="ghost small" onClick={() => update(i, { parts: [] })}>Don't split</button>
                        </td>
                        <td className={sub === Number(r.max_score) ? "c-present small" : "c-absent small"}>{sub} / {r.max_score || 0}</td>
                        <td />
                      </tr>,
                    ]
                  : []),
              ];
            })}
          </tbody>
          <tfoot><tr><td><strong>Total</strong></td><td className={total === 100 ? "c-present" : "c-absent"}><strong>{total}</strong> / 100</td><td /></tr></tfoot>
        </table>
      </div>
      <button type="button" onClick={() => setRows([...rows, { name: "", max_score: "", parts: [] }])}>Add a part</button>
      <p className="muted small">Use Split when a part is made of smaller pieces, for example CA1 = test + assignment + classwork.</p>
      {error && <p className="error">{error}</p>}
      <div className="row">
        <button className="primary" disabled={busy}>{scheme ? "Save changes" : "Add"}</button>
        <button type="button" onClick={onCancel}>Cancel</button>
      </div>
    </form>
  );
}
