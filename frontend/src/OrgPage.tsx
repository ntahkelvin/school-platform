import { useCallback, useEffect, useState, type FormEvent } from "react";
import { api, errorText, SCHOOL_TYPE_LABEL, type Group, type Me } from "./api";
import BoardsCard from "./BoardsCard";
import Layout from "./Layout";
import { org, type Organisation } from "./orgApi";
import { shrinkImage } from "./ProfileCard";
import { href } from "./router";
import { Empty, Field } from "./ui";

export default function OrgPage({ me, onLogout, orgId }: { me: Me; onLogout: () => void; orgId: string }) {
  const [profile, setProfile] = useState<Organisation | null>(null);
  const [groups, setGroups] = useState<Group[]>([]);
  const [error, setError] = useState("");

  const load = useCallback(() => {
    org.profile(orgId).then(setProfile).catch((err) => setError(errorText(err)));
    api.groups().then(setGroups).catch(() => {});
  }, [orgId]);
  useEffect(load, [load]);

  const group = groups.find((g) => g.id === orgId);
  const others = groups.filter((g) => g.id !== orgId);

  return (
    <Layout me={me} onLogout={onLogout} crumbs={[{ label: "Home", href: "#/" }, { label: profile?.name ?? "Organisation" }]}>
      {error && <p className="error">{error}</p>}
      {profile && (
        <>
          <div className="page-head">
            <div className="row" style={{ alignItems: "center", gap: 14 }}>
              {profile.logo && <img className="logo" src={profile.logo} alt="" />}
              <div>
                <h1>{profile.name}</h1>
                <p className="muted">Organisation · {group?.schools.length ?? 0} schools</p>
              </div>
            </div>
            <div className="row wrap">
              <a className="button" href={href({ page: "board" })}>Board view</a>
              {group && group.schools.length === 0 && (
                <button className="danger" onClick={() => {
                  if (window.confirm(`Remove the organisation ${profile.name}?`))
                    org.deleteOrganisation(orgId).then(() => { window.location.hash = "#/"; }).catch((err) => setError(errorText(err)));
                }}>Remove organisation</button>
              )}
            </div>
          </div>
          <div className="sections wide">
            <OrgProfileForm profile={profile} onSaved={setProfile} />
            <div className="stack">
              <BoardsCard
                scope={{ kind: "org", id: orgId }}
                title="Organisation boards"
                suggestedName="Board of Trustees"
                intro="Trustees or directors of the whole organisation. Members see every school in it, read-only."
              />
              <section className="card">
                <h2>Schools in this organisation</h2>
                {group?.schools.length === 0 && <Empty>No schools yet.</Empty>}
                <ul className="list">
                  {group?.schools.map((s) => (
                    <li key={s.id}>
                      <div className="grow">
                        <a href={href({ page: "school", id: s.id, tab: "overview" })}>{s.name}</a>
                        <span className="muted small block">{SCHOOL_TYPE_LABEL[s.school_type]}</span>
                      </div>
                      {others.length > 0 && (
                        <select
                          aria-label={`Move ${s.name} to another organisation`}
                          value=""
                          style={{ maxWidth: 220 }}
                          onChange={(e) => {
                            const to = others.find((o) => o.id === e.target.value);
                            if (to && window.confirm(`Move ${s.name} to ${to.name}? Its staff, students and board go with it.`))
                              org.moveSchool(s.id, to.id).then(load).catch((err) => setError(errorText(err)));
                          }}
                        >
                          <option value="">Move to…</option>
                          {others.map((o) => <option key={o.id} value={o.id}>{o.name}</option>)}
                        </select>
                      )}
                    </li>
                  ))}
                </ul>
              </section>
            </div>
          </div>
        </>
      )}
    </Layout>
  );
}

function OrgProfileForm({ profile, onSaved }: { profile: Organisation; onSaved: (o: Organisation) => void }) {
  const [f, setF] = useState(() => Object.fromEntries(Object.entries(profile).map(([k, v]) => [k, v ?? ""])) as Record<string, string>);
  const [error, setError] = useState("");
  const [saved, setSaved] = useState(false);
  const [busy, setBusy] = useState(false);
  const set = (k: string) => (e: { target: { value: string } }) => { setF({ ...f, [k]: e.target.value }); setError(""); setSaved(false); };

  async function save(e: FormEvent) {
    e.preventDefault();
    if (f.name.trim().length < 2) return setError("Enter the organisation's name.");
    if (f.email && !/^\S+@\S+\.\S+$/.test(f.email)) return setError("That email address doesn't look right.");
    setBusy(true);
    try {
      const payload: Record<string, unknown> = { ...f };
      delete payload.id;
      for (const k of Object.keys(payload)) if (payload[k] === "") payload[k] = null;
      const o = await org.saveProfile(profile.id, payload);
      onSaved(o);
      setSaved(true);
    } catch (err) {
      setError(errorText(err));
    } finally {
      setBusy(false);
    }
  }

  return (
    <section className="card">
      <h2>Organisation profile</h2>
      <form className="stack" onSubmit={save} noValidate>
        <div className="logo-row">
          {f.logo ? <img className="logo big" src={f.logo} alt="Organisation logo" /> : <div className="logo big placeholder">No logo</div>}
          <div className="stack">
            <label className="button file-button">
              {f.logo ? "Change logo" : "Upload logo"}
              <input type="file" accept="image/png,image/jpeg,image/webp" onChange={async (e) => {
                const file = e.target.files?.[0];
                if (!file) return;
                try { setF({ ...f, logo: await shrinkImage(file) }); setSaved(false); } catch (err) { setError(errorText(err)); }
              }} />
            </label>
            {f.logo && <button type="button" className="ghost" onClick={() => { setF({ ...f, logo: "" }); setSaved(false); }}>Remove logo</button>}
          </div>
        </div>
        <Field label="Name"><input value={f.name} onChange={set("name")} /></Field>
        <Field label="About (optional)"><textarea rows={3} value={f.description} onChange={set("description")} /></Field>
        <Field label="Address"><input value={f.address} onChange={set("address")} /></Field>
        <div className="form-grid">
          <Field label="Phone"><input type="tel" value={f.phone} onChange={set("phone")} /></Field>
          <Field label="Email"><input type="email" value={f.email} onChange={set("email")} /></Field>
          <div className="span-all"><Field label="Website"><input value={f.website} onChange={set("website")} /></Field></div>
        </div>
        {error && <p className="error">{error}</p>}
        <div className="row" style={{ alignItems: "center" }}>
          <button className="primary" disabled={busy}>{busy ? "Saving…" : "Save profile"}</button>
          {saved && <span className="c-present small">Saved</span>}
        </div>
      </form>
    </section>
  );
}
