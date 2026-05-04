// Frontend/src/AdminLogin.tsx
import { useState, ChangeEvent } from "react";
import * as api from "./api";

interface Props {
  onLogin: (name: string) => void;
}

export default function AdminLogin({ onLogin }: Props) {
  const [email, setEmail]       = useState("");
  const [password, setPassword] = useState("");
  const [error, setError]       = useState<string | null>(null);
  const [loading, setLoading]   = useState(false);

  const handleSubmit = async () => {
    setError(null);
    if (!email || !password) {
      setError("Please enter both email and password.");
      return;
    }
    setLoading(true);
    try {
      const result = await api.adminLogin(email, password);
      localStorage.setItem("admin_token", result.access_token);
      localStorage.setItem("admin_user", JSON.stringify({ name: result.name, email: result.email }));
      onLogin(result.name);
    } catch (err: any) {
      setError(err.message || "Admin login failed.");
    } finally {
      setLoading(false);
    }
  };

  return (
    <>
      <style>{`
        .adm-login-page {
          min-height: 100vh;
          display: flex;
          align-items: center;
          justify-content: center;
          background: var(--bg);
          font-family: 'DM Sans', sans-serif;
          padding: 24px;
        }

        .adm-card {
          width: 100%;
          max-width: 380px;
          background: var(--bg2);
          border: 1px solid var(--border);
          border-radius: 14px;
          padding: 36px 32px;
        }

        .adm-header {
          margin-bottom: 28px;
        }

        .adm-brand {
          display: flex;
          align-items: center;
          gap: 9px;
          margin-bottom: 16px;
        }

        .adm-brand-icon {
          width: 32px; height: 32px;
          background: var(--bg3);
          border: 1px solid var(--border2);
          border-radius: 8px;
          display: flex; align-items: center; justify-content: center;
          font-size: 14px;
          color: var(--text2);
        }

        .adm-brand-name {
          font-size: 14px;
          font-weight: 500;
          color: var(--text2);
          letter-spacing: -0.01em;
        }

        .adm-title {
          font-size: 20px;
          font-weight: 500;
          color: var(--text);
          margin: 0 0 4px;
          letter-spacing: -0.02em;
        }

        .adm-sub {
          font-size: 12px;
          color: var(--text3);
          margin: 0;
        }

        .adm-fields {
          display: flex;
          flex-direction: column;
          gap: 10px;
          margin-bottom: 4px;
        }

        .adm-input {
          width: 100%;
          padding: 10px 13px;
          background: var(--bg);
          border: 1px solid var(--border);
          border-radius: 8px;
          font-size: 13px;
          color: var(--text);
          font-family: 'DM Sans', sans-serif;
          outline: none;
          transition: border-color 0.15s, box-shadow 0.15s;
          box-sizing: border-box;
        }
        .adm-input::placeholder { color: var(--text3); }
        .adm-input:focus {
          border-color: var(--accent);
          box-shadow: 0 0 0 3px rgba(127,119,221,0.1);
        }

        .adm-error {
          font-size: 12px;
          color: var(--danger);
          padding: 8px 12px;
          background: rgba(216,90,48,0.08);
          border: 1px solid rgba(216,90,48,0.18);
          border-radius: 7px;
          margin-top: 2px;
        }

        .adm-submit {
          width: 100%;
          padding: 10px;
          margin-top: 14px;
          background: var(--bg3);
          border: 1px solid var(--border2);
          border-radius: 8px;
          color: var(--text);
          font-size: 13px;
          font-weight: 500;
          font-family: 'DM Sans', sans-serif;
          cursor: pointer;
          transition: background 0.15s, border-color 0.15s, color 0.15s;
        }
        .adm-submit:hover:not(:disabled) {
          background: var(--accent);
          border-color: var(--accent);
          color: #fff;
        }
        .adm-submit:disabled {
          opacity: 0.4;
          cursor: not-allowed;
        }

        .adm-footer {
          margin-top: 20px;
          padding-top: 16px;
          border-top: 1px solid var(--border);
          font-size: 11px;
          color: var(--text3);
          text-align: center;
        }
      `}</style>

      <div className="adm-login-page">
        <div className="adm-card">
          <div className="adm-header">
            <div className="adm-brand">
              <div className="adm-brand-icon">⚙️</div>
              <span className="adm-brand-name">NovaMind</span>
            </div>
            <h2 className="adm-title">Admin sign in</h2>
            <p className="adm-sub">Access analytics, billing, and bot management.</p>
          </div>

          <div className="adm-fields">
            <input
              className="adm-input"
              type="email"
              placeholder="admin@example.com"
              value={email}
              onChange={(e: ChangeEvent<HTMLInputElement>) => setEmail(e.target.value)}
              onKeyDown={(e) => e.key === "Enter" && handleSubmit()}
            />
            <input
              className="adm-input"
              type="password"
              placeholder="Password"
              value={password}
              onChange={(e: ChangeEvent<HTMLInputElement>) => setPassword(e.target.value)}
              onKeyDown={(e) => e.key === "Enter" && handleSubmit()}
            />
            {error && <div className="adm-error">{error}</div>}
          </div>

          <button className="adm-submit" onClick={handleSubmit} disabled={loading}>
            {loading ? "Signing in…" : "Sign in"}
          </button>

          <div className="adm-footer">Restricted access — authorised personnel only</div>
        </div>
      </div>
    </>
  );
}