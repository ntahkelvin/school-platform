// The Rights page: what each role (or one person) may see and change, requests for private records, and the log.
import { useCallback, useEffect, useMemo, useState } from "react";
import { errorText } from "./api";
import { useBusy } from "./GrowthBits";
import Icon from "./Icon";
import { TAB_LOOK } from "./look";
import { structure, type PersonOption } from "./structureApi";
import { loadRightsMeta, rightsApi, type Grant, type PersonRights, type RightsMeta, type RightsPage as Page } from "./rightsApi";
import { Avatar, Empty, Field, Glyph, hue, Modal } from "./ui";

const AREA_TAB: Record<string, string> = {
  school: "overview", students: "students", attendance: "attendance", classes: "classes", teaching: "teaching", results: "results", discipline: "discipline", staff: "staff",
  staff_day: "staff-day", growth: "growth", operations: "operations", facilities: "facilities", setup: "sections", imports: "imports",
  logins: "logins", rights: "rights",
};
const ROLE_HUE: Record<string, string> = {
  head_of_school: "indigo", head: "violet", vice_principal: "fuchsia", it_admin: "teal", bursar: "green", house_parent: "rose", teacher: "blue", support: "slate",
};
const TITLES = ["President", "Rector", "Head of School", "Director", "Proprietor's Representative"];
const HOURS: [number, string][] = [[2, "2 hours"], [8, "Today (8 hours)"], [24, "1 day"], [72, "3 days"], [168, "1 week"]];

const when = (at: string) => new Date(at).toLocaleString("en-GB", { day: "numeric", month: "short", hour: "2-digit", minute: "2-digit" });

export default function RightsPage({ schoolId }: { schoolId: string }) {
  const [meta, setMeta] = useState<RightsMeta | null>(null);
  const [p, setP] = useState<Page | null>(null);
  const [error, setError] = useState("");
  const [role, setRole] = useState("head");
  const [person, setPerson] = useState<string | "pick" | null>(null);
  const load = useCallback(() => { rightsApi.page(schoolId).then(setP).catch((e) => setError(errorText(e))); }, [schoolId]);
  useEffect(() => { loadRightsMeta().then(setMeta).catch(() => {}); load(); }, [load]);
  if (error) return <p className="error">{error}</p>;
  if (!p || !meta) return <p className="muted">Loading…</p>;
  const row = p.roles.find((r) => r.role === role) ?? p.roles[0];
  const waiting = p.requests.filter((g) => g.status === "waiting");
  const live = p.requests.filter((g) => g.status === "approved");
  return (
    <section className="stack rights-page">
      <p className="muted small">Each role starts with sensible rights. {p.can_change ? "Tap to change what a role may see or change. You can also give one person different rights." : "Only the owner and the head of school can change them."}</p>

      {(waiting.length > 0 || (p.can_approve && live.length > 0)) && (
        <section className="card g-card" style={hue("amber")}>
          <h3 className="with-glyph"><Glyph icon="key" hue="amber" size={32} />Requests to open private records{waiting.length > 0 && <span className="count">{waiting.length}</span>}</h3>
          <div className="grant-list">{[...waiting, ...live].map((g) => <GrantRow key={g.id} g={g} canDecide={p.can_approve} onDone={load} />)}</div>
        </section>
      )}

      <section className="card g-card" style={hue("indigo")}>
        <h3 className="with-glyph"><Glyph icon="crown" hue="indigo" size={32} />What this school calls its head of school</h3>
        <TitlePicker schoolId={schoolId} title={p.school.head_title} canChange={p.can_change} onDone={load} />
        <p className="muted small">The head of school sits above the principal: sees everything, can change rights, and approves private access. The owner still owns the school.</p>
      </section>

      <section className="card g-card" style={hue(ROLE_HUE[row.role] ?? "blue")}>
        <h3 className="with-glyph"><Glyph icon="users" hue={ROLE_HUE[row.role] ?? "blue"} size={32} />Rights for each role</h3>
        <div className="role-chips" role="tablist">
          {p.roles.map((r) => (
            <button key={r.role} role="tab" aria-selected={r.role === row.role} className={`role-chip${r.role === row.role ? " on" : ""}`} style={hue(ROLE_HUE[r.role] ?? "blue")} onClick={() => setRole(r.role)}>
              {r.label}<small>{r.people} {r.people === 1 ? "person" : "people"}{r.changed.length > 0 && " · changed"}</small>
            </button>
          ))}
        </div>
        <RoleEditor schoolId={schoolId} meta={meta} have={new Set(row.rights)} changed={new Set(row.changed)} editable={row.editable}
                    label={row.label} myRights={new Set(p.my_rights)}
                    onSet={(right, allowed) => rightsApi.setRole(schoolId, row.role, right, allowed).then(setP)}
                    onReset={row.changed.length > 0 && row.editable ? () => rightsApi.resetRole(schoolId, row.role).then(setP) : undefined} />
      </section>

      <section className="card g-card" style={hue("teal")}>
        <h3 className="with-glyph"><Glyph icon="user" hue="teal" size={32} />One person, different rights</h3>
        <p className="muted small">For example: the Examinations Officer may change teaching, or one teacher may see the student list.</p>
        {p.exceptions.length === 0 ? <p className="muted small">Nobody yet.</p> : (
          <ul className="exception-list">
            {p.exceptions.map((x) => (
              <li key={x.user_id}>
                <Avatar name={x.name} size={34} />
                <span className="grow"><strong>{x.name}</strong><span className="muted small">{x.job_title ?? x.roles.map((r) => meta.roles[r] ?? r).join(", ")}</span></span>
                <span className="exception-chips">{x.changes.map((c) => <span key={c.right} className={`hue-chip ${c.allowed ? "" : "struck"}`} style={hue(c.allowed ? "green" : "red")}>{c.allowed ? "+" : "−"} {rightLabel(meta, c.right)}</span>)}</span>
                <button className="with-icon small" onClick={() => setPerson(x.user_id)}><Icon name={p.can_change ? "edit" : "eye"} size={14} />{p.can_change ? "Change" : "View"}</button>
              </li>
            ))}
          </ul>
        )}
        {p.can_change && <button className="with-icon" onClick={() => setPerson("pick")}><Icon name="plus" size={15} />Choose a person</button>}
      </section>

      <section className="card g-card" style={hue("slate")}>
        <h3 className="with-glyph"><Glyph icon="history" hue="slate" size={32} />What happened</h3>
        <p className="muted small">Every change of rights, every 'see as', every request and every time private records were opened with temporary access.</p>
        {p.log.length === 0 ? <p className="muted small">Nothing yet.</p> : (
          <ul className="audit-list">{p.log.map((l, i) => (
            <li key={i} className={`a-${l.action}`}><span className="audit-dot"><Icon name={AUDIT_ICON[l.action] ?? "history"} size={13} /></span>
              <span className="grow"><b>{l.who ?? "Someone"}</b> {l.what}</span><small>{when(l.at)}</small></li>))}</ul>
        )}
      </section>

      {person === "pick" && <PersonPicker schoolId={schoolId} onClose={() => setPerson(null)} onPick={(id) => setPerson(id)} />}
      {person && person !== "pick" && <PersonEditor schoolId={schoolId} meta={meta} userId={person} canChange={p.can_change} myRights={new Set(p.my_rights)}
                                                     onClose={() => { setPerson(null); load(); }} />}
    </section>
  );
}

const AUDIT_ICON: Record<string, string> = { see_as: "eye", private_open: "lock", private_change: "edit", rights: "key", grant: "key" };

export function rightLabel(meta: RightsMeta, right: string): string {
  const [k, l] = right.split(".");
  if (k === "private") return meta.private[l]?.label ?? right;
  if (k === "power") return meta.powers[l]?.label ?? right;
  return `${l === "see" ? "See" : "Change"} ${(meta.areas[k]?.label ?? k).toLowerCase()}`;
}

function TitlePicker({ schoolId, title, canChange, onDone }: { schoolId: string; title: string; canChange: boolean; onDone: () => void }) {
  const [other, setOther] = useState(TITLES.includes(title) || title === "Head of school" ? "" : title);
  const [busy, error, run] = useBusy();
  const save = (t: string) => run(async () => { await rightsApi.setTitle(schoolId, t); onDone(); });
  return (
    <div className="stack">
      <div className="kind-pick">
        {TITLES.map((t) => (
          <button key={t} type="button" disabled={!canChange || busy} className={`chip pick${title.toLowerCase() === t.toLowerCase() ? " on" : ""}`} onClick={() => save(t)}>{t}</button>
        ))}
      </div>
      {canChange && (
        <div className="row wrap">
          <input aria-label="Another title" placeholder="Another title…" value={other} onChange={(e) => setOther(e.target.value)} />
          <button disabled={busy || other.trim().length < 2} onClick={() => save(other.trim())}>Use this</button>
        </div>
      )}
      {error && <p className="error">{error}</p>}
    </div>
  );
}

function Switch({ on, disabled, onChange, label }: { on: boolean; disabled?: boolean; onChange: (v: boolean) => void; label: string }) {
  return (
    <button type="button" role="switch" aria-checked={on} aria-label={label} disabled={disabled} className={`switch${on ? " on" : ""}`} onClick={() => onChange(!on)}>
      <span className="knob" />
    </button>
  );
}

function RoleEditor({ meta, have, changed, editable, label, myRights, onSet, onReset }: {
  schoolId: string; meta: RightsMeta; have: Set<string>; changed: Set<string>; editable: boolean; label: string; myRights: Set<string>;
  onSet: (right: string, allowed: boolean) => Promise<unknown>; onReset?: () => Promise<unknown>;
}) {
  const [busy, error, run] = useBusy();
  const set = (r: string, v: boolean) => run(() => onSet(r, v));
  const may = (r: string) => editable && !busy && myRights.has(r);
  return (
    <div className="stack">
      <div className="rights-grid">
        <div className="rg-head"><span>Page</span><span>See</span><span>Change</span></div>
        {Object.entries(meta.areas).map(([k, a]) => {
          const look = TAB_LOOK[AREA_TAB[k]] ?? { icon: a.icon, hue: "blue" };
          return (
            <div key={k} className={`rg-row${changed.has(`${k}.see`) || changed.has(`${k}.change`) ? " changed" : ""}`}>
              <span className="rg-name"><Glyph icon={look.icon} hue={look.hue} size={30} soft /><span><strong>{a.label}</strong><small>{a.hint}</small></span></span>
              <span>{a.change_only ? <span className="muted small">–</span> : <Switch on={have.has(`${k}.see`)} disabled={!may(`${k}.see`)} label={`${label} can see ${a.label}`} onChange={(v) => set(`${k}.see`, v)} />}</span>
              <span><Switch on={have.has(`${k}.change`)} disabled={!may(`${k}.change`)} label={`${label} can change ${a.label}`} onChange={(v) => set(`${k}.change`, v)} /></span>
            </div>
          );
        })}
      </div>
      <h4 className="goals-title"><Icon name="lock" size={16} />Private records</h4>
      <div className="rights-grid private">
        {Object.entries(meta.private).map(([k, a]) => (
          <div key={k} className={`rg-row${changed.has(`private.${k}`) ? " changed" : ""}`}>
            <span className="rg-name"><Glyph icon={a.icon} hue="red" size={30} soft /><span><strong>{a.label}</strong><small>{a.hint}</small></span></span>
            <span /><span><Switch on={have.has(`private.${k}`)} disabled={!may(`private.${k}`)} label={`${label} can open ${a.label}`} onChange={(v) => set(`private.${k}`, v)} /></span>
          </div>
        ))}
        {Object.entries(meta.powers).map(([k, a]) => (
          <div key={k} className={`rg-row${changed.has(`power.${k}`) ? " changed" : ""}`}>
            <span className="rg-name"><Glyph icon={a.icon} hue="teal" size={30} soft /><span><strong>{a.label}</strong><small>{a.hint}</small></span></span>
            <span /><span><Switch on={have.has(`power.${k}`)} disabled={!may(`power.${k}`)} label={`${label}: ${a.label}`} onChange={(v) => set(`power.${k}`, v)} /></span>
          </div>
        ))}
      </div>
      <p className="muted small">Anyone without a private right can ask for it for a few hours. The principal and the head of school say yes or no, and are told each time the records are opened.</p>
      {error && <p className="error">{error}</p>}
      <div className="row">{!editable && <span className="muted small"><Icon name="lock" size={13} /> You can't change rights for {label.toLowerCase()}.</span>}<span className="grow" />
        {onReset && <button className="with-icon small" disabled={busy} onClick={() => run(onReset)}><Icon name="undo" size={14} />Back to ready-made</button>}</div>
    </div>
  );
}

function GrantRow({ g, canDecide, onDone }: { g: Grant; canDecide: boolean; onDone: () => void }) {
  const [hours, setHours] = useState(g.hours);
  const [note, setNote] = useState("");
  const [busy, error, run] = useBusy();
  return (
    <div className={`grant-row g-${g.status}`}>
      <Avatar name={g.name ?? "?"} size={36} />
      <span className="grow">
        <strong>{g.name}</strong> asks to open <b>{g.label.toLowerCase()}</b>
        <span className="muted small block">“{g.reason}” · {when(g.at)}</span>
        {g.status === "approved" && g.expires_at && <span className="hue-chip" style={hue("green")}><Icon name="key" size={12} />Open until {when(g.expires_at)}{g.decided_by && ` · approved by ${g.decided_by}`}</span>}
      </span>
      {canDecide && g.status === "waiting" && (
        <span className="grant-actions">
          <select aria-label="For how long" value={hours} onChange={(e) => setHours(Number(e.target.value))}>{HOURS.map(([h, l]) => <option key={h} value={h}>{l}</option>)}</select>
          <input aria-label="Note (optional)" placeholder="Note (optional)" value={note} onChange={(e) => setNote(e.target.value)} />
          <button className="ok-button" disabled={busy} onClick={() => run(async () => { await rightsApi.decide(g.id, "approve", hours, note); onDone(); })}>Approve</button>
          <button disabled={busy} onClick={() => run(async () => { await rightsApi.decide(g.id, "refuse", undefined, note); onDone(); })}>Say no</button>
        </span>
      )}
      {canDecide && g.status === "approved" && <button disabled={busy} onClick={() => run(async () => { await rightsApi.decide(g.id, "end"); onDone(); })}>End now</button>}
      {error && <p className="error">{error}</p>}
    </div>
  );
}

function PersonPicker({ schoolId, onClose, onPick }: { schoolId: string; onClose: () => void; onPick: (id: string) => void }) {
  const [people, setPeople] = useState<PersonOption[] | null>(null);
  const [q, setQ] = useState("");
  useEffect(() => { structure.staffOptions(schoolId).then(setPeople).catch(() => setPeople([])); }, [schoolId]);
  const list = useMemo(() => (people ?? []).filter((x) => x.full_name.toLowerCase().includes(q.toLowerCase())).slice(0, 60), [people, q]);
  return (
    <Modal title="Choose a person" onClose={onClose}>
      <input autoFocus placeholder="Type a name…" value={q} onChange={(e) => setQ(e.target.value)} />
      <ul className="pick-list">{list.map((x) => (
        <li key={x.id}><button onClick={() => onPick(x.id)}><Avatar name={x.full_name} size={30} /><span className="grow"><strong>{x.full_name}</strong><small>{x.roles.join(", ")}</small></span><Icon name="chevron-right" size={16} /></button></li>
      ))}</ul>
      {people && list.length === 0 && <Empty icon="user">Nobody found.</Empty>}
    </Modal>
  );
}

function PersonEditor({ schoolId, meta, userId, canChange, myRights, onClose }: {
  schoolId: string; meta: RightsMeta; userId: string; canChange: boolean; myRights: Set<string>; onClose: () => void;
}) {
  const [p, setP] = useState<PersonRights | null>(null);
  const [busy, error, run] = useBusy();
  const load = useCallback(() => { rightsApi.person(schoolId, userId).then(setP).catch(() => {}); }, [schoolId, userId]);
  useEffect(load, [load]);
  if (!p) return <Modal title="Rights" onClose={onClose}><p className="muted">Loading…</p></Modal>;
  const have = new Set(p.rights);
  const changes = new Map(p.changes.map((c) => [c.right, c.allowed]));
  const set = (r: string, v: boolean | null) => run(async () => { await rightsApi.setPerson(schoolId, userId, r, v); load(); });
  const rows: [string, string, string][] = [
    ...Object.entries(meta.areas).flatMap(([k, a]) => [...(a.change_only ? [] : [[`${k}.see`, `See ${a.label.toLowerCase()}`, TAB_LOOK[AREA_TAB[k]]?.icon ?? a.icon] as [string, string, string]]),
      [`${k}.change`, `Change ${a.label.toLowerCase()}`, TAB_LOOK[AREA_TAB[k]]?.icon ?? a.icon] as [string, string, string]]),
    ...Object.entries(meta.private).map(([k, a]) => [`private.${k}`, a.label, a.icon] as [string, string, string]),
    ...Object.entries(meta.powers).map(([k, a]) => [`power.${k}`, a.label, a.icon] as [string, string, string]),
  ];
  return (
    <Modal title={p.name} onClose={onClose}>
      <p className="muted small">{p.job_title ?? ""}{p.roles.length > 0 && ` · ${p.roles.map((r) => meta.roles[r] ?? r).join(", ")}`}. Switches show what they can do now; a coloured mark means it differs from their role.</p>
      <div className="person-rights">
        {rows.map(([r, l, ic]) => (
          <div key={r} className={`pr-row${changes.has(r) ? " changed" : ""}`}>
            <Icon name={ic} size={16} /><span className="grow">{l}{changes.has(r) && <small>{changes.get(r) ? " just for them" : " taken away from them"}</small>}</span>
            {changes.has(r) && canChange && <button className="text-link small" disabled={busy} onClick={() => set(r, null)}>Undo</button>}
            <Switch on={have.has(r)} disabled={!canChange || busy || !myRights.has(r)} label={l} onChange={(v) => set(r, v)} />
          </div>
        ))}
      </div>
      {error && <p className="error">{error}</p>}
      <div className="row"><span className="grow" /><button className="primary" onClick={onClose}>Done</button></div>
    </Modal>
  );
}

// ---------- Asking for private records, from anywhere ----------

export function AskAccess({ schoolId, right, what }: { schoolId: string; right: string; what: string }) {
  const [mine, setMine] = useState<Grant[] | null>(null);
  const [open, setOpen] = useState(false);
  const load = useCallback(() => { rightsApi.mine(schoolId).then(setMine).catch(() => setMine([])); }, [schoolId]);
  useEffect(load, [load]);
  const last = (mine ?? []).find((g) => g.right === right);
  return (
    <section className="card ask-access" style={hue("amber")}>
      <Glyph icon="lock" hue="amber" size={48} />
      <div className="grow">
        <h3>{what} are private</h3>
        {last?.status === "waiting" ? <p>You asked on {when(last.at)}. The principal has been told and will answer soon.</p>
          : last?.status === "refused" ? <p>The principal said no{last.note && `: “${last.note}”`}. You can ask again with more detail.</p>
          : <p>Only the people who need them can open these. If you need to (for example to fix a problem), ask the principal. They will be told each time you open them.</p>}
      </div>
      {last?.status !== "waiting" && <button className="primary with-icon" onClick={() => setOpen(true)}><Icon name="key" size={16} />Ask for access</button>}
      {open && <AskForm schoolId={schoolId} right={right} what={what} onClose={() => setOpen(false)} onDone={() => { setOpen(false); load(); }} />}
    </section>
  );
}

function AskForm({ schoolId, right, what, onClose, onDone }: { schoolId: string; right: string; what: string; onClose: () => void; onDone: () => void }) {
  const [reason, setReason] = useState("");
  const [hours, setHours] = useState(2);
  const [busy, error, run] = useBusy();
  return (
    <Modal title={`Ask to open ${what.toLowerCase()}`} onClose={onClose}>
      <form className="stack" onSubmit={(e) => { e.preventDefault(); run(async () => { await rightsApi.ask(schoolId, right, reason, hours); onDone(); }); }}>
        <Field label="Why do you need them?"><textarea required minLength={5} rows={3} value={reason} onChange={(e) => setReason(e.target.value)} placeholder="e.g. The nurse can't print the visit report; I need to see the screen to fix it." /></Field>
        <Field label="For how long"><select value={hours} onChange={(e) => setHours(Number(e.target.value))}>{HOURS.map(([h, l]) => <option key={h} value={h}>{l}</option>)}</select></Field>
        {error && <p className="error">{error}</p>}
        <div className="row"><span className="grow" /><button type="button" onClick={onClose}>Cancel</button><button className="primary" disabled={busy}>Send to the principal</button></div>
      </form>
    </Modal>
  );
}
