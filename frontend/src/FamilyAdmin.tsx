// The school's side of the family portal: settings, login slips to send home, and messages from parents.
import { useEffect, useState } from "react";
import { api, errorText } from "./api";
import { fam, NoteList, type FamilyNote } from "./Family";
import { useBusy } from "./GrowthBits";
import Icon from "./Icon";
import { PrintSheet } from "./Scanner";
import { Field, Glyph, hue, Modal, nicePhone } from "./ui";

interface Summary {
  settings: { student_logins: boolean; student_from_level: string; parents_see_sickbay: boolean; parents_see_conduct: boolean; welcome: string | null };
  parents: number; parents_in: number; students: number; no_parent: number; eligible: number; student_logins: number; students_in: number; messages_new: number;
  classes: { class_id: string; name: string; students: number; families_in: number; student_logins: number; students_in: number; eligible: boolean }[];
}
interface Slip { kind: "parent" | "student"; name: string; username: string; password: string; children: string[]; class_name: string | null }
interface Slips { school: { name: string; logo: string | null; colour: string | null; phone: string | null }; slips: Slip[]; skipped: { why: string; count: number }[] }

const fapi = {
  summary: (sid: string) => api.raw<Summary>("GET", `/api/schools/${sid}/family-logins`),
  settings: (sid: string, body: unknown) => api.raw<Summary>("PUT", `/api/schools/${sid}/family-settings`, body),
  slips: (sid: string, body: unknown) => api.raw<Slips>("POST", `/api/schools/${sid}/family-logins`, body),
};
const LEVELS = ["Primary 4", "Primary 5", "Primary 6", "JSS 1", "JSS 2", "JSS 3", "SS 1", "SS 2", "SS 3"];

function Ring({ value, total, label, h }: { value: number; total: number; label: string; h: string }) {
  const pct = total ? Math.round((100 * value) / total) : 0;
  return (
    <div className="fa-ring" style={hue(h as never)}>
      <span className="setup-ring" style={{ ["--pct" as string]: `${pct}%` }}><b>{pct}%</b></span>
      <span><b>{value} of {total}</b><small>{label}</small></span>
    </div>
  );
}

export function FamilyLogins({ schoolId }: { schoolId: string }) {
  const [d, setD] = useState<Summary | null>(null);
  const [error, setError] = useState("");
  const [edit, setEdit] = useState(false);
  const [ask, setAsk] = useState<{ who: "parents" | "students"; class_id: string | null; label: string } | null>(null);
  const [slips, setSlips] = useState<Slips | null>(null);
  const [msgs, setMsgs] = useState(false);
  const load = () => fapi.summary(schoolId).then(setD).catch((e) => setError(errorText(e)));
  useEffect(() => { void load(); }, [schoolId]); // eslint-disable-line react-hooks/exhaustive-deps
  if (error) return <p className="error">{error}</p>;
  if (!d) return null;
  const st = d.settings;
  return (
    <section className="card editor fa-card" style={hue("violet")}>
      <div className="fa-head">
        <Glyph icon="handshake" hue="violet" size={48} />
        <div className="grow"><strong>Parents and students</strong>
          <span className="block small muted">Parents see their own children: attendance, merits, library and sick bay visits. They can tell the school when a child is sick or someone else is collecting.
            {st.student_logins ? ` Students from ${st.student_from_level} up get their own login.` : " Student logins are switched off."}</span></div>
        <button className="with-icon" onClick={() => setEdit(true)}><Icon name="settings" size={15} />Settings</button>
        {d.messages_new > 0 && <button className="with-icon accent-soft" onClick={() => setMsgs(true)}><Icon name="message" size={15} />{d.messages_new} new from parents</button>}
      </div>
      <div className="fa-rings">
        <Ring value={d.parents_in} total={d.parents} label="parents have logged in" h="violet" />
        {st.student_logins && <Ring value={d.students_in} total={d.eligible} label={`students (${st.student_from_level} up) have logged in`} h="blue" />}
        {d.no_parent > 0 && <div className="fa-ring" style={hue("red")}><Glyph icon="phone" hue="red" size={40} /><span><b>{d.no_parent}</b><small>students with no parent on record</small></span></div>}
      </div>
      <div className="row wrap">
        <button className="primary with-icon" onClick={() => setAsk({ who: "parents", class_id: null, label: "every parent" })}><Icon name="printer" size={15} />Parent login slips</button>
        {st.student_logins && <button className="with-icon" onClick={() => setAsk({ who: "students", class_id: null, label: `every student from ${st.student_from_level}` })}><Icon name="printer" size={15} />Student login slips</button>}
      </div>
      <div className="table-wrap plain fa-table">
        <table>
          <thead><tr><th>Class</th><th>Families logged in</th>{st.student_logins && <th className="hide-small">Students logged in</th>}<th /></tr></thead>
          <tbody>
            {d.classes.map((c) => (
              <tr key={c.class_id}>
                <td><b>{c.name}</b> <span className="muted small">{c.students}</span></td>
                <td><span className="att-bar" style={hue(c.families_in / Math.max(1, c.students) >= 0.6 ? "green" : "amber")}><span style={{ width: `${(54 * c.families_in) / Math.max(1, c.students)}px` }} /><b>{c.families_in}</b></span></td>
                {st.student_logins && <td className="hide-small">{c.eligible ? <span className="att-bar" style={hue("blue")}><span style={{ width: `${(54 * c.students_in) / Math.max(1, c.students)}px` }} /><b>{c.students_in}</b></span> : <span className="muted small">uses parent's login</span>}</td>}
                <td className="nowrap fa-slip-btns">
                  <button className="small-btn" onClick={() => setAsk({ who: "parents", class_id: c.class_id, label: `${c.name} parents` })}>Parents</button>
                  {st.student_logins && c.eligible && <button className="small-btn" onClick={() => setAsk({ who: "students", class_id: c.class_id, label: `${c.name} students` })}>Students</button>}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
      {edit && <SettingsForm schoolId={schoolId} s={st} onClose={() => setEdit(false)} onDone={(x) => { setD(x); setEdit(false); }} />}
      {ask && <SlipAsk schoolId={schoolId} ask={ask} onClose={() => setAsk(null)} onDone={(x) => { setAsk(null); setSlips(x); void load(); }} />}
      {slips && <SlipSheet d={slips} onClose={() => setSlips(null)} />}
      {msgs && <FromHome schoolId={schoolId} onClose={() => { setMsgs(false); void load(); }} />}
    </section>
  );
}

function SettingsForm({ schoolId, s, onClose, onDone }: { schoolId: string; s: Summary["settings"]; onClose: () => void; onDone: (x: Summary) => void }) {
  const [v, setV] = useState(s);
  const [busy, error, run] = useBusy();
  const tog = (k: keyof Summary["settings"], label: string, note: string) => (
    <label className="fa-toggle"><input type="checkbox" checked={!!v[k]} onChange={(e) => setV({ ...v, [k]: e.target.checked })} /><span><b>{label}</b><small>{note}</small></span></label>
  );
  return (
    <Modal title="Parent and student portal" onClose={onClose}>
      <form className="stack" onSubmit={(e) => { e.preventDefault(); run(async () => onDone(await fapi.settings(schoolId, v))); }}>
        {tog("student_logins", "Students can log in", "They see their own attendance, merits, library books and house league. Never other students.")}
        {v.student_logins && <Field label="From which class"><select value={v.student_from_level} onChange={(e) => setV({ ...v, student_from_level: e.target.value })}>{LEVELS.map((l) => <option key={l}>{l}</option>)}</select></Field>}
        {tog("parents_see_conduct", "Show merits and demerits", "Parents and students see points given, with the teacher's name.")}
        {tog("parents_see_sickbay", "Show sick bay visits", "Parents see when their child was seen, the complaint and what happened next.")}
        <Field label="Welcome message (shown at the top of the parents' page)"><textarea rows={3} maxLength={600} value={v.welcome ?? ""} onChange={(e) => setV({ ...v, welcome: e.target.value || null })}
          placeholder="e.g. PTA meeting this Saturday at 10am in the hall." /></Field>
        {error && <p className="error">{error}</p>}
        <div className="row"><span className="grow" /><button type="button" onClick={onClose}>Cancel</button><button className="primary" disabled={busy}>Save</button></div>
      </form>
    </Modal>
  );
}

function SlipAsk({ schoolId, ask, onClose, onDone }: { schoolId: string; ask: { who: "parents" | "students"; class_id: string | null; label: string }; onClose: () => void; onDone: (x: Slips) => void }) {
  const [onlyNew, setOnlyNew] = useState(true);
  const [busy, error, run] = useBusy();
  return (
    <Modal title={`Login slips: ${ask.label}`} onClose={onClose}>
      <div className="stack">
        <p>Each slip has a username and a new password, ready to cut out and send home in the school bag. They choose their own password when they first log in.</p>
        <label className="fa-toggle"><input type="radio" checked={onlyNew} onChange={() => setOnlyNew(true)} /><span><b>Only people who have never logged in</b><small>Recommended. Anyone already using the app keeps their password.</small></span></label>
        <label className="fa-toggle"><input type="radio" checked={!onlyNew} onChange={() => setOnlyNew(false)} /><span><b>Everyone</b><small>Gives everyone a new password, even those already using it.</small></span></label>
        {error && <p className="error">{error}</p>}
        <div className="row"><span className="grow" /><button onClick={onClose}>Cancel</button>
          <button className="primary with-icon" disabled={busy} onClick={() => run(async () => onDone(await fapi.slips(schoolId, { who: ask.who, class_id: ask.class_id, only_new: onlyNew })))}><Icon name="printer" size={15} />Make slips</button></div>
      </div>
    </Modal>
  );
}

function SlipSheet({ d, onClose }: { d: Slips; onClose: () => void }) {
  const site = window.location.origin;
  const colour = d.school.colour || "#0f7a4f";
  const skipped = d.skipped.map((s) => `${s.count} ${s.why}`).join(", ");
  return (
    <PrintSheet title="Login slips" onClose={onClose} note={`${d.slips.length} slip${d.slips.length === 1 ? "" : "s"}.${skipped ? ` Skipped: ${skipped}.` : ""} The passwords are not shown again, so print now.`}>
      {d.slips.length === 0 && <p>Nobody needs a slip. Everyone here has already logged in.</p>}
      <div className="slips">
        {d.slips.map((s, i) => (
          <div key={i} className="slip" style={{ ["--card" as string]: colour }}>
            <div className="slip-head">{d.school.logo && <img src={d.school.logo} alt="" />}<b>{d.school.name}</b><span>{s.kind === "parent" ? "Parent login" : "Student login"}</span></div>
            <div className="slip-body">
              <p className="slip-to">{s.kind === "parent" ? <>Dear <b>{s.name}</b>,<br />follow {s.children.join(", ")} at school on your phone.</> : <>Hi <b>{s.name}</b>{s.class_name ? ` (${s.class_name})` : ""}! This is your own school page.</>}</p>
              <ol>
                <li>Open <b className="mono">{site.replace(/^https?:\/\//, "")}</b></li>
                <li>Username: <b className="mono slip-big">{s.kind === "parent" ? nicePhone(s.username) || s.username : s.username}</b></li>
                <li>Password: <b className="mono slip-big">{s.password}</b></li>
                <li>Choose your own new password.</li>
              </ol>
            </div>
            <div className="slip-foot">Keep this private.{d.school.phone ? ` Help: ${d.school.phone}` : ""}</div>
          </div>
        ))}
      </div>
    </PrintSheet>
  );
}

export function FromHome({ schoolId, onClose }: { schoolId: string; onClose: () => void }) {
  const [list, setList] = useState<FamilyNote[] | null>(null);
  const [reply, setReply] = useState<FamilyNote | null>(null);
  const [error, setError] = useState("");
  useEffect(() => { fam.schoolNotes(schoolId).then(setList).catch((e) => setError(errorText(e))); }, [schoolId]);
  return (
    <Modal title="Messages from parents" onClose={onClose} wide>
      {error && <p className="error">{error}</p>}
      {list && list.length === 0 && <p className="muted">No messages in the last two weeks.</p>}
      {list && list.length > 0 && <NoteList notes={list} onSeen={setReply} />}
      {reply && <SeenForm n={reply} onClose={() => setReply(null)} onDone={(x) => { setList((l) => l?.map((y) => (y.id === x.id ? x : y)) ?? null); setReply(null); }} />}
    </Modal>
  );
}

export function SeenForm({ n, onClose, onDone }: { n: FamilyNote; onClose: () => void; onDone: (x: FamilyNote) => void }) {
  const [text, setText] = useState("");
  const [busy, error, run] = useBusy();
  const quick = ["Thank you. Noted.", "Thank you, get well soon.", "Noted. The gate has been told.", "Thank you. Please send a note when they return."];
  return (
    <Modal title={`Reply to ${n.by ?? "the parent"}`} onClose={onClose}>
      <div className="stack">
        <p className="muted small">The parent is told you've seen it. A short reply is optional.</p>
        <div className="chips">{quick.map((q) => <button key={q} className="small-btn" onClick={() => setText(q)}>{q}</button>)}</div>
        <textarea rows={2} maxLength={400} value={text} onChange={(e) => setText(e.target.value)} placeholder="Optional reply" />
        {error && <p className="error">{error}</p>}
        <div className="row"><span className="grow" /><button onClick={onClose}>Cancel</button><button className="primary" disabled={busy} onClick={() => run(async () => onDone(await fam.seen(n.id, text.trim() || null)))}>Mark as seen</button></div>
      </div>
    </Modal>
  );
}
