// Small building blocks used by many screens.
import { useEffect, useState, type CSSProperties, type ReactNode } from "react";
import type { NewLogin } from "./api";
import Icon from "./Icon";
import { hueOf, type Hue } from "./look";

/** Style that sets the colour used by .glyph, .hue-* and friends. */
export function hue(h: Hue | string, colour?: string | null): CSSProperties {
  return { "--hue": colour || `var(--h-${h})` } as CSSProperties;
}

/** A coloured icon tile. Solid ones have a gradient; soft ones a light tint. */
export function Glyph({ icon, hue: h, colour, size = 40, soft = false }: {
  icon: string; hue: Hue | string; colour?: string | null; size?: number; soft?: boolean;
}) {
  return (
    <span className={`glyph${soft ? " soft" : ""}`} style={{ ...hue(h, colour), width: size, height: size, borderRadius: size * 0.3 }} aria-hidden="true">
      <Icon name={icon} size={Math.round(size * 0.5)} stroke={soft ? 2 : 2.1} />
    </span>
  );
}

/** A small figure with a coloured icon, e.g. "48 beds". */
export function Stat({ icon, hue: h, value, label, note }: {
  icon: string; hue: Hue; value: ReactNode; label: ReactNode; note?: ReactNode;
}) {
  return (
    <div className="stat-tile" style={hue(h)}>
      <Glyph icon={icon} hue={h} size={44} />
      <div className="stat-text">
        <strong>{value}</strong>
        <span>{label}</span>
        {note && <span className="stat-note">{note}</span>}
      </div>
    </div>
  );
}

export function Modal({ title, onClose, children, wide = false }: { title: string; onClose: () => void; children: ReactNode; wide?: boolean }) {
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => e.key === "Escape" && onClose();
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [onClose]);
  return (
    <div className="overlay" onMouseDown={(e) => e.target === e.currentTarget && onClose()}>
      <div className={`modal card${wide ? " modal-wide" : ""}`} role="dialog" aria-modal="true" aria-label={title}>
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

export function Field({ label, children, hint }: { label: ReactNode; children: ReactNode; hint?: string }) {
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
      {icon && <Glyph icon={icon} hue="slate" size={48} soft />}
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

/** Round initials badge for a person, in a colour that stays the same for that name. */
export function Avatar({ name, size = 36 }: { name: string; size?: number }) {
  const parts = name.replace(/^(mr|mrs|ms|miss|dr|fr|rev|chief|prof|sr|br)\.?\s+/i, "").split(/[\s,]+/).filter(Boolean);
  const text = ((parts[0]?.[0] ?? "") + (parts[1]?.[0] ?? "")).toUpperCase();
  return (
    <span className="avatar" style={{ ...hue(hueOf(name)), width: size, height: size, fontSize: size * 0.38 }} aria-hidden="true">
      {text}
    </span>
  );
}

/** +2348031234567 -> 0803 123 4567 (Nigerian numbers); anything else as it is. */
export function nicePhone(phone: string | null | undefined): string {
  if (!phone) return "";
  const m = /^\+234(\d{3})(\d{3})(\d{4})$/.exec(phone);
  return m ? `0${m[1]} ${m[2]} ${m[3]}` : phone;
}
