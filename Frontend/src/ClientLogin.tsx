// Frontend/src/ClientLogin.tsx
// Updated: login no longer auto-creates or fetches a bot.
// ClientApp handles multi-bot loading after authentication.

import { useState, ChangeEvent, FormEvent } from "react";
import { ClientUser } from "./ClientApp";

const API = "http://localhost:8000";

interface Props {
  onLogin: (user: ClientUser, token: string) => void;
}

export default function ClientLogin({ onLogin }: Props) {
  const [mode, setMode]         = useState<"login" | "register">("login");
  const [email, setEmail]       = useState("");
  const [password, setPassword] = useState("");
  const [name, setName]         = useState("");
  const [error, setError]       = useState<string | null>(null);
  const [loading, setLoading]   = useState(false);
  const [successMsg, setSuccessMsg] = useState("");

  const handleSubmit = async (e: FormEvent) => {
    e.preventDefault();
    setError(null);
    setLoading(true);

    try {
      if (mode === "register") {
        const regRes = await fetch(`${API}/register`, {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ name, email, password, role: "client" }),
        });
        if (!regRes.ok) {
          const e = await regRes.json();
          throw new Error(e.detail || "Registration failed");
        }
        setMode("login");
        setSuccessMsg("Check your email to verify your account before signing in.");
        return;
      }

      // Login
      const loginRes = await fetch(`${API}/login`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ email, password }),
      });
      if (!loginRes.ok) {
        const e = await loginRes.json();
        throw new Error(e.detail || "Login failed");
      }
      const { access_token, user } = await loginRes.json();

      // Pass token + user up — ClientApp will load all bots itself
      onLogin(user, access_token);

    } catch (err: any) {
      setError(err.message);
    } finally {
      setLoading(false);
    }
  };

  return (
    <div className="cl-login-page">
      <div className="cl-login-card">
        <div className="cl-login-brand">
          <span className="cl-brand-icon" style={{ fontSize: 20 }}>✦</span>
          <span className="cl-brand-name" style={{ fontSize: 16, fontWeight: 600 }}>NovaMind</span>
        </div>
        <p className="cl-login-sub">Client Portal — manage your chatbots</p>

        <div className="cl-login-tabs">
          <button
            className={mode === "login" ? "active" : ""}
            onClick={() => { setMode("login"); setSuccessMsg(""); setError(null); }}
          >
            Sign in
          </button>
          <button
            className={mode === "register" ? "active" : ""}
            onClick={() => { setMode("register"); setSuccessMsg(""); setError(null); }}
          >
            Register
          </button>
        </div>

        <form onSubmit={handleSubmit} className="cl-login-form">
          {mode === "register" && (
            <input
              className="cl-input"
              placeholder="Your name"
              value={name}
              onChange={(e: ChangeEvent<HTMLInputElement>) => setName(e.target.value)}
              required
            />
          )}
          <input
            className="cl-input"
            type="email"
            placeholder="Email"
            value={email}
            onChange={(e: ChangeEvent<HTMLInputElement>) => setEmail(e.target.value)}
            required
          />
          <input
            className="cl-input"
            type="password"
            placeholder="Password"
            value={password}
            onChange={(e: ChangeEvent<HTMLInputElement>) => setPassword(e.target.value)}
            required
          />

          {successMsg && (
            <div style={{
              fontSize: 12, padding: "8px 12px", borderRadius: 6,
              background: "rgba(29,158,117,0.08)",
              border: "1px solid rgba(29,158,117,0.2)",
              color: "var(--success)",
            }}>
              {successMsg}
            </div>
          )}
          {error && <div className="cl-error">{error}</div>}

          <button className="cl-btn-primary" type="submit" disabled={loading}>
            {loading
              ? "Please wait…"
              : mode === "login" ? "Sign in" : "Create account"}
          </button>
        </form>
      </div>
    </div>
  );
}