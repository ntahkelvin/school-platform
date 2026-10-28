import type { ReactNode } from "react";
import type { Me } from "./api";

export interface Crumb {
  label: string;
  href?: string;
}

export default function Layout({
  me,
  onLogout,
  crumbs,
  children,
}: {
  me: Me;
  onLogout: () => void;
  crumbs: Crumb[];
  children: ReactNode;
}) {
  return (
    <div className="page">
      <header className="topbar">
        <a className="brand" href="#/">
          School Platform
        </a>
        <div className="topbar-right">
          <span className="muted hide-small">{me.full_name}</span>
          <button onClick={onLogout}>Log out</button>
        </div>
      </header>
      <main className="content">
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
