// The public admissions page: families apply, upload documents, follow progress and answer an offer. No login needed.
import { useEffect, useState, type FormEvent } from "react";
import { request } from "./api";
import Icon from "./Icon";
import { Field, hue } from "./ui";

export interface PublicSchool {
  name: string; logo: string | null; colour: string | null; motto: string | null; address: string | null; phone: string | null; email: string | null;
  open: boolean; session: string | null; levels: string[]; intro: string | null; form_fee: number | null; test_on: string | null; test_venue: string | null;
  boarding: boolean; doc_kinds: Record<string, string>;
}
interface Status {
  number: string; name: string; level: string; status: string; label: string; text: string; steps: string[]; step: number | null;
  test: { on: string | null; venue: string | null } | null; offer: { class_name: string; boarding: boolean; expires: string | null; note: string | null; session: string | null } | null;
  can_respond: boolean; documents: string[]; school: { name: string; phone: string | null };
}
export type ApplyData = Record<string, string | boolean | null>;

const pub = {
  info: (code: string) => request<PublicSchool>(`/api/public/apply/${code}`),
  apply: (code: string, body: ApplyData) => request<{ number: string; track_code: string; name: string }>(`/api/public/apply/${code}`, { method: "POST", body: JSON.stringify(body) }),
  status: (code: string, number: string, track: string) => request<Status>(`/api/public/apply/${code}/status?number=${encodeURIComponent(number)}&track=${encodeURIComponent(track)}`),
  respond: (code: string, number: string, track: string, accept: boolean) =>
    request<{ status: string }>(`/api/public/apply/${code}/respond`, { method: "POST", body: JSON.stringify({ number, track, accept }) }),
  upload: (code: string, number: string, track: string, kind: string, file: File) => {
    const b = new FormData(); b.append("number", number); b.append("track", track); b.append("kind", kind); b.append("file", file);
    return request(`/api/public/apply/${code}/documents`, { method: "POST", body: b });
  },
};

export const STATES = ["Abia", "Adamawa", "Akwa Ibom", "Anambra", "Bauchi", "Bayelsa", "Benue", "Borno", "Cross River", "Delta", "Ebonyi", "Edo", "Ekiti", "Enugu",
  "FCT Abuja", "Gombe", "Imo", "Jigawa", "Kaduna", "Kano", "Katsina", "Kebbi", "Kogi", "Kwara", "Lagos", "Nasarawa", "Niger", "Ogun", "Ondo", "Osun", "Oyo",
  "Plateau", "Rivers", "Sokoto", "Taraba", "Yobe", "Zamfara", "Not Nigerian"];
const RELATIONS = ["Father", "Mother", "Guardian", "Uncle", "Aunt", "Grandparent", "Sponsor"];
const HEARD = ["Another parent", "A pupil at the school", "Church or mosque", "Social media", "Radio or TV", "Our website", "Walked past", "Other"];
const STEP_LABEL: Record<string, string> = { new: "Applied", test_booked: "Test", tested: "Tested", offered: "Offer", accepted: "Accepted", enrolled: "Enrolled" };

function shrink(file: File | undefined, done: (url: string) => void) {
  if (!file) return;
  const img = new Image(); const url = URL.createObjectURL(file);
  img.onload = () => {
    const c = document.createElement("canvas"); const sc = Math.min(1, 400 / Math.max(img.width, img.height));
    c.width = img.width * sc; c.height = img.height * sc; c.getContext("2d")?.drawImage(img, 0, 0, c.width, c.height);
    done(c.toDataURL("image/jpeg", 0.8)); URL.revokeObjectURL(url);
  };
  img.src = url;
}

const EMPTY: ApplyData = { first_name: "", middle_name: "", last_name: "", gender: "", date_of_birth: "", level: "", boarding: false, previous_school: "", last_class: "",
  state_of_origin: "", lga: "", religion: "", photo: null, allergies: "", conditions: "", support_needs: "", parent_name: "", parent_relationship: "Mother",
  parent_phone: "", parent_email: "", parent_occupation: "", home_address: "", parent2_name: "", parent2_relationship: "Father", parent2_phone: "",
  sibling_note: "", heard_from: "", website: "" };

/** The application form, used by families online and by the school office for walk-ins. */
export function ApplyForm({ levels, boarding, onSubmit, submitLabel = "Send application", initial }: {
  levels: string[]; boarding: boolean; onSubmit: (d: ApplyData) => Promise<void>; submitLabel?: string; initial?: ApplyData;
}) {
  const [d, setD] = useState<ApplyData>({ ...EMPTY, ...(initial ?? {}) });
  const [step, setStep] = useState(0);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const set = (k: string, v: string | boolean | null) => setD((x) => ({ ...x, [k]: v }));
  const txt = (k: string, label: string, o: { req?: boolean; type?: string; ph?: string; max?: number } = {}) => (
    <Field label={label + (o.req ? "" : " (optional)")}><input type={o.type ?? "text"} value={(d[k] as string) ?? ""} required={o.req} maxLength={o.max ?? 150}
      placeholder={o.ph} onChange={(e) => set(k, e.target.value)} /></Field>
  );
  const steps = ["Your child", "Parents", "Health and more", "Check and send"];
  function next(e: FormEvent) {
    e.preventDefault(); setError("");
    if (step === 0 && (!d.gender || !d.level)) return setError("Choose boy or girl, and the class.");
    if (step < 3) { setStep(step + 1); window.scrollTo({ top: 0, behavior: "smooth" }); return; }
    setBusy(true);
    const clean: ApplyData = {};
    for (const [k, v] of Object.entries(d)) clean[k] = typeof v === "string" ? v.trim() || null : v;
    onSubmit(clean).catch((err) => setError(err instanceof Error ? err.message : "Something went wrong.")).finally(() => setBusy(false));
  }
  return (
    <form className="apply-form" onSubmit={next}>
      <ol className="wiz-steps apply-steps">{steps.map((s, i) => <li key={s} className={step === i ? "on" : step > i ? "done" : ""}>
        <button type="button" disabled={i > step} onClick={() => setStep(i)}><b>{step > i ? "✓" : i + 1}</b>{s}</button></li>)}</ol>
      {step === 0 && (
        <div className="stack">
          <div className="apply-photo">
            <label className="apply-photo-pick">{d.photo ? <img src={d.photo as string} alt="" /> : <span><Icon name="camera" size={26} />Add a photo</span>}
              <input hidden type="file" accept="image/*" onChange={(e) => shrink(e.target.files?.[0], (u) => set("photo", u))} /></label>
            <small className="muted">A clear face photo, like a passport photo. Optional.</small>
          </div>
          <div className="form-grid">
            {txt("first_name", "First name", { req: true, max: 80 })}{txt("middle_name", "Middle name", { max: 80 })}{txt("last_name", "Surname", { req: true, max: 80 })}
          </div>
          <div className="apply-choice" role="radiogroup" aria-label="Boy or girl">
            {[["male", "Boy", "👦"], ["female", "Girl", "👧"]].map(([v, l, em]) => <button type="button" role="radio" aria-checked={d.gender === v} key={v} className={d.gender === v ? "on" : ""} onClick={() => set("gender", v)}><span>{em}</span>{l}</button>)}
          </div>
          <div className="form-grid">
            <Field label="Date of birth"><input type="date" value={d.date_of_birth as string} onChange={(e) => set("date_of_birth", e.target.value)} required /></Field>
            <Field label="Class you are applying for"><select value={d.level as string} onChange={(e) => set("level", e.target.value)} required><option value="">Choose…</option>{levels.map((l) => <option key={l}>{l}</option>)}</select></Field>
            {txt("previous_school", "Present or last school")}{txt("last_class", "Class there", { max: 40 })}
          </div>
          {boarding && (
            <div className="apply-choice" role="radiogroup" aria-label="Day or boarding">
              {[[false, "Day student", "🏠"], [true, "Boarding", "🛏️"]].map(([v, l, em]) => <button type="button" role="radio" aria-checked={d.boarding === v} key={String(v)} className={d.boarding === v ? "on" : ""} onClick={() => set("boarding", v as boolean)}><span>{em as string}</span>{l as string}</button>)}
            </div>
          )}
          <div className="form-grid">
            <Field label="State of origin (optional)"><select value={d.state_of_origin as string} onChange={(e) => set("state_of_origin", e.target.value)}><option value="">Choose…</option>{STATES.map((s) => <option key={s}>{s}</option>)}</select></Field>
            {txt("lga", "LGA", { max: 80 })}
            <Field label="Religion (optional)"><select value={d.religion as string} onChange={(e) => set("religion", e.target.value)}><option value="">Choose…</option>{["Christianity", "Islam", "Other", "Prefer not to say"].map((s) => <option key={s}>{s}</option>)}</select></Field>
          </div>
        </div>
      )}
      {step === 1 && (
        <div className="stack">
          <h3 className="apply-h">Main parent or guardian</h3>
          <div className="form-grid">
            {txt("parent_name", "Full name", { req: true, ph: "e.g. Mrs Ngozi Eze" })}
            <Field label="Relationship"><select value={d.parent_relationship as string} onChange={(e) => set("parent_relationship", e.target.value)}>{RELATIONS.map((r) => <option key={r}>{r}</option>)}</select></Field>
            {txt("parent_phone", "Phone number", { req: true, type: "tel", ph: "0803 123 4567", max: 32 })}{txt("parent_email", "Email", { type: "email", max: 255 })}
            {txt("parent_occupation", "Occupation", { max: 100 })}
          </div>
          {txt("home_address", "Home address", { max: 300 })}
          <h3 className="apply-h">Second parent (optional)</h3>
          <div className="form-grid">
            {txt("parent2_name", "Full name")}
            <Field label="Relationship"><select value={d.parent2_relationship as string} onChange={(e) => set("parent2_relationship", e.target.value)}>{RELATIONS.map((r) => <option key={r}>{r}</option>)}</select></Field>
            {txt("parent2_phone", "Phone number", { type: "tel", max: 32 })}
          </div>
          <p className="hint-line"><Icon name="info" size={14} />If your child is offered a place, this phone number becomes your login to follow them at school.</p>
        </div>
      )}
      {step === 2 && (
        <div className="stack">
          <div className="form-grid">
            {txt("allergies", "Allergies", { ph: "e.g. groundnuts, penicillin", max: 300 })}{txt("conditions", "Health conditions", { ph: "e.g. asthma, sickle cell", max: 300 })}
          </div>
          <Field label="Anything that helps your child learn (optional)"><textarea rows={2} maxLength={600} value={d.support_needs as string} onChange={(e) => set("support_needs", e.target.value)} placeholder="e.g. needs glasses, sits in front" /></Field>
          {txt("sibling_note", "Brothers or sisters at this school", { ph: "Names and classes", max: 200 })}
          <Field label="How did you hear about the school? (optional)"><select value={d.heard_from as string} onChange={(e) => set("heard_from", e.target.value)}><option value="">Choose…</option>{HEARD.map((s) => <option key={s}>{s}</option>)}</select></Field>
          <input className="hp-field" tabIndex={-1} autoComplete="off" aria-hidden="true" value={d.website as string} onChange={(e) => set("website", e.target.value)} />
        </div>
      )}
      {step === 3 && (
        <div className="apply-review">
          <div className="row">{d.photo ? <img src={d.photo as string} alt="" className="apply-review-photo" /> : null}
            <div><h3>{[d.first_name, d.middle_name, d.last_name].filter(Boolean).join(" ")}</h3>
              <p>{d.gender === "female" ? "Girl" : "Boy"}{d.date_of_birth ? `, born ${new Date(`${d.date_of_birth}T12:00:00`).toLocaleDateString("en-GB", { day: "numeric", month: "long", year: "numeric" })}` : ""}</p>
              <p>Applying for <b>{d.level as string}</b>{boarding ? (d.boarding ? " as a boarder" : " as a day student") : ""}</p></div></div>
          <dl className="fam-facts">
            <div><dt>Parent</dt><dd>{d.parent_name as string} ({d.parent_relationship as string})</dd></div>
            <div><dt>Phone</dt><dd>{d.parent_phone as string}</dd></div>
            {d.previous_school && <div><dt>Last school</dt><dd>{d.previous_school as string}</dd></div>}
            {d.allergies && <div><dt>Allergies</dt><dd>{d.allergies as string}</dd></div>}
          </dl>
          <p className="muted small">By sending this you confirm the details are true. The school uses them only for admission.</p>
        </div>
      )}
      {error && <p className="error">{error}</p>}
      <div className="row apply-nav">{step > 0 && <button type="button" onClick={() => setStep(step - 1)}>Back</button>}<span className="grow" />
        <button className="primary with-icon" disabled={busy}>{step < 3 ? <>Next<Icon name="arrow-right" size={15} /></> : busy ? "Sending…" : <><Icon name="send" size={15} />{submitLabel}</>}</button></div>
    </form>
  );
}

export function ApplyPage({ code }: { code: string }) {
  const [s, setS] = useState<PublicSchool | null>(null);
  const [error, setError] = useState("");
  const [mode, setMode] = useState<"apply" | "check">("apply");
  const [done, setDone] = useState<{ number: string; track_code: string; name: string } | null>(null);
  useEffect(() => { pub.info(code).then(setS).catch((e) => setError(e.message)); }, [code]);
  useEffect(() => { if (s) document.title = `Apply to ${s.name}`; }, [s]);
  if (error) return <main className="apply-page"><div className="card apply-card"><h1>Page not found</h1><p className="muted">This admissions link is not working. Please ask the school for the right one.</p></div></main>;
  if (!s) return <main className="apply-page"><p className="muted center">Loading…</p></main>;
  const colour = s.colour || "#0f7a4f";
  return (
    <main className="apply-page" style={{ ["--school" as string]: colour }}>
      <header className="apply-hero">
        <span className="hero-pattern" aria-hidden="true" />
        {s.logo ? <img src={s.logo} alt="" className="fam-logo" /> : <span className="apply-initial">{s.name[0]}</span>}
        <div><h1>{s.name}</h1>{s.motto && <em>{s.motto}</em>}<p>Admissions{s.session ? ` for ${s.session}` : ""}</p></div>
      </header>
      <div className="segmented apply-tabs" role="tablist">
        <button className={mode === "apply" ? "on" : ""} onClick={() => setMode("apply")}><Icon name="user-plus" size={15} />Apply</button>
        <button className={mode === "check" ? "on" : ""} onClick={() => setMode("check")}><Icon name="search" size={15} />Check my application</button>
      </div>
      {mode === "apply" && !done && (
        <div className="card apply-card">
          {!s.open ? (
            <div className="apply-closed"><span>📪</span><h2>Admissions are closed right now</h2><p className="muted">Please check again later{s.phone ? ` or call ${s.phone}` : ""}.</p></div>
          ) : (
            <>
              {s.intro && <p className="apply-intro">{s.intro}</p>}
              <div className="apply-facts">
                {s.levels.length > 0 && <span style={hue("violet")}><Icon name="classes" size={14} />Taking: {s.levels.join(", ")}</span>}
                {s.test_on && <span style={hue("amber")}><Icon name="calendar" size={14} />Entrance test: {new Date(s.test_on).toLocaleString("en-GB", { weekday: "short", day: "numeric", month: "short", hour: "2-digit", minute: "2-digit" })}</span>}
                {s.form_fee ? <span style={hue("green")}><Icon name="banknote" size={14} />Form fee ₦{s.form_fee.toLocaleString()} (paid at the school)</span> : null}
              </div>
              <ApplyForm levels={s.levels} boarding={s.boarding} onSubmit={async (d) => setDone(await pub.apply(code, d))} />
            </>
          )}
        </div>
      )}
      {mode === "apply" && done && <Done code={code} s={s} done={done} />}
      {mode === "check" && <Check code={code} s={s} start={done} />}
      <footer className="apply-foot muted small">{[s.address, s.phone, s.email].filter(Boolean).join(" · ")}</footer>
    </main>
  );
}

function Done({ code, s, done }: { code: string; s: PublicSchool; done: { number: string; track_code: string; name: string } }) {
  return (
    <div className="card apply-card apply-done">
      <span className="apply-burst">🎉</span>
      <h2>Thank you! {done.name.split(" ")[0]}'s application is in.</h2>
      <p>Keep these two codes. You need them to check progress and answer an offer.</p>
      <div className="apply-codes"><span><small>Application number</small><b>{done.number}</b></span><span><small>Secret code</small><b>{done.track_code}</b></span></div>
      <p className="muted small">Take a screenshot of this screen now.</p>
      <Uploads code={code} number={done.number} track={done.track_code} kinds={s.doc_kinds} have={[]} />
    </div>
  );
}

function Uploads({ code, number, track, kinds, have }: { code: string; number: string; track: string; kinds: Record<string, string>; have: string[] }) {
  const [sent, setSent] = useState<string[]>(have);
  const [kind, setKind] = useState("birth_certificate");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  return (
    <div className="apply-uploads">
      <h3><Icon name="file" size={16} />Send documents (optional)</h3>
      <p className="muted small">A birth certificate and the last school report help the school decide faster. PDF or photo, 4 MB at most.</p>
      <div className="row wrap">
        <select value={kind} onChange={(e) => setKind(e.target.value)}>{Object.entries(kinds).map(([k, v]) => <option key={k} value={k}>{v}</option>)}</select>
        <label className={`button with-icon${busy ? " disabled" : ""}`}><Icon name="plus" size={15} />{busy ? "Sending…" : "Choose file"}
          <input hidden type="file" accept="application/pdf,image/*" disabled={busy} onChange={async (e) => {
            const f = e.target.files?.[0]; e.target.value = ""; if (!f) return;
            setBusy(true); setError("");
            try { await pub.upload(code, number, track, kind, f); setSent((x) => [...x, kind]); } catch (err) { setError(err instanceof Error ? err.message : "Could not send"); } finally { setBusy(false); }
          }} /></label>
      </div>
      {sent.length > 0 && <p className="fam-seen"><Icon name="circle-check" size={14} />Sent: {sent.map((k) => kinds[k] ?? k).join(", ")}</p>}
      {error && <p className="error">{error}</p>}
    </div>
  );
}

function Check({ code, s, start }: { code: string; s: PublicSchool; start: { number: string; track_code: string } | null }) {
  const [number, setNumber] = useState(start?.number ?? "");
  const [track, setTrack] = useState(start?.track_code ?? "");
  const [st, setSt] = useState<Status | null>(null);
  const [error, setError] = useState("");
  const [busy, setBusy] = useState(false);
  const look = async (e?: FormEvent) => { e?.preventDefault(); setError(""); setBusy(true); try { setSt(await pub.status(code, number, track)); } catch (err) { setSt(null); setError(err instanceof Error ? err.message : "Not found"); } finally { setBusy(false); } };
  const answer = async (accept: boolean) => { setBusy(true); try { await pub.respond(code, number, track, accept); await look(); } catch (err) { setError(err instanceof Error ? err.message : "Could not send"); } finally { setBusy(false); } };
  return (
    <div className="card apply-card">
      <form className="row wrap apply-check" onSubmit={look}>
        <Field label="Application number"><input value={number} onChange={(e) => setNumber(e.target.value)} placeholder="APP/2026/0001" required /></Field>
        <Field label="Secret code"><input value={track} onChange={(e) => setTrack(e.target.value)} placeholder="6 letters and numbers" required maxLength={12} /></Field>
        <button className="primary" disabled={busy}>Check</button>
      </form>
      {error && <p className="error">{error}</p>}
      {st && (
        <div className="apply-status">
          <h2>{st.name} <small className="muted">· {st.level}</small></h2>
          {st.step != null && (
            <ol className="apply-track">{st.steps.map((k, i) => <li key={k} className={i < st.step! ? "done" : i === st.step ? "on" : ""}><span>{i < st.step! ? "✓" : i + 1}</span>{STEP_LABEL[k]}</li>)}</ol>
          )}
          <p className={`apply-status-text s-${st.status}`}>{st.text}</p>
          {st.test && st.test.on && <p className="hint-line"><Icon name="calendar" size={14} />Test: {new Date(st.test.on).toLocaleString("en-GB", { weekday: "long", day: "numeric", month: "long", hour: "2-digit", minute: "2-digit" })}{st.test.venue ? ` at ${st.test.venue}` : ""}. Bring a pen, pencil and this application number.</p>}
          {st.offer && (
            <div className="apply-offer">
              <span className="apply-burst sm">🎓</span>
              <p>Offer: <b>{st.offer.class_name}</b>{st.offer.boarding ? " (boarding)" : ""}{st.offer.session ? ` for ${st.offer.session}` : ""}.</p>
              {st.offer.note && <p className="muted">{st.offer.note}</p>}
              {st.can_respond && <>
                {st.offer.expires && <p className="small">Please answer by <b>{new Date(`${st.offer.expires}T12:00:00`).toLocaleDateString("en-GB", { weekday: "long", day: "numeric", month: "long" })}</b>.</p>}
                <div className="row wrap"><button className="primary with-icon" disabled={busy} onClick={() => answer(true)}><Icon name="circle-check" size={16} />Yes, we accept the place</button>
                  <button className="danger-soft" disabled={busy} onClick={() => { if (window.confirm("Are you sure you don't want the place?")) void answer(false); }}>No, thank you</button></div>
              </>}
            </div>
          )}
          {!["enrolled", "rejected", "declined", "withdrawn"].includes(st.status) && <Uploads code={code} number={st.number} track={track} kinds={s.doc_kinds} have={st.documents} />}
          <p className="muted small">Questions? Call {st.school.name}{st.school.phone ? ` on ${st.school.phone}` : ""}.</p>
        </div>
      )}
    </div>
  );
}
