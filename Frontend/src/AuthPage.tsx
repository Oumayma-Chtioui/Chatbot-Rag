import { useState, ChangeEvent } from "react";
import { AuthPageProps } from './types.tsx';

const API = "http://localhost:8000";

export default function AuthPage({ onLogin }: AuthPageProps) {
  const [tab, setTab] = useState<"login" | "signup">("login");
  const [form, setForm] = useState({ name: "", email: "", password: "" });
  const [error, setError] = useState<string>("");
  const [loading, setLoading] = useState<boolean>(false);



  const handleSubmit = async (): Promise<void> => {
    setError("");

    if (!form.email || !form.password) {
      setError("Please fill in all fields.");
      return;
    }
    if (tab === "signup" && !form.name) {
      setError("Please enter your name.");
      return;
    }

    setLoading(true);
    try {
      const endpoint = tab === "login" ? "/login" : "/register";
      const body = tab === "login"
        ? { email: form.email, password: form.password }
        : { name: form.name, email: form.email, password: form.password };

      const res = await fetch(`${API}${endpoint}`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(body),
      });

      const data = await res.json();

      if (!res.ok) {
        setError(data.detail || "Something went wrong.");
        return;
      }

      // Store token and user info
      localStorage.setItem("token", data.access_token);
      localStorage.setItem("user", JSON.stringify({ name: data.name, email: data.email, is_admin: data.is_admin }));

      onLogin(data.name, data.is_admin); // Pass admin flag to parent
    } catch (err) {
      setError("Could not connect to the server. Is the backend running?");
    } finally {
      setLoading(false);
    }
  };

  return (
    <div className="auth-page">
      <div className="auth-left">
        <div className="logo">
          <div className="logo-icon">✦</div>
          NovaMind
        </div>
        <div className="auth-hero">
          <h1>Your documents,<br />now conversational.</h1>
          <p>Upload PDFs, paste URLs, or drop images — then ask anything. Powered by local AI, your data never leaves your machine.</p>
          <div className="feature-pills">
            
          </div>
        </div>
        <div style={{ color: "var(--text3)", fontSize: 12 }}>© 2026 NovaMind · Local AI</div>
      </div>

      <div className="auth-right">
        <div className="auth-card animate-in">
          <h2>{tab === "login" ? "Welcome back" : "Create account"}</h2>
          <p className="subtitle">
            {tab === "login" ? "Sign in to your workspace" : "Start chatting with your documents"}
          </p>

          <div className="tab-switcher">
            <button className={`tab-btn ${tab === "login" ? "active" : ""}`} onClick={() => { setTab("login"); setError(""); }}>
              Sign in
            </button>
            <button className={`tab-btn ${tab === "signup" ? "active" : ""}`} onClick={() => { setTab("signup"); setError(""); }}>
              Sign up
            </button>
          </div>

          {tab === "signup" && (
            <div className="form-group">
              <label className="form-label">Full Name</label>
              <input
                className="form-input"
                placeholder="Alex Johnson"
                value={form.name}
                onChange={(e: ChangeEvent<HTMLInputElement>) => setForm({ ...form, name: e.target.value })}
              />
            </div>
          )}

          <div className="form-group">
            <label className="form-label">Email</label>
            <input
              className="form-input"
              type="email"
              placeholder="you@example.com"
              value={form.email}
              onChange={(e: ChangeEvent<HTMLInputElement>) => setForm({ ...form, email: e.target.value })}
              onKeyDown={(e) => e.key === "Enter" && handleSubmit()}
            />
          </div>

          <div className="form-group">
            <label className="form-label">Password</label>
            <input
              className="form-input"
              type="password"
              placeholder="••••••••"
              value={form.password}
              onChange={(e: ChangeEvent<HTMLInputElement>) => setForm({ ...form, password: e.target.value })}
              onKeyDown={(e) => e.key === "Enter" && handleSubmit()}
            />
          </div>

          {error && (
            <div style={{ color: "var(--danger)", fontSize: 13, marginBottom: 14, padding: "10px 14px", background: "#ff557211", borderRadius: 8, border: "1px solid #ff557233" }}>
              {error}
            </div>
          )}

          <button className="btn-primary" onClick={handleSubmit} disabled={loading} style={{ marginBottom: 16 }}>
            {loading ? "Please wait…" : tab === "login" ? "Sign in →" : "Create account →"}
          </button>

          <div className="divider">or continue with</div>

          <button className="btn-secondary" disabled>
            <span>🌐</span> Continue with Google
          </button>
        </div>
      </div>
    </div>
  );
}