import { useState, type FormEvent } from "react";
import { api, type Me } from "./api";

export default function Login({ onLoggedIn }: { onLoggedIn: (me: Me) => void }) {
  const [identifier, setIdentifier] = useState("");
  const [password, setPassword] = useState("");
  const [error, setError] = useState("");
  const [busy, setBusy] = useState(false);

  async function submit(e: FormEvent) {
    e.preventDefault();
    if (!identifier.trim() || !password) {
      setError("Enter your email or phone number and your password.");
      return;
    }
    setBusy(true);
    setError("");
    try {
      await api.login(identifier.trim(), password);
      onLoggedIn(await api.me());
    } catch (err) {
      setError(err instanceof Error ? err.message : "Could not log in.");
    } finally {
      setBusy(false);
    }
  }

  return (
    <main className="center">
      <form className="card login" onSubmit={submit} noValidate>
        <div className="brand">School Platform</div>
        <h1>Log in</h1>
        <label>
          Email or phone number
          <input value={identifier} onChange={(e) => setIdentifier(e.target.value)} autoComplete="username" />
        </label>
        <label>
          Password
          <input
            type="password"
            value={password}
            onChange={(e) => setPassword(e.target.value)}
            autoComplete="current-password"
          />
        </label>
        {error && <p className="error">{error}</p>}
        <button className="primary" disabled={busy}>
          {busy ? "Logging in…" : "Log in"}
        </button>
      </form>
    </main>
  );
}
