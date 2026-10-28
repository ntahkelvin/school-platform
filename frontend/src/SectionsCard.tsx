import { useCallback, useEffect, useMemo, useState, type FormEvent } from "react";
import { api, errorText } from "./api";
import { records, structure, type PersonOption, type Scale, type Scheme, type Section } from "./structureApi";
import { Empty, Field, Modal } from "./ui";

const STANDARD = ["Nursery", "Primary", "Junior Secondary", "Senior Secondary"];

export default function SectionsCard({ schoolId, people }: { schoolId: string; people: PersonOption[] }) {
  const sectionApi = useMemo(() => records("school", schoolId, "sections"), [schoolId]);
  const [sections, setSections] = useState<Section[] | null>(null);
  const [levels, setLevels] = useState<string[]>([]);
  const [scales, setScales] = useState<Scale[]>([]);
  const [schemes, setSchemes] = useState<Scheme[]>([]);
  const [editing, setEditing] = useState<Section | "new" | null>(null);
  const [picking, setPicking] = useState(false);
  const [error, setError] = useState("");

  const load = useCallback(() => {
    sectionApi.list().then((s) => setSections(s as unknown as Section[])).catch((err) => setError(errorText(err)));
  }, [sectionApi]);
  useEffect(() => {
    load();
    api.levels().then(setLevels).catch(() => {});
    structure.scales(schoolId).then(setScales).catch(() => {});
    structure.schemes(schoolId).then(setSchemes).catch(() => {});
  }, [load, schoolId]);

  const used = new Set((sections ?? []).flatMap((s) => s.levels));
  const unused = levels.filter((l) => !used.has(l));

  return (
    <section className="card">
      <div className="card-head">
        <h2>Sections</h2>
        <div className="row wrap">
          <button onClick={() => setPicking(true)}>Add standard sections</button>
          <button className="primary" onClick={() => setEditing("new")}>Add section</button>
        </div>
      </div>
      <p className="muted small">
        A section is a part of the school with its own class levels, head, grading and CA / exam split, such as Primary or
        Senior Secondary.
      </p>
      {error && <p className="error">{error}</p>}
      {sections?.length === 0 && <Empty>No sections yet. Click Add standard sections to choose from the usual ones.</Empty>}
      {sections && sections.length > 0 && (
        <ul className="list">
          {sections.map((s) => (
            <li key={s.id}>
              <div className="grow">
                <strong>{s.name}</strong>
                <span className="muted small block">
                  {s.levels.length ? s.levels.join(", ") : "No class levels yet"}
                </span>
                <span className="muted small block">
                  {[
                    s.head_name ? `Head: ${s.head_name}` : "No head yet",
                    scales.find((x) => x.id === s.grading_scale_id)?.name ?? "No grading scale",
                    schemes.find((x) => x.id === s.assessment_scheme_id)?.name ?? "No CA / exam split",
                  ].join(" · ")}
                </span>
              </div>
              <div className="row">
                <button className="ghost" onClick={() => setEditing(s)}>Edit</button>
                <button
                  className="ghost"
                  onClick={() => {
                    if (window.confirm(`Delete the ${s.name} section? Classes and students are not deleted.`))
                      sectionApi.remove(s.id).then(load).catch((err) => setError(errorText(err)));
                  }}
                >
                  Delete
                </button>
              </div>
            </li>
          ))}
        </ul>
      )}
      {sections && unused.length > 0 && sections.length > 0 && (
        <p className="muted small">Class levels not in any section yet: {unused.join(", ")}</p>
      )}

      {picking && (
        <PickStandard
          existing={(sections ?? []).map((s) => s.name)}
          onClose={() => setPicking(false)}
          onPick={async (names) => {
            setSections(await structure.addStandardSections(schoolId, names));
            setPicking(false);
          }}
        />
      )}
      {editing && (
        <Modal title={editing === "new" ? "Add section" : `Edit ${editing.name}`} onClose={() => setEditing(null)}>
          <SectionForm
            section={editing === "new" ? null : editing}
            allLevels={levels}
            takenLevels={new Set((sections ?? []).filter((s) => editing === "new" || s.id !== editing.id).flatMap((s) => s.levels))}
            people={people}
            scales={scales}
            schemes={schemes}
            onCancel={() => setEditing(null)}
            onSubmit={async (data) => {
              if (editing === "new") await sectionApi.add(data);
              else await sectionApi.update(editing.id, data);
              setEditing(null);
              load();
            }}
          />
        </Modal>
      )}
    </section>
  );
}

function PickStandard({ existing, onPick, onClose }: { existing: string[]; onPick: (names: string[]) => Promise<void>; onClose: () => void }) {
  const available = STANDARD.filter((n) => !existing.some((e) => e.toLowerCase() === n.toLowerCase()));
  const [chosen, setChosen] = useState<string[]>(available);
  const [error, setError] = useState("");
  return (
    <Modal title="Add standard sections" onClose={onClose}>
      {available.length === 0 ? (
        <p>This school already has all the standard sections.</p>
      ) : (
        <div className="stack">
          <p className="small muted">Tick the sections this school has. You can rename them or change their class levels afterwards.</p>
          {available.map((n) => (
            <label key={n} className="check">
              <input type="checkbox" checked={chosen.includes(n)} onChange={(e) => setChosen(e.target.checked ? [...chosen, n] : chosen.filter((c) => c !== n))} />
              {n}
            </label>
          ))}
          {error && <p className="error">{error}</p>}
          <div className="row">
            <button
              className="primary"
              onClick={() => (chosen.length ? onPick(chosen).catch((err) => setError(errorText(err))) : setError("Tick at least one section."))}
            >
              Add sections
            </button>
            <button onClick={onClose}>Cancel</button>
          </div>
        </div>
      )}
    </Modal>
  );
}

function SectionForm({
  section, allLevels, takenLevels, people, scales, schemes, onSubmit, onCancel,
}: {
  section: Section | null;
  allLevels: string[];
  takenLevels: Set<string>;
  people: PersonOption[];
  scales: Scale[];
  schemes: Scheme[];
  onSubmit: (data: Record<string, unknown>) => Promise<void>;
  onCancel: () => void;
}) {
  const [name, setName] = useState(section?.name ?? "");
  const [position, setPosition] = useState(String(section?.position ?? 0));
  const [levels, setLevels] = useState<string[]>(section?.levels ?? []);
  const [head, setHead] = useState(section?.head_user_id ?? "");
  const [scale, setScale] = useState(section?.grading_scale_id ?? "");
  const [scheme, setScheme] = useState(section?.assessment_scheme_id ?? "");
  const [error, setError] = useState("");
  const [busy, setBusy] = useState(false);

  async function submit(e: FormEvent) {
    e.preventDefault();
    if (name.trim().length < 2) return setError("Give the section a name.");
    if (!/^\d+$/.test(position)) return setError("Order must be a whole number.");
    setBusy(true);
    try {
      await onSubmit({
        name: name.trim(), position: Number(position), levels, head_user_id: head || null,
        grading_scale_id: scale || null, assessment_scheme_id: scheme || null,
      });
    } catch (err) {
      setError(errorText(err));
      setBusy(false);
    }
  }

  return (
    <form className="stack" onSubmit={submit} noValidate>
      <div className="form-grid">
        <Field label="Name"><input value={name} onChange={(e) => { setName(e.target.value); setError(""); }} autoFocus /></Field>
        <Field label="Order" hint="Lower numbers are listed first."><input inputMode="numeric" value={position} onChange={(e) => setPosition(e.target.value)} /></Field>
        <Field label="Head of section">
          <select value={head} onChange={(e) => setHead(e.target.value)}>
            <option value="">Nobody yet</option>
            {people.map((p) => <option key={p.id} value={p.id}>{p.full_name}</option>)}
          </select>
        </Field>
        <Field label="Grading scale" hint={scales.length === 0 ? "Create one on the Grading tab." : undefined}>
          <select value={scale} onChange={(e) => setScale(e.target.value)}>
            <option value="">Not set</option>
            {scales.map((s) => <option key={s.id} value={s.id}>{s.name}</option>)}
          </select>
        </Field>
        <Field label="CA / exam split" hint={schemes.length === 0 ? "Create one on the Grading tab." : undefined}>
          <select value={scheme} onChange={(e) => setScheme(e.target.value)}>
            <option value="">Not set</option>
            {schemes.map((s) => <option key={s.id} value={s.id}>{s.name}</option>)}
          </select>
        </Field>
      </div>
      <fieldset>
        <legend>Class levels in this section</legend>
        <div className="chips">
          {allLevels.map((lv) => {
            const taken = takenLevels.has(lv);
            const on = levels.includes(lv);
            return (
              <label key={lv} className={`chip pick${on ? " on" : ""}${taken ? " taken" : ""}`} title={taken ? "Already in another section" : undefined}>
                <input
                  type="checkbox"
                  checked={on}
                  disabled={taken}
                  onChange={(e) => { setLevels(e.target.checked ? [...levels, lv] : levels.filter((l) => l !== lv)); setError(""); }}
                />
                {lv}
              </label>
            );
          })}
        </div>
      </fieldset>
      {error && <p className="error">{error}</p>}
      <div className="row">
        <button className="primary" disabled={busy}>{section ? "Save changes" : "Add section"}</button>
        <button type="button" onClick={onCancel}>Cancel</button>
      </div>
    </form>
  );
}
