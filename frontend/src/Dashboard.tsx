import { useCallback, useEffect, useState } from "react";
import { api, SCHOOL_TYPE_LABEL, type Group, type Me, type School } from "./api";
import Layout from "./Layout";
import { BranchForm, SchoolForm } from "./forms";
import { href } from "./router";

export default function Dashboard({ me, onLogout }: { me: Me; onLogout: () => void }) {
  const [groups, setGroups] = useState<Group[] | null>(null);
  const [error, setError] = useState("");

  const load = useCallback(() => {
    api.groups().then(setGroups).catch((err) => setError(err.message));
  }, []);
  useEffect(load, [load]);

  return (
    <Layout me={me} onLogout={onLogout} crumbs={[]}>
      {error && <p className="error">{error}</p>}
      {groups === null && !error && <p className="muted">Loading your schools…</p>}
      {groups?.length === 0 && <p className="muted">You don't own any school groups yet.</p>}
      {groups?.map((g) => <GroupSection key={g.id} group={g} onChanged={load} />)}
    </Layout>
  );
}

function GroupSection({ group, onChanged }: { group: Group; onChanged: () => void }) {
  const branchCount = group.schools.reduce((n, s) => n + s.branches.length, 0);
  return (
    <section>
      <div className="section-head">
        <h1>{group.name}</h1>
        <p className="muted">
          {group.schools.length} {group.schools.length === 1 ? "school" : "schools"} · {branchCount}{" "}
          {branchCount === 1 ? "branch" : "branches"}
        </p>
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
        <h2>
          <a href={href({ page: "school", id: school.id })}>{school.name}</a>
        </h2>
        <span className={`pill pill-${school.school_type}`}>{SCHOOL_TYPE_LABEL[school.school_type]}</span>
      </div>

      {school.branches.length === 0 ? (
        <p className="muted small">No branches yet. Every school needs at least one.</p>
      ) : (
        <ul className="branches">
          {school.branches.map((b) => (
            <li key={b.id}>
              <a className="branch-link" href={href({ page: "branch", id: b.id, tab: "students" })}>
                <span>
                  {b.name}
                  {b.has_boarding && <span className="tag">Boarding</span>}
                </span>
                {b.address && <span className="muted small block">{b.address}</span>}
              </a>
            </li>
          ))}
        </ul>
      )}

      {adding ? (
        <BranchForm
          submitLabel="Save branch"
          onCancel={() => setAdding(false)}
          onSubmit={async (name, address, boarding) => {
            await api.addBranch(school.id, name, address, boarding);
            setAdding(false);
            onChanged();
          }}
        />
      ) : (
        <div className="row">
          <button className="grow" onClick={() => setAdding(true)}>Add branch</button>
          <a className="button" href={href({ page: "school", id: school.id })}>Settings</a>
        </div>
      )}
    </div>
  );
}

function AddSchoolCard({ groupId, onAdded }: { groupId: string; onAdded: () => void }) {
  const [open, setOpen] = useState(false);
  if (!open) {
    return (
      <button className="card add-card" onClick={() => setOpen(true)}>
        + Add a school
      </button>
    );
  }
  return (
    <div className="card">
      <h2>New school</h2>
      <SchoolForm
        submitLabel="Save school"
        onCancel={() => setOpen(false)}
        onSubmit={async (name, type) => {
          await api.addSchool(groupId, name, type);
          setOpen(false);
          onAdded();
        }}
      />
    </div>
  );
}
