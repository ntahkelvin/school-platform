import { useCallback, useEffect, useState, type FormEvent } from "react";
import { errorText, type NewLogin } from "./api";
import { org, type Board, type BoardMember, type BoardScope } from "./orgApi";
import { LoginPanel } from "./Logins";
import { Empty, Field, Modal, NewLoginNotice, nicePhone } from "./ui";

function niceDate(iso: string | null): string {
  return iso ? new Date(iso + "T00:00:00").toLocaleDateString("en-GB", { month: "short", year: "numeric" }) : "";
}

export default function BoardsCard({ scope, title, suggestedName, intro }: {
  scope: BoardScope; title: string; suggestedName: string; intro: string;
}) {
  const [boards, setBoards] = useState<Board[] | null>(null);
  const [positions, setPositions] = useState<string[]>([]);
  const [adding, setAdding] = useState<Board | null>(null);
  const [editing, setEditing] = useState<BoardMember | null>(null);
  const [newLogin, setNewLogin] = useState<NewLogin | null>(null);
  const [error, setError] = useState("");

  const load = useCallback(() => {
    org.boards(scope).then(setBoards).catch((err) => setError(errorText(err)));
  }, [scope.kind, scope.id]); // eslint-disable-line react-hooks/exhaustive-deps
  useEffect(() => {
    load();
    org.positions().then(setPositions).catch(() => {});
  }, [load]);

  const replace = (b: Board) => setBoards((list) => (list ?? []).map((x) => (x.id === b.id ? b : x)));

  return (
    <section className="card">
      <div className="card-head">
        <h2>{title}</h2>
        <button onClick={() => {
          const name = window.prompt("Name of the board", suggestedName);
          if (name && name.trim().length >= 2) org.addBoard(scope, name.trim()).then(load).catch((err) => setError(errorText(err)));
        }}>
          Add board
        </button>
      </div>
      <p className="muted small">{intro}</p>
      {error && <p className="error">{error}</p>}
      {boards?.length === 0 && <Empty>No board yet. Click Add board to create the {suggestedName.toLowerCase()}.</Empty>}
      {boards?.map((b) => (
        <div key={b.id} className="sub-card">
          <div className="card-head">
            <strong>{b.name}</strong>
            <div className="row">
              <button className="ghost" onClick={() => {
                const name = window.prompt("Rename board", b.name);
                if (name && name.trim().length >= 2) org.renameBoard(b.id, name.trim()).then(replace).catch((err) => setError(errorText(err)));
              }}>Rename</button>
              <button className="ghost" onClick={() => {
                if (window.confirm(`Delete ${b.name}? Its members lose their board view.`)) org.deleteBoard(b.id).then(load).catch((err) => setError(errorText(err)));
              }}>Delete</button>
              <button className="primary" onClick={() => setAdding(b)}>Add member</button>
            </div>
          </div>
          {b.members.length === 0 ? (
            <span className="muted small">No members yet.</span>
          ) : (
            <ul className="list">
              {b.members.map((m) => (
                <li key={m.id}>
                  <div className="grow">
                    <strong>{m.full_name}</strong> <span className="tag">{m.position}</span>
                    <span className="muted small block">
                      {[nicePhone(m.phone), m.email].filter(Boolean).join(" · ")}
                      {(m.term_start || m.term_end) && ` · Term: ${niceDate(m.term_start) || "?"} to ${niceDate(m.term_end) || "?"}`}
                    </span>
                  </div>
                  <div className="row">
                    <button className="ghost" onClick={() => setEditing(m)}>{scope.kind === "school" ? "Edit or login" : "Edit"}</button>
                    <button className="ghost" onClick={() => {
                      if (window.confirm(`Remove ${m.full_name} from ${b.name}?`)) org.removeMember(m.id).then(replace).catch((err) => setError(errorText(err)));
                    }}>Remove</button>
                  </div>
                </li>
              ))}
            </ul>
          )}
        </div>
      ))}
      {adding && (
        <Modal title={`Add member to ${adding.name}`} onClose={() => setAdding(null)}>
          <MemberForm
            positions={positions}
            onCancel={() => setAdding(null)}
            onSubmit={async (m) => {
              const res = await org.addMember(adding.id, m);
              replace(res.board);
              setAdding(null);
              if (res.new_login) setNewLogin(res.new_login);
            }}
          />
        </Modal>
      )}
      {editing && (
        <Modal title={`Edit ${editing.full_name}`} onClose={() => setEditing(null)}>
          <MemberForm
            positions={positions}
            member={editing}
            onCancel={() => setEditing(null)}
            onSubmit={async (m) => {
              replace(await org.updateMember(editing.id, m.position, m.term_start, m.term_end));
              setEditing(null);
            }}
          />
          {scope.kind === "school" && <div style={{ marginTop: 16 }}><LoginPanel schoolId={scope.id} userId={editing.user_id} /></div>}
        </Modal>
      )}
      {newLogin && (
        <Modal title="Board member login" onClose={() => setNewLogin(null)}>
          <p className="small">They'll see a read-only board view: schools, students, staff, attendance and the calendar.</p>
          <NewLoginNotice login={newLogin} onDone={() => setNewLogin(null)} />
        </Modal>
      )}
    </section>
  );
}

function MemberForm({ positions, member, onSubmit, onCancel }: {
  positions: string[];
  member?: BoardMember;
  onSubmit: (m: { full_name: string; phone: string; email: string; position: string; term_start: string | null; term_end: string | null }) => Promise<void>;
  onCancel: () => void;
}) {
  const [name, setName] = useState(member?.full_name ?? "");
  const [phone, setPhone] = useState(member?.phone ?? "");
  const [email, setEmail] = useState(member?.email ?? "");
  const [position, setPosition] = useState(member?.position ?? "Member");
  const [start, setStart] = useState(member?.term_start ?? "");
  const [end, setEnd] = useState(member?.term_end ?? "");
  const [error, setError] = useState("");
  const [busy, setBusy] = useState(false);

  async function submit(e: FormEvent) {
    e.preventDefault();
    if (!member) {
      if (name.trim().length < 2) return setError("Enter their name.");
      if (!phone.trim() && !email.trim()) return setError("Enter a phone number or email so they can log in.");
      if (email.trim() && !/^\S+@\S+\.\S+$/.test(email.trim())) return setError("That email address doesn't look right.");
    }
    if (start && end && end < start) return setError("The term of office can't end before it starts.");
    setBusy(true);
    try {
      await onSubmit({ full_name: name.trim(), phone: phone.trim(), email: email.trim(), position, term_start: start || null, term_end: end || null });
    } catch (err) {
      setError(errorText(err));
      setBusy(false);
    }
  }

  return (
    <form className="stack" onSubmit={submit} noValidate>
      <div className="form-grid">
        {!member && (
          <>
            <div className="span-all"><Field label="Full name"><input value={name} onChange={(e) => { setName(e.target.value); setError(""); }} autoFocus /></Field></div>
            <Field label="Phone number"><input type="tel" value={phone} onChange={(e) => { setPhone(e.target.value); setError(""); }} /></Field>
            <Field label="Email (optional)"><input type="email" value={email} onChange={(e) => { setEmail(e.target.value); setError(""); }} /></Field>
          </>
        )}
        <Field label="Position">
          <select value={position} onChange={(e) => setPosition(e.target.value)}>
            {positions.map((p) => <option key={p}>{p}</option>)}
          </select>
        </Field>
        <span />
        <Field label="Term starts (optional)"><input type="date" value={start} onChange={(e) => { setStart(e.target.value); setError(""); }} /></Field>
        <Field label="Term ends (optional)"><input type="date" value={end} onChange={(e) => { setEnd(e.target.value); setError(""); }} /></Field>
      </div>
      {error && <p className="error">{error}</p>}
      <div className="row">
        <button className="primary" disabled={busy}>{member ? "Save changes" : "Add member"}</button>
        <button type="button" onClick={onCancel}>Cancel</button>
      </div>
    </form>
  );
}
