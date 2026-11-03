// The student's side of checking marks: my score book (what the teacher wrote on my script), the official mark beside it,
// confirm or query (with a photo of the script), the teacher's reply, and asking the head to look.
import { useEffect, useMemo, useState } from "react";
import { api, errorText } from "./api";
import { useBusy } from "./GrowthBits";
import Icon from "./Icon";
import { subjectLook } from "./look";
import { Field, Glyph, hue, Modal } from "./ui";

interface Part { key: string; label: string; max: number }
interface Cell { visible: boolean; rechecking: boolean; locked: boolean; official: Record<string, number | null>; absent: string[]; total: number | null;
  recorded: Record<string, { value: number; photo: boolean; note: string | null }>; compare: string; state: string; label: string; due_at: string | null; late: boolean;
  check: { id: string; status: string; query_text: string | null; claimed: number | null; has_photo: boolean; reply: string | null; answered_at: string | null;
    history: { at: string; by: string; action: string; note: string | null }[] } | null;
  can_confirm: boolean; can_query: boolean; can_escalate: boolean; can_accept: boolean }
interface View { term: { id: string; name: string; session: string }; confirm_days: number; tests: { name: string; max: number; parts: Part[] }[];
  subjects: { subject_id: string; subject: string; teacher: string | null; scope: string; tests: Record<string, Cell> }[]; can_act: boolean;
  counts: { to_check: number; different: number; open: number; replied: number; done: number; out: number; next_due: string | null } }

const msapi = {
  view: (sid: string) => api.raw<View>("GET", `/api/me/children/${sid}/my-scores`),
  book: (sid: string, b: unknown) => api.raw<View>("PUT", `/api/me/children/${sid}/score-book`, b),
  confirm: (sid: string, b: unknown) => api.raw<View & { confirmed: number }>("POST", `/api/me/children/${sid}/my-scores/confirm`, b),
  query: (sid: string, b: unknown) => api.raw<View>("POST", `/api/me/children/${sid}/my-scores/query`, b),
  escalate: (sid: string, b: unknown) => api.raw<View>("POST", `/api/me/children/${sid}/my-scores/escalate`, b),
};
const STATE_HUE: Record<string, string> = { not_yet: "slate", waiting: "amber", different: "red", match: "green", confirmed: "green", accepted: "slate", queried: "violet",
  answered: "sky", escalated: "fuchsia", correcting: "orange", corrected: "teal", closed: "slate" };
const STATE_ICON: Record<string, string> = { not_yet: "⏳", waiting: "👀", different: "⚠️", match: "✅", confirmed: "✅", accepted: "☑️", queried: "❓", answered: "💬",
  escalated: "📣", correcting: "✏️", corrected: "✨", closed: "🔚" };
const fmt = (n: number | null | undefined) => (n == null ? "–" : Number.isInteger(n) ? String(n) : n.toFixed(1));
const dayText = (iso: string) => new Date(iso).toLocaleDateString("en-GB", { weekday: "long", day: "numeric", month: "short" });

/** A photo from the camera or gallery, made small enough to send (about 150 KB). */
export function shrinkPhoto(file: File, max = 1200): Promise<string> {
  return new Promise((resolve, reject) => {
    const img = new Image();
    img.onload = () => {
      const k = Math.min(1, max / Math.max(img.width, img.height));
      const c = document.createElement("canvas");
      c.width = Math.round(img.width * k); c.height = Math.round(img.height * k);
      c.getContext("2d")!.drawImage(img, 0, 0, c.width, c.height);
      resolve(c.toDataURL("image/jpeg", 0.72));
      URL.revokeObjectURL(img.src);
    };
    img.onerror = reject;
    img.src = URL.createObjectURL(file);
  });
}

function PhotoPick({ value, onChange }: { value: string | null; onChange: (v: string | null) => void }) {
  return (
    <div className="ms-photo">
      {value ? <><img src={value} alt="Your script" /><button className="small-btn" onClick={() => onChange(null)}>Remove photo</button></> : (
        <label className="small-btn with-icon"><Icon name="camera" size={14} />Add a photo of the script
          <input type="file" accept="image/*" capture="environment" hidden onChange={(e) => { const f = e.target.files?.[0]; if (f) void shrinkPhoto(f).then(onChange); }} /></label>
      )}
    </div>
  );
}

export default function MyScoresPage({ studentId }: { studentId: string }) {
  const [d, setD] = useState<View | null>(null);
  const [error, setError] = useState("");
  const [test, setTest] = useState<string | null>(null);
  const [modal, setModal] = useState<null | { kind: "book" | "query" | "escalate"; sub: View["subjects"][number]; test: string }>(null);
  const [busy, err, run] = useBusy();
  useEffect(() => { msapi.view(studentId).then(setD).catch((e) => setError(errorText(e))); }, [studentId]);
  const current = useMemo(() => {
    if (!d) return null;
    if (test) return test;
    // Start on the newest test that is out and still has something to do, else the newest that is out.
    const out = [...d.tests].reverse();
    return (out.find((t) => d.subjects.some((x) => ["waiting", "different", "answered"].includes(x.tests[t.name]?.state)))
      ?? out.find((t) => d.subjects.some((x) => x.tests[t.name]?.visible)) ?? d.tests[0])?.name ?? null;
  }, [d, test]);
  if (error) return <p className="error">{error}</p>;
  if (!d || !current) return <div className="skeleton"><span /><span /></div>;
  const t = d.tests.find((x) => x.name === current)!;
  const waiting = d.subjects.filter((x) => x.tests[current]?.state === "waiting").length;
  const act = d.can_act;
  return (
    <section className="stack ms">
      <div className="ms-hero" style={hue(d.counts.to_check ? "amber" : "green")}>
        <span className="ms-hero-big">{d.counts.to_check ? STATE_ICON.waiting : "🎉"}</span>
        <div className="grow">
          <b>{d.counts.to_check ? `${d.counts.to_check} mark${d.counts.to_check === 1 ? "" : "s"} to check` : d.counts.out ? "All your marks are checked" : "No marks out yet"}</b>
          <small className="block">{d.counts.next_due ? `Check them against your scripts by ${dayText(d.counts.next_due)}. After that they count as accepted.` : "When a teacher's marks are approved they show here first, before your parents see them."}</small>
        </div>
        <ul className="ms-counts">
          <li style={hue("green")}><b>{d.counts.done}</b>done</li>
          {d.counts.open > 0 && <li style={hue("violet")}><b>{d.counts.open}</b>queries open</li>}
          {d.counts.replied > 0 && <li style={hue("sky")}><b>{d.counts.replied}</b>replies</li>}
        </ul>
      </div>
      <p className="small muted">💡 When your teacher gives back a marked script, write the mark in <b>My score book</b> straight away (with a photo if you can). When the official mark comes out, you'll see at once if they match.</p>
      <div className="row wrap">
        <div className="segmented">{d.tests.map((x) => { const n = d.subjects.filter((s) => ["waiting", "different", "answered"].includes(s.tests[x.name]?.state)).length; return (
          <button key={x.name} className={x.name === current ? "on" : ""} onClick={() => setTest(x.name)}>{x.name}{n ? <span className="count-badge">{n}</span> : null}</button>); })}</div>
        <span className="grow" />
        {act && waiting > 0 && <button className="primary with-icon" disabled={busy} onClick={() => run(async () => setD(await msapi.confirm(studentId, { term_id: d.term.id })))}>
          <Icon name="circle-check" size={15} />Confirm all {waiting} that look right</button>}
      </div>
      {err && <p className="error">{err}</p>}
      <div className="ms-grid">
        {d.subjects.map((s) => { const c = s.tests[current]; if (!c) return null; const l = subjectLook(s.subject); const mine = t.parts.map((p) => c.recorded[p.key]?.value);
          const mineTotal = mine.every((v) => v == null) ? null : mine.reduce<number>((a, v) => a + (v ?? 0), 0);
          return (
            <article key={s.subject_id} className={`ms-card s-${c.state}`} style={hue(l.hue)}>
              <div className="row"><Glyph icon={l.icon} hue={l.hue} size={36} />
                <span className="grow"><b>{s.subject}</b><small className="block muted">{s.teacher ?? ""}</small></span>
                <span className="hue-chip" style={hue(STATE_HUE[c.state] ?? "slate")}>{STATE_ICON[c.state]} {c.label}</span></div>
              <div className="ms-compare">
                <div className={`ms-num${c.visible ? "" : " dim"}`}><small>Official</small><b>{c.visible ? (c.absent.length ? "ABS" : fmt(c.total)) : "?"}</b><small>/{t.max}</small>
                  {c.rechecking && <em>being re-checked</em>}</div>
                <span className={`ms-vs ${c.compare}`}>{c.compare === "match" ? "=" : c.compare === "different" ? "≠" : "·"}</span>
                <div className={`ms-num mine${mineTotal == null ? " dim" : ""}`}><small>My score book</small><b>{fmt(mineTotal)}</b><small>/{t.max}</small>
                  {Object.values(c.recorded).some((r) => r.photo) && <em>📷 photo</em>}</div>
              </div>
              {t.parts.length > 1 && c.visible && <p className="small muted">{t.parts.map((p) => `${p.label} ${fmt(c.official[p.key])}${c.recorded[p.key] ? ` (you: ${fmt(c.recorded[p.key].value)})` : ""}`).join(" · ")}</p>}
              {c.check && (c.check.query_text || c.check.reply) && (
                <div className="ms-thread">
                  {c.check.history.filter((h) => h.note).map((h, i) => <p key={i} className={["Queried", "Asked the head to look"].includes(h.action) ? "me" : "them"}>
                    <small>{h.by} · {h.action}</small>{h.note}</p>)}
                </div>
              )}
              {act && (
                <div className="row wrap ms-actions">
                  <button className="small-btn with-icon" onClick={() => setModal({ kind: "book", sub: s, test: current })}><Icon name="pen-tool" size={13} />{mineTotal == null ? "Write my score" : "Change my score"}</button>
                  {c.can_confirm && <button className="small-btn primary with-icon" disabled={busy} onClick={() => run(async () => setD(await msapi.confirm(studentId, { term_id: d.term.id, subject_id: s.subject_id, component: current })))}><Icon name="check" size={13} />Confirm</button>}
                  {c.can_query && <button className="small-btn with-icon" onClick={() => setModal({ kind: "query", sub: s, test: current })}><Icon name="message" size={13} />Query</button>}
                  {c.can_accept && <button className="small-btn primary with-icon" disabled={busy} onClick={() => run(async () => setD(await msapi.confirm(studentId, { term_id: d.term.id, subject_id: s.subject_id, component: current })))}><Icon name="thumbs-up" size={13} />I accept</button>}
                  {c.can_escalate && <button className="small-btn with-icon" onClick={() => setModal({ kind: "escalate", sub: s, test: current })}><Icon name="megaphone" size={13} />Ask the head to look</button>}
                </div>
              )}
              {c.locked && <small className="muted">🔒 Published to your parents</small>}
            </article>); })}
      </div>
      {modal?.kind === "book" && <BookForm studentId={studentId} d={d} sub={modal.sub} test={t} onClose={() => setModal(null)} onDone={(x) => { setD(x); setModal(null); }} />}
      {modal && modal.kind !== "book" && <QueryForm studentId={studentId} d={d} sub={modal.sub} test={t} kind={modal.kind} onClose={() => setModal(null)} onDone={(x) => { setD(x); setModal(null); }} />}
    </section>
  );
}

function BookForm({ studentId, d, sub, test, onClose, onDone }: { studentId: string; d: View; sub: View["subjects"][number]; test: View["tests"][number]; onClose: () => void; onDone: (v: View) => void }) {
  const c = sub.tests[test.name];
  const [vals, setVals] = useState<Record<string, string>>(Object.fromEntries(test.parts.map((p) => [p.key, c.recorded[p.key] ? String(c.recorded[p.key].value) : ""])));
  const [photo, setPhoto] = useState<string | null>(null);
  const [busy, error, run] = useBusy();
  const bad = (p: Part) => vals[p.key] !== "" && (Number.isNaN(Number(vals[p.key])) || Number(vals[p.key]) < 0 || Number(vals[p.key]) > p.max);
  return (
    <Modal title={`My score book: ${sub.subject} ${test.name}`} onClose={onClose}>
      <div className="stack">
        <p className="small muted">Write exactly what the teacher wrote on your marked script.</p>
        <div className="form-grid">{test.parts.map((p) => (
          <Field key={p.key} label={`${p.label} (out of ${p.max})`}><input inputMode="decimal" className={bad(p) ? "bad" : ""} value={vals[p.key]} onChange={(e) => setVals({ ...vals, [p.key]: e.target.value })} placeholder="e.g. 15" /></Field>))}</div>
        <PhotoPick value={photo} onChange={setPhoto} />
        {error && <p className="error">{error}</p>}
        <div className="row"><span className="grow" /><button onClick={onClose}>Cancel</button>
          <button className="primary" disabled={busy || test.parts.some(bad)} onClick={() => run(async () => {
            let v = d;
            for (const p of test.parts) v = await msapi.book(studentId, { term_id: d.term.id, subject_id: sub.subject_id, key: p.key, value: vals[p.key] === "" ? null : Number(vals[p.key]), ...(photo && p === test.parts[0] ? { photo } : {}) });
            onDone(v); })}>Save</button></div>
      </div>
    </Modal>
  );
}

function QueryForm({ studentId, d, sub, test, kind, onClose, onDone }: { studentId: string; d: View; sub: View["subjects"][number]; test: View["tests"][number]; kind: "query" | "escalate"; onClose: () => void; onDone: (v: View) => void }) {
  const c = sub.tests[test.name];
  const mine = Object.values(c.recorded).reduce((a, r) => a + r.value, 0);
  const [text, setText] = useState("");
  const [claimed, setClaimed] = useState(Object.keys(c.recorded).length ? String(mine) : "");
  const [photo, setPhoto] = useState<string | null>(null);
  const [busy, error, run] = useBusy();
  return (
    <Modal title={kind === "query" ? `Query ${sub.subject} ${test.name}` : `Ask the head to look at ${sub.subject} ${test.name}`} onClose={onClose}>
      <div className="stack">
        <p className="small">Official mark: <b>{fmt(c.total)}/{test.max}</b>{kind === "escalate" && c.check?.reply ? <> · Your teacher said: “{c.check.reply}”</> : null}</p>
        <Field label={kind === "query" ? "What do you think is wrong?" : "Why do you still disagree?"}>
          <textarea rows={3} maxLength={600} value={text} onChange={(e) => setText(e.target.value)} placeholder={kind === "query" ? "e.g. My script shows 15 but the mark here is 12" : "e.g. My answer to question 2 matches the textbook"} /></Field>
        {kind === "query" && <Field label="What your script says (optional)"><input inputMode="decimal" value={claimed} onChange={(e) => setClaimed(e.target.value)} /></Field>}
        {kind === "query" && <PhotoPick value={photo} onChange={setPhoto} />}
        <p className="small muted">{kind === "query" ? "Your subject teacher sees this and replies. Your parents don't see it." : "The unit head or head of department looks at it and decides."}</p>
        {error && <p className="error">{error}</p>}
        <div className="row"><span className="grow" /><button onClick={onClose}>Cancel</button>
          <button className="primary with-icon" disabled={busy || text.trim().length < 3} onClick={() => run(async () => onDone(await (kind === "query"
            ? msapi.query(studentId, { term_id: d.term.id, subject_id: sub.subject_id, component: test.name, text, claimed: claimed === "" ? null : Number(claimed), photo })
            : msapi.escalate(studentId, { term_id: d.term.id, subject_id: sub.subject_id, component: test.name, text }))))}><Icon name="send" size={14} />Send</button></div>
      </div>
    </Modal>
  );
}
