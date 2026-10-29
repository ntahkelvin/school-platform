// Logins: see each person's username and status, reset a forgotten password, switch a login off.
// Passwords are stored scrambled one way, so the app can never show an existing password.
import { useCallback, useEffect, useMemo, useState, type FormEvent } from "react";
import { api, errorText, type LoginInfo, type Me, type NewLogin } from "./api";
import Icon from "./Icon";
import type { Hue } from "./look";
import { Avatar, Empty, Field, Glyph, hue, Modal, nicePhone, Stat } from "./ui";

export function whenLoggedIn(iso: string | null): string {
  if (!iso) return "Never logged in";
  const d = new Date(iso), days = Math.floor((Date.now() - d.getTime()) / 86400000);
  if (days < 1) return "Last in today";
  if (days === 1) return "Last in yesterday";
  if (days < 30) return `Last in ${days} days ago`;
  return `Last in ${d.toLocaleDateString("en-GB", { day: "numeric", month: "short", year: "numeric" })}`;
}

function statusOf(l: LoginInfo): { label: string; hue: Hue } {
  if (!l.is_active) return { label: "Switched off", hue: "red" };
  if (!l.last_login_at) return { label: "Not used yet", hue: "amber" };
  if (l.must_change_password) return { label: "Must set a password", hue: "amber" };
  return { label: "Active", hue: "green" };
}

const KIND: Record<string, { label: string; icon: string; hue: Hue }> = {
  staff: { label: "Staff", icon: "staff", hue: "cyan" },
  board: { label: "Board", icon: "users", hue: "rose" },
  parent: { label: "Parents", icon: "handshake", hue: "violet" },
  student: { label: "Students", icon: "students", hue: "blue" },
};

const TITLE = /^(mr|mrs|miss|ms|dr|rev|fr|sr|br|prof|chief|barr|engr|hon|pastor|alhaji|alhaja|sir|lady)\.?$/i;
/** "Barr. Ebuka Ugwu" -> "Ebuka" */
const firstName = (name: string) => name.split(/\s+/).find((w) => !TITLE.test(w)) ?? name;

/** The new password, shown once, with ways to pass it on. */
export function NewPassword({ login, onDone }: { login: NewLogin; onDone: () => void }) {
  const [copied, setCopied] = useState(false);
  const user = nicePhone(login.username);
  const text = `Hello ${firstName(login.name)}, here is your login for the school app.\nUsername: ${user}\nPassword: ${login.password}\nYou will choose your own password when you log in.`;
  const digits = login.username.replace(/\D/g, "");
  return (
    <div className="stack">
      <div className="new-password">
        <Glyph icon="shield-check" hue="green" size={52} />
        <dl>
          <dt>Username</dt><dd>{user}</dd>
          <dt>Password</dt><dd className="mono big-pass">{login.password}</dd>
        </dl>
      </div>
      <p className="small muted">This password is shown only now. {firstName(login.name)} will be asked to choose their own the first time they log in.</p>
      <div className="row wrap">
        <button className="with-icon" onClick={() => navigator.clipboard?.writeText(text).then(() => setCopied(true), () => setCopied(false))}>
          <Icon name="clipboard" size={16} />{copied ? "Copied" : "Copy message"}
        </button>
        {login.username.startsWith("+") && (
          <a className="button with-icon whatsapp" href={`https://wa.me/${digits}?text=${encodeURIComponent(text)}`} target="_blank" rel="noreferrer">
            <Icon name="phone" size={16} />Send on WhatsApp
          </a>
        )}
        <button className="primary" onClick={onDone}>Done</button>
      </div>
    </div>
  );
}

/** A person's login: shown inside a staff record or a board member's window. */
export function LoginPanel({ schoolId, userId }: { schoolId: string; userId: string }) {
  const [info, setInfo] = useState<LoginInfo | null>(null);
  const [fresh, setFresh] = useState<NewLogin | null>(null);
  const [error, setError] = useState("");
  const load = useCallback(() => { api.loginInfo(schoolId, userId).then(setInfo).catch((err) => setError(errorText(err))); }, [schoolId, userId]);
  useEffect(load, [load]);
  if (error) return <p className="error">{error}</p>;
  if (!info) return null;
  const st = statusOf(info);
  return (
    <section className="login-panel" style={hue(st.hue)}>
      <div className="login-panel-head">
        <Glyph icon="shield-check" hue={st.hue} size={36} soft />
        <div className="grow">
          <strong>Login</strong>
          <span className="block small muted">{whenLoggedIn(info.last_login_at)}</span>
        </div>
        <span className="hue-chip">{st.label}</span>
      </div>
      {fresh ? (
        <NewPassword login={fresh} onDone={() => { setFresh(null); load(); }} />
      ) : (
        <>
          <dl className="login-facts">
            <dt>Username</dt><dd>{nicePhone(info.phone) || info.email}{info.phone && info.email ? <span className="muted"> or {info.email}</span> : null}</dd>
            <dt>Password</dt><dd className="muted">Hidden. Nobody can see it, not even you. Reset it if it's forgotten.</dd>
          </dl>
          {info.is_admin ? (
            <p className="small muted">This person is an owner, so they manage their own login.</p>
          ) : (
            <div className="row wrap">
              <button className="with-icon" onClick={() => {
                if (window.confirm(`Give ${info.full_name} a new password? The old one stops working.`))
                  api.resetPassword(schoolId, userId).then(setFresh).catch((err) => setError(errorText(err)));
              }}><Icon name="shield-check" size={16} />Reset password</button>
              <button className={info.is_active ? "danger-outline" : "with-icon"} onClick={() => {
                if (!info.is_active || window.confirm(`Switch off ${info.full_name}'s login? They are logged out at once.`))
                  api.setLoginActive(schoolId, userId, !info.is_active).then(setInfo).catch((err) => setError(errorText(err)));
              }}>{info.is_active ? "Switch off login" : "Switch login back on"}</button>
            </div>
          )}
        </>
      )}
    </section>
  );
}

/** The Logins page: everyone with a login at this school. */
export default function LoginsPage({ schoolId }: { schoolId: string }) {
  const [list, setList] = useState<LoginInfo[] | null>(null);
  const [kind, setKind] = useState("");
  const [q, setQ] = useState("");
  const [open, setOpen] = useState<LoginInfo | null>(null);
  const [error, setError] = useState("");
  const load = useCallback(() => { api.logins(schoolId).then(setList).catch((err) => setError(errorText(err))); }, [schoolId]);
  useEffect(load, [load]);

  const shown = useMemo(() => {
    const words = q.trim().toLowerCase();
    const digits = q.replace(/\D/g, "").replace(/^0/, "");
    const matches = (l: LoginInfo) => !words
      || `${l.title ?? ""} ${l.full_name} ${l.email ?? ""} ${l.roles.join(" ")}`.toLowerCase().includes(words)
      || (digits.length > 3 && (l.phone ?? "").includes(digits));
    return (list ?? []).filter((l) => (!kind || l.kind === kind) && matches(l));
  }, [list, kind, q]);
  const count = (f: (l: LoginInfo) => boolean) => (list ?? []).filter(f).length;

  return (
    <div className="stack">
      <div className="bulk-intro">
        <Glyph icon="shield-check" hue="indigo" size={56} />
        <div>
          <strong>Logins and passwords</strong>
          <span className="block small">
            Everyone who can log in to this school: staff, board members and parents. Passwords are stored scrambled, so they can't
            be shown. If someone forgets theirs, reset it: you get a new one to pass on, and they choose their own when they log in.
          </span>
        </div>
      </div>
      {list && (
        <div className="stat-strip">
          <Stat icon="users" hue="indigo" value={list.length} label="logins" />
          <Stat icon="shield-check" hue="green" value={count((l) => l.is_active && !!l.last_login_at)} label="have logged in" />
          <Stat icon="clock" hue="amber" value={count((l) => l.is_active && !l.last_login_at)} label="never logged in" />
          <Stat icon="close" hue="red" value={count((l) => !l.is_active)} label="switched off" />
        </div>
      )}
      <section className="card editor">
        <div className="toolbar">
          <label className="search grow">
            <Icon name="search" size={17} />
            <input aria-label="Search logins" placeholder="Search by name, phone or email" value={q} onChange={(e) => setQ(e.target.value)} />
          </label>
        </div>
        <div className="filter-chips">
          <button className={kind === "" ? "on" : ""} onClick={() => setKind("")}>Everyone<span className="chip-count">{list?.length ?? 0}</span></button>
          {Object.entries(KIND).map(([k, v]) => count((l) => l.kind === k) ? (
            <button key={k} className={kind === k ? "on" : ""} style={hue(v.hue)} onClick={() => setKind(k)}>
              <span className="chip-dot" />{v.label}<span className="chip-count">{count((l) => l.kind === k)}</span>
            </button>
          ) : null)}
        </div>
        {error && <p className="error">{error}</p>}
        {list === null && !error && <div className="skeleton" aria-hidden="true"><span /><span /><span /></div>}
        {list && shown.length === 0 && <Empty icon="users">{q || kind ? "Nobody matches." : "Nobody has a login yet."}</Empty>}
        {shown.length > 0 && (
          <div className="table-wrap plain people-table">
            <table>
              <thead>
                <tr><th>Person</th><th>Username</th><th className="hide-small">Role</th><th className="hide-small">Status</th><th /></tr>
              </thead>
              <tbody>
                {shown.slice(0, 300).map((l) => {
                  const st = statusOf(l);
                  return (
                    <tr key={l.user_id} className="clickable" onClick={() => setOpen(l)}>
                      <td>
                        <span className="person">
                          <Avatar name={l.full_name} size={34} />
                          <span>
                            <strong>{[l.title, l.full_name].filter(Boolean).join(" ")}</strong>
                            <span className="block small muted">{whenLoggedIn(l.last_login_at)}</span>
                          </span>
                        </span>
                      </td>
                      <td className="mono small">{nicePhone(l.phone) || l.email}</td>
                      <td className="hide-small"><span className="hue-chip" style={hue(KIND[l.kind]?.hue ?? "slate")}>{l.roles.join(", ")}</span></td>
                      <td className="hide-small"><span className="hue-chip" style={hue(st.hue)}>{st.label}</span></td>
                      <td className="nowrap"><span className="small link-like">Manage</span></td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
            {shown.length > 300 && <p className="small muted table-foot">Showing 300 of {shown.length}. Search to find someone.</p>}
          </div>
        )}
      </section>
      {open && (
        <Modal title={[open.title, open.full_name].filter(Boolean).join(" ")} onClose={() => { setOpen(null); load(); }}>
          <div className="stack">
            <div className="staff-summary">
              <Avatar name={open.full_name} size={52} />
              <div className="grow">
                <strong>{[open.title, open.full_name].filter(Boolean).join(" ")}</strong>
                <span className="block small muted">{open.roles.join(", ")}</span>
              </div>
            </div>
            <LoginPanel schoolId={schoolId} userId={open.user_id} />
          </div>
        </Modal>
      )}
    </div>
  );
}

/** Shown straight after logging in with a password someone else chose. */
export function ChoosePassword({ me, onDone, onLogout }: { me: Me; onDone: () => void; onLogout: () => void }) {
  const [current, setCurrent] = useState("");
  const [next, setNext] = useState("");
  const [again, setAgain] = useState("");
  const [error, setError] = useState("");
  const [busy, setBusy] = useState(false);
  async function submit(e: FormEvent) {
    e.preventDefault();
    if (next.length < 8) return setError("Use at least 8 characters.");
    if (next !== again) return setError("The two new passwords are not the same.");
    setBusy(true);
    try {
      await api.changePassword(current, next);
      onDone();
    } catch (err) {
      setError(errorText(err));
      setBusy(false);
    }
  }
  return (
    <div className="center">
      <form className="card login" onSubmit={submit} noValidate>
        <Glyph icon="shield-check" hue="green" size={52} />
        <h1>Choose your password</h1>
        <p className="small muted">Welcome, {firstName(me.full_name)}. The password you were given was only for the first login. Choose one only you know.</p>
        <Field label="Password you were given"><input type="password" autoComplete="current-password" value={current} onChange={(e) => { setCurrent(e.target.value); setError(""); }} autoFocus /></Field>
        <Field label="New password" hint="At least 8 characters. Mix letters and numbers."><input type="password" autoComplete="new-password" value={next} onChange={(e) => { setNext(e.target.value); setError(""); }} /></Field>
        <Field label="New password again"><input type="password" autoComplete="new-password" value={again} onChange={(e) => { setAgain(e.target.value); setError(""); }} /></Field>
        {error && <p className="error">{error}</p>}
        <button className="primary" disabled={busy}>{busy ? "Saving…" : "Save my password"}</button>
        <button type="button" className="ghost" onClick={onLogout}>Log out</button>
      </form>
    </div>
  );
}
