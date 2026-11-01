// A staff member's full record: work, personal details, next of kin, TRCN, qualifications, documents, pay, login.
import { useCallback, useEffect, useRef, useState, type FormEvent, type ReactNode } from "react";
import { api, errorText, getToken, type Me, type StaffMember, type Subject } from "./api";
import { StaffForm } from "./DailyTabs";
import Icon from "./Icon";
import Layout from "./Layout";
import { LoginPanel } from "./Logins";
import { subjectLook } from "./look";
import { shrinkImage } from "./ProfileCard";
import { href } from "./router";
import { records, type Item } from "./structureApi";
import { Empty, Field, Glyph, hue, IconButton, Modal, nicePhone } from "./ui";

interface Qual { id: string; title: string; institution: string | null; year: number | null; kind: string }
interface Doc { id: string; kind: string; kind_label: string; filename: string; content_type: string; size: number; uploaded_on: string }
interface Check { key: string; label: string; done: boolean }
interface Pay { grade_level: string | null; step: string | null; bank_name: string | null; account_number: string | null; account_name: string | null }
export interface StaffRecordData {
  user_id: string; school_id: string; school_name: string; full_name: string; phone: string | null; email: string | null;
  roles: string[]; title: string | null; gender: string | null; job_title: string | null; department_name: string | null;
  unit_name: string | null; staff_no: string | null; employment_type: string; date_joined: string | null; teaching: boolean;
  photo: string | null; date_of_birth: string | null; address: string | null; state_of_origin: string | null; lga: string | null;
  marital_status: string | null; religion: string | null; next_of_kin_name: string | null; next_of_kin_relationship: string | null;
  next_of_kin_phone: string | null; next_of_kin_address: string | null; trcn_number: string | null; trcn_expiry: string | null;
  subjects_trained: string[]; qualifications: Qual[]; documents: Doc[]; pay: Pay | null; may_edit: boolean; sees_pay: boolean;
  is_self: boolean; checklist: Check[];
}

const ROLE_NAME: Record<string, string> = {
  head: "Principal", vice_principal: "Vice principal", it_admin: "IT team", bursar: "Bursar", teacher: "Teacher",
  house_parent: "House parent", support: "Support staff",
};
const EMPLOYMENT: Record<string, string> = { full_time: "Full time", part_time: "Part time", contract: "Contract", nysc: "NYSC corps member", volunteer: "Volunteer" };
const DOC_KINDS: [string, string][] = [["cv", "CV"], ["appointment_letter", "Appointment letter"], ["certificate", "Certificate"],
  ["trcn", "TRCN certificate"], ["id", "Means of ID"], ["nysc", "NYSC certificate"], ["medical", "Medical report"], ["other", "Other"]];
const REQUIRED = ["cv", "appointment_letter", "certificate", "id"];
const STATES = ["Abia", "Adamawa", "Akwa Ibom", "Anambra", "Bauchi", "Bayelsa", "Benue", "Borno", "Cross River", "Delta", "Ebonyi", "Edo",
  "Ekiti", "Enugu", "FCT", "Gombe", "Imo", "Jigawa", "Kaduna", "Kano", "Katsina", "Kebbi", "Kogi", "Kwara", "Lagos", "Nasarawa", "Niger",
  "Ogun", "Ondo", "Osun", "Oyo", "Plateau", "Rivers", "Sokoto", "Taraba", "Yobe", "Zamfara"];

const nice = (iso: string | null) => (iso ? new Date(iso + "T00:00:00").toLocaleDateString("en-GB", { day: "numeric", month: "long", year: "numeric" }) : null);
const ageOf = (iso: string | null) => {
  if (!iso) return null;
  const b = new Date(iso + "T00:00:00"), n = new Date();
  let y = n.getFullYear() - b.getFullYear();
  if (n < new Date(n.getFullYear(), b.getMonth(), b.getDate())) y--;
  return y;
};
const yearsSince = (iso: string | null) => (iso ? Math.max(0, Math.floor((Date.now() - new Date(iso + "T00:00:00").getTime()) / 31557600000)) : null);

function Row({ label, children }: { label: string; children: ReactNode }) {
  return <><dt>{label}</dt><dd>{children || <span className="muted">Not set</span>}</dd></>;
}

function CompletenessRing({ checks }: { checks: Check[] }) {
  const done = checks.filter((c) => c.done).length, pct = checks.length ? done / checks.length : 0;
  const r = 30, len = 2 * Math.PI * r;
  const colour = pct === 1 ? "var(--h-green)" : pct >= 0.6 ? "var(--h-amber)" : "var(--h-red)";
  return (
    <svg width="76" height="76" viewBox="0 0 76 76" aria-label={`${Math.round(pct * 100)}% complete`}>
      <circle cx="38" cy="38" r={r} fill="none" stroke="var(--border)" strokeWidth="7" />
      <circle cx="38" cy="38" r={r} fill="none" stroke={colour} strokeWidth="7" strokeLinecap="round" strokeDasharray={`${len * pct} ${len}`} transform="rotate(-90 38 38)" />
      <text x="38" y="38" textAnchor="middle" dominantBaseline="central" className="mini-ring-text" style={{ fontSize: 16 }}>{Math.round(pct * 100)}%</text>
    </svg>
  );
}

function Card({ icon, hueName, title, action, children }: { icon: string; hueName: Parameters<typeof Glyph>[0]["hue"]; title: string; action?: ReactNode; children: ReactNode }) {
  return (
    <section className="card editor record-card" style={hue(hueName)}>
      <div className="card-head">
        <h2 className="with-glyph"><Glyph icon={icon} hue={hueName} size={34} />{title}</h2>
        {action}
      </div>
      {children}
    </section>
  );
}

type PersonalKey = "date_of_birth" | "address" | "state_of_origin" | "lga" | "marital_status" | "religion" | "next_of_kin_name"
  | "next_of_kin_relationship" | "next_of_kin_phone" | "next_of_kin_address" | "trcn_number" | "trcn_expiry";

function PersonalForm({ r, keys, onSave, onClose, title }: {
  r: StaffRecordData; keys: PersonalKey[]; title: string; onSave: (d: Record<string, string | null>) => Promise<void>; onClose: () => void;
}) {
  const [v, setV] = useState<Record<string, string>>(() => Object.fromEntries(keys.map((k) => [k, (r[k] as string | null) ?? ""])));
  const [error, setError] = useState("");
  const [busy, setBusy] = useState(false);
  const set = (k: string, x: string) => { setV((o) => ({ ...o, [k]: x })); setError(""); };
  const input = (k: PersonalKey, label: string, extra?: ReactNode) => {
    let el: ReactNode;
    if (k === "date_of_birth" || k === "trcn_expiry") el = <input type="date" value={v[k]} onChange={(e) => set(k, e.target.value)} />;
    else if (k === "state_of_origin") el = <select value={v[k]} onChange={(e) => set(k, e.target.value)}><option value="">Not set</option>{STATES.map((x) => <option key={x}>{x}</option>)}</select>;
    else if (k === "marital_status") el = <select value={v[k]} onChange={(e) => set(k, e.target.value)}><option value="">Not set</option>{["Single", "Married", "Widowed", "Divorced", "Separated"].map((x) => <option key={x}>{x}</option>)}</select>;
    else if (k === "religion") el = <select value={v[k]} onChange={(e) => set(k, e.target.value)}><option value="">Not set</option>{["Christianity", "Islam", "Traditional", "Other", "Prefer not to say"].map((x) => <option key={x}>{x}</option>)}</select>;
    else if (k === "address" || k === "next_of_kin_address") el = <textarea rows={2} value={v[k]} onChange={(e) => set(k, e.target.value)} />;
    else el = <input type={k === "next_of_kin_phone" ? "tel" : "text"} value={v[k]} onChange={(e) => set(k, e.target.value)} />;
    return <div key={k} className={k.includes("address") ? "span-all" : ""}><Field label={label}>{el}</Field>{extra}</div>;
  };
  const LABEL: Record<PersonalKey, string> = {
    date_of_birth: "Date of birth", address: "Home address", state_of_origin: "State of origin", lga: "Local government area",
    marital_status: "Marital status", religion: "Religion (optional)", next_of_kin_name: "Next of kin: full name",
    next_of_kin_relationship: "Relationship", next_of_kin_phone: "Next of kin: phone", next_of_kin_address: "Next of kin: address",
    trcn_number: "TRCN registration number", trcn_expiry: "TRCN licence expires",
  };
  async function submit(e: FormEvent) {
    e.preventDefault();
    setBusy(true);
    try { await onSave(Object.fromEntries(keys.map((k) => [k, v[k].trim() || null]))); } catch (err) { setError(errorText(err)); setBusy(false); }
  }
  return (
    <Modal title={title} onClose={onClose}>
      <form className="stack" onSubmit={submit} noValidate>
        <div className="form-grid">{keys.map((k) => input(k, LABEL[k]))}</div>
        {error && <p className="error">{error}</p>}
        <div className="row"><button className="primary" disabled={busy}>{busy ? "Saving…" : "Save"}</button><button type="button" onClick={onClose}>Cancel</button></div>
      </form>
    </Modal>
  );
}

async function openDocument(schoolId: string, userId: string, doc: Doc) {
  const res = await fetch(`/api/schools/${schoolId}/staff/${userId}/documents/${doc.id}`, { headers: { Authorization: `Bearer ${getToken() ?? ""}` } });
  if (!res.ok) throw new Error("The document couldn't be opened.");
  const url = URL.createObjectURL(await res.blob());
  window.open(url, "_blank", "noopener");
  setTimeout(() => URL.revokeObjectURL(url), 60000);
}

export default function StaffRecordPage({ me, onLogout, schoolId, userId }: { me: Me; onLogout: () => void; schoolId: string; userId: string }) {
  const [r, setR] = useState<StaffRecordData | null>(null);
  const [error, setError] = useState("");
  const [editing, setEditing] = useState<"" | "personal" | "kin" | "trcn" | "subjects" | "qual" | "pay" | "work">("");
  const [docKind, setDocKind] = useState("cv");
  const [uploading, setUploading] = useState(false);
  const fileInput = useRef<HTMLInputElement>(null);
  const photoInput = useRef<HTMLInputElement>(null);
  const base = `/api/schools/${schoolId}/staff/${userId}`;

  const load = useCallback(() => {
    api.raw<StaffRecordData>("GET", `${base}/record`).then(setR).catch((err) => setError(errorText(err)));
  }, [base]);
  useEffect(load, [load]);
  const save = (path: string, method: string, body: unknown) =>
    api.raw<StaffRecordData>(method, path, body).then((x) => { setR(x); setEditing(""); });

  async function upload(file: File) {
    setUploading(true);
    setError("");
    const body = new FormData();
    body.append("kind", docKind);
    body.append("file", file);
    try {
      const res = await fetch(`${base}/documents`, { method: "POST", body, headers: { Authorization: `Bearer ${getToken() ?? ""}` } });
      const data = await res.json();
      if (!res.ok) throw new Error(typeof data.detail === "string" ? data.detail : "The upload didn't work.");
      setR(data);
    } catch (err) {
      setError(errorText(err));
    } finally {
      setUploading(false);
    }
  }

  const crumbs = r && !r.is_self
    ? [{ label: "Home", href: "#/" }, { label: r.school_name, href: href({ page: "school", id: schoolId, tab: "staff" }) }, { label: r.full_name }]
    : [{ label: "Home", href: "#/" }, { label: "My record" }];
  const name = r ? [r.title, r.full_name].filter(Boolean).join(" ") : "";
  const trcnDays = r?.trcn_expiry ? Math.round((new Date(r.trcn_expiry + "T00:00:00").getTime() - Date.now()) / 86400000) : null;
  const hasDoc = (k: string) => r?.documents.some((d) => d.kind === k);

  return (
    <Layout wide me={me} onLogout={onLogout} crumbs={crumbs}>
      {error && <p className="error">{error}</p>}
      {!r && !error && <div className="skeleton"><span /><span /><span /></div>}
      {r && (
        <div className="stack staff-record">
          <header className="record-hero">
            <div className="record-photo">
              {r.photo ? <img src={r.photo} alt={`Photo of ${r.full_name}`} /> : <span className="photo-empty"><Icon name="user" size={44} /></span>}
              {r.may_edit && (
                <button className="photo-change" onClick={() => photoInput.current?.click()} title="Change photo"><Icon name="camera" size={16} /></button>
              )}
              <input ref={photoInput} type="file" accept="image/*" hidden onChange={async (e) => {
                const f = e.target.files?.[0];
                e.target.value = "";
                if (!f) return;
                try { await save(`${base}/record`, "PATCH", { photo: await shrinkImage(f) }); } catch (err) { setError(errorText(err)); }
              }} />
            </div>
            <div className="grow record-title">
              <h1>{name}</h1>
              <p className="muted">{[r.job_title, r.department_name, r.unit_name ? `${r.unit_name} unit` : null].filter(Boolean).join(" · ") || "No position yet"}</p>
              <ul className="facts">
                {r.staff_no && <li style={hue("slate")}><Icon name="clipboard" size={15} />{r.staff_no}</li>}
                {r.roles.map((x) => <li key={x} style={hue("violet")}><Icon name="shield-check" size={15} />{ROLE_NAME[x] ?? x}</li>)}
                <li style={hue(r.teaching ? "blue" : "orange")}><Icon name={r.teaching ? "book" : "wrench"} size={15} />{r.teaching ? "Teaching" : "Non-teaching"}</li>
                {r.phone && <li style={hue("green")}><Icon name="phone" size={15} /><a href={`tel:${r.phone}`}>{nicePhone(r.phone)}</a></li>}
                {r.email && <li style={hue("sky")}><Icon name="mail" size={15} /><a href={`mailto:${r.email}`}>{r.email}</a></li>}
              </ul>
            </div>
            <div className="record-progress">
              <CompletenessRing checks={r.checklist} />
              <span className="small muted">record complete</span>
              <a className="button with-icon" href={`#/staff-cards/${schoolId}/${userId}`}><Icon name="clipboard" size={15} />ID card</a>
            </div>
          </header>

          {r.checklist.some((c) => !c.done) && (
            <div className="missing-strip">
              <strong className="small">Still missing:</strong>
              {r.checklist.filter((c) => !c.done).map((c) => <span key={c.key} className="hue-chip" style={hue("amber")}>{c.label}</span>)}
            </div>
          )}

          <div className="record-grid">
            <Card icon="briefcase" hueName="violet" title="Work" action={!r.is_self && r.may_edit ? <button className="ghost small with-icon" onClick={() => setEditing("work")}><Icon name="edit" size={14} />Edit</button> : undefined}>
              <dl className="record-list">
                <Row label="Position">{r.job_title}</Row>
                <Row label="Department">{r.department_name}</Row>
                <Row label="Unit">{r.unit_name}</Row>
                <Row label="Staff number">{r.staff_no}</Row>
                <Row label="Employment">{EMPLOYMENT[r.employment_type]}</Row>
                <Row label="Joined">{r.date_joined ? `${nice(r.date_joined)} (${yearsSince(r.date_joined)} years)` : null}</Row>
              </dl>
            </Card>

            <Card icon="user" hueName="blue" title="Personal details" action={r.may_edit ? <button className="ghost small with-icon" onClick={() => setEditing("personal")}><Icon name="edit" size={14} />Edit</button> : undefined}>
              <dl className="record-list">
                <Row label="Gender">{r.gender ? (r.gender === "female" ? "Female" : "Male") : null}</Row>
                <Row label="Date of birth">{r.date_of_birth ? `${nice(r.date_of_birth)} (${ageOf(r.date_of_birth)})` : null}</Row>
                <Row label="Home address">{r.address}</Row>
                <Row label="State of origin">{[r.state_of_origin, r.lga].filter(Boolean).join(", ")}</Row>
                <Row label="Marital status">{r.marital_status}</Row>
                <Row label="Religion">{r.religion}</Row>
              </dl>
            </Card>

            <Card icon="handshake" hueName="pink" title="Next of kin" action={r.may_edit ? <button className="ghost small with-icon" onClick={() => setEditing("kin")}><Icon name="edit" size={14} />Edit</button> : undefined}>
              <dl className="record-list">
                <Row label="Name">{r.next_of_kin_name}</Row>
                <Row label="Relationship">{r.next_of_kin_relationship}</Row>
                <Row label="Phone">{r.next_of_kin_phone ? <a href={`tel:${r.next_of_kin_phone}`}>{nicePhone(r.next_of_kin_phone)}</a> : null}</Row>
                <Row label="Address">{r.next_of_kin_address}</Row>
              </dl>
            </Card>

            {r.teaching && (
              <Card icon="graduation-cap" hueName="indigo" title="Teaching registration" action={r.may_edit ? <button className="ghost small with-icon" onClick={() => setEditing("trcn")}><Icon name="edit" size={14} />Edit</button> : undefined}>
                <dl className="record-list">
                  <Row label="TRCN number">{r.trcn_number}</Row>
                  <Row label="Licence expires">{r.trcn_expiry ? <>{nice(r.trcn_expiry)} {trcnDays !== null && trcnDays < 0 ? <span className="hue-chip" style={hue("red")}>Expired</span> : trcnDays !== null && trcnDays < 90 ? <span className="hue-chip" style={hue("amber")}>Renew soon</span> : null}</> : null}</Row>
                </dl>
                <div className="row" style={{ justifyContent: "space-between", alignItems: "center" }}>
                  <strong className="small">Trained to teach</strong>
                  {r.may_edit && <button className="ghost small" onClick={() => setEditing("subjects")}>Choose</button>}
                </div>
                <div className="chips">
                  {r.subjects_trained.length === 0 && <span className="small muted">Not set</span>}
                  {r.subjects_trained.map((s) => <span key={s} className="hue-chip" style={hue(subjectLook(s).hue)}><Icon name={subjectLook(s).icon} size={12} />{s}</span>)}
                </div>
              </Card>
            )}

            <Card icon="award" hueName="amber" title="Qualifications" action={r.may_edit ? <button className="ghost small with-icon" onClick={() => setEditing("qual")}><Icon name="plus" size={14} />Add</button> : undefined}>
              {r.qualifications.length === 0 ? <p className="small muted">None recorded yet.</p> : (
                <ul className="qual-list">
                  {r.qualifications.map((q) => (
                    <li key={q.id}>
                      <span className="qual-year">{q.year ?? "–"}</span>
                      <span className="grow"><strong>{q.title}</strong><span className="block small muted">{q.institution ?? ""}</span></span>
                      {r.may_edit && <IconButton icon="trash" label={`Remove ${q.title}`} danger onClick={() => {
                        if (window.confirm(`Remove ${q.title}?`)) save(`${base}/qualifications/${q.id}`, "DELETE", undefined).catch((err) => setError(errorText(err)));
                      }} />}
                    </li>
                  ))}
                </ul>
              )}
            </Card>

            <Card icon="scroll" hueName="teal" title="Documents">
              <div className="doc-checks">
                {REQUIRED.map((k) => (
                  <span key={k} className={`doc-check${hasDoc(k) ? " ok" : ""}`}><Icon name={hasDoc(k) ? "shield-check" : "close"} size={13} />{DOC_KINDS.find((d) => d[0] === k)![1]}</span>
                ))}
              </div>
              {r.documents.length === 0 ? <p className="small muted">No documents yet.</p> : (
                <ul className="doc-list">
                  {r.documents.map((d) => (
                    <li key={d.id}>
                      <Glyph icon={d.content_type.includes("pdf") ? "scroll" : d.content_type.startsWith("image") ? "camera" : "book-text"} hue="teal" size={32} soft />
                      <button className="link-button grow" onClick={() => openDocument(schoolId, userId, d).catch((err) => setError(errorText(err)))}>
                        <strong>{d.kind_label}</strong>
                        <span className="block small muted">{d.filename} · {Math.max(1, Math.round(d.size / 1024))} KB · {nice(d.uploaded_on)}</span>
                      </button>
                      {r.may_edit && <IconButton icon="trash" label={`Delete ${d.filename}`} danger onClick={() => {
                        if (window.confirm(`Delete ${d.filename}?`)) save(`${base}/documents/${d.id}`, "DELETE", undefined).catch((err) => setError(errorText(err)));
                      }} />}
                    </li>
                  ))}
                </ul>
              )}
              {r.may_edit && (
                <div className="row wrap doc-upload">
                  <select aria-label="Kind of document" value={docKind} onChange={(e) => setDocKind(e.target.value)}>
                    {DOC_KINDS.map(([k, l]) => <option key={k} value={k}>{l}</option>)}
                  </select>
                  <button className="primary with-icon" disabled={uploading} onClick={() => fileInput.current?.click()}><Icon name="plus" size={15} />{uploading ? "Uploading…" : "Upload"}</button>
                  <input ref={fileInput} type="file" accept=".pdf,.jpg,.jpeg,.png,.webp,.doc,.docx" hidden onChange={(e) => { const f = e.target.files?.[0]; e.target.value = ""; if (f) upload(f); }} />
                  <span className="small muted">PDF, photo or Word, up to 5 MB</span>
                </div>
              )}
            </Card>

            {r.sees_pay && r.pay && (
              <Card icon="banknote" hueName="green" title="Pay (private)" action={<button className="ghost small with-icon" onClick={() => setEditing("pay")}><Icon name="edit" size={14} />Edit</button>}>
                <p className="small muted">Only the owner, principal and bursar can see this.</p>
                <dl className="record-list">
                  <Row label="Grade level">{[r.pay.grade_level, r.pay.step ? `step ${r.pay.step}` : null].filter(Boolean).join(", ")}</Row>
                  <Row label="Bank">{r.pay.bank_name}</Row>
                  <Row label="Account number">{r.pay.account_number ? <span className="mono">{r.pay.account_number}</span> : null}</Row>
                  <Row label="Account name">{r.pay.account_name}</Row>
                </dl>
              </Card>
            )}

            {!r.is_self && r.may_edit && (
              <section className="record-card"><LoginPanel schoolId={schoolId} userId={userId} /></section>
            )}
          </div>
        </div>
      )}

      {r && editing === "personal" && <PersonalForm r={r} title="Personal details" keys={["date_of_birth", "marital_status", "state_of_origin", "lga", "religion", "address"]}
        onClose={() => setEditing("")} onSave={(d) => save(`${base}/record`, "PATCH", d)} />}
      {r && editing === "kin" && <PersonalForm r={r} title="Next of kin" keys={["next_of_kin_name", "next_of_kin_relationship", "next_of_kin_phone", "next_of_kin_address"]}
        onClose={() => setEditing("")} onSave={(d) => save(`${base}/record`, "PATCH", d)} />}
      {r && editing === "trcn" && <PersonalForm r={r} title="Teaching registration" keys={["trcn_number", "trcn_expiry"]}
        onClose={() => setEditing("")} onSave={(d) => save(`${base}/record`, "PATCH", d)} />}
      {r && editing === "subjects" && <SubjectsTrained r={r} onClose={() => setEditing("")} onSave={(list) => save(`${base}/record`, "PATCH", { subjects_trained: list })} />}
      {r && editing === "qual" && <QualForm onClose={() => setEditing("")} onSave={(q) => save(`${base}/qualifications`, "POST", q)} />}
      {r && editing === "pay" && r.pay && <PayForm pay={r.pay} onClose={() => setEditing("")} onSave={(p) => save(`${base}/pay`, "PUT", p)} />}
      {r && editing === "work" && <WorkEditor schoolId={schoolId} userId={userId} onClose={() => setEditing("")} onSaved={() => { setEditing(""); load(); }} />}
    </Layout>
  );
}

function SubjectsTrained({ r, onSave, onClose }: { r: StaffRecordData; onSave: (s: string[]) => Promise<void>; onClose: () => void }) {
  const [subjects, setSubjects] = useState<Subject[]>([]);
  const [picked, setPicked] = useState<string[]>(r.subjects_trained);
  useEffect(() => { api.subjects(r.school_id).then(setSubjects).catch(() => {}); }, [r.school_id]);
  return (
    <Modal title="Subjects trained to teach" onClose={onClose}>
      <div className="stack">
        <div className="chips">
          {subjects.map((s) => (
            <label key={s.id} className={`chip pick${picked.includes(s.name) ? " on" : ""}`}>
              <input type="checkbox" checked={picked.includes(s.name)} onChange={(e) => setPicked(e.target.checked ? [...picked, s.name] : picked.filter((x) => x !== s.name))} />{s.name}
            </label>
          ))}
        </div>
        <div className="row"><button className="primary" onClick={() => onSave(picked)}>Save</button><button onClick={onClose}>Cancel</button></div>
      </div>
    </Modal>
  );
}

function QualForm({ onSave, onClose }: { onSave: (q: Partial<Qual>) => Promise<void>; onClose: () => void }) {
  const [title, setTitle] = useState("");
  const [institution, setInstitution] = useState("");
  const [year, setYear] = useState("");
  const [kind, setKind] = useState("degree");
  const [error, setError] = useState("");
  return (
    <Modal title="Add a qualification" onClose={onClose}>
      <form className="stack" noValidate onSubmit={(e) => {
        e.preventDefault();
        if (title.trim().length < 2) return setError("Enter the qualification, e.g. B.Sc. Ed Chemistry.");
        if (year && !/^\d{4}$/.test(year)) return setError("The year should be four digits.");
        onSave({ title: title.trim(), institution: institution.trim() || null, year: year ? Number(year) : null, kind }).catch((err) => setError(errorText(err)));
      }}>
        <div className="form-grid">
          <Field label="Qualification"><input value={title} onChange={(e) => setTitle(e.target.value)} placeholder="e.g. B.Sc. Ed Chemistry" autoFocus /></Field>
          <Field label="Type">
            <select value={kind} onChange={(e) => setKind(e.target.value)}>
              {[["degree", "Degree"], ["masters", "Master's / PhD"], ["nce", "NCE"], ["diploma", "Diploma / HND / OND"], ["pgde", "PGDE"], ["professional", "Professional (e.g. ICAN)"], ["certificate", "Certificate"], ["other", "Other"]].map(([k, l]) => <option key={k} value={k}>{l}</option>)}
            </select>
          </Field>
          <Field label="Institution"><input value={institution} onChange={(e) => setInstitution(e.target.value)} placeholder="e.g. University of Port Harcourt" /></Field>
          <Field label="Year"><input inputMode="numeric" value={year} onChange={(e) => setYear(e.target.value)} placeholder="2012" /></Field>
        </div>
        {error && <p className="error">{error}</p>}
        <div className="row"><button className="primary">Add</button><button type="button" onClick={onClose}>Cancel</button></div>
      </form>
    </Modal>
  );
}

function PayForm({ pay, onSave, onClose }: { pay: Pay; onSave: (p: Pay) => Promise<void>; onClose: () => void }) {
  const [v, setV] = useState<Pay>(pay);
  const [error, setError] = useState("");
  const set = (k: keyof Pay, x: string) => setV((o) => ({ ...o, [k]: x }));
  return (
    <Modal title="Pay details (private)" onClose={onClose}>
      <form className="stack" noValidate onSubmit={(e) => { e.preventDefault(); onSave(v).catch((err) => setError(errorText(err))); }}>
        <div className="form-grid">
          <Field label="Grade level"><input value={v.grade_level ?? ""} onChange={(e) => set("grade_level", e.target.value)} placeholder="e.g. GL 08" /></Field>
          <Field label="Step"><input value={v.step ?? ""} onChange={(e) => set("step", e.target.value)} /></Field>
          <Field label="Bank"><input value={v.bank_name ?? ""} onChange={(e) => set("bank_name", e.target.value)} placeholder="e.g. First Bank" /></Field>
          <Field label="Account number"><input inputMode="numeric" value={v.account_number ?? ""} onChange={(e) => set("account_number", e.target.value.replace(/\D/g, ""))} maxLength={10} /></Field>
          <div className="span-all"><Field label="Account name"><input value={v.account_name ?? ""} onChange={(e) => set("account_name", e.target.value)} /></Field></div>
        </div>
        {error && <p className="error">{error}</p>}
        <div className="row"><button className="primary">Save</button><button type="button" onClick={onClose}>Cancel</button></div>
      </form>
    </Modal>
  );
}

function WorkEditor({ schoolId, userId, onClose, onSaved }: { schoolId: string; userId: string; onClose: () => void; onSaved: () => void }) {
  const [person, setPerson] = useState<StaffMember | null>(null);
  const [branchId, setBranchId] = useState("");
  const [departments, setDepartments] = useState<Item[]>([]);
  const [units, setUnits] = useState<Awaited<ReturnType<typeof api.units>>>([]);
  const [jobs, setJobs] = useState<string[]>([]);
  useEffect(() => {
    api.school(schoolId).then((s) => {
      if (!s.campus_id) return;
      setBranchId(s.campus_id);
      api.staff(s.campus_id).then((list) => setPerson(list.find((p) => p.user_id === userId) ?? null)).catch(() => {});
    }).catch(() => {});
    records("school", schoolId, "departments").list().then(setDepartments).catch(() => {});
    api.units(schoolId).then(setUnits).catch(() => {});
    api.staffOptions().then((o) => setJobs(o.job_titles)).catch(() => {});
  }, [schoolId, userId]);
  return (
    <Modal title="Work details" onClose={onClose}>
      {!person ? <Empty icon="staff">Loading…</Empty> : (
        <StaffForm schoolId={schoolId} hideLogin person={person} departments={departments} units={units} jobTitles={jobs}
          onCancel={onClose}
          onRemoveRole={(m) => api.removeStaffRole(m).then(onSaved)}
          onSubmit={async (data, extra) => {
            await api.updateStaff(branchId, userId, data);
            if (extra.role) await api.addStaff(branchId, { ...data, phone: person.phone ?? "", email: person.email ?? "", role: extra.role });
            onSaved();
          }} />
      )}
    </Modal>
  );
}
