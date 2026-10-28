import type { ReactNode } from "react";
import type { Me } from "./api";
import { dismissFailures, flushOutbox, useSyncStatus } from "./offline";

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
          <span className="muted hide-small">{me.full_name}</span>
          <button onClick={onLogout}>Log out</button>
        </div>
      </header>
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
