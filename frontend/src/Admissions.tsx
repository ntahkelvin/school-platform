// Admissions: from application to enrolled student. Families apply on the public page; the school tests, offers and enrols here.
import { useEffect, useMemo, useState } from "react";
import { api, errorText, getToken, type NewLogin } from "./api";
import { ApplyForm, type ApplyData, type PublicSchool } from "./Apply";
import { InsightList, useBusy } from "./GrowthBits";
import type { Insight } from "./growthApi";
import Icon from "./Icon";
import { useCanChange } from "./rightsApi";
import { href } from "./router";
import { PrintSheet, Qr } from "./Scanner";
import { Avatar, Field, Glyph, hue, Modal, NewLoginNotice, nicePhone } from "./ui";

interface Settings { is_open: boolean; code: string; session_label: string | null; levels: string[]; intro: string | null; form_fee: number | null; test_on: string | null;
  test_venue: string | null; test_subjects: string[]; pass_mark: number | null; offer_days: number }
interface Row { id: string; number: string; status: string; label: string; icon: string; hue: string; first_name: string; middle_name: string | null; last_name: string;
  gender: string; level: string; boarding: boolean; age: number | null; date_of_birth: string | null; photo: string | null; previous_school: string | null; parent_name: string;
  parent_phone: string; source: string; scores: Record<string, number>; score_total: number | null; offer_class: string | null; offer_expires: string | null;
  student_id: string | null; applied_at: string; docs: number; sibling_note: string | null; alert: boolean }
interface Detail extends Row { track_code: string; last_class: string | null; state_of_origin: string | null; lga: string | null; religion: string | null; allergies: string | null;
  conditions: string | null; support_needs: string | null; parent_relationship: string; parent_email: string | null; parent_occupation: string | null; home_address: string | null;
  parent2_name: string | null; parent2_relationship: string | null; parent2_phone: string | null; heard_from: string | null; interview: string | null; staff_note: string | null;
  offer_note: string | null; offer_class_id: string | null; history: { at: string; text: string; by: string | null }[];
  documents: { id: string; kind: string; label: string; filename: string; size: number }[]; siblings: { id: string; name: string; class_name: string | null }[];
  test_subjects: string[]; pass_mark: number | null; family_text: string }
interface Overview { settings: Settings; school: PublicSchool; statuses: Record<string, { label: string; icon: string; hue: string }>; counts: Record<string, number>;
  applications: Row[]; places: { level: string; capacity: number; students: number; offered: number; free: number; applied: number }[];
  classes: { id: string; name: string; level: string }[]; levels: string[]; insights: Insight[] }
interface LetterData { school: PublicSchool & { approval_number: string | null }; head: string | null; today: string;
  application: { number: string; track_code: string; name: string; first_name: string; gender: string; level: string; class_name: string; boarding: boolean; parent_name: string;
    home_address: string | null; expires: string | null; note: string | null; status: string };
  settings: { session: string | null; test_on: string | null; test_venue: string | null; test_subjects: string[]; code: string } }

const aapi = {
  overview: (sid: string) => api.raw<Overview>("GET", `/api/schools/${sid}/admissions`),
  settings: (sid: string, b: unknown) => api.raw<Settings>("PUT", `/api/schools/${sid}/admissions/settings`, b),
  newLink: (sid: string) => api.raw<Settings>("POST", `/api/schools/${sid}/admissions/new-link`),
  add: (sid: string, b: unknown) => api.raw<{ id: string; number: string; track_code: string }>("POST", `/api/schools/${sid}/admissions`, b),
  one: (id: string) => api.raw<Detail>("GET", `/api/applications/${id}`),
  status: (id: string, status: string, note?: string) => api.raw<Detail>("PUT", `/api/applications/${id}/status`, { status, note }),
  bulk: (sid: string, ids: string[], status: string) => api.raw<{ changed: number }>("POST", `/api/schools/${sid}/admissions/bulk-status`, { ids, status }),
  scores: (sid: string, rows: unknown) => api.raw("PUT", `/api/schools/${sid}/admissions/scores`, { rows }),
  offer: (id: string, b: unknown) => api.raw<Detail>("POST", `/api/applications/${id}/offer`, b),
  answer: (id: string, accept: boolean) => api.raw<Detail>("POST", `/api/applications/${id}/answer`, { accept }),
  enrol: (id: string, b: unknown) => api.raw<{ student_id: string; admission_no: string; class_name: string; logins: (NewLogin & { password: string | null })[] }>("POST", `/api/applications/${id}/enrol`, b),
  letter: (id: string) => api.raw<LetterData>("GET", `/api/applications/${id}/letter`),
};

const nice = (d: string | null, o: Intl.DateTimeFormatOptions = { day: "numeric", month: "short", year: "numeric" }) => (d ? new Date(d.length === 10 ? `${d}T12:00:00` : d).toLocaleDateString("en-GB", o) : "–");
const FLOW = ["new", "reviewing", "test_booked", "tested", "offered", "accepted", "enrolled"];
const SIDE = ["waitlist", "rejected", "declined", "withdrawn"];
const linkOf = (code: string) => `${window.location.origin}/#/apply/${code}`;

function Pic({ r, size = 40 }: { r: Pick<Row, "photo" | "first_name" | "last_name">; size?: number }) {
  return r.photo ? <img src={r.photo} alt="" className="adm-pic" width={size} height={size} /> : <Avatar name={`${r.first_name} ${r.last_name}`} size={size} />;
}

export default function AdmissionsPage({ schoolId }: { schoolId: string }) {
  const [d, setD] = useState<Overview | null>(null);
  const [error, setError] = useState("");
  const [status, setStatus] = useState("active");
  const [level, setLevel] = useState("");
  const [q, setQ] = useState("");
  const [pick, setPick] = useState<Set<string>>(new Set());
  const [open, setOpen] = useState<string | null>(null);
  const [modal, setModal] = useState<null | "settings" | "add" | "marks" | "poster">(null);
  const canChange = useCanChange();
  const load = () => aapi.overview(schoolId).then(setD).catch((e) => setError(errorText(e)));
  useEffect(() => { void load(); }, [schoolId]); // eslint-disable-line react-hooks/exhaustive-deps
  const list = useMemo(() => {
    if (!d) return [];
    const t = q.trim().toLowerCase();
    return d.applications.filter((a) => (status === "all" || (status === "active" ? !SIDE.includes(a.status) && a.status !== "enrolled" : a.status === status))
      && (!level || a.level === level) && (!t || `${a.first_name} ${a.last_name} ${a.number} ${a.parent_name} ${a.parent_phone}`.toLowerCase().includes(t)));
  }, [d, status, level, q]);
  if (error) return <p className="error">{error}</p>;
  if (!d) return <div className="skeleton" aria-hidden="true"><span /><span /><span /></div>;
  const st = d.settings;
  const bulk = async (to: string) => { await aapi.bulk(schoolId, [...pick], to); setPick(new Set()); void load(); };
  return (
    <div className="stack">
      <section className={`adm-banner${st.is_open ? " open" : ""}`}>
        <div className="adm-banner-main">
          <span className={`adm-state${st.is_open ? " on" : ""}`}><span className="dot" />{st.is_open ? "Taking applications" : "Closed"}</span>
          <strong>Admissions {st.session_label ?? ""}</strong>
          <span className="small">{st.levels.length ? `Entry classes: ${st.levels.join(", ")}` : "No entry classes chosen"}{st.test_on ? ` · Test ${nice(st.test_on, { weekday: "short", day: "numeric", month: "short" })}` : ""}</span>
          <div className="adm-link">
            <code>{linkOf(st.code).replace(/^https?:\/\//, "")}</code>
            <button className="small-btn with-icon" onClick={() => void navigator.clipboard?.writeText(linkOf(st.code))}><Icon name="copy" size={13} />Copy</button>
            <a className="small-btn button with-icon" href={`#/apply/${st.code}`} target="_blank" rel="noreferrer"><Icon name="eye" size={13} />Open</a>
          </div>
        </div>
        <button className="adm-qr" onClick={() => setModal("poster")} title="Print a poster with this QR code"><Qr text={linkOf(st.code)} size={92} /><small>Print poster</small></button>
        {canChange && <button className="on-band with-icon adm-settings" onClick={() => setModal("settings")}><Icon name="settings" size={15} />Settings</button>}
      </section>

      <div className="adm-funnel">
        {FLOW.map((k, i) => {
          const s = d.statuses[k]; const n = d.counts[k] ?? 0;
          return <button key={k} className={`adm-step${status === k ? " on" : ""}`} style={hue(s.hue as never)} onClick={() => setStatus(status === k ? "active" : k)}>
            <Glyph icon={s.icon} hue={s.hue} size={30} /><b>{n}</b><small>{s.label}</small>{i < FLOW.length - 1 && <span className="adm-arrow" aria-hidden="true" />}</button>;
        })}
      </div>
      <div className="row wrap adm-side">
        {SIDE.map((k) => <button key={k} className={`flag-chip${status === k ? " on" : ""}`} style={hue(d.statuses[k].hue as never)} onClick={() => setStatus(status === k ? "active" : k)}>
          <Icon name={d.statuses[k].icon} size={13} /><b>{d.counts[k] ?? 0}</b>{d.statuses[k].label}</button>)}
        <button className={`flag-chip${status === "all" ? " on" : ""}`} style={hue("slate")} onClick={() => setStatus(status === "all" ? "active" : "all")}><b>{d.applications.length}</b>All</button>
      </div>

      {d.places.length > 0 && (
        <div className="adm-places">
          {d.places.map((p) => {
            const pct = (n: number) => `${Math.min(100, (100 * n) / Math.max(1, p.capacity))}%`;
            return (
              <div key={p.level} className="adm-place">
                <div className="row"><b>{p.level}</b><span className="grow" /><span className={p.free ? "muted small" : "danger-text small"}>{p.free} place{p.free === 1 ? "" : "s"} left</span></div>
                <div className="adm-bar"><span className="have" style={{ width: pct(p.students) }} /><span className="offer" style={{ width: pct(p.offered) }} /></div>
                <small className="muted">{p.students} already in · {p.offered} offered · {p.applied} applied · room for {p.capacity}</small>
              </div>
            );
          })}
        </div>
      )}
      {d.insights.length > 0 && <InsightList items={d.insights} schoolId={schoolId} />}

      <div className="toolbar">
        <label className="search grow"><Icon name="search" size={17} /><input placeholder="Search by name, number or parent's phone" value={q} onChange={(e) => setQ(e.target.value)} /></label>
        <select value={level} onChange={(e) => setLevel(e.target.value)} aria-label="Class"><option value="">All classes</option>{[...new Set(d.applications.map((a) => a.level))].map((l) => <option key={l}>{l}</option>)}</select>
        {canChange && <button className="with-icon" onClick={() => setModal("marks")}><Icon name="clipboard-list" size={15} />Test marks</button>}
        {canChange && <button className="primary with-icon" onClick={() => setModal("add")}><Icon name="plus" size={15} />Walk-in application</button>}
      </div>
      {pick.size > 0 && canChange && (
        <div className="adm-bulk"><b>{pick.size} chosen</b>
          <button className="small-btn" onClick={() => bulk("test_booked")}>Book for the test</button>
          <button className="small-btn" onClick={() => bulk("reviewing")}>Being reviewed</button>
          <button className="small-btn" onClick={() => bulk("waitlist")}>Waiting list</button>
          <button className="small-btn danger-soft" onClick={() => { if (window.confirm(`Not offer a place to ${pick.size}?`)) void bulk("rejected"); }}>Not offered</button>
          <span className="grow" /><button className="text-link" onClick={() => setPick(new Set())}>Clear</button></div>
      )}

      {list.length === 0 ? (
        <div className="adm-empty">
          <span>📝</span>
          <p>{d.applications.length === 0 ? (st.is_open ? "No applications yet. Share the link or print the poster with its QR code." : "No applications yet. Open admissions in Settings, then share the link.") : "Nothing here."}</p>
        </div>
      ) : (
        <div className="adm-list">
          {list.map((a) => (
            <div key={a.id} className={`adm-row${pick.has(a.id) ? " picked" : ""}`} style={hue(a.hue as never)}>
              {canChange && <input type="checkbox" aria-label="Choose" checked={pick.has(a.id)} onChange={(e) => { const n = new Set(pick); if (e.target.checked) n.add(a.id); else n.delete(a.id); setPick(n); }} />}
              <button className="adm-row-main" onClick={() => setOpen(a.id)}>
                <Pic r={a} />
                <span className="adm-who"><b>{a.first_name} {a.last_name}</b>
                  <small className="muted">{a.number} · {a.gender === "female" ? "Girl" : "Boy"}{a.age != null ? `, ${a.age}` : ""} · {a.parent_name}</small></span>
                <span className="class-chip" style={hue("orange")}>{a.level}</span>
                {a.boarding && <span className="hue-chip hide-small" style={hue("indigo")}><Icon name="bed" size={11} />Boarding</span>}
                <span className="adm-icons hide-small">
                  {a.alert && <span className="alert-dot red" title="Health or learning note"><Icon name="heart-pulse" size={12} /></span>}
                  {a.docs > 0 && <span className="alert-dot sky" title={`${a.docs} documents`}><Icon name="file" size={12} /></span>}
                  {a.sibling_note && <span className="alert-dot amber" title={`Sibling: ${a.sibling_note}`}><Icon name="users" size={12} /></span>}
                </span>
                {a.score_total != null && <span className="adm-score" style={hue(a.score_total >= 70 ? "green" : a.score_total >= 50 ? "amber" : "red")}>{a.score_total}%</span>}
                <span className="adm-status"><Icon name={a.icon} size={13} />{a.label}{a.status === "offered" && a.offer_expires ? ` · by ${nice(a.offer_expires, { day: "numeric", month: "short" })}` : ""}</span>
              </button>
            </div>
          ))}
        </div>
      )}

      {open && <AppDetail id={open} classes={d.classes} canChange={canChange} onClose={() => { setOpen(null); void load(); }} />}
      {modal === "settings" && <SettingsForm schoolId={schoolId} s={st} levels={d.levels} onClose={() => setModal(null)} onDone={() => { setModal(null); void load(); }} />}
      {modal === "add" && (
        <Modal title="Walk-in application" onClose={() => setModal(null)} wide>
          <ApplyForm levels={st.levels.length ? st.levels : d.levels} boarding={d.school.boarding} submitLabel="Save application"
            onSubmit={async (x: ApplyData) => { const r = await aapi.add(schoolId, x); setModal(null); await load(); setOpen(r.id); }} />
        </Modal>
      )}
      {modal === "marks" && <Marks schoolId={schoolId} rows={d.applications.filter((a) => ["test_booked", "tested", "reviewing", "new"].includes(a.status))} subjects={st.test_subjects} pass={st.pass_mark}
        onClose={() => setModal(null)} onDone={() => { setModal(null); void load(); }} />}
      {modal === "poster" && <Poster s={d.school} link={linkOf(st.code)} onClose={() => setModal(null)} />}
    </div>
  );
}

// ---------- One application ----------

function AppDetail({ id, classes, canChange, onClose }: { id: string; classes: Overview["classes"]; canChange: boolean; onClose: () => void }) {
  const [a, setA] = useState<Detail | null>(null);
  const [error, setError] = useState("");
  const [sub, setSub] = useState<null | "offer" | "enrol" | "letter" | "invite" | "edit">(null);
  const [busy, err2, run] = useBusy();
  const [enrolled, setEnrolled] = useState<Awaited<ReturnType<typeof aapi.enrol>> | null>(null);
  useEffect(() => { aapi.one(id).then(setA).catch((e) => setError(errorText(e))); }, [id]);
  if (error) return <Modal title="Application" onClose={onClose}><p className="error">{error}</p></Modal>;
  if (!a) return <Modal title="Application" onClose={onClose}><p className="muted">Loading…</p></Modal>;
  const act = (f: () => Promise<Detail>) => run(async () => setA(await f()));
  const openDoc = async (docId: string) => {
    const res = await fetch(`/api/applications/${a.id}/documents/${docId}`, { headers: { Authorization: `Bearer ${getToken() ?? ""}` } });
    if (res.ok) window.open(URL.createObjectURL(await res.blob()), "_blank");
  };
  const fact = (l: string, v: string | null | undefined) => v ? <div><dt>{l}</dt><dd>{v}</dd></div> : null;
  return (
    <Modal title={`${a.first_name} ${a.last_name}`} onClose={onClose} wide>
      <div className="adm-detail">
        <div className="adm-head" style={hue(a.hue as never)}>
          <Pic r={a} size={84} />
          <div className="grow">
            <span className="adm-status big"><Icon name={a.icon} size={14} />{a.label}</span>
            <h3>{[a.first_name, a.middle_name, a.last_name].filter(Boolean).join(" ")}</h3>
            <p className="muted small">{a.number} · code {a.track_code} · {a.source === "office" ? "taken at the office" : "applied online"} {nice(a.applied_at)}</p>
            <p>{a.gender === "female" ? "Girl" : "Boy"}{a.age != null ? `, ${a.age} years` : ""} · for <b>{a.level}</b>{a.boarding ? " (boarding)" : " (day)"}{a.offer_class ? ` · offered ${a.offer_class}` : ""}</p>
          </div>
        </div>
        <p className="hint-line"><Icon name="eye" size={14} />The family sees: “{a.family_text}”</p>

        {canChange && a.status !== "enrolled" && (
          <div className="adm-actions">
            {["new", "reviewing"].includes(a.status) && <button className="with-icon" disabled={busy} onClick={() => act(() => aapi.status(a.id, "test_booked"))}><Icon name="calendar" size={15} />Book for the test</button>}
            {a.status === "test_booked" && <button className="with-icon" onClick={() => setSub("invite")}><Icon name="printer" size={15} />Test invitation</button>}
            {!["offered", "accepted"].includes(a.status) && <button className="primary with-icon" onClick={() => setSub("offer")}><Icon name="send" size={15} />Offer a place</button>}
            {a.status === "offered" && <>
              <button className="with-icon" onClick={() => setSub("letter")}><Icon name="printer" size={15} />Offer letter</button>
              <button className="with-icon" disabled={busy} onClick={() => act(() => aapi.answer(a.id, true))}><Icon name="circle-check" size={15} />Family said yes</button>
              <button className="with-icon" disabled={busy} onClick={() => act(() => aapi.answer(a.id, false))}><Icon name="circle-x" size={15} />Family said no</button>
            </>}
            {["offered", "accepted"].includes(a.status) && <button className="primary with-icon" onClick={() => setSub("enrol")}><Icon name="graduation-cap" size={15} />Enrol now</button>}
            {!["waitlist", "rejected", "withdrawn", "declined"].includes(a.status) && <button className="small-btn" disabled={busy} onClick={() => act(() => aapi.status(a.id, "waitlist"))}>Waiting list</button>}
            {!["rejected", "withdrawn"].includes(a.status) && <button className="small-btn danger-soft" disabled={busy} onClick={() => { if (window.confirm("Not offer a place?")) void act(() => aapi.status(a.id, "rejected")); }}>Not offered</button>}
            {["waitlist", "rejected", "declined", "withdrawn"].includes(a.status) && <button className="small-btn" disabled={busy} onClick={() => act(() => aapi.status(a.id, "reviewing", "Reopened"))}>Reopen</button>}
            <button className="small-btn with-icon" onClick={() => setSub("edit")}><Icon name="edit" size={13} />Edit details</button>
          </div>
        )}
        {a.status === "enrolled" && a.student_id && <p className="fam-seen"><Icon name="circle-check" size={15} />Enrolled. <a href={href({ page: "student", id: a.student_id })}>Open {a.first_name}'s profile</a></p>}
        {err2 && <p className="error">{err2}</p>}

        {Object.keys(a.scores).length > 0 && (
          <div className="adm-scores">
            {Object.entries(a.scores).map(([k, v]) => <span key={k} style={hue(v >= 70 ? "green" : v >= 50 ? "amber" : "red")}><b>{v}</b>{k}</span>)}
            {a.score_total != null && <span className="total" style={hue(a.pass_mark != null && a.score_total < a.pass_mark ? "red" : "green")}><b>{a.score_total}%</b>Overall{a.pass_mark != null ? (a.score_total >= a.pass_mark ? " · passed" : " · below pass mark") : ""}</span>}
          </div>
        )}
        {a.siblings.length > 0 && <p className="hint-line"><Icon name="users" size={14} />Already at the school: {a.siblings.map((s) => `${s.name}${s.class_name ? ` (${s.class_name})` : ""}`).join(", ")}</p>}
        {(a.allergies || a.conditions || a.support_needs) && <p className="hint-line warn"><Icon name="heart-pulse" size={14} />{[a.allergies && `Allergies: ${a.allergies}`, a.conditions && `Health: ${a.conditions}`, a.support_needs && `Learning: ${a.support_needs}`].filter(Boolean).join(" · ")}</p>}

        <div className="adm-cols">
          <section>
            <h4>Child</h4>
            <dl className="fam-facts">{fact("Date of birth", nice(a.date_of_birth))}{fact("Last school", a.previous_school)}{fact("Class there", a.last_class)}{fact("State", a.state_of_origin)}{fact("LGA", a.lga)}{fact("Religion", a.religion)}</dl>
          </section>
          <section>
            <h4>Family</h4>
            <dl className="fam-facts">{fact(a.parent_relationship, a.parent_name)}<div><dt>Phone</dt><dd><a href={`tel:${a.parent_phone}`}>{nicePhone(a.parent_phone)}</a></dd></div>
              {fact("Email", a.parent_email)}{fact("Occupation", a.parent_occupation)}{fact("Address", a.home_address)}{fact(a.parent2_relationship ?? "Second parent", a.parent2_name)}
              {a.parent2_phone && <div><dt>Their phone</dt><dd><a href={`tel:${a.parent2_phone}`}>{nicePhone(a.parent2_phone)}</a></dd></div>}{fact("Heard from", a.heard_from)}</dl>
          </section>
        </div>
        {a.documents.length > 0 && (
          <section><h4>Documents</h4><div className="row wrap">{a.documents.map((x) => <button key={x.id} className="small-btn with-icon" onClick={() => void openDoc(x.id)}><Icon name="file" size={13} />{x.label}</button>)}</div></section>
        )}
        {(a.interview || a.staff_note) && <section><h4>School notes (not shown to the family)</h4>{a.interview && <p><b>Interview:</b> {a.interview}</p>}{a.staff_note && <p>{a.staff_note}</p>}</section>}
        <section><h4>History</h4><ul className="fam-journey">{a.history.map((h, i) => <li key={i}><span className="muted small">{new Date(h.at).toLocaleString("en-GB", { day: "numeric", month: "short", hour: "2-digit", minute: "2-digit" })}{h.by ? ` · ${h.by}` : ""}</span>{h.text}</li>)}</ul></section>
      </div>
      {sub === "offer" && <OfferForm a={a} classes={classes} onClose={() => setSub(null)} onDone={(x) => { setA(x); setSub("letter"); }} />}
      {sub === "enrol" && !enrolled && <EnrolForm a={a} classes={classes} onClose={() => setSub(null)} onDone={(r) => { setEnrolled(r); void aapi.one(a.id).then(setA); }} />}
      {enrolled && (
        <Modal title="Welcome to the school! 🎉" onClose={() => { setEnrolled(null); setSub(null); }}>
          <div className="stack">
            <p><b>{a.first_name}</b> is now in <b>{enrolled.class_name}</b> with admission number <b className="mono">{enrolled.admission_no}</b>. Their profile has the photo, health notes and documents from the application.</p>
            {enrolled.logins.filter((l) => l.password).map((l) => <NewLoginNotice key={l.username} login={l as NewLogin} onDone={() => {}} />)}
            {enrolled.logins.filter((l) => !l.password).map((l) => <p key={l.username} className="hint-line"><Icon name="info" size={14} />{l.name} already has a login ({l.username}) and will see {a.first_name} there.</p>)}
            <div className="row"><a className="button" href={href({ page: "student", id: enrolled.student_id })}>Open the profile</a><span className="grow" /><button className="primary" onClick={() => { setEnrolled(null); setSub(null); }}>Done</button></div>
          </div>
        </Modal>
      )}
      {(sub === "letter" || sub === "invite") && <Letter id={a.id} kind={sub} onClose={() => setSub(null)} />}
      {sub === "edit" && <EditForm a={a} onClose={() => setSub(null)} onDone={(x) => { setA(x); setSub(null); }} />}
    </Modal>
  );
}

function OfferForm({ a, classes, onClose, onDone }: { a: Detail; classes: Overview["classes"]; onClose: () => void; onDone: (x: Detail) => void }) {
  const fit = classes.filter((c) => c.level === a.level);
  const [cls, setCls] = useState(a.offer_class_id ?? fit[0]?.id ?? "");
  const [boarding, setBoarding] = useState(a.boarding);
  const d = new Date(); d.setDate(d.getDate() + 14);
  const [expires, setExpires] = useState(d.toISOString().slice(0, 10));
  const [note, setNote] = useState(a.offer_note ?? "Please bring the acceptance form, 4 passport photographs and the birth certificate on resumption.");
  const [busy, error, run] = useBusy();
  return (
    <Modal title={`Offer ${a.first_name} a place`} onClose={onClose}>
      <form className="stack" onSubmit={(e) => { e.preventDefault(); run(async () => onDone(await aapi.offer(a.id, { class_id: cls || null, boarding, expires, note }))); }}>
        <div className="form-grid">
          <Field label="Class"><select value={cls} onChange={(e) => setCls(e.target.value)}><option value="">{a.level} (class chosen later)</option>{classes.map((c) => <option key={c.id} value={c.id}>{c.name}</option>)}</select></Field>
          <Field label="Answer by"><input type="date" value={expires} onChange={(e) => setExpires(e.target.value)} required /></Field>
        </div>
        <label className="check"><input type="checkbox" checked={boarding} onChange={(e) => setBoarding(e.target.checked)} />Boarding place</label>
        <Field label="Note on the letter"><textarea rows={3} maxLength={600} value={note} onChange={(e) => setNote(e.target.value)} /></Field>
        <p className="hint-line"><Icon name="info" size={14} />The family sees the offer on the admissions page with their code, and can accept there. You'll get a notice.</p>
        {error && <p className="error">{error}</p>}
        <div className="row"><span className="grow" /><button type="button" onClick={onClose}>Cancel</button><button className="primary" disabled={busy}>Make the offer</button></div>
      </form>
    </Modal>
  );
}

function EnrolForm({ a, classes, onClose, onDone }: { a: Detail; classes: Overview["classes"]; onClose: () => void; onDone: (r: Awaited<ReturnType<typeof aapi.enrol>>) => void }) {
  const [cls, setCls] = useState(a.offer_class_id ?? classes.find((c) => c.level === a.level)?.id ?? "");
  const [num, setNum] = useState("");
  const [busy, error, run] = useBusy();
  return (
    <Modal title={`Enrol ${a.first_name}`} onClose={onClose}>
      <form className="stack" onSubmit={(e) => { e.preventDefault(); run(async () => onDone(await aapi.enrol(a.id, { class_id: cls, admission_no: num || null }))); }}>
        <Field label="Class"><select value={cls} onChange={(e) => setCls(e.target.value)} required><option value="">Choose…</option>{classes.map((c) => <option key={c.id} value={c.id}>{c.name}</option>)}</select></Field>
        <Field label="Admission number (leave blank to give the next one)"><input value={num} onChange={(e) => setNum(e.target.value)} maxLength={40} /></Field>
        <ul className="enrol-list">
          <li><Icon name="circle-check" size={14} />Student profile with photo, class and a house (keeping houses even)</li>
          <li><Icon name="circle-check" size={14} />Health notes and documents copied across</li>
          <li><Icon name="circle-check" size={14} />Parent login made, linked to brothers and sisters already here</li>
        </ul>
        {error && <p className="error">{error}</p>}
        <div className="row"><span className="grow" /><button type="button" onClick={onClose}>Cancel</button><button className="primary with-icon" disabled={busy || !cls}><Icon name="graduation-cap" size={15} />Enrol</button></div>
      </form>
    </Modal>
  );
}

function EditForm({ a, onClose, onDone }: { a: Detail; onClose: () => void; onDone: (x: Detail) => void }) {
  const [staff, setStaff] = useState(a.staff_note ?? "");
  const [interview, setInterview] = useState(a.interview ?? "");
  const keys = ["first_name", "middle_name", "last_name", "gender", "date_of_birth", "level", "boarding", "previous_school", "last_class", "state_of_origin", "lga", "religion",
    "photo", "allergies", "conditions", "support_needs", "parent_name", "parent_relationship", "parent_phone", "parent_email", "parent_occupation", "home_address",
    "parent2_name", "parent2_relationship", "parent2_phone", "sibling_note", "heard_from"] as const;
  const initial: ApplyData = Object.fromEntries(keys.map((k) => [k, (a as unknown as Record<string, string | boolean | null>)[k] ?? (k === "boarding" ? false : "")]));
  return (
    <Modal title="Edit application" onClose={onClose} wide>
      <div className="form-grid">
        <Field label="Interview notes"><textarea rows={2} value={interview} onChange={(e) => setInterview(e.target.value)} maxLength={1000} /></Field>
        <Field label="Staff note (private)"><textarea rows={2} value={staff} onChange={(e) => setStaff(e.target.value)} maxLength={1000} /></Field>
      </div>
      <ApplyForm levels={[...new Set([a.level, "Nursery 1", "Primary 1", "JSS 1", "JSS 2", "JSS 3", "SS 1", "SS 2"])]} boarding initial={initial} submitLabel="Save changes"
        onSubmit={async (x) => onDone(await api.raw<Detail>("PUT", `/api/applications/${a.id}`, { ...x, staff_note: staff || null, interview: interview || null }))} />
    </Modal>
  );
}

// ---------- Test marks ----------

function Marks({ schoolId, rows, subjects, pass, onClose, onDone }: { schoolId: string; rows: Row[]; subjects: string[]; pass: number | null; onClose: () => void; onDone: () => void }) {
  const [m, setM] = useState<Record<string, Record<string, string>>>(() => Object.fromEntries(rows.map((r) => [r.id, Object.fromEntries(subjects.map((s) => [s, r.scores[s] != null ? String(r.scores[s]) : ""]))])));
  const [absent, setAbsent] = useState<Set<string>>(new Set());
  const [busy, error, run] = useBusy();
  const total = (id: string) => { const v = subjects.map((s) => m[id][s]).filter((x) => x !== ""); return v.length === subjects.length && subjects.length ? Math.round(v.reduce((a, b) => a + Number(b), 0) / subjects.length) : null; };
  const [order] = useState(() => [...rows].sort((a, b) => (b.score_total ?? -1) - (a.score_total ?? -1) || a.last_name.localeCompare(b.last_name)));
  const ranks = Object.fromEntries([...rows].map((r) => [r.id, total(r.id)]).filter(([, t]) => t != null).sort((a, b) => (b[1] as number) - (a[1] as number)).map(([id], i) => [id, i + 1]));
  const ranked = order;
  if (!subjects.length) return <Modal title="Test marks" onClose={onClose}><p>Add the test subjects in Settings first.</p></Modal>;
  return (
    <Modal title="Entrance test marks (out of 100)" onClose={onClose} wide>
      {rows.length === 0 ? <p className="muted">Nobody is booked for the test.</p> : (
        <div className="table-wrap plain marks-table">
          <table>
            <thead><tr><th>#</th><th>Child</th>{subjects.map((s) => <th key={s}>{s}</th>)}<th>Overall</th><th>Absent</th></tr></thead>
            <tbody>{ranked.map((r) => { const t = total(r.id); return (
              <tr key={r.id} className={absent.has(r.id) ? "muted" : ""}>
                <td>{ranks[r.id] ?? ""}</td>
                <td><b>{r.first_name} {r.last_name}</b><small className="block muted">{r.number} · {r.level}</small></td>
                {subjects.map((s) => <td key={s}><input className="mark-in" type="number" min={0} max={100} inputMode="numeric" value={m[r.id][s]} disabled={absent.has(r.id)}
                  onChange={(e) => setM({ ...m, [r.id]: { ...m[r.id], [s]: e.target.value } })} aria-label={`${s} for ${r.first_name}`} /></td>)}
                <td>{t != null && <span className="adm-score" style={hue(pass != null && t < pass ? "red" : "green")}>{t}%</span>}</td>
                <td><input type="checkbox" checked={absent.has(r.id)} onChange={(e) => { const n = new Set(absent); if (e.target.checked) n.add(r.id); else n.delete(r.id); setAbsent(n); }} aria-label="Absent" /></td>
              </tr>); })}</tbody>
          </table>
        </div>
      )}
      {pass != null && <p className="muted small">Pass mark: {pass}%. The # column shows each child's place by overall mark.</p>}
      {error && <p className="error">{error}</p>}
      <div className="row"><span className="grow" /><button onClick={onClose}>Cancel</button>
        <button className="primary" disabled={busy || !rows.length} onClick={() => run(async () => {
          await aapi.scores(schoolId, rows.map((r) => ({ id: r.id, absent: absent.has(r.id), scores: Object.fromEntries(subjects.map((s) => [s, m[r.id][s] === "" ? null : Number(m[r.id][s])])) })));
          onDone();
        })}>Save marks</button></div>
    </Modal>
  );
}

// ---------- Settings ----------

function SettingsForm({ schoolId, s, levels, onClose, onDone }: { schoolId: string; s: Settings; levels: string[]; onClose: () => void; onDone: () => void }) {
  const [v, setV] = useState({ ...s, test_on: s.test_on ? s.test_on.slice(0, 16) : "", subjects: s.test_subjects.join(", ") });
  const [busy, error, run] = useBusy();
  const local = s.test_on ? (() => { const d = new Date(s.test_on); return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}T${String(d.getHours()).padStart(2, "0")}:${String(d.getMinutes()).padStart(2, "0")}`; })() : "";
  useEffect(() => { setV((x) => ({ ...x, test_on: local })); }, []); // eslint-disable-line react-hooks/exhaustive-deps
  return (
    <Modal title="Admissions settings" onClose={onClose} wide>
      <form className="stack" onSubmit={(e) => { e.preventDefault(); run(async () => {
        await aapi.settings(schoolId, { is_open: v.is_open, session_label: v.session_label || null, levels: v.levels, intro: v.intro || null, form_fee: v.form_fee || null,
          test_on: v.test_on ? new Date(v.test_on).toISOString() : null, test_venue: v.test_venue || null, test_subjects: v.subjects.split(",").map((x) => x.trim()).filter(Boolean),
          pass_mark: v.pass_mark, offer_days: v.offer_days });
        onDone();
      }); }}>
        <label className="fa-toggle"><input type="checkbox" checked={v.is_open} onChange={(e) => setV({ ...v, is_open: e.target.checked })} /><span><b>Taking applications</b><small>When off, the public page says admissions are closed.</small></span></label>
        <div className="form-grid">
          <Field label="Session"><input value={v.session_label ?? ""} onChange={(e) => setV({ ...v, session_label: e.target.value })} placeholder="2027/2028" maxLength={30} /></Field>
          <Field label="Form fee (₦, paid at school)"><input type="number" min={0} value={v.form_fee ?? ""} onChange={(e) => setV({ ...v, form_fee: e.target.value ? Number(e.target.value) : null })} /></Field>
          <Field label="Days to accept an offer"><input type="number" min={1} max={90} value={v.offer_days} onChange={(e) => setV({ ...v, offer_days: Number(e.target.value) || 14 })} /></Field>
        </div>
        <Field label="Classes taking new students">
          <div className="chips">{levels.map((l) => <button type="button" key={l} className={`small-btn${v.levels.includes(l) ? " primary" : ""}`} onClick={() => setV({ ...v, levels: v.levels.includes(l) ? v.levels.filter((x) => x !== l) : [...v.levels, l] })}>{l}</button>)}</div>
        </Field>
        <div className="form-grid">
          <Field label="Entrance test date and time"><input type="datetime-local" value={v.test_on} onChange={(e) => setV({ ...v, test_on: e.target.value })} /></Field>
          <Field label="Where"><input value={v.test_venue ?? ""} onChange={(e) => setV({ ...v, test_venue: e.target.value })} placeholder="School hall" maxLength={150} /></Field>
          <Field label="Pass mark (%)"><input type="number" min={0} max={100} value={v.pass_mark ?? ""} onChange={(e) => setV({ ...v, pass_mark: e.target.value ? Number(e.target.value) : null })} /></Field>
        </div>
        <Field label="Test subjects (separate with commas)"><input value={v.subjects} onChange={(e) => setV({ ...v, subjects: e.target.value })} placeholder="English, Mathematics, General paper" /></Field>
        <Field label="Welcome text on the form"><textarea rows={3} maxLength={1000} value={v.intro ?? ""} onChange={(e) => setV({ ...v, intro: e.target.value })} placeholder="e.g. We welcome boys and girls of every faith. Forms are free for brothers and sisters of our students." /></Field>
        {error && <p className="error">{error}</p>}
        <div className="row"><button type="button" className="text-link danger-hover" onClick={() => { if (window.confirm("Make a new link? The old link and posters stop working.")) void run(async () => { await aapi.newLink(schoolId); onDone(); }); }}>Make a new link</button>
          <span className="grow" /><button type="button" onClick={onClose}>Cancel</button><button className="primary" disabled={busy}>Save</button></div>
      </form>
    </Modal>
  );
}

// ---------- Printing ----------

function Poster({ s, link, onClose }: { s: PublicSchool; link: string; onClose: () => void }) {
  return (
    <PrintSheet title="Admissions poster" onClose={onClose} note="Put it at the gate, in churches and mosques, and send a photo of it to parents' WhatsApp groups.">
      <div className="adm-poster" style={{ ["--card" as string]: s.colour || "#0f7a4f" }}>
        {s.logo && <img src={s.logo} alt="" className="poster-logo" />}
        <h1>{s.name}</h1>
        {s.motto && <em>{s.motto}</em>}
        <h2>Admissions {s.session ? `for ${s.session}` : "are open"}</h2>
        {s.levels.length > 0 && <p className="poster-levels">{s.levels.join(" · ")}</p>}
        <div className="poster-qr"><Qr text={link} size={260} /></div>
        <p className="poster-scan">📱 Scan with your phone camera to apply</p>
        <p className="mono poster-link">{link.replace(/^https?:\/\//, "")}</p>
        {s.test_on && <p>Entrance test: <b>{new Date(s.test_on).toLocaleString("en-GB", { weekday: "long", day: "numeric", month: "long", hour: "2-digit", minute: "2-digit" })}</b>{s.test_venue ? ` · ${s.test_venue}` : ""}</p>}
        <p className="poster-foot">{[s.address, s.phone].filter(Boolean).join(" · ")}</p>
      </div>
    </PrintSheet>
  );
}

function Letter({ id, kind, onClose }: { id: string; kind: "letter" | "invite"; onClose: () => void }) {
  const [d, setD] = useState<LetterData | null>(null);
  useEffect(() => { void aapi.letter(id).then(setD); }, [id]);
  const title = kind === "letter" ? "Offer letter" : "Test invitation";
  if (!d) return <PrintSheet title={title} onClose={onClose}><p>Loading…</p></PrintSheet>;
  const a = d.application, f = a.gender === "female";
  const his = f ? "her" : "his";
  const link = linkOf(d.settings.code);
  return (
    <PrintSheet title={title} onClose={onClose} note="Click any line to change the wording before you print.">
      <article className="letter" style={{ ["--card" as string]: d.school.colour || "#1e63d6" }}>
        <header className="lt-head">
          {d.school.logo && <img src={d.school.logo} alt="" />}
          <div><h1>{d.school.name}</h1>{d.school.motto && <em>{d.school.motto}</em>}<small>{[d.school.address, d.school.phone, d.school.email].filter(Boolean).join(" · ")}</small>
            {d.school.approval_number && <small>Approval no. {d.school.approval_number}</small>}</div>
        </header>
        <div className="lt-meta"><span>Ref: {a.number}</span><span>{nice(d.today, { day: "numeric", month: "long", year: "numeric" })}</span></div>
        <p contentEditable suppressContentEditableWarning>Dear {a.parent_name},</p>
        {kind === "letter" ? <>
          <h2>Offer of admission: {a.name}</h2>
          <p contentEditable suppressContentEditableWarning>We are delighted to offer <b>{a.name}</b> a place in <b>{a.class_name}</b>{a.boarding ? " as a boarder" : " as a day student"}{d.settings.session ? ` for the ${d.settings.session} session` : ""}. Congratulations!</p>
          {a.note && <p contentEditable suppressContentEditableWarning>{a.note}</p>}
          <p contentEditable suppressContentEditableWarning>Please let us know your answer{a.expires ? <> by <b>{nice(a.expires, { weekday: "long", day: "numeric", month: "long", year: "numeric" })}</b></> : ""}. You can accept online: scan the code at the bottom of this letter with your phone, choose “Check my application” and enter application number <b>{a.number}</b> with code <b>{a.track_code}</b>. You may also tell the school office.</p>
          <p contentEditable suppressContentEditableWarning>Once {a.first_name} is enrolled, your phone number becomes your login to follow {his} attendance, merits and school life.</p>
        </> : <>
          <h2>Invitation to the entrance test</h2>
          <p contentEditable suppressContentEditableWarning><b>{a.name}</b> is invited to sit the entrance test for <b>{a.level}</b>{d.settings.test_on ? <> on <b>{new Date(d.settings.test_on).toLocaleString("en-GB", { weekday: "long", day: "numeric", month: "long", hour: "2-digit", minute: "2-digit" })}</b></> : ""}{d.settings.test_venue ? ` at ${d.settings.test_venue}` : ""}.</p>
          {d.settings.test_subjects.length > 0 && <p contentEditable suppressContentEditableWarning>The test covers {d.settings.test_subjects.join(", ")}. Please bring two pens, a pencil, an eraser and this letter. Arrive 30 minutes early.</p>}
          <p contentEditable suppressContentEditableWarning>You can follow progress online with application number <b>{a.number}</b> and code <b>{a.track_code}</b>.</p>
        </>}
        <div className="lt-qr"><Qr text={link} size={90} /><small>Scan to check the application</small></div>
        <div className="lt-sign"><span className="lt-line" /><b contentEditable suppressContentEditableWarning>{d.head ?? " "}</b><span contentEditable suppressContentEditableWarning>Principal</span></div>
      </article>
    </PrintSheet>
  );
}
