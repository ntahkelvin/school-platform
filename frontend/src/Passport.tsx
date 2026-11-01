// A staff member's growth passport: teaching shape, training, recognition, goals, strengths, insights and their story so far.
import { useCallback, useEffect, useState, type CSSProperties } from "react";
import { errorText, type Me } from "./api";
import { niceDate } from "./dayApi";
import { APP_STATUS, BADGE_LOOK, grow, INSIGHT_HUE, type Passport } from "./growthApi";
import { KudosItem, LevelChip, Radar, Ring, Spark, useBusy } from "./GrowthBits";
import { AppraisalModal, KudosForm, MentoringForm, MentoringView, ObservationForm, useMeta, usePeople } from "./GrowthForms";
import Icon from "./Icon";
import Layout from "./Layout";
import { href } from "./router";
import { Avatar, Empty, Glyph, hue } from "./ui";

const TL_LOOK: Record<string, { icon: string; hue: "indigo" | "teal" | "pink" | "violet" | "amber" }> = {
  observation: { icon: "eye", hue: "indigo" }, cpd: { icon: "graduation-cap", hue: "teal" }, kudos: { icon: "heart", hue: "pink" },
  appraisal: { icon: "clipboard-list", hue: "violet" }, mentoring: { icon: "handshake", hue: "amber" },
};

export default function PassportPage({ me, onLogout, schoolId, userId }: { me: Me; onLogout: () => void; schoolId: string; userId: string }) {
  const [p, setP] = useState<Passport | null>(null);
  const [error, setError] = useState("");
  const [canObserve, setCanObserve] = useState(false);
  const [modal, setModal] = useState<null | "kudos" | "observe" | "appraisal" | { mentor?: string; focus?: string } | { view: string }>(null);
  const { people } = usePeople(schoolId);
  const meta = useMeta();
  const isOwner = me.memberships.some((m) => m.role === "owner");
  const load = useCallback(() => { grow.passport(schoolId, userId).then(setP).catch((e) => setError(errorText(e))); }, [schoolId, userId]);
  useEffect(load, [load]);
  useEffect(() => { if (isOwner) setCanObserve(true); else grow.me(schoolId).then((m) => setCanObserve(m.can_observe)).catch(() => {}); }, [schoolId, isOwner]);
  const runs = isOwner || me.memberships.some((m) => m.school_id === schoolId && ["head", "vice_principal", "it_admin"].includes(m.role));
  const crumbs = [{ label: "Home", href: "#/" }, ...(runs ? [{ label: "Growth", href: href({ page: "school", id: schoolId, tab: "growth" }) }] : []), { label: p?.person.name ?? "Growth passport" }];
  if (error) return <Layout wide me={me} onLogout={onLogout} crumbs={crumbs}><p className="error">{error}</p></Layout>;
  if (!p) return <Layout wide me={me} onLogout={onLogout} crumbs={crumbs}><p className="muted">Loading…</p></Layout>;
  const avgAll = Object.values(p.averages);
  const teach = avgAll.length ? avgAll.reduce((a, b) => a + b, 0) / avgAll.length : null;
  const first = p.person.name.replace(/^(mr|mrs|ms|miss|dr|rev fr|rev|fr|sr|br)\.?\s+/i, "").split(" ")[0];
  return (
    <Layout wide me={me} onLogout={onLogout} crumbs={crumbs}>
      <div className="passport" style={{ "--hue": "var(--h-lime)" } as CSSProperties}>
        <header className="passport-hero">
          <span className="passport-pattern" aria-hidden="true" />
          <span className="passport-photo">{p.person.photo ? <img src={p.person.photo} alt="" /> : <Avatar name={p.person.name} size={112} />}</span>
          <div className="passport-id">
            <span className="passport-tag"><Icon name="growth" size={14} />Growth passport</span>
            <h1>{p.person.name}</h1>
            <p>{p.person.job_title ?? "Staff"}{p.person.department_name && ` · ${p.person.department_name}`}{p.person.unit_name && `, ${p.person.unit_name}`}</p>
            <ul className="passport-facts">
              {p.person.years != null && <li><Icon name="calendar-days" size={14} />{p.person.years < 1 ? "New this year" : `${Math.floor(p.person.years)} year${Math.floor(p.person.years) === 1 ? "" : "s"} here`}</li>}
              {p.person.staff_no && <li><Icon name="clipboard" size={14} />{p.person.staff_no}</li>}
              {Object.entries(p.kudos.badges).sort((a, b) => b[1] - a[1]).slice(0, 4).map(([b, n]) => <li key={b} title={b}>{BADGE_LOOK[b]?.emoji} ×{n}</li>)}
            </ul>
          </div>
          <div className="passport-actions">
            {!p.is_me && <button className="on-band with-icon" onClick={() => setModal("kudos")}><Icon name="heart" size={16} />Give kudos</button>}
            {!p.is_me && canObserve && p.person.teaching && <button className="on-band with-icon" onClick={() => setModal("observe")}><Icon name="eye" size={16} />Observe</button>}
            {p.appraisal && <button className="on-band with-icon" onClick={() => setModal("appraisal")}><Icon name="clipboard-list" size={16} />Appraisal</button>}
          </div>
        </header>

        <div className="stat-strip passport-stats">
          <div className="stat-tile" style={hue("indigo")}>
            <Ring value={teach ?? 0} max={4} size={56} stroke={7} label={teach != null ? teach.toFixed(1) : "–"} />
            <div className="stat-text"><strong>{teach != null ? <LevelChip v={Math.round(teach * 10) / 10} label /> : "Not yet"}</strong><span>Teaching</span><span className="stat-note">{p.observations} observation{p.observations === 1 ? "" : "s"}</span></div>
          </div>
          <div className="stat-tile" style={hue("teal")}>
            <Ring value={p.cpd.hours} max={p.cpd.target} size={56} stroke={7} label={`${Math.round(p.cpd.hours)}`} />
            <div className="stat-text"><strong>{p.cpd.hours}<small> / {p.cpd.target} h</small></strong><span>Training this year</span><span className="stat-note">{p.cpd.records} record{p.cpd.records === 1 ? "" : "s"} in all</span></div>
          </div>
          <div className="stat-tile" style={hue(p.attendance.rate == null ? "slate" : p.attendance.rate >= 95 ? "green" : p.attendance.rate >= 90 ? "amber" : "red")}>
            <Ring value={p.attendance.rate ?? 0} max={100} size={56} stroke={7} label={p.attendance.rate != null ? `${p.attendance.rate}` : "–"} />
            <div className="stat-text"><strong>{p.attendance.rate != null ? `${p.attendance.rate}%` : "–"}</strong><span>Attendance</span><span className="stat-note">last 2 months · {p.attendance.late} late</span></div>
          </div>
          <div className="stat-tile" style={hue("pink")}>
            <Glyph icon="heart" hue="pink" size={44} />
            <div className="stat-text"><strong>{p.kudos.received}</strong><span>Kudos received</span><span className="stat-note">{p.kudos.given} given to others</span></div>
          </div>
          <div className="stat-tile" style={hue(p.workload.points > p.workload_limit ? "red" : "sky")}>
            <Glyph icon="scale" hue={p.workload.points > p.workload_limit ? "red" : "sky"} size={44} />
            <div className="stat-text"><strong>{p.workload.points}<small> / {p.workload_limit}</small></strong><span>Workload points</span>
              <span className="stat-note">{[p.workload.classes && `${p.workload.classes} classes`, p.workload.duties && `${p.workload.duties} duties`, p.workload.lead && "leads a team"].filter(Boolean).join(" · ") || "—"}</span></div>
          </div>
        </div>

        <div className="passport-grid">
          <section className="card g-card" style={hue("indigo")}>
            <h3 className="with-glyph"><Glyph icon="eye" hue="indigo" size={32} />Teaching shape</h3>
            {Object.keys(p.averages).length ? (
              <>
                <Radar criteria={p.criteria} values={p.averages} compare={p.school_averages} size={340} />
                <p className="radar-key"><span className="me" />{p.is_me ? "Me" : first}<span className="school" />School average</p>
              </>
            ) : <Empty icon="eye">No shared observations yet.</Empty>}
            {p.trend.length > 1 && (
              <div className="trend-box"><span className="small muted">Average of each observation, oldest to newest</span><Spark points={p.trend.map((t) => t.average)} width={300} /></div>
            )}
          </section>
          <section className="card g-card" style={hue("violet")}>
            <h3 className="with-glyph"><Glyph icon="sparkle" hue="violet" size={32} />{p.is_me ? "What stands out" : `What stands out for ${first}`}<span className="ai-tag">Offline insights</span></h3>
            <ul className="insights">
              {p.insights.map((t, i) => (
                <li key={i} className={`insight i-${t.kind}`} style={hue(INSIGHT_HUE[t.kind])}>
                  <Glyph icon={t.icon} hue={INSIGHT_HUE[t.kind]} size={34} />
                  <div>
                    <p>{t.text}</p>
                    {t.matches && t.matches.length > 0 && (
                      <div className="insight-people"><span className="small muted">Strong colleagues in this area:</span>
                        {t.matches.map((m) => (
                          <span key={m.user_id} className="mini-person">
                            <Avatar name={m.name} size={22} /><a href={href({ page: "passport", school: schoolId, id: m.user_id })}>{m.name}</a><b>{m.score.toFixed(1)}</b>
                            {runs && <button className="text-link small" onClick={() => setModal({ mentor: m.user_id, focus: meta?.criteria.find((c) => c.key === t.area)?.label })}>Pair up</button>}
                          </span>
                        ))}
                      </div>
                    )}
                  </div>
                </li>
              ))}
            </ul>
          </section>

          <section className="card g-card" style={hue("amber")}>
            <h3 className="with-glyph"><Glyph icon="target" hue="amber" size={32} />Goals{p.appraisal ? ` ${p.appraisal.period_label}` : ""}</h3>
            {!p.appraisal ? <Empty icon="target">No appraisal yet.</Empty> : (
              <>
                <span className="hue-chip" style={hue(APP_STATUS[p.appraisal.status]?.hue ?? "slate")}>{APP_STATUS[p.appraisal.status]?.label}</span>
                {p.appraisal.overall != null && <p className="obs-avg">Overall <LevelChip v={p.appraisal.overall} /></p>}
                {p.appraisal.goals.length === 0 ? <p className="muted small">No goals set yet.</p> : (
                  <ul className="goal-list">
                    {p.appraisal.goals.map((g, i) => (
                      <li key={i} style={hue(g.progress >= 100 ? "green" : "amber")}>
                        <Ring value={g.progress} max={100} size={40} stroke={5} label={<small>{g.progress}</small>} />
                        <span><strong>{g.title}</strong>{g.measure && <span className="muted small">{g.measure}</span>}</span>
                      </li>
                    ))}
                  </ul>
                )}
                <button className="text-link" onClick={() => setModal("appraisal")}>Open appraisal →</button>
              </>
            )}
          </section>

          <StrengthsCard p={p} schoolId={schoolId} onChanged={load} />

          <section className="card g-card" style={hue("pink")}>
            <h3 className="with-glyph"><Glyph icon="heart" hue="pink" size={32} />Kudos</h3>
            {p.kudos.recent.length === 0 ? <Empty icon="heart">No kudos yet{p.is_me ? "" : `. Be the first to thank ${first}!`}</Empty>
              : <div className="kudos-stack">{p.kudos.recent.map((k) => <KudosItem key={k.id} k={k} compact onChanged={load} />)}</div>}
          </section>

          <section className="card g-card" style={hue("orange")}>
            <h3 className="with-glyph"><Glyph icon="handshake" hue="orange" size={32} />Mentoring</h3>
            {p.mentoring.length === 0 ? <Empty icon="handshake">Not in a mentoring pair right now.</Empty> : (
              <ul className="strength-people">
                {p.mentoring.map((m) => (
                  <li key={m.id}><button className="mentor-line" onClick={() => setModal({ view: m.id })}>
                    <Avatar name={m.mentor.user_id === p.person.user_id ? m.mentee.name : m.mentor.name} size={32} />
                    <span><strong>{m.mentor.user_id === p.person.user_id ? `Mentoring ${m.mentee.name}` : `Mentored by ${m.mentor.name}`}</strong><span className="muted small">{m.focus} · {m.meetings.length} meetings</span></span>
                  </button></li>
                ))}
              </ul>
            )}
          </section>

          <section className="card g-card wide" style={hue("lime")}>
            <h3 className="with-glyph"><Glyph icon="history" hue="lime" size={32} />The story so far</h3>
            {p.timeline.length === 0 ? <Empty icon="history">Nothing yet. Observations, training, kudos and appraisals will build this story.</Empty> : (
              <ol className="timeline">
                {p.timeline.map((t, i) => { const l = TL_LOOK[t.kind] ?? TL_LOOK.cpd; return (
                  <li key={i} style={hue(l.hue)}>
                    <span className="tl-dot"><Icon name={l.icon} size={14} /></span>
                    <span className="tl-date">{niceDate(t.date, { day: "numeric", month: "short", year: "2-digit" })}</span>
                    <span className="tl-text"><strong>{t.title}</strong>{t.detail && <span className="muted small">{t.detail}</span>}</span>
                  </li>); })}
              </ol>
            )}
          </section>
        </div>
      </div>
      {modal === "kudos" && <KudosForm schoolId={schoolId} people={people} me={me.id} to={userId} onClose={() => setModal(null)} onDone={() => { setModal(null); load(); }} />}
      {modal === "observe" && <ObservationForm schoolId={schoolId} people={people} teacherId={userId} onClose={() => setModal(null)} onDone={() => { setModal(null); load(); }} />}
      {modal === "appraisal" && p.appraisal && <AppraisalModal id={p.appraisal.id} onClose={() => setModal(null)} onChanged={load} />}
      {modal && typeof modal === "object" && "mentor" in modal && <MentoringForm schoolId={schoolId} people={people} mentee={userId} mentor={modal.mentor} focus={modal.focus}
        onClose={() => setModal(null)} onDone={() => { setModal(null); load(); }} />}
      {modal && typeof modal === "object" && "view" in modal && (() => { const m = p.mentoring.find((x) => x.id === modal.view); return m ? <MentoringView m={m} onClose={() => setModal(null)} onChanged={() => load()} /> : null; })()}
    </Layout>
  );
}

function StrengthsCard({ p, schoolId, onChanged }: { p: Passport; schoolId: string; onChanged: () => void }) {
  const meta = useMeta();
  const [adding, setAdding] = useState("");
  const [busy, error, run] = useBusy();
  const all = meta ? Object.values(meta.skills).flat() : [];
  const have = new Set(p.strengths.map((s) => s.skill));
  return (
    <section className="card g-card" style={hue("cyan")}>
      <h3 className="with-glyph"><Glyph icon="star" hue="cyan" size={32} />Strengths</h3>
      {p.strengths.length === 0 && <p className="muted small">{p.is_me ? "What are you good at? Add your strengths so the school knows who to ask." : "No strengths listed yet."}</p>}
      <div className="strength-chips">
        {p.strengths.map((s) => (
          <span key={s.id} className={`strength-chip${s.endorsed ? " on" : ""}`}>
            {s.skill}
            {p.is_me ? (
              <>
                <b title="Endorsements">{s.endorsements}</b>
                <button className="chip-x" aria-label={`Remove ${s.skill}`} onClick={() => run(async () => { await grow.removeStrength(s.id); onChanged(); })}><Icon name="close" size={12} /></button>
              </>
            ) : (
              <button className="endorse" title={s.endorsed ? "Remove endorsement" : "Endorse: I can vouch for this"} onClick={() => run(async () => { await grow.endorse(s.id); onChanged(); })}>
                <Icon name="thumbs-up" size={12} />{s.endorsements}
              </button>
            )}
          </span>
        ))}
      </div>
      {p.is_me && (
        <form className="row" onSubmit={(e) => { e.preventDefault(); if (adding.trim()) run(async () => { await grow.addStrength(schoolId, adding.trim()); setAdding(""); onChanged(); }); }}>
          <input list="skill-list" value={adding} onChange={(e) => setAdding(e.target.value)} placeholder="e.g. Debate, Football, Hausa, ICT…" />
          <datalist id="skill-list">{all.filter((s) => !have.has(s)).map((s) => <option key={s} value={s} />)}</datalist>
          <button className="primary" disabled={busy || !adding.trim()}>Add</button>
        </form>
      )}
      {error && <p className="error">{error}</p>}
    </section>
  );
}
