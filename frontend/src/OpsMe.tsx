// Operations on the staff portal: report a problem, my desks, exit passes, report an incident.
import { useCallback, useEffect, useState } from "react";
import { PassesPanel } from "./GateDesk";
import { MyTickets, TicketForm } from "./Helpdesk";
import Icon from "./Icon";
import { IncidentForm } from "./Incidents";
import { ops, type MyOps } from "./opsApi";
import { href } from "./router";
import { Glyph, hue } from "./ui";

export function useMyOps(schoolId: string): [MyOps | null, () => void] {
  const [m, setM] = useState<MyOps | null>(null);
  const load = useCallback(() => { ops.me(schoolId).then(setM).catch(() => {}); }, [schoolId]);
  useEffect(load, [load]);
  return [m, load];
}

export function HelpCard({ schoolId }: { schoolId: string }) {
  const [m, reload] = useMyOps(schoolId);
  const [modal, setModal] = useState<null | "ticket" | "mine" | "incident" | "passes">(null);
  const [sent, setSent] = useState("");
  if (!m) return null;
  return (
    <section className="card editor portal-card help-card" style={hue("orange")}>
      <div className="card-head"><h2 className="with-glyph"><Glyph icon="wrench" hue="orange" size={34} />Something wrong?</h2></div>
      <div className="help-buttons">
        <button style={hue("orange")} onClick={() => setModal("ticket")}><Icon name="hammer" size={20} /><span><strong>Report a problem</strong><small>Broken fan, leaking tap, printer, store items…</small></span></button>
        <button style={hue("rose")} onClick={() => setModal("incident")}><Icon name="flame" size={20} /><span><strong>Report an incident</strong><small>Injury, fight, theft, bullying, intruder…</small></span></button>
        {m.can_request_pass && <button style={hue("teal")} onClick={() => setModal("passes")}><Icon name="clipboard" size={20} /><span><strong>Exit passes</strong>
          <small>{m.can_approve_pass ? `${m.passes_waiting} waiting for approval` : "Ask for a student to leave school"}</small></span>{m.passes_waiting > 0 && <b className="badge-count">{m.passes_waiting}</b>}</button>}
      </div>
      {sent && <p className="saved-note"><Icon name="check" size={15} />{sent}</p>}
      {(m.my_open > 0 || m.to_rate > 0) && (
        <button className="todo" style={hue(m.to_rate ? "green" : "sky")} onClick={() => setModal("mine")}>
          <Icon name={m.to_rate ? "star" : "inbox"} size={16} />{m.to_rate ? `${m.to_rate} job${m.to_rate > 1 ? "s" : ""} done: please check and rate` : `My requests (${m.my_open} open)`}<Icon name="chevron-right" size={16} />
        </button>
      )}
      {modal === "ticket" && <TicketForm schoolId={schoolId} onClose={() => setModal(null)} onDone={(t) => { setModal(null); setSent(`Sent as job #${t.number}. You'll see progress here.`); reload(); }} />}
      {modal === "mine" && <MyTickets schoolId={schoolId} onClose={() => { setModal(null); reload(); }} />}
      {modal === "incident" && <IncidentForm schoolId={schoolId} onClose={() => setModal(null)} onDone={() => { setModal(null); setSent("Incident reported. The principal can see it now."); }} />}
      {modal === "passes" && <PassesPanel schoolId={schoolId} canApprove={m.can_approve_pass} onClose={() => { setModal(null); reload(); }} />}
    </section>
  );
}

export function MyDeskCards({ schoolId }: { schoolId: string }) {
  const [m] = useMyOps(schoolId);
  if (!m || m.desks.length === 0) return null;
  return (
    <>
      {m.desks.map((d) => (
        <section key={d.key} className="card editor portal-card desk-portal" style={hue(d.hue)}>
          <div className="card-head"><h2 className="with-glyph"><Glyph icon={d.icon} hue={d.hue} size={34} />{d.label}</h2></div>
          {d.info ? (
            <>
              <p className="desk-big"><b>{d.info.big}</b>{d.info.line}</p>
              <p className="small desk-more">{d.info.more}</p>
              {d.info.alerts > 0 && <p className="small desk-alert"><Icon name="sparkle" size={13} />{d.info.alerts} thing{d.info.alerts > 1 ? "s" : ""} to look at</p>}
              {d.open > 0 && !["gate", "sickbay"].includes(d.key) && <p className="small">{d.open} open job{d.open > 1 ? "s" : ""} for your team</p>}
            </>
          ) : (
            <p className="desk-big"><b>{d.open}</b>open job{d.open === 1 ? "" : "s"} for your team</p>
          )}
          {m.assigned > 0 && !["gate", "sickbay"].includes(d.key) && <p className="small">{m.assigned} given to you</p>}
          <a className="button primary-link" href={href({ page: "desk", school: schoolId, desk: d.key })}><Icon name={d.icon} size={16} />Open the {d.key === "sickbay" ? "sick bay" : d.key === "gate" ? "gate desk" : "desk"}</a>
        </section>
      ))}
    </>
  );
}
