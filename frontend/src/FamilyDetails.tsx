// The family helps complete their child's school record: details, health, a photo, who may collect, and documents.
import { useEffect, useState } from "react";
import { api, errorText, request } from "./api";
import { STATES } from "./Apply";
import { useBusy } from "./GrowthBits";
import Icon from "./Icon";
import { makeThumb } from "./StudentYear";
import { Avatar, Field, Glyph, hue } from "./ui";

interface FieldRow { key: string; label: string; group: "about" | "health" | "photo"; max: number; value: string | null; has: boolean }
interface Details {
  can_edit: boolean; complete: number; missing: string[]; fields: FieldRow[]; photo: string | null;
  pending: { at: string; keys: string[]; collectors: { name: string }[]; values: Record<string, string>; photo: string | null } | null;
  last: { at: string | null; approved: string[]; rejected: string[]; note: string | null } | null;
  documents: { id: string; kind: string; label: string; filename: string; checked: boolean; at: string }[]; doc_kinds: Record<string, string>;
  collectors: { name: string; phone: string | null; relationship: string }[];
}
const dapi = {
  get: (id: string) => api.raw<Details>("GET", `/api/me/children/${id}/details`),
  send: (id: string, b: unknown) => api.raw<Details>("POST", `/api/me/children/${id}/details`, b),
  doc: (id: string, kind: string, file: File) => { const b = new FormData(); b.append("kind", kind); b.append("file", file); return request<Details>(`/api/me/children/${id}/documents`, { method: "POST", body: b }); },
};
export const loadDetails = dapi.get;
const CHOICES: Record<string, string[]> = {
  state_of_origin: STATES, religion: ["Christianity", "Islam", "Other", "Prefer not to say"],
  "health.blood_group": ["A+", "A-", "B+", "B-", "AB+", "AB-", "O+", "O-", "Don't know"], "health.genotype": ["AA", "AS", "AC", "SS", "SC", "Don't know"],
};
const HINT: Record<string, string> = {
  "health.allergies": "e.g. groundnuts, penicillin. Write “None” if none.", "health.conditions": "e.g. asthma, sickle cell. Write “None” if none.",
  "health.diet": "The kitchen sees this", languages: "e.g. English, Igbo", home_address: "House number, street, town",
};
const RELS = ["Aunt", "Uncle", "Grandparent", "Brother", "Sister", "Driver", "Family friend"];

function shrink(file: File, done: (url: string) => void) {
  const img = new Image(); const u = URL.createObjectURL(file);
  img.onload = () => { const s = Math.min(img.width, img.height), c = document.createElement("canvas"); c.width = c.height = 400;
    c.getContext("2d")?.drawImage(img, (img.width - s) / 2, (img.height - s) / 2.6, s, s, 0, 0, 400, 400); done(c.toDataURL("image/jpeg", 0.82)); URL.revokeObjectURL(u); };
  img.src = u;
}

export default function FamilyDetails({ childId, name }: { childId: string; name: string }) {
  const [d, setD] = useState<Details | null>(null);
  const [v, setV] = useState<Record<string, string>>({});
  const [photo, setPhoto] = useState<string | null>(null);
  const [people, setPeople] = useState<{ name: string; phone: string; relationship: string }[]>([]);
  const [kind, setKind] = useState("birth_certificate");
  const [sent, setSent] = useState(false);
  const [error, setError] = useState("");
  const [busy, err2, run] = useBusy();
  useEffect(() => { dapi.get(childId).then((x) => { setD(x); setV(Object.fromEntries(x.fields.filter((f) => f.group !== "photo").map((f) => [f.key, x.pending?.values[f.key] ?? f.value ?? ""]))); }).catch((e) => setError(errorText(e))); }, [childId]);
  if (error) return <p className="error">{error}</p>;
  if (!d) return <div className="skeleton"><span /><span /></div>;
  const field = (f: FieldRow) => {
    const pend = d.pending?.keys.includes(f.key);
    const label = <>{f.label}{!f.has && !pend && <span className="fd-miss">missing</span>}{pend && <span className="fd-wait">waiting</span>}</>;
    const common = { value: v[f.key] ?? "", disabled: !d.can_edit, onChange: (e: { target: { value: string } }) => setV({ ...v, [f.key]: e.target.value }) };
    return (
      <Field key={f.key} label={label} hint={HINT[f.key]}>
        {CHOICES[f.key] ? <select {...common}><option value="">Choose…</option>{CHOICES[f.key].map((o) => <option key={o}>{o}</option>)}</select>
          : f.key === "date_of_birth" ? <input type="date" {...common} />
          : f.max > 150 ? <textarea rows={2} maxLength={f.max} {...common} /> : <input maxLength={f.max} {...common} />}
      </Field>
    );
  };
  const changed = () => Object.fromEntries(d.fields.filter((f) => f.group !== "photo").map((f) => [f.key, v[f.key] ?? ""]).filter(([k, x]) => (x || null) !== (d.fields.find((f) => f.key === k)?.value ?? null) && x !== (d.pending?.values[k as string] ?? null)));
  const send = () => run(async () => {
    const ch: Record<string, string | null> = { ...changed() };
    let thumb: string | null = null;
    if (photo) { ch.photo = photo; thumb = await makeThumb(photo); }
    const x = await dapi.send(childId, { changes: ch, photo_thumb: thumb, collectors: people.filter((p) => p.name.trim()) });
    setD(x); setPhoto(null); setPeople([]); setSent(true);
  });
  const dirty = Object.keys(changed()).length > 0 || !!photo || people.some((p) => p.name.trim());
  return (
    <section className="stack fd">
      <div className="fd-head" style={hue(d.complete >= 80 ? "green" : d.complete >= 50 ? "amber" : "red")}>
        <span className="setup-ring big" style={{ ["--pct" as string]: `${d.complete}%` }}><b>{d.complete}%</b></span>
        <div><strong>{name}'s school record is {d.complete}% complete</strong>
          <span className="small">{d.missing.length ? `Missing: ${d.missing.join(", ")}.` : "Everything is there. Thank you!"} {d.can_edit ? "Fill in what you can; the school checks it before it goes on the record." : ""}</span></div>
      </div>
      {sent && <p className="fam-seen"><Icon name="circle-check" size={15} />Sent. The school will check it and you'll get a notice.</p>}
      {d.pending && !sent && <p className="hint-line"><Icon name="clock" size={14} />You sent changes {new Date(d.pending.at).toLocaleDateString("en-GB", { day: "numeric", month: "short" })}. The school hasn't checked them yet. You can still add more.</p>}
      {d.last && (d.last.rejected.length > 0 || d.last.note) && <p className="hint-line warn"><Icon name="info" size={14} />Last time the school didn't change: {d.last.rejected.join(", ") || "–"}.{d.last.note ? ` “${d.last.note}”` : ""}</p>}

      <section className="card g-card" style={hue("violet")}>
        <h3 className="with-glyph"><Glyph icon="camera" hue="violet" size={30} />Photo</h3>
        <div className="row fd-photo">
          {photo || d.pending?.photo || d.photo ? <img src={photo ?? d.pending?.photo ?? d.photo!} alt="" /> : <Avatar name={name} size={96} />}
          {d.can_edit && <div className="stack"><label className="button with-icon"><Icon name="camera" size={15} />{d.photo ? "Send a newer photo" : "Add a photo"}
            <input hidden type="file" accept="image/*" onChange={(e) => { const f = e.target.files?.[0]; if (f) shrink(f, setPhoto); }} /></label>
            <small className="muted">A clear face on a plain background, like a passport photo. It goes on the ID card.</small></div>}
        </div>
      </section>
      <section className="card g-card" style={hue("blue")}>
        <h3 className="with-glyph"><Glyph icon="user" hue="blue" size={30} />About {name}</h3>
        <div className="form-grid">{d.fields.filter((f) => f.group === "about").map(field)}</div>
      </section>
      <section className="card g-card" style={hue("rose")}>
        <h3 className="with-glyph"><Glyph icon="heart-pulse" hue="rose" size={30} />Health</h3>
        <p className="muted small">Only the nurse and the people your school chooses can see these. Allergies and food are shared with the kitchen and teachers for safety.</p>
        <div className="form-grid">{d.fields.filter((f) => f.group === "health").map(field)}</div>
      </section>
      <section className="card g-card" style={hue("teal")}>
        <h3 className="with-glyph"><Glyph icon="shield" hue="teal" size={30} />Who else may collect {name}</h3>
        {d.collectors.length > 0 && <ul className="mini-list">{d.collectors.map((c) => <li key={c.name}><Avatar name={c.name} size={28} /><span><b>{c.name}</b><span className="muted"> · {c.relationship}{c.phone ? ` · ${c.phone}` : ""}</span></span></li>)}</ul>}
        {people.map((p, i) => (
          <div key={i} className="form-grid fd-person">
            <Field label="Full name"><input value={p.name} onChange={(e) => setPeople(people.map((x, j) => (j === i ? { ...x, name: e.target.value } : x)))} maxLength={120} /></Field>
            <Field label="Phone"><input type="tel" value={p.phone} onChange={(e) => setPeople(people.map((x, j) => (j === i ? { ...x, phone: e.target.value } : x)))} maxLength={30} /></Field>
            <Field label="Who are they?"><select value={p.relationship} onChange={(e) => setPeople(people.map((x, j) => (j === i ? { ...x, relationship: e.target.value } : x)))}>{RELS.map((r) => <option key={r}>{r}</option>)}</select></Field>
          </div>
        ))}
        {d.can_edit && people.length < 3 && <button className="small-btn with-icon" onClick={() => setPeople([...people, { name: "", phone: "", relationship: "Aunt" }])}><Icon name="plus" size={13} />Add someone</button>}
        <p className="muted small">The gate checks this list before letting {name} leave with anyone.</p>
      </section>
      <section className="card g-card" style={hue("sky")}>
        <h3 className="with-glyph"><Glyph icon="file" hue="sky" size={30} />Documents</h3>
        {d.documents.length > 0 && <ul className="mini-list">{d.documents.map((x) => <li key={x.id}><Icon name="file" size={15} /><span><b>{x.label}</b><span className="muted"> · {x.checked ? "on file" : "waiting for the school"}</span></span></li>)}</ul>}
        {d.can_edit && <div className="row wrap">
          <select value={kind} onChange={(e) => setKind(e.target.value)}>{Object.entries(d.doc_kinds).map(([k, l]) => <option key={k} value={k}>{l}</option>)}</select>
          <label className="button with-icon"><Icon name="plus" size={15} />Send a scan or photo
            <input hidden type="file" accept="application/pdf,image/*" onChange={(e) => { const f = e.target.files?.[0]; e.target.value = ""; if (f) void run(async () => setD(await dapi.doc(childId, kind, f))); }} /></label>
        </div>}
      </section>
      {err2 && <p className="error">{err2}</p>}
      {d.can_edit && <div className="fd-send"><button className="primary with-icon big-btn" disabled={busy || !dirty} onClick={send}><Icon name="send" size={16} />{busy ? "Sending…" : "Send to the school"}</button></div>}
    </section>
  );
}
