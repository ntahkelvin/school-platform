// Small building blocks used by many screens.
import { useEffect, useState, type ReactNode } from "react";
import type { NewLogin } from "./api";

export function Modal({ title, onClose, children }: { title: string; onClose: () => void; children: ReactNode }) {
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => e.key === "Escape" && onClose();
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [onClose]);
  return (
    <div className="overlay" onMouseDown={(e) => e.target === e.currentTarget && onClose()}>
      <div className="modal card" role="dialog" aria-modal="true" aria-label={title}>
        <div className="card-head">
          <h2>{title}</h2>
          <button className="ghost" onClick={onClose} aria-label="Close">
            ✕
          </button>
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

export function Empty({ children }: { children: ReactNode }) {
  return <div className="empty muted">{children}</div>;
}
