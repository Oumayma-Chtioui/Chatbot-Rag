import { useState, ChangeEvent, FormEvent } from "react";
import { ClientUser, Bot } from "./ClientApp";

const API = "http://localhost:8000";

interface Props {
  onLogin: (user: ClientUser, token: string, bot: Bot) => void;
}

export default function ClientLogin({ onLogin }: Props) {
  const [mode, setMode] = useState<"login" | "register">("login");
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [name, setName] = useState("");
  const [botName, setBotName] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);
  const [successMsg, setSuccessMsg] = useState("")
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
        // STOP HERE — show message, don't proceed to login
        setError(""); 
        setMode("login");
        // add a success state to show the message
        setSuccessMsg("Check your email to verify your account before signing in.");
        return;  // ← this is the key line, was missing
      }

      // 2. Login to get token
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

      // 3. Create or fetch bot
      const botsRes = await fetch(`${API}/widgets/bots`, {
        headers: { Authorization: `Bearer ${access_token}` },
      });
      const bots = await botsRes.json();

      let bot: Bot;
      if (bots.length > 0) {
        bot = bots[0];
      } else {
        const createRes = await fetch(`${API}/widgets/bots`, {
          method: "POST",
          headers: {
            "Content-Type": "application/json",
            Authorization: `Bearer ${access_token}`,
          },
          body: JSON.stringify({ name: botName || `${name}'s bot` }),
        });
        const created = await createRes.json();
        bot = { id: created.bot_id, name: created.name, allowed_origin: null };
      }

      onLogin(user, access_token, bot);
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
          <span className="cl-brand-icon">✦</span>
          <span className="cl-brand-name">NovaMind</span>
        </div>
        <p className="cl-login-sub">Client Portal</p>

        <div className="cl-login-tabs">
          <button
            className={mode === "login" ? "active" : ""}
            onClick={() => setMode("login")}
          >Sign in</button>
          <button
            className={mode === "register" ? "active" : ""}
            onClick={() => setMode("register")}
          >Register</button>
        </div>

        <form onSubmit={handleSubmit} className="cl-login-form">
          {mode === "register" && (
            <>
              <input
                className="cl-input"
                placeholder="Your name"
                value={name}
                onChange={(e: ChangeEvent<HTMLInputElement>) => setName(e.target.value)}
                required
              />
              <input
                className="cl-input"
                placeholder="Bot name (e.g. Support Assistant)"
                value={botName}
                onChange={(e: ChangeEvent<HTMLInputElement>) => setBotName(e.target.value)}
              />
            </>
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
          {error && <div className="cl-error">{error}</div>}
          <button className="cl-btn-primary" type="submit" disabled={loading}>
            {loading ? "Please wait..." : mode === "login" ? "Sign in" : "Create account"}
          </button>
        </form>
      </div>
    </div>
  );
}
