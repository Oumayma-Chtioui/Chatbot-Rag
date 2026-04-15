import { useState, ChangeEvent } from "react";
import * as api from "./api";

interface Props {
  onLogin: (name: string) => void;
}

export default function AdminLogin({ onLogin }: Props) {
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);

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
    <div className="auth-page" style={{ minHeight: "100vh" }}>
      <div className="auth-right" style={{ maxWidth: 420, margin: "auto" }}>
        <div className="cl-login-card" style={{ padding: 32 }}>
          <div className="cl-login-brand" style={{ marginBottom: 24 }}>
            <div className="logo-icon">⚙️</div>
            Admin Portal
          </div>
          <h2 style={{ marginBottom: 8 }}>Admin sign in</h2>
          <p className="cl-login-sub">Access system analytics, billing, and bot management.</p>

          <div className="cl-login-form">
            <input
              className="cl-input"
              type="email"
              placeholder="admin@example.com"
              value={email}
              onChange={(e: ChangeEvent<HTMLInputElement>) => setEmail(e.target.value)}
            />
            <input
              className="cl-input"
              type="password"
              placeholder="Password"
              value={password}
              onChange={(e: ChangeEvent<HTMLInputElement>) => setPassword(e.target.value)}
              onKeyDown={(e) => e.key === "Enter" && handleSubmit()}
            />
            {error && <div className="cl-error">{error}</div>}
            <button className="cl-btn-primary" onClick={handleSubmit} disabled={loading}>
              {loading ? "Signing in…" : "Sign in"}
            </button>
          </div>
        </div>
      </div>
    </div>
  );
}
