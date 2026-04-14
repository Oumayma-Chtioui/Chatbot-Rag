import { useState, useEffect } from "react";
import ClientLogin from "./ClientLogin";
import ClientDashboard from "./ClientDashboard";
import ClientDocuments from "./ClientDocuments";
import ClientWidget from "./ClientWidget";
import ClientAnalytics from "./ClientAnalytics";
import "./client-style.css";

export type ClientPage = "dashboard" | "documents" | "widget" | "analytics";

export interface ClientUser {
  id: number;
  name: string;
  email: string;
  role: string;
}

export interface Bot {
  id: string;
  name: string;
  allowed_origin: string | null;
}

export default function ClientApp() {
  const [authed, setAuthed] = useState(!!localStorage.getItem("client_token"));
  const [user, setUser] = useState<ClientUser | null>(() => {
    try { return JSON.parse(localStorage.getItem("client_user") || "null"); }
    catch { return null; }
  });
  const [page, setPage] = useState<ClientPage>("dashboard");
  const [bot, setBot] = useState<Bot | null>(() => {
    try { return JSON.parse(localStorage.getItem("client_bot") || "null"); }
    catch { return null; }
  });

  const handleLogin = (userData: ClientUser, token: string, botData: Bot) => {
    localStorage.setItem("client_token", token);
    localStorage.setItem("client_user", JSON.stringify(userData));
    localStorage.setItem("client_bot", JSON.stringify(botData));
    setUser(userData);
    setBot(botData);
    setAuthed(true);
  };

  const handleLogout = () => {
    localStorage.removeItem("client_token");
    localStorage.removeItem("client_user");
    localStorage.removeItem("client_bot");
    setAuthed(false);
    setUser(null);
    setBot(null);
  };

  if (!authed) return <ClientLogin onLogin={handleLogin} />;

  return (
    <div className="cl-layout">
      <aside className="cl-sidebar">
        <div className="cl-brand">
          <span className="cl-brand-icon">✦</span>
          <span className="cl-brand-name">NovaMind</span>
        </div>

        <nav className="cl-nav">
          {([
            ["dashboard",  "▦", "Dashboard"],
            ["documents",  "◈", "Documents"],
            ["widget",     "◎", "Widget"],
            ["analytics",  "◉", "Analytics"],
          ] as [ClientPage, string, string][]).map(([p, icon, label]) => (
            <button
              key={p}
              className={`cl-nav-item ${page === p ? "active" : ""}`}
              onClick={() => setPage(p)}
            >
              <span className="cl-nav-icon">{icon}</span>
              {label}
            </button>
          ))}
        </nav>

        <div className="cl-sidebar-footer">
          <div className="cl-user-info">
            <div className="cl-avatar">{user?.name?.charAt(0).toUpperCase()}</div>
            <div>
              <div className="cl-user-name">{user?.name}</div>
              <div className="cl-user-role">Client</div>
            </div>
          </div>
          <button className="cl-logout" onClick={handleLogout}>Sign out</button>
        </div>
      </aside>

      <main className="cl-main">
        {page === "dashboard"  && <ClientDashboard bot={bot} user={user} />}
        {page === "documents"  && <ClientDocuments bot={bot} />}
        {page === "widget"     && <ClientWidget bot={bot} setBot={setBot} user={user} />}
        {page === "analytics"  && <ClientAnalytics bot={bot} />}
      </main>
    </div>
  );
}
