import { useState, type FormEvent } from "react";
import {
  errorText,
  type GuardianInput, type SchoolClass, type StudentInput, type StudentRow, type StudentStatus,
} from "./api";
import { Field } from "./ui";

export const NIGERIAN_STATES = [
  "Abia", "Adamawa", "Akwa Ibom", "Anambra", "Bauchi", "Bayelsa", "Benue", "Borno", "Cross River", "Delta",
  "Ebonyi", "Edo", "Ekiti", "Enugu", "FCT", "Gombe", "Imo", "Jigawa", "Kaduna", "Kano", "Katsina", "Kebbi",
  "Kogi", "Kwara", "Lagos", "Nasarawa", "Niger", "Ogun", "Ondo", "Osun", "Oyo", "Plateau", "Rivers", "Sokoto",
  "Taraba", "Yobe", "Zamfara",
];

export const RELATIONSHIPS = ["Mother", "Father", "Guardian", "Grandparent", "Uncle", "Aunt", "Sibling", "Sponsor"];

export function emptyGuardian(): GuardianInput {
  return { full_name: "", relationship: "Mother", phone: "", email: "" };
}

/** Returns an error message, or "" if the guardian details are fine (or entirely blank when optional). */
export function checkGuardian(g: GuardianInput, required: boolean): string {
  const blank = !g.full_name.trim() && !g.phone.trim() && !g.email.trim();
  if (blank && !required) return "";
  if (g.full_name.trim().length < 2) return "Enter the parent or guardian's name.";
  if (!g.phone.trim() && !g.email.trim()) return "Enter the parent's phone number or email, so they can log in later.";
  if (g.phone.trim() && g.phone.replace(/\D/g, "").length < 10) return "That phone number looks too short.";
  if (g.email.trim() && !/^\S+@\S+\.\S+$/.test(g.email.trim())) return "That email address doesn't look right.";
  return "";
}

export function GuardianFields({ value, onChange }: { value: GuardianInput; onChange: (g: GuardianInput) => void }) {
  const set = (k: keyof GuardianInput) => (e: { target: { value: string } }) => onChange({ ...value, [k]: e.target.value });
  return (
    <div className="form-grid">
      <Field label="Full name">
        <input value={value.full_name} onChange={set("full_name")} />
      </Field>
      <Field label="Relationship">
        <select value={value.relationship} onChange={set("relationship")}>
          {RELATIONSHIPS.map((r) => <option key={r}>{r}</option>)}
        </select>
      </Field>
      <Field label="Phone number" hint="If this parent is already on the system, their children are linked automatically.">
        <input type="tel" value={value.phone} onChange={set("phone")} placeholder="0803 123 4567" />
      </Field>
      <Field label="Email (optional)">
        <input type="email" value={value.email} onChange={set("email")} />
      </Field>
    </div>
  );
}

export default function StudentForm({
  classes,
  hasBoarding,
  initial,
  withGuardian,
  submitLabel,
  onSubmit,
  onCancel,
  hideStatus = false,
}: {
  classes: SchoolClass[];
  hasBoarding: boolean;
  initial?: StudentRow;
  withGuardian: boolean;
  submitLabel: string;
  onSubmit: (data: StudentInput & { status: StudentStatus }, guardian: GuardianInput | null) => Promise<void>;
  onCancel: () => void;
  hideStatus?: boolean;
}) {
  const [d, setD] = useState({
    first_name: initial?.first_name ?? "",
    middle_name: initial?.middle_name ?? "",
    last_name: initial?.last_name ?? "",
    gender: initial?.gender ?? ("" as "" | "male" | "female"),
    date_of_birth: initial?.date_of_birth ?? "",
    state_of_origin: initial?.state_of_origin ?? "",
    class_id: initial?.class_id ?? "",
    boarding_status: initial?.boarding_status ?? "day",
    admission_no: initial?.admission_no ?? "",
    status: initial?.status ?? "active",
  });
  const [guardian, setGuardian] = useState<GuardianInput>(emptyGuardian());
  const [error, setError] = useState("");
  const [busy, setBusy] = useState(false);
  const set = (k: keyof typeof d) => (e: { target: { value: string } }) => {
    setD({ ...d, [k]: e.target.value });
    setError("");
  };

  async function submit(e: FormEvent) {
    e.preventDefault();
    if (!d.first_name.trim() || !d.last_name.trim()) return setError("Enter the student's first and last name.");
    if (!d.gender) return setError("Choose the student's gender.");
    if (initial && !d.admission_no.trim()) return setError("The admission number can't be empty.");
    if (d.date_of_birth && d.date_of_birth > new Date().toISOString().slice(0, 10))
      return setError("Date of birth can't be in the future.");
    const gErr = withGuardian ? checkGuardian(guardian, false) : "";
    if (gErr) return setError(gErr);
    const hasGuardian = withGuardian && Boolean(guardian.full_name.trim());

    setBusy(true);
    try {
      await onSubmit(
        {
          first_name: d.first_name.trim(),
          middle_name: d.middle_name.trim(),
          last_name: d.last_name.trim(),
          gender: d.gender,
          date_of_birth: d.date_of_birth || null,
          state_of_origin: d.state_of_origin,
          class_id: d.class_id || null,
          boarding_status: d.boarding_status as "day" | "boarder",
          admission_no: d.admission_no.trim(),
          status: d.status as StudentStatus,
        },
        hasGuardian ? guardian : null,
      );
    } catch (err) {
      setError(errorText(err, "Could not save the student."));
      setBusy(false);
    }
  }

  return (
    <form className="stack" onSubmit={submit} noValidate>
      <div className="form-grid">
        <Field label="First name">
          <input value={d.first_name} onChange={set("first_name")} autoFocus />
        </Field>
        <Field label="Middle name (optional)">
          <input value={d.middle_name} onChange={set("middle_name")} />
        </Field>
        <Field label="Last name (surname)">
          <input value={d.last_name} onChange={set("last_name")} />
        </Field>
        <Field label="Gender">
          <select value={d.gender} onChange={set("gender")}>
            <option value="">Choose…</option>
            <option value="female">Female</option>
            <option value="male">Male</option>
          </select>
        </Field>
        <Field label="Date of birth (optional)">
          <input type="date" value={d.date_of_birth} onChange={set("date_of_birth")} />
        </Field>
        <Field label="State of origin (optional)">
          <select value={d.state_of_origin} onChange={set("state_of_origin")}>
            <option value="">Not set</option>
            {NIGERIAN_STATES.map((s) => <option key={s}>{s}</option>)}
          </select>
        </Field>
        <Field label="Class">
          <select value={d.class_id} onChange={set("class_id")}>
            <option value="">No class yet</option>
            {classes.map((c) => <option key={c.id} value={c.id}>{c.name}</option>)}
          </select>
        </Field>
        {hasBoarding && (
          <Field label="Day or boarder">
            <select value={d.boarding_status} onChange={set("boarding_status")}>
              <option value="day">Day student</option>
              <option value="boarder">Boarder</option>
            </select>
          </Field>
        )}
        <Field label="Admission number" hint={initial ? undefined : "Leave blank to create one automatically."}>
          <input value={d.admission_no} onChange={set("admission_no")} />
        </Field>
        {initial && hideStatus && <p className="hint-line">To mark {initial.first_name} as left or graduated, use <b>Print and more → Leaving the school</b>. It also frees their bed and bus seat.</p>}
        {initial && !hideStatus && (
          <Field label="Status">
            <select value={d.status} onChange={set("status")}>
              <option value="active">Active</option>
              <option value="graduated">Graduated</option>
              <option value="withdrawn">Withdrawn / left</option>
            </select>
          </Field>
        )}
      </div>

      {withGuardian && (
        <fieldset>
          <legend>Parent or guardian</legend>
          <GuardianFields value={guardian} onChange={(g) => { setGuardian(g); setError(""); }} />
        </fieldset>
      )}

      {error && <p className="error">{error}</p>}
      <div className="row">
        <button className="primary" disabled={busy}>{busy ? "Saving…" : submitLabel}</button>
        <button type="button" onClick={onCancel}>Cancel</button>
      </div>
    </form>
  );
}
