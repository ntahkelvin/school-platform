import { useEffect, useState } from "react";
import { errorText, type School } from "./api";
import { structure, type StarterChoices } from "./structureApi";
import { Field, Modal } from "./ui";

/** Fills a school with sensible defaults in one go. Never changes what's already there. */
export default function StarterSetup({ school, onDone, compact = false }: { school: School; onDone: () => void; compact?: boolean }) {
  const [open, setOpen] = useState(false);
  const [opts, setOpts] = useState<{ sections: string[]; grading: string[]; assessment: string[] } | null>(null);
  const [c, setC] = useState<StarterChoices>({
    sections: school.school_type === "boarding" ? ["Junior Secondary", "Senior Secondary"] : ["Primary", "Junior Secondary", "Senior Secondary"],
    secondary_grading: "WAEC (A1 to F9)",
    primary_grading: "Basic (A to F)",
    assessment: "CA1, CA2 and exam (20 + 20 + 60)",
    departments: true,
    subjects: true,
    calendar: true,
    facilities: true,
    hostels: true,
  });
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const [result, setResult] = useState<string[] | null>(null);

  useEffect(() => {
    if (open && !opts) structure.starterOptions().then(setOpts).catch((err) => setError(errorText(err)));
  }, [open, opts]);

  const hasPrimary = c.sections.some((s) => s === "Nursery" || s === "Primary");
  const hasSecondary = c.sections.some((s) => s.includes("Secondary"));
  const anyBoarding = school.school_type !== "day";
  const toggle = (k: keyof StarterChoices) => setC({ ...c, [k]: !c[k] });

  async function apply() {
    if (c.sections.length === 0) return setError("Tick at least one section.");
    setBusy(true);
    setError("");
    try {
      const res = await structure.applyStarter(school.id, {
        ...c,
        primary_grading: hasPrimary ? c.primary_grading : null,
        secondary_grading: hasSecondary ? c.secondary_grading : null,
      });
      setResult(res.added);
      onDone();
    } catch (err) {
      setError(errorText(err));
    } finally {
      setBusy(false);
    }
  }

  return (
    <>
      {compact ? (
        <button className="starter-button" onClick={() => { setOpen(true); setResult(null); }}>
          <span className="starter-icon" aria-hidden="true">✦</span>
          <span>
            <strong>Fill in the usual set-up</strong>
            <span className="small block">Sections, grading, departments, subjects, calendar and facilities in one go</span>
          </span>
        </button>
      ) : (
      <section className="card starter">
        <h2>Starter set-up</h2>
        <p className="small">
          Fill {school.name} with the usual Nigerian set-up in one go, then correct anything that's different. It only
          adds what's missing and never changes what you've already entered.
        </p>
        <button className="primary" onClick={() => { setOpen(true); setResult(null); }}>Start</button>
      </section>
      )}
      {open && (
        <Modal title={`Starter set-up for ${school.name}`} onClose={() => setOpen(false)}>
          {result ? (
            <div className="stack">
              {result.length === 0 ? (
                <p>Nothing new to add. This school already has all of it.</p>
              ) : (
                <>
                  <p><strong>Added:</strong></p>
                  <ul className="added-list">{result.map((r) => <li key={r}>{r}</li>)}</ul>
                  <p className="small muted">
                    Next, go through each tab and correct anything that's different at this school: names, heads, grading,
                    term dates, facilities, and rooms and beds in the hostels.
                  </p>
                </>
              )}
              <div className="row"><button className="primary" onClick={() => setOpen(false)}>Done</button></div>
            </div>
          ) : !opts ? (
            error ? <p className="error">{error}</p> : <p className="muted">Loading…</p>
          ) : (
            <div className="stack">
              <fieldset>
                <legend>Which sections does this school have?</legend>
                <div className="chips">
                  {opts.sections.map((s) => (
                    <label key={s} className={`chip pick${c.sections.includes(s) ? " on" : ""}`}>
                      <input
                        type="checkbox"
                        checked={c.sections.includes(s)}
                        onChange={(e) => { setC({ ...c, sections: e.target.checked ? [...c.sections, s] : c.sections.filter((x) => x !== s) }); setError(""); }}
                      />
                      {s}
                    </label>
                  ))}
                </div>
              </fieldset>
              <div className="form-grid">
                {hasSecondary && (
                  <Field label="Grading for secondary">
                    <select value={c.secondary_grading ?? ""} onChange={(e) => setC({ ...c, secondary_grading: e.target.value || null })}>
                      <option value="">Set it up myself</option>
                      {opts.grading.map((g) => <option key={g}>{g}</option>)}
                    </select>
                  </Field>
                )}
                {hasPrimary && (
                  <Field label="Grading for nursery and primary">
                    <select value={c.primary_grading ?? ""} onChange={(e) => setC({ ...c, primary_grading: e.target.value || null })}>
                      <option value="">Set it up myself</option>
                      {opts.grading.map((g) => <option key={g}>{g}</option>)}
                    </select>
                  </Field>
                )}
                <div className="span-all">
                  <Field label="CA and exam split" hint="You can change the marks or split any part into pieces afterwards.">
                    <select value={c.assessment ?? ""} onChange={(e) => setC({ ...c, assessment: e.target.value || null })}>
                      <option value="">Set it up myself</option>
                      {opts.assessment.map((a) => <option key={a}>{a}</option>)}
                    </select>
                  </Field>
                </div>
              </div>
              <fieldset>
                <legend>Also add</legend>
                <div className="stack">
                  <label className="check"><input type="checkbox" checked={c.departments} onChange={() => toggle("departments")} />Common departments (academic and non-academic)</label>
                  <label className="check"><input type="checkbox" checked={c.subjects} onChange={() => toggle("subjects")} />Common subjects, sorted into departments</label>
                  <label className="check"><input type="checkbox" checked={c.calendar} onChange={() => toggle("calendar")} />2026/2027 session, term dates, mid-terms, exams and holidays</label>
                  <label className="check"><input type="checkbox" checked={c.facilities} onChange={() => toggle("facilities")} />Usual facilities (offices, library, labs, sick bay…)</label>
                  {anyBoarding && (
                    <label className="check"><input type="checkbox" checked={c.hostels} onChange={() => toggle("hostels")} />Empty boys' and girls' hostels, ready for rooms and beds</label>
                  )}
                </div>
              </fieldset>
              <p className="small muted">Houses aren't added, because every school has its own names and colours.</p>
              {error && <p className="error">{error}</p>}
              <div className="row">
                <button className="primary" disabled={busy} onClick={apply}>{busy ? "Setting up…" : "Apply starter set-up"}</button>
                <button onClick={() => setOpen(false)}>Cancel</button>
              </div>
            </div>
          )}
        </Modal>
      )}
    </>
  );
}
