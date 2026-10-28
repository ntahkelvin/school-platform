import { useEffect, useState, type FormEvent } from "react";
import { errorText } from "./api";
import { NIGERIAN_STATES } from "./StudentForm";
import { structure, type Profile } from "./structureApi";
import { Field } from "./ui";

/** Shrinks a chosen picture to at most 256 pixels across and returns it as a PNG data URL. */
export function shrinkImage(file: File): Promise<string> {
  return new Promise((resolve, reject) => {
    if (!file.type.startsWith("image/")) return reject(new Error("Choose a picture file (PNG or JPG)."));
    if (file.size > 10 * 1024 * 1024) return reject(new Error("That picture is too big. Choose one under 10 MB."));
    const img = new Image();
    img.onload = () => {
      const scale = Math.min(1, 256 / Math.max(img.width, img.height));
      const canvas = document.createElement("canvas");
      canvas.width = Math.max(1, Math.round(img.width * scale));
      canvas.height = Math.max(1, Math.round(img.height * scale));
      canvas.getContext("2d")?.drawImage(img, 0, 0, canvas.width, canvas.height);
      URL.revokeObjectURL(img.src);
      resolve(canvas.toDataURL("image/png"));
    };
    img.onerror = () => reject(new Error("That picture couldn't be opened."));
    img.src = URL.createObjectURL(file);
  });
}

type Form = Record<keyof Omit<Profile, "id" | "name">, string>;

function toForm(p: Profile): Form {
  const f = {} as Form;
  for (const k of Object.keys(p) as (keyof Profile)[]) {
    if (k === "id" || k === "name") continue;
    f[k] = p[k] === null || p[k] === undefined ? "" : String(p[k]);
  }
  return f;
}

export default function ProfileCard({ schoolId, onSaved, bare = false }: { schoolId: string; onSaved: () => void; bare?: boolean }) {
  const [form, setForm] = useState<Form | null>(null);
  const [error, setError] = useState("");
  const [saved, setSaved] = useState(false);
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    structure.profile(schoolId).then((p) => setForm(toForm(p))).catch((err) => setError(errorText(err)));
  }, [schoolId]);

  if (!form) return <section className="card">{error ? <p className="error">{error}</p> : <p className="muted">Loading…</p>}</section>;

  const set = (k: keyof Form) => (e: { target: { value: string } }) => {
    setForm({ ...form, [k]: e.target.value });
    setError("");
    setSaved(false);
  };

  async function pickLogo(file: File | undefined) {
    if (!file || !form) return;
    try {
      setForm({ ...form, logo: await shrinkImage(file) });
      setSaved(false);
    } catch (err) {
      setError(errorText(err));
    }
  }

  async function save(e: FormEvent) {
    e.preventDefault();
    if (!form) return;
    if (form.founded_year && !/^\d{4}$/.test(form.founded_year)) return setError("Year founded should be four digits, e.g. 1995.");
    if (form.email && !/^\S+@\S+\.\S+$/.test(form.email)) return setError("That email address doesn't look right.");
    setBusy(true);
    try {
      const payload: Record<string, unknown> = { ...form, founded_year: form.founded_year ? Number(form.founded_year) : null };
      for (const k of Object.keys(payload)) if (payload[k] === "") payload[k] = null;
      setForm(toForm(await structure.saveProfile(schoolId, payload)));
      setSaved(true);
      onSaved();
    } catch (err) {
      setError(errorText(err));
    } finally {
      setBusy(false);
    }
  }

  const Wrapper = bare ? "div" : "section";
  return (
    <Wrapper className={bare ? "" : "card"}>
      {!bare && <h2>School profile</h2>}
      <form className="stack" onSubmit={save} noValidate>
        <div className="logo-row">
          {form.logo ? <img className="logo big" src={form.logo} alt="School logo" /> : <div className="logo big placeholder">No logo</div>}
          <div className="stack">
            <label className="button file-button">
              {form.logo ? "Change logo" : "Upload logo"}
              <input type="file" accept="image/png,image/jpeg,image/webp" onChange={(e) => pickLogo(e.target.files?.[0])} />
            </label>
            {form.logo && <button type="button" className="ghost" onClick={() => { setForm({ ...form, logo: "" }); setSaved(false); }}>Remove logo</button>}
          </div>
        </div>
        <div className="form-grid">
          <div className="span-all"><Field label="Motto"><input value={form.motto} onChange={set("motto")} /></Field></div>
          <div className="span-all"><Field label="Address"><input value={form.address} onChange={set("address")} /></Field></div>
          <Field label="State">
            <select value={form.state} onChange={set("state")}>
              <option value="">Not set</option>
              {NIGERIAN_STATES.map((s) => <option key={s}>{s}</option>)}
            </select>
          </Field>
          <Field label="Local government area"><input value={form.lga} onChange={set("lga")} /></Field>
          <Field label="Phone"><input type="tel" value={form.phone} onChange={set("phone")} /></Field>
          <Field label="Email"><input type="email" value={form.email} onChange={set("email")} /></Field>
          <Field label="Website"><input value={form.website} onChange={set("website")} placeholder="www.example.edu.ng" /></Field>
          <Field label="Year founded"><input inputMode="numeric" value={form.founded_year} onChange={set("founded_year")} /></Field>
          <Field label="School colour">
            <div className="row">
              <input type="color" value={form.colour || "#0f7a4f"} onChange={set("colour")} style={{ width: 56, padding: 4 }} />
              {!form.colour && <span className="muted small">Not set</span>}
            </div>
          </Field>
          <Field label="Ministry approval number"><input value={form.approval_number} onChange={set("approval_number")} /></Field>
          <Field label="WAEC centre number"><input value={form.waec_centre_no} onChange={set("waec_centre_no")} /></Field>
          <Field label="NECO centre number"><input value={form.neco_centre_no} onChange={set("neco_centre_no")} /></Field>
        </div>
        {error && <p className="error">{error}</p>}
        <div className="row" style={{ alignItems: "center" }}>
          <button className="primary" disabled={busy}>{busy ? "Saving…" : "Save profile"}</button>
          {saved && <span className="c-present small">Saved</span>}
        </div>
      </form>
    </Wrapper>
  );
}
