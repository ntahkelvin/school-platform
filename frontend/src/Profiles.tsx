// Complete every profile: which classes have gaps, photo day, asking families, and checking what families send.
import { useEffect, useRef, useState } from "react";
import { api, errorText, getToken } from "./api";
import { useBusy } from "./GrowthBits";
import Icon from "./Icon";
import { href } from "./router";
import { makeThumb } from "./StudentYear";
import { Avatar, Field, Glyph, hue, Modal } from "./ui";

interface Item { key: string; label: string; health: boolean; may: boolean; old: string | null; new: string | null; photo: string | null; decided: string | null }
interface Req { id: string; student: { id: string; name: string; class_name: string | null; thumb: string | null }; by: string | null; at: string; items: Item[]; collectors: { name: string; phone: string | null; relationship: string }[] }
interface Doc { id: string; student_id: string; student: string; class_name: string | null; kind: string; label: string; filename: string; size: number; by: string | null; at: string }
export interface ProfilesData {
  students: number; complete: number; full: number; missing: [string, number][]; families: number; health_ok: boolean;
  classes: { class_id: string; name: string; students: number; complete: number; full: number; missing: [string, number][]; no_photo: number }[];
  requests: Req[]; documents: Doc[];
}
export const papi = {
  overview: (sid: string) => api.raw<ProfilesData>("GET", `/api/schools/${sid}/profiles`),
  decide: (rid: string, b: unknown) => api.raw<ProfilesData>("POST", `/api/profile-requests/${rid}/decide`, b),
  doc: (did: string, keep: boolean) => api.raw("POST", `/api/student-documents/${did}/checked`, { keep }),
  ask: (sid: string, b: unknown) => api.raw<{ families: number; skipped: number; never_logged_in: number }>("POST", `/api/schools/${sid}/profiles/ask`, b),
};
const ringHue = (n: number) => (n >= 80 ? "green" : n >= 50 ? "amber" : "red");
const ago = (iso: string) => { const d = Math.round((Date.now() - new Date(iso).getTime()) / 86400000); return d <= 0 ? "today" : d === 1 ? "yesterday" : `${d} days ago`; };

export default function ProfilesPanel({ schoolId, onCount }: { schoolId: string; onCount?: (n: number) => void }) {
  const [d, setD] = useState<ProfilesData | null>(null);
  const [error, setError] = useState("");
  const [photoDay, setPhotoDay] = useState<{ id: string; name: string } | null>(null);
  const [ask, setAsk] = useState<{ class_id: string | null; name: string } | null>(null);
  const load = () => papi.overview(schoolId).then((x) => { setD(x); onCount?.(x.requests.length + x.documents.length); }).catch((e) => setError(errorText(e)));
  useEffect(() => { void load(); }, [schoolId]); // eslint-disable-line react-hooks/exhaustive-deps
  if (error) return <p className="error">{error}</p>;
  if (!d) return <div className="skeleton"><span /><span /><span /></div>;
  const waiting = d.requests.length + d.documents.length;
  return (
    <div className="stack">
      <section className="pf-hero">
        <span className="setup-ring big" style={{ ...hue(ringHue(d.complete)), ["--pct" as string]: `${d.complete}%` }}><b>{d.complete}%</b></span>
        <div className="grow">
          <strong>Student records are {d.complete}% complete</strong>
          <span className="small">{d.full} of {d.students} students have everything. Families can fill in gaps from their phone, and you can take a whole class's photos in a few minutes.</span>
          <div className="pf-missing">{d.missing.slice(0, 7).map(([m, n]) => <span key={m}><b>{n}</b> no {m}</span>)}</div>
        </div>
        <div className="pf-hero-actions">
          <button className="on-band with-icon" onClick={() => setAsk({ class_id: null, name: "the whole school" })}><Icon name="send" size={15} />Ask families to help</button>
        </div>
      </section>

      {waiting > 0 && (
        <section className="card editor pf-waiting" style={hue("violet")}>
          <h3 className="with-glyph"><Glyph icon="user-check" hue="violet" size={30} />From families: {waiting} to check</h3>
          {d.requests.map((r) => <RequestCard key={r.id} r={r} healthOk={d.health_ok} onDone={(x) => { setD(x); onCount?.(x.requests.length + x.documents.length); }} />)}
          {d.documents.length > 0 && (
            <div className="pf-docs">
              {d.documents.map((x) => <DocRow key={x.id} d={x} onDone={() => void load()} />)}
            </div>
          )}
        </section>
      )}

      <section className="card editor">
        <h3 className="with-glyph"><Glyph icon="classes" hue="orange" size={30} />Class by class</h3>
        <div className="pf-classes">
          {d.classes.map((c) => (
            <div key={c.class_id} className="pf-class" style={hue(ringHue(c.complete))}>
              <div className="row">
                <span className="setup-ring" style={{ ["--pct" as string]: `${c.complete}%` }}><b>{c.complete}%</b></span>
                <span className="grow"><a href={href({ page: "class", id: c.class_id })}><b>{c.name}</b></a><small className="muted block">{c.full} of {c.students} complete</small></span>
              </div>
              <div className="pf-class-miss">{c.missing.map(([m, n]) => <span key={m}>{n} no {m}</span>)}</div>
              <div className="row">
                <button className="small-btn with-icon" disabled={!c.students} onClick={() => setPhotoDay({ id: c.class_id, name: c.name })}><Icon name="camera" size={13} />Photo day{c.no_photo ? ` (${c.no_photo})` : ""}</button>
                <button className="small-btn with-icon" onClick={() => setAsk({ class_id: c.class_id, name: c.name })}><Icon name="send" size={13} />Ask families</button>
              </div>
            </div>
          ))}
        </div>
      </section>
      {photoDay && <PhotoDay classId={photoDay.id} name={photoDay.name} onClose={() => { setPhotoDay(null); void load(); }} />}
      {ask && <AskFamilies schoolId={schoolId} classId={ask.class_id} name={ask.name} onClose={() => setAsk(null)} />}
    </div>
  );
}

function RequestCard({ r, healthOk, onDone }: { r: Req; healthOk: boolean; onDone: (x: ProfilesData) => void }) {
  const open = r.items.filter((i) => !i.decided && i.may);
  const [pick, setPick] = useState<Record<string, boolean>>(() => Object.fromEntries(open.map((i) => [i.key, true])));
  const [coll, setColl] = useState(r.collectors.length > 0);
  const [note, setNote] = useState("");
  const [busy, error, run] = useBusy();
  const waitingHealth = r.items.some((i) => !i.decided && !i.may);
  return (
    <div className="pf-req">
      <div className="row pf-req-head">
        {r.student.thumb ? <img src={r.student.thumb} alt="" className="pf-thumb" /> : <Avatar name={r.student.name} size={40} />}
        <span className="grow"><a href={href({ page: "student", id: r.student.id })}><b>{r.student.name}</b></a>
          <small className="muted block">{r.student.class_name ?? ""} · sent by {r.by ?? "a parent"} {ago(r.at)}</small></span>
      </div>
      <table className="pf-diff">
        <thead><tr><th /><th>Now</th><th>Family says</th><th>Use it?</th></tr></thead>
        <tbody>
          {r.items.map((i) => (
            <tr key={i.key} className={i.decided ? `done ${i.decided}` : ""}>
              <th>{i.label}{i.health && <span className="hue-chip" style={hue("rose")}>health</span>}</th>
              <td className="muted">{i.key === "photo" ? "–" : i.old ?? "–"}</td>
              <td>{i.photo ? <img src={i.photo} alt="" className="pf-photo" /> : <b>{i.new ?? "–"}</b>}</td>
              <td>{i.decided ? <span className="muted small">{i.decided}</span> : i.may
                ? <label className="pf-yes"><input type="checkbox" checked={!!pick[i.key]} onChange={(e) => setPick({ ...pick, [i.key]: e.target.checked })} />Yes</label>
                : <span className="muted small">For the nurse</span>}</td>
            </tr>
          ))}
          {r.collectors.length > 0 && (
            <tr><th>May collect</th><td className="muted">–</td><td>{r.collectors.map((c) => <b key={c.name} className="block">{c.name} ({c.relationship}){c.phone ? ` · ${c.phone}` : ""}</b>)}</td>
              <td><label className="pf-yes"><input type="checkbox" checked={coll} onChange={(e) => setColl(e.target.checked)} />Yes</label></td></tr>
          )}
        </tbody>
      </table>
      {waitingHealth && !healthOk && <p className="hint-line"><Icon name="lock" size={13} />Health details are kept private: the nurse (or someone with the medical records right) checks those.</p>}
      {(open.length > 0 || r.collectors.length > 0) && (
        <div className="row wrap pf-req-foot">
          <input className="grow" placeholder="Note to the family (optional), e.g. please send the birth certificate" value={note} onChange={(e) => setNote(e.target.value)} maxLength={300} />
          <button className="primary" disabled={busy} onClick={() => run(async () => onDone(await papi.decide(r.id, {
            approve: open.filter((i) => pick[i.key]).map((i) => i.key), reject: open.filter((i) => !pick[i.key]).map((i) => i.key),
            collectors: r.collectors.length ? coll : null, note: note || null })))}>Save</button>
        </div>
      )}
      {error && <p className="error">{error}</p>}
    </div>
  );
}

function DocRow({ d, onDone }: { d: Doc; onDone: () => void }) {
  const [busy, , run] = useBusy();
  const view = async () => {
    const res = await fetch(`/api/students/${d.student_id}/documents/${d.id}`, { headers: { Authorization: `Bearer ${getToken() ?? ""}` } });
    if (res.ok) window.open(URL.createObjectURL(await res.blob()), "_blank");
  };
  return (
    <div className="pf-doc">
      <Glyph icon="file" hue="sky" size={34} />
      <span className="grow"><b>{d.label}</b> for <a href={href({ page: "student", id: d.student_id })}>{d.student}</a>{d.class_name ? ` (${d.class_name})` : ""}
        <small className="muted block">{d.filename} · {Math.max(1, Math.round(d.size / 1024))} KB · from {d.by ?? "a parent"} {ago(d.at)}</small></span>
      <button className="small-btn with-icon" onClick={() => void view()}><Icon name="eye" size={13} />Look</button>
      <button className="small-btn primary" disabled={busy} onClick={() => run(async () => { await papi.doc(d.id, true); onDone(); })}>Keep</button>
      <button className="small-btn danger-soft" disabled={busy} onClick={() => run(async () => { await papi.doc(d.id, false); onDone(); })}>Not clear: ask again</button>
    </div>
  );
}

function AskFamilies({ schoolId, classId, name, onClose }: { schoolId: string; classId: string | null; name: string; onClose: () => void }) {
  const [below, setBelow] = useState(80);
  const [busy, error, run] = useBusy();
  const [done, setDone] = useState<Awaited<ReturnType<typeof papi.ask>> | null>(null);
  return (
    <Modal title={`Ask families: ${name}`} onClose={onClose}>
      {done ? (
        <div className="fam-sent"><span>📨</span><h3>{done.families} famil{done.families === 1 ? "y" : "ies"} asked</h3>
          <p className="muted">They see a notice on their phone with what's missing and can fill it in from their child's page.{done.skipped ? ` ${done.skipped} were asked in the last 3 days, so they were left alone.` : ""}</p>
          {done.never_logged_in > 0 && <p className="hint-line warn"><Icon name="info" size={14} />{done.never_logged_in} parents have never logged in. Print their login slips in Logins and passwords so they see this.</p>}
          <button className="primary" onClick={onClose}>Done</button></div>
      ) : (
        <div className="stack">
          <p>Each family gets a notice on their phone listing what's missing for their child, with a button to fill it in. The school checks everything before it goes on the record.</p>
          <Field label="Ask families whose child's record is below"><select value={below} onChange={(e) => setBelow(Number(e.target.value))}>{[50, 70, 80, 90, 100].map((n) => <option key={n} value={n}>{n}% complete</option>)}</select></Field>
          {error && <p className="error">{error}</p>}
          <div className="row"><span className="grow" /><button onClick={onClose}>Cancel</button><button className="primary with-icon" disabled={busy} onClick={() => run(async () => setDone(await papi.ask(schoolId, { class_id: classId, below })))}><Icon name="send" size={15} />Send</button></div>
        </div>
      )}
    </Modal>
  );
}

// ---------- Photo day ----------

interface Kid { id: string; first_name: string; last_name: string; thumb: string | null; admission_no: string }

export function PhotoDay({ classId, name, onClose }: { classId: string; name: string; onClose: () => void }) {
  const [kids, setKids] = useState<Kid[] | null>(null);
  const [i, setI] = useState(0);
  const [shot, setShot] = useState<string | null>(null);
  const [saved, setSaved] = useState<Record<string, string>>({});
  const [onlyMissing, setOnlyMissing] = useState(true);
  const [camErr, setCamErr] = useState("");
  const [busy, error, run] = useBusy();
  const video = useRef<HTMLVideoElement>(null);
  const stream = useRef<MediaStream | null>(null);
  useEffect(() => { api.raw<{ students: Kid[] }>("GET", `/api/classes/${classId}/page`).then((d) => setKids(d.students)).catch(() => setKids([])); }, [classId]);
  useEffect(() => {
    let off = false;
    navigator.mediaDevices?.getUserMedia({ video: { facingMode: "environment", width: { ideal: 1280 } }, audio: false })
      .then((s) => { if (off) { s.getTracks().forEach((t) => t.stop()); return; } stream.current = s; if (video.current) { video.current.srcObject = s; void video.current.play(); } })
      .catch(() => setCamErr("The camera isn't available here. Use “Choose a photo” instead."));
    return () => { off = true; stream.current?.getTracks().forEach((t) => t.stop()); };
  }, []);
  useEffect(() => {
    const v = video.current;
    if (v && stream.current && v.srcObject !== stream.current) { v.srcObject = stream.current; void v.play().catch(() => {}); }
  });
  const list = (kids ?? []).filter((k) => !onlyMissing || !k.thumb || saved[k.id]);
  const k = list[i];
  const square = (src: CanvasImageSource, w: number, h: number) => {
    const s = Math.min(w, h), c = document.createElement("canvas"); c.width = c.height = 400;
    c.getContext("2d")?.drawImage(src, (w - s) / 2, (h - s) / 2.6, s, s, 0, 0, 400, 400);
    return c.toDataURL("image/jpeg", 0.82);
  };
  const snap = () => { const v = video.current; if (v && v.videoWidth) setShot(square(v, v.videoWidth, v.videoHeight)); };
  const pickFile = (f?: File) => { if (!f) return; const img = new Image(); const u = URL.createObjectURL(f); img.onload = () => { setShot(square(img, img.width, img.height)); URL.revokeObjectURL(u); }; img.src = u; };
  const save = () => run(async () => {
    if (!k || !shot) return;
    const thumb = await makeThumb(shot);
    await api.raw("PUT", `/api/students/${k.id}/photo`, { photo: shot, thumb });
    setSaved({ ...saved, [k.id]: thumb }); setShot(null); setI(i + 1);
  });
  useEffect(() => {
    const key = (e: KeyboardEvent) => { if (e.code === "Space" && !shot) { e.preventDefault(); snap(); } else if (e.key === "Enter" && shot) save(); };
    window.addEventListener("keydown", key); return () => window.removeEventListener("keydown", key);
  });
  const done = Object.keys(saved).length;
  return (
    <div className="photo-day" role="dialog" aria-label={`Photo day: ${name}`}>
      <header className="row"><b>📸 Photo day · {name}</b><span className="grow" />
        <label className="check small"><input type="checkbox" checked={onlyMissing} onChange={(e) => { setOnlyMissing(e.target.checked); setI(0); }} />Only students with no photo</label>
        <button onClick={onClose}>Finish</button></header>
      {!kids ? <p>Loading…</p> : !k ? (
        <div className="pd-done"><span>🎉</span><h2>{done ? `${done} photo${done > 1 ? "s" : ""} saved` : "Everyone has a photo"}</h2><p className="muted">ID cards, the gate and the register now show these photos.</p><button className="primary" onClick={onClose}>Finish</button></div>
      ) : (
        <div className="pd-main">
          <div className="pd-progress">{list.map((x, j) => <i key={x.id} className={saved[x.id] ? "done" : j === i ? "now" : ""} />)}</div>
          <div className="pd-who"><small>{i + 1} of {list.length}</small><h2>{k.first_name} {k.last_name}</h2><span className="mono muted">{k.admission_no}</span></div>
          <div className="pd-stage">
            {shot ? <img src={shot} alt="" /> : <video ref={video} playsInline muted />}
            {!shot && <span className="pd-guide" aria-hidden="true" />}
            {camErr && !shot && <p className="pd-err">{camErr}</p>}
          </div>
          <div className="pd-buttons">
            {!shot ? <>
              <button className="pd-snap" onClick={snap} disabled={!!camErr} aria-label="Take photo"><span /></button>
              <label className="button with-icon"><Icon name="file" size={15} />Choose a photo<input hidden type="file" accept="image/*" capture="environment" onChange={(e) => pickFile(e.target.files?.[0])} /></label>
              <button onClick={() => setI(i + 1)}>Skip</button>
            </> : <>
              <button onClick={() => setShot(null)}>Retake</button>
              <button className="primary big-btn" disabled={busy} onClick={save}>Save and next →</button>
            </>}
          </div>
          {error && <p className="error">{error}</p>}
          <p className="muted small">Tip: stand the student against a plain wall, face the light. Space takes the photo, Enter saves.</p>
        </div>
      )}
    </div>
  );
}
