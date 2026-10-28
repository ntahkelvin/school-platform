import { useCallback, useEffect, useState, type FormEvent } from "react";
import { api, type Group, type Me, type School, type SchoolType } from "./api";

const TYPE_LABEL: Record<SchoolType, string> = {
  day: "Day school",
  boarding: "Boarding school",
  mixed: "Day and boarding",
};

export default function Dashboard({ me, onLogout }: { me: Me; onLogout: () => void }) {
  const [groups, setGroups] = useState<Group[] | null>(null);
  const [error, setError] = useState("");

  const load = useCallback(() => {
    api
      .groups()
      .then(setGroups)
      .catch((err) => setError(err.message));
  }, []);

  useEffect(load, [load]);

  return (
    <div className="page">
      <header className="topbar">
        <div className="brand">School Platform</div>
        <div className="topbar-right">
          <span className="muted">{me.full_name}</span>
          <button onClick={onLogout}>Log out</button>
        </div>
      </header>

      <main className="content">
        {error && <p className="error">{error}</p>}
        {groups === null && !error && <p className="muted">Loading your schools…</p>}
        {groups?.length === 0 && <p className="muted">You don't own any school groups yet.</p>}
        {groups?.map((g) => <GroupSection key={g.id} group={g} onChanged={load} />)}
      </main>
    </div>
  );
}

function GroupSection({ group, onChanged }: { group: Group; onChanged: () => void }) {
  const branchCount = group.schools.reduce((n, s) => n + s.branches.length, 0);
  return (
    <section>
      <div className="section-head">
        <div>
          <h1>{group.name}</h1>
          <p className="muted">
            {group.schools.length} {group.schools.length === 1 ? "school" : "schools"} · {branchCount}{" "}
            {branchCount === 1 ? "branch" : "branches"}
          </p>
        </div>
      </div>

      <div className="grid">
        {group.schools.map((s) => (
          <SchoolCard key={s.id} school={s} onChanged={onChanged} />
        ))}
        <AddSchoolCard groupId={group.id} onAdded={onChanged} />
      </div>
    </section>
  );
}

function SchoolCard({ school, onChanged }: { school: School; onChanged: () => void }) {
  const [adding, setAdding] = useState(false);
  return (
    <div className="card">
      <div className="card-head">
        <h2>{school.name}</h2>
        <span className={`pill pill-${school.school_type}`}>{TYPE_LABEL[school.school_type]}</span>
      </div>

      {school.branches.length === 0 ? (
        <p className="muted small">No branches yet. Every school needs at least one.</p>
      ) : (
        <ul className="branches">
          {school.branches.map((b) => (
            <li key={b.id}>
              <span>{b.name}</span>
              {b.has_boarding && <span className="tag">Boarding</span>}
              {b.address && <span className="muted small block">{b.address}</span>}
            </li>
          ))}
        </ul>
      )}

      {adding ? (
        <AddBranchForm
          schoolId={school.id}
          onDone={() => {
            setAdding(false);
            onChanged();
          }}
          onCancel={() => setAdding(false)}
        />
      ) : (
        <button onClick={() => setAdding(true)}>Add branch</button>
      )}
    </div>
  );
}

function AddBranchForm({
  schoolId,
  onDone,
  onCancel,
}: {
  schoolId: string;
  onDone: () => void;
  onCancel: () => void;
}) {
  const [name, setName] = useState("");
  const [address, setAddress] = useState("");
  const [boarding, setBoarding] = useState(false);
  const [error, setError] = useState("");
  const [busy, setBusy] = useState(false);

  async function submit(e: FormEvent) {
    e.preventDefault();
    if (name.trim().length < 2) {
      setError("Give the branch a name, for example Lekki campus.");
      return;
    }
    setBusy(true);
    try {
      await api.addBranch(schoolId, name.trim(), address.trim(), boarding);
      onDone();
    } catch (err) {
      setError(err instanceof Error ? err.message : "Could not add branch.");
      setBusy(false);
    }
  }

  return (
    <form className="stack" onSubmit={submit} noValidate>
      <label>
        Branch name
        <input value={name} onChange={(e) => { setName(e.target.value); setError(""); }} autoFocus />
      </label>
      <label>
        Address (optional)
        <input value={address} onChange={(e) => setAddress(e.target.value)} />
      </label>
      <label className="check">
        <input type="checkbox" checked={boarding} onChange={(e) => setBoarding(e.target.checked)} />
        This branch has boarding
      </label>
      {error && <p className="error">{error}</p>}
      <div className="row">
        <button className="primary" disabled={busy}>Save branch</button>
        <button type="button" onClick={onCancel}>Cancel</button>
      </div>
    </form>
  );
}

function AddSchoolCard({ groupId, onAdded }: { groupId: string; onAdded: () => void }) {
  const [open, setOpen] = useState(false);
  const [name, setName] = useState("");
  const [type, setType] = useState<SchoolType>("day");
  const [error, setError] = useState("");
  const [busy, setBusy] = useState(false);

  async function submit(e: FormEvent) {
    e.preventDefault();
    if (name.trim().length < 2) {
      setError("Enter the school's name.");
      return;
    }
    setBusy(true);
    try {
      await api.addSchool(groupId, name.trim(), type);
      setName("");
      setType("day");
      setOpen(false);
      onAdded();
    } catch (err) {
      setError(err instanceof Error ? err.message : "Could not add school.");
    } finally {
      setBusy(false);
    }
  }

  if (!open) {
    return (
      <button className="card add-card" onClick={() => setOpen(true)}>
        + Add a school
      </button>
    );
  }

  return (
    <form className="card stack" onSubmit={submit} noValidate>
      <h2>New school</h2>
      <label>
        School name
        <input value={name} onChange={(e) => { setName(e.target.value); setError(""); }} autoFocus />
      </label>
      <label>
        Type
        <select value={type} onChange={(e) => setType(e.target.value as SchoolType)}>
          <option value="day">Day school</option>
          <option value="boarding">Boarding school</option>
          <option value="mixed">Day and boarding</option>
        </select>
      </label>
      {error && <p className="error">{error}</p>}
      <div className="row">
        <button className="primary" disabled={busy}>Save school</button>
        <button type="button" onClick={() => setOpen(false)}>Cancel</button>
      </div>
    </form>
  );
}
