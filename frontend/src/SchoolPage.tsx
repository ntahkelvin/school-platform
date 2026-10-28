import { useCallback, useEffect, useState, type FormEvent } from "react";
import {
  api, errorText, SCHOOL_TYPE_LABEL,
  type AcademicSession, type Branch, type Me, type School, type Subject, type Term,
} from "./api";
import Layout from "./Layout";
import { BranchForm, SchoolForm } from "./forms";
import { href } from "./router";
import { Empty, Field, Modal } from "./ui";

export default function SchoolPage({ me, onLogout, schoolId }: { me: Me; onLogout: () => void; schoolId: string }) {
  const [school, setSchool] = useState<School | null>(null);
  const [error, setError] = useState("");
  const [editing, setEditing] = useState(false);

  const load = useCallback(() => {
    api.school(schoolId).then(setSchool).catch((err) => setError(err.message));
  }, [schoolId]);
  useEffect(load, [load]);

  return (
    <Layout me={me} onLogout={onLogout} crumbs={[{ label: "Home", href: "#/" }, { label: school?.name ?? "School" }]}>
      {error && <p className="error">{error}</p>}
      {school && (
        <>
          <div className="page-head">
            <div>
              <h1>{school.name}</h1>
              <p className="muted">{SCHOOL_TYPE_LABEL[school.school_type]}</p>
            </div>
            <button onClick={() => setEditing(true)}>Edit school</button>
          </div>

          {editing && (
            <Modal title="Edit school" onClose={() => setEditing(false)}>
              <SchoolForm
                initial={school}
                submitLabel="Save changes"
                onCancel={() => setEditing(false)}
                onSubmit={async (name, type) => {
                  setSchool(await api.updateSchool(school.id, name, type));
                  setEditing(false);
                }}
              />
            </Modal>
          )}

          <div className="sections">
            <BranchesSection school={school} onChanged={load} />
            <SessionsSection schoolId={school.id} />
            <SubjectsSection schoolId={school.id} />
          </div>
        </>
      )}
    </Layout>
  );
}

function BranchesSection({ school, onChanged }: { school: School; onChanged: () => void }) {
  const [adding, setAdding] = useState(false);
  const [editing, setEditing] = useState<Branch | null>(null);
  return (
    <section className="card">
      <div className="card-head">
        <h2>Branches</h2>
        <button onClick={() => setAdding(true)}>Add branch</button>
      </div>
      {school.branches.length === 0 ? (
        <Empty>No branches yet.</Empty>
      ) : (
        <ul className="list">
          {school.branches.map((b) => (
            <li key={b.id}>
              <div>
                <a href={href({ page: "branch", id: b.id, tab: "students" })}>{b.name}</a>
                {b.has_boarding && <span className="tag">Boarding</span>}
                {b.address && <span className="muted small block">{b.address}</span>}
              </div>
              <button className="ghost" onClick={() => setEditing(b)}>Edit</button>
            </li>
          ))}
        </ul>
      )}
      {adding && (
        <Modal title="Add branch" onClose={() => setAdding(false)}>
          <BranchForm
            submitLabel="Save branch"
            onCancel={() => setAdding(false)}
            onSubmit={async (name, address, boarding) => {
              await api.addBranch(school.id, name, address, boarding);
              setAdding(false);
              onChanged();
            }}
          />
        </Modal>
      )}
      {editing && (
        <Modal title="Edit branch" onClose={() => setEditing(null)}>
          <BranchForm
            initial={editing}
            submitLabel="Save changes"
            onCancel={() => setEditing(null)}
            onSubmit={async (name, address, boarding) => {
              await api.updateBranch(editing.id, name, address, boarding);
              setEditing(null);
              onChanged();
            }}
          />
        </Modal>
      )}
    </section>
  );
}

function suggestedSessionName(): string {
  // Nigerian sessions usually start in September.
  const now = new Date();
  const start = now.getMonth() >= 7 ? now.getFullYear() : now.getFullYear() - 1;
  return `${start}/${start + 1}`;
}

function formatDate(d: string | null): string {
  if (!d) return "Not set";
  return new Date(d + "T00:00:00").toLocaleDateString("en-GB", { day: "numeric", month: "short", year: "numeric" });
}

function SessionsSection({ schoolId }: { schoolId: string }) {
  const [sessions, setSessions] = useState<AcademicSession[] | null>(null);
  const [name, setName] = useState(suggestedSessionName());
  const [error, setError] = useState("");
  const [editingTerm, setEditingTerm] = useState<Term | null>(null);

  const load = useCallback(() => {
    api.sessions(schoolId).then(setSessions).catch((err) => setError(err.message));
  }, [schoolId]);
  useEffect(load, [load]);

  async function add(e: FormEvent) {
    e.preventDefault();
    setError("");
    try {
      await api.addSession(schoolId, name);
      load();
    } catch (err) {
      setError(errorText(err));
    }
  }

  return (
    <section className="card">
      <div className="card-head">
        <h2>Sessions and terms</h2>
      </div>
      <form className="row wrap" onSubmit={add} noValidate>
        <input
          aria-label="New session"
          value={name}
          onChange={(e) => { setName(e.target.value); setError(""); }}
          placeholder="2026/2027"
          style={{ maxWidth: 160 }}
        />
        <button className="primary">Add session</button>
      </form>
      {error && <p className="error">{error}</p>}
      {sessions?.length === 0 && <Empty>No sessions yet. Add one to create its three terms.</Empty>}
      {sessions?.map((s) => (
        <div key={s.id} className="session">
          <h3>{s.name}</h3>
          <ul className="list">
            {s.terms.map((t) => (
              <li key={t.id}>
                <div>
                  {t.name}
                  {t.is_current && <span className="tag">Current</span>}
                  <span className="muted small block">
                    {t.starts_on || t.ends_on ? `${formatDate(t.starts_on)} to ${formatDate(t.ends_on)}` : "Dates not set"}
                  </span>
                </div>
                <div className="row">
                  {!t.is_current && (
                    <button className="ghost" onClick={() => api.makeCurrent(t.id).then(setSessions)}>
                      Make current
                    </button>
                  )}
                  <button className="ghost" onClick={() => setEditingTerm(t)}>Dates</button>
                </div>
              </li>
            ))}
          </ul>
        </div>
      ))}
      {editingTerm && (
        <TermDates term={editingTerm} onClose={() => setEditingTerm(null)} onSaved={() => { setEditingTerm(null); load(); }} />
      )}
    </section>
  );
}

function TermDates({ term, onClose, onSaved }: { term: Term; onClose: () => void; onSaved: () => void }) {
  const [start, setStart] = useState(term.starts_on ?? "");
  const [end, setEnd] = useState(term.ends_on ?? "");
  const [error, setError] = useState("");
  async function save(e: FormEvent) {
    e.preventDefault();
    try {
      await api.updateTerm(term.id, start || null, end || null);
      onSaved();
    } catch (err) {
      setError(errorText(err));
    }
  }
  return (
    <Modal title={`${term.name} dates`} onClose={onClose}>
      <form className="stack" onSubmit={save} noValidate>
        <Field label="Starts">
          <input type="date" value={start} onChange={(e) => { setStart(e.target.value); setError(""); }} />
        </Field>
        <Field label="Ends">
          <input type="date" value={end} onChange={(e) => { setEnd(e.target.value); setError(""); }} />
        </Field>
        {error && <p className="error">{error}</p>}
        <div className="row">
          <button className="primary">Save dates</button>
          <button type="button" onClick={onClose}>Cancel</button>
        </div>
      </form>
    </Modal>
  );
}

function SubjectsSection({ schoolId }: { schoolId: string }) {
  const [subjects, setSubjects] = useState<Subject[] | null>(null);
  const [name, setName] = useState("");
  const [code, setCode] = useState("");
  const [error, setError] = useState("");

  const load = useCallback(() => {
    api.subjects(schoolId).then(setSubjects).catch((err) => setError(err.message));
  }, [schoolId]);
  useEffect(load, [load]);

  async function add(e: FormEvent) {
    e.preventDefault();
    if (name.trim().length < 2) return setError("Enter a subject name.");
    try {
      await api.addSubject(schoolId, name.trim(), code.trim());
      setName("");
      setCode("");
      load();
    } catch (err) {
      setError(errorText(err));
    }
  }

  return (
    <section className="card">
      <div className="card-head">
        <h2>Subjects</h2>
        <button onClick={() => api.addCommonSubjects(schoolId).then(setSubjects)}>Add common subjects</button>
      </div>
      <p className="muted small">Shared by every branch of this school.</p>
      <form className="row wrap" onSubmit={add} noValidate>
        <input aria-label="Subject name" placeholder="Subject name" value={name} onChange={(e) => { setName(e.target.value); setError(""); }} />
        <input aria-label="Code" placeholder="Code (optional)" value={code} onChange={(e) => setCode(e.target.value)} style={{ maxWidth: 140 }} />
        <button className="primary">Add</button>
      </form>
      {error && <p className="error">{error}</p>}
      {subjects?.length === 0 && <Empty>No subjects yet.</Empty>}
      <div className="chips">
        {subjects?.map((s) => (
          <span key={s.id} className="chip">
            {s.name}
            {s.code && <span className="muted"> ({s.code})</span>}
            <button
              className="chip-x"
              aria-label={`Remove ${s.name}`}
              onClick={() => api.deleteSubject(s.id).then(load).catch((err) => setError(errorText(err)))}
            >
              ✕
            </button>
          </span>
        ))}
      </div>
    </section>
  );
}
