import { useState, useEffect } from "react";
import ClientLogin from "./ClientLogin";
import ClientDashboard from "./ClientDashboard";
import ClientDocuments from "./ClientDocuments";
import ClientWidget from "./ClientWidget";
import ClientFeedback from "./ClientFeedback";
import "./client-style.css";
import ClientTickets from "./ClientTickets";
import { useTheme } from "./UseTheme";

export type ClientPage = "dashboard" | "documents" | "widget" |  "feedback" | "tickets";

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

  // Close sidebar on route change (mobile UX)
  const navigate = (p: ClientPage) => {
    setPage(p);
    setSidebarOpen(false);
  };

  // Close sidebar on Escape key
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

  const [theme, toggleTheme] = useTheme()

  if (!authed) return <ClientLogin onLogin={handleLogin} />;

  return (
    <div className="cl-layout">
      {/* Overlay — clicking it closes the sidebar */}
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
        {/* Mobile topbar with hamburger — always visible on mobile */}
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

        {page === "dashboard"  && bot && <ClientDashboard bot={bot} />}
        {page === "documents"  && bot && <ClientDocuments bot={bot} />}
        {page === "widget"     && bot && <ClientWidget bot={bot} setBot={setBot} user={user} />}
        {page === "feedback"   && bot && <ClientFeedback bot={bot} />}
        {page === "tickets"    && <ClientTickets />}
      </main>
    </div>
  );
}