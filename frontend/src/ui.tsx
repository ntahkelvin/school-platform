// Small building blocks used by many screens.
import { useEffect, useState, type ReactNode } from "react";
import type { NewLogin } from "./api";
import Icon from "./Icon";

export function Modal({ title, onClose, children }: { title: string; onClose: () => void; children: ReactNode }) {
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => e.key === "Escape" && onClose();
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [onClose]);
  return (
    <div className="overlay" onMouseDown={(e) => e.target === e.currentTarget && onClose()}>
      <div className="modal card" role="dialog" aria-modal="true" aria-label={title}>
        <div className="modal-head">
          <h2>{title}</h2>
          <IconButton icon="close" label="Close" onClick={onClose} />
        </div>
        {children}
      </div>
    </div>
  );
}

/** Shows a new person's login details once, so the school can pass them on. */
export function NewLoginNotice({ login, onDone }: { login: NewLogin; onDone: () => void }) {
  const [copied, setCopied] = useState(false);
  const text = `Login for ${login.name}\nUsername: ${login.username}\nPassword: ${login.password}`;
  return (
    <div className="notice">
      <strong>New login created for {login.name}</strong>
      <p className="small">Write this down or copy it now. The password won't be shown again.</p>
      <dl className="login-details">
        <dt>Username</dt>
        <dd>{login.username}</dd>
        <dt>Password</dt>
        <dd className="mono">{login.password}</dd>
      </dl>
      <div className="row">
        <button
          onClick={() => {
            navigator.clipboard?.writeText(text).then(() => setCopied(true), () => setCopied(false));
          }}
        >
          {copied ? "Copied" : "Copy details"}
        </button>
        <button className="primary" onClick={onDone}>
          Done
        </button>
      </div>
    </div>
  );
}

export function Field({ label, children, hint }: { label: string; children: ReactNode; hint?: string }) {
  return (
    <label>
      {label}
      {children}
      {hint && <span className="muted small">{hint}</span>}
    </label>
  );
}

export function Empty({ children, icon }: { children: ReactNode; icon?: string }) {
  return (
    <div className="empty muted">
      {icon && <span className="empty-icon"><Icon name={icon} size={22} /></span>}
      <span>{children}</span>
    </div>
  );
}

export function IconButton({ icon, label, onClick, danger = false }: {
  icon: string; label: string; onClick: () => void; danger?: boolean;
}) {
  return (
    <button type="button" className={`icon-button${danger ? " danger-hover" : ""}`} onClick={onClick} aria-label={label} title={label}>
      <Icon name={icon} size={17} />
    </button>
  );
}

/** Round initials badge for a person. */
export function Avatar({ name, size = 36 }: { name: string; size?: number }) {
  const parts = name.replace(/^(mr|mrs|ms|miss|dr|fr|rev|chief|prof)\.?\s+/i, "").split(/[\s,]+/).filter(Boolean);
  const text = ((parts[0]?.[0] ?? "") + (parts[1]?.[0] ?? "")).toUpperCase();
  return <span className="avatar" style={{ width: size, height: size, fontSize: size * 0.38 }} aria-hidden="true">{text}</span>;
}
