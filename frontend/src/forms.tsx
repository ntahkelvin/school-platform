import { useState, type FormEvent } from "react";
import { errorText, type SchoolType } from "./api";
import { Field } from "./ui";

export function SchoolForm({
  initial,
  submitLabel,
  onSubmit,
  onCancel,
}: {
  initial?: { name: string; school_type: SchoolType };
  submitLabel: string;
  onSubmit: (name: string, type: SchoolType) => Promise<void>;
  onCancel: () => void;
}) {
  const [name, setName] = useState(initial?.name ?? "");
  const [type, setType] = useState<SchoolType>(initial?.school_type ?? "day");
  const [error, setError] = useState("");
  const [busy, setBusy] = useState(false);

  async function submit(e: FormEvent) {
    e.preventDefault();
    if (name.trim().length < 2) return setError("Enter the school's name.");
    setBusy(true);
    try {
      await onSubmit(name.trim(), type);
    } catch (err) {
      setError(errorText(err, "Could not save the school."));
      setBusy(false);
    }
  }

  return (
    <form className="stack" onSubmit={submit} noValidate>
      <Field label="School name">
        <input value={name} onChange={(e) => { setName(e.target.value); setError(""); }} autoFocus />
      </Field>
      <Field label="Type">
        <select value={type} onChange={(e) => setType(e.target.value as SchoolType)}>
          <option value="day">Day school</option>
          <option value="boarding">Boarding school</option>
          <option value="mixed">Day and boarding</option>
        </select>
      </Field>
      {error && <p className="error">{error}</p>}
      <div className="row">
        <button className="primary" disabled={busy}>{submitLabel}</button>
        <button type="button" onClick={onCancel}>Cancel</button>
      </div>
    </form>
  );
}

export function BranchForm({
  initial,
  submitLabel,
  onSubmit,
  onCancel,
}: {
  initial?: { name: string; address: string | null; has_boarding: boolean };
  submitLabel: string;
  onSubmit: (name: string, address: string, hasBoarding: boolean) => Promise<void>;
  onCancel: () => void;
}) {
  const [name, setName] = useState(initial?.name ?? "");
  const [address, setAddress] = useState(initial?.address ?? "");
  const [boarding, setBoarding] = useState(initial?.has_boarding ?? false);
  const [error, setError] = useState("");
  const [busy, setBusy] = useState(false);

  async function submit(e: FormEvent) {
    e.preventDefault();
    if (name.trim().length < 2) return setError("Give the branch a name, for example Lekki campus.");
    setBusy(true);
    try {
      await onSubmit(name.trim(), address.trim(), boarding);
    } catch (err) {
      setError(errorText(err, "Could not save the branch."));
      setBusy(false);
    }
  }

  return (
    <form className="stack" onSubmit={submit} noValidate>
      <Field label="Branch name">
        <input value={name} onChange={(e) => { setName(e.target.value); setError(""); }} autoFocus />
      </Field>
      <Field label="Address (optional)">
        <input value={address} onChange={(e) => setAddress(e.target.value)} />
      </Field>
      <label className="check">
        <input type="checkbox" checked={boarding} onChange={(e) => setBoarding(e.target.checked)} />
        This branch has boarding
      </label>
      {error && <p className="error">{error}</p>}
      <div className="row">
        <button className="primary" disabled={busy}>{submitLabel}</button>
        <button type="button" onClick={onCancel}>Cancel</button>
      </div>
    </form>
  );
}
