import { useState, useEffect, useCallback } from "react";
import ClientLogin from "./ClientLogin";
import ClientDashboard from "./ClientDashboard";
import ClientDocuments from "./ClientDocuments";
import ClientWidget from "./ClientWidget";
import ClientFeedback from "./ClientFeedback";
import "./client-style.css";
import ClientTickets from "./ClientTickets";
import { useTheme } from "./UseTheme";

export type ClientPage = "dashboard" | "documents" | "widget" | "feedback" | "tickets";

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
  const [sidebarOpen, setSidebarOpen] = useState(false);

  // ── Dashboard refresh key — incrementing it re-mounts the dashboard
  //    which triggers a fresh analytics fetch including updated storage/doc count
  const [dashboardKey, setDashboardKey] = useState(0);
  const refreshDashboard = useCallback(() => setDashboardKey((k) => k + 1), []);

  const navigate = (p: ClientPage) => {
    setPage(p);
    setSidebarOpen(false);
  };

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => { if (e.key === "Escape") setSidebarOpen(false); };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, []);

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

  const [theme, toggleTheme] = useTheme();

  if (!authed) return <ClientLogin onLogin={handleLogin} />;

  return (
    <div className="cl-layout">
      <div
        className={`cl-sidebar-overlay${sidebarOpen ? " open" : ""}`}
        onClick={() => setSidebarOpen(false)}
        aria-hidden="true"
      />

      <aside className={`cl-sidebar${sidebarOpen ? " open" : ""}`}>
        <div className="cl-brand">
          <span className="cl-brand-icon">✦</span>
          <span className="cl-brand-name">NovaMind</span>
        </div>

        <nav className="cl-nav">
          {([
            ["dashboard",  "▦", "Dashboard"],
            ["documents",  "◈", "Documents"],
            ["widget",     "◎", "Widget"],
            ["feedback",   "✦", "Feedback"],
            ["tickets",    "✉", "Tickets"],
          ] as [ClientPage, string, string][]).map(([p, icon, label]) => (
            <button
              key={p}
              className={`cl-nav-item${page === p ? " active" : ""}`}
              onClick={() => navigate(p)}
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
          <button
            className="cl-theme-toggle"
            onClick={toggleTheme}
            title={`Switch to ${theme === "dark" ? "light" : "dark"} mode`}
          >
            {theme === "dark" ? "☀️" : "🌙"}
          </button>
          <button className="cl-logout" onClick={handleLogout}>Sign out</button>
        </div>
      </aside>

      <main className="cl-main">
        <div className="cl-mobile-topbar">
          <button
            className="cl-hamburger"
            onClick={() => setSidebarOpen(!sidebarOpen)}
            aria-label="Toggle navigation"
          >
            ☰
          </button>
          <span className="cl-mobile-title">NovaMind</span>
        </div>

        {/* key prop forces re-mount (fresh fetch) whenever a document is mutated */}
        {page === "dashboard"  && bot && <ClientDashboard key={dashboardKey} bot={bot} />}
        {page === "documents"  && bot && (
          <ClientDocuments
            bot={bot}
            onUpload={refreshDashboard}   // ← triggers dashboard refresh
          />
        )}
        {page === "widget"     && bot && <ClientWidget bot={bot} setBot={setBot} user={user} />}
        {page === "feedback"   && bot && <ClientFeedback bot={bot} />}
        {page === "tickets"    && <ClientTickets />}
      </main>
    </div>
  );
}