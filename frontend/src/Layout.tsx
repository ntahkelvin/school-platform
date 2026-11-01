import { useEffect, useRef, useState, type ReactNode } from "react";
import type { Me } from "./api";
import Icon from "./Icon";
import { dismissFailures, flushOutbox, useSyncStatus } from "./offline";
import { rightsApi, stopSeeAs, type Notice } from "./rightsApi";

export interface Crumb {
  label: string;
  href?: string;
}

export default function Layout({
  me,
  onLogout,
  crumbs,
  children,
  wide = false,
}: {
  me: Me;
  onLogout: () => void;
  crumbs: Crumb[];
  children: ReactNode;
  wide?: boolean;
}) {
  const sync = useSyncStatus();
  return (
    <div className="page">
      <header className="topbar">
        <a className="brand" href="#/">
          School Platform
        </a>
        <div className="topbar-right">
          {!sync.online && <span className="sync-pill offline">Offline</span>}
          {sync.pending.length > 0 && (
            <button className="sync-pill waiting" onClick={() => void flushOutbox()} title={sync.pending.map((p) => p.label).join("\n")}>
              {sync.syncing ? "Sending…" : `${sync.pending.length} to send`}
            </button>
          )}
          {!me.acting && <Bell />}
          <span className="muted hide-small">{me.full_name}</span>
          <button onClick={onLogout}>{me.acting ? "Stop seeing as" : "Log out"}</button>
        </div>
      </header>
      {me.acting && (
        <div className="see-as-bar">
          <Icon name="eye" size={18} />
          <span>You are seeing the platform <b>as {me.full_name}</b>. Nothing can be changed and private records stay hidden.</span>
          <button onClick={() => void stopSeeAs()}>Stop and go back to {me.acting.by}</button>
        </div>
      )}
      {sync.failed.length > 0 && (
        <div className="banner banner-error">
          <div>
            {sync.failed.map((f, i) => (
              <p key={i}>
                <strong>Couldn't save {f.label}:</strong> {f.message}
              </p>
            ))}
          </div>
          <button className="ghost" onClick={dismissFailures}>Dismiss</button>
        </div>
      )}
      <main className={wide ? "content wide" : "content"}>
        {crumbs.length > 0 && (
          <nav className="crumbs" aria-label="Breadcrumb">
            {crumbs.map((c, i) => (
              <span key={i}>
                {i > 0 && <span className="sep">/</span>}
                {c.href ? <a href={c.href}>{c.label}</a> : <span>{c.label}</span>}
              </span>
            ))}
          </nav>
        )}
        {children}
      </main>
    </div>
  );
}

function ago(at: string): string {
  const m = Math.round((Date.now() - new Date(at).getTime()) / 60000);
  if (m < 1) return "just now";
  if (m < 60) return `${m} min ago`;
  const h = Math.round(m / 60);
  if (h < 24) return `${h} h ago`;
  return new Date(at).toLocaleDateString("en-GB", { day: "numeric", month: "short" });
}

// The bell: requests for private records, 'see as', password resets and other things the person should know.
function Bell() {
  const [data, setData] = useState<{ unread: number; items: Notice[] }>({ unread: 0, items: [] });
  const [open, setOpen] = useState(false);
  const box = useRef<HTMLDivElement>(null);
  useEffect(() => {
    const load = () => rightsApi.notices().then(setData).catch(() => {});
    load();
    const t = window.setInterval(load, 60000);
    return () => window.clearInterval(t);
  }, []);
  useEffect(() => {
    if (!open) return;
    const off = (e: MouseEvent) => { if (box.current && !box.current.contains(e.target as Node)) setOpen(false); };
    document.addEventListener("mousedown", off);
    return () => document.removeEventListener("mousedown", off);
  }, [open]);
  const toggle = () => {
    setOpen(!open);
    if (!open && data.unread) rightsApi.readAll().then(() => setData((d) => ({ ...d, unread: 0 }))).catch(() => {});
  };
  return (
    <div className="bell" ref={box}>
      <button className="icon-button bell-button" aria-label={`Notices${data.unread ? `, ${data.unread} new` : ""}`} onClick={toggle}>
        <Icon name="bell" size={18} />{data.unread > 0 && <b className="bell-count">{data.unread > 9 ? "9+" : data.unread}</b>}
      </button>
      {open && (
        <div className="bell-panel" role="dialog" aria-label="Notices">
          <h3>Notices</h3>
          {data.items.length === 0 ? <p className="muted small">Nothing yet.</p> : (
            <ul>
              {data.items.map((n) => (
                <li key={n.id} className={n.read ? "" : "new"}>
                  <span className={`bell-icon k-${n.kind}`}><Icon name={n.icon} size={15} /></span>
                  <span className="grow">{n.link ? <a href={n.link} onClick={() => setOpen(false)}>{n.text}</a> : n.text}<small>{ago(n.at)}</small></span>
                </li>
              ))}
            </ul>
          )}
        </div>
      )}
    </div>
  );
}
