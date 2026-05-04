// Frontend/src/ClientApp.tsx
import { useState, useEffect, useCallback } from "react";
import ClientLogin from "./ClientLogin";
import ClientDashboard from "./ClientDashboard";
import ClientDocuments from "./ClientDocuments";
import ClientWidget from "./ClientWidget";
import ClientFeedback from "./ClientFeedback";
import ClientTickets from "./ClientTickets";
import BotSelector from "./BotSelector";
import BotCreate from "./BotCreate";
import "./client-style.css";
import { useTheme } from "./UseTheme";

export type ClientPage =
  | "bots"           // landing — pick a bot
  | "create-bot"     // create / edit bot
  | "dashboard"
  | "documents"
  | "widget"
  | "feedback"
  | "tickets"
  | "subscription";

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
  accent_color?: string;
  welcome_message?: string;
  system_prompt?: string;
  docs_indexed?: number;
  is_active?: boolean;
  created_at?: string;
}

const API = "http://localhost:8000";

export default function ClientApp() {
  const [authed, setAuthed] = useState(!!localStorage.getItem("client_token"));
  const [user, setUser] = useState<ClientUser | null>(() => {
    try { return JSON.parse(localStorage.getItem("client_user") || "null"); }
    catch { return null; }
  });

  // Multi-bot state
  const [bots, setBots] = useState<Bot[]>([]);
  const [activeBot, setActiveBot] = useState<Bot | null>(null);
  const [botsLoading, setBotsLoading] = useState(false);
  const [editingBot, setEditingBot] = useState<Bot | null>(null); // for edit mode

  const [page, setPage] = useState<ClientPage>("bots");
  const [sidebarOpen, setSidebarOpen] = useState(false);
  const [dashboardKey, setDashboardKey] = useState(0);
  const refreshDashboard = useCallback(() => setDashboardKey((k) => k + 1), []);

  const token = () => localStorage.getItem("client_token");

  // Load all bots
  const loadBots = useCallback(async () => {
    if (!token()) return;
    setBotsLoading(true);
    try {
      const res = await fetch(`${API}/widgets/bots`, {
        headers: { Authorization: `Bearer ${token()}` },
      });
      if (res.ok) {
        const data = await res.json();
        setBots(data);
        // If active bot exists, refresh its data
        if (activeBot) {
          const updated = data.find((b: Bot) => b.id === activeBot.id);
          if (updated) setActiveBot(updated);
        }
      }
    } finally {
      setBotsLoading(false);
    }
  }, [activeBot]);

  useEffect(() => {
    if (authed) loadBots();
  }, [authed]);

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => { if (e.key === "Escape") setSidebarOpen(false); };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, []);

  const navigate = (p: ClientPage) => {
    setPage(p);
    setSidebarOpen(false);
    if (p === "widget") loadBots();
  };

  const handleLogin = (userData: ClientUser, tkn: string) => {
    localStorage.setItem("client_token", tkn);
    localStorage.setItem("client_user", JSON.stringify(userData));
    setUser(userData);
    setAuthed(true);
  };

  const handleLogout = () => {
    localStorage.removeItem("client_token");
    localStorage.removeItem("client_user");
    setAuthed(false);
    setUser(null);
    setBots([]);
    setActiveBot(null);
    setPage("bots");
  };

  const handleSelectBot = (bot: Bot) => {
    setActiveBot(bot);
    navigate("dashboard");
  };

  // In ClientApp.tsx
  const handleDeleteBot = async (botId: string) => {
    const res = await fetch(`${API}/widgets/bots/${botId}`, {
      method: "DELETE",
      headers: { Authorization: `Bearer ${token()}` },
    });
    if (!res.ok) {
      const data = await res.json().catch(() => ({}));
      throw new Error(data.detail || "Delete failed");
    }
    // Remove from local state so the card disappears immediately
    setBots(prev => prev.filter(b => b.id !== botId));
  };

  const handleBotCreated = (bot: Bot) => {
    setBots(prev => {
      const existing = prev.findIndex(b => b.id === bot.id);
      if (existing >= 0) {
        const updated = [...prev];
        updated[existing] = bot;
        return updated;
      }
      return [bot, ...prev];
    });
    setActiveBot(bot);
    setEditingBot(null);
    navigate("dashboard");
  };

  const handleEditBot = (bot: Bot) => {
    setEditingBot(bot);
    navigate("create-bot");
  };

  const [theme, toggleTheme] = useTheme();

  if (!authed) return <ClientLogin onLogin={handleLogin} />;

  // ── Inside-bot sidebar nav items
  const botNavItems: [ClientPage, string, string][] = [
    ["dashboard",  "▦", "Dashboard"],
    ["documents",  "◈", "Documents"],
    ["widget",     "◎", "Widget"],
    ["feedback",   "✦", "Feedback"],
    ["tickets",    "✉", "Tickets"],
  ];

  const isInsideBot = activeBot && page !== "bots" && page !== "create-bot" && page !== "subscription";

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

        {/* Global nav */}
        <nav className="cl-nav" style={{ marginBottom: 8 }}>
          <button
            className={`cl-nav-item${page === "bots" ? " active" : ""}`}
            onClick={() => { setActiveBot(null); navigate("bots"); }}
          >
            <span className="cl-nav-icon">◉</span>
            My Bots
            {bots.length > 0 && (
              <span style={{
                marginLeft: "auto", fontSize: 11, fontWeight: 700,
                background: "rgba(127,119,221,0.2)", color: "var(--accent-light)",
                borderRadius: 10, padding: "1px 7px",
              }}>
                {bots.length}
              </span>
            )}
          </button>
          <button
            className={`cl-nav-item${page === "subscription" ? " active" : ""}`}
            onClick={() => navigate("subscription")}
          >
            <span className="cl-nav-icon">◎</span>
            Subscription
          </button>
        </nav>

        {/* Per-bot nav — only shown when a bot is selected */}
        {activeBot && (
          <>
            <div style={{
              padding: "8px 12px 4px",
              fontSize: 10,
              fontWeight: 700,
              color: "var(--text3)",
              textTransform: "uppercase",
              letterSpacing: "0.08em",
              display: "flex",
              alignItems: "center",
              gap: 6,
            }}>
              <span style={{
                width: 8, height: 8, borderRadius: "50%",
                background: activeBot.accent_color || "var(--accent)",
                display: "inline-block", flexShrink: 0,
              }} />
              {activeBot.name}
            </div>
            <nav className="cl-nav">
              {botNavItems.map(([p, icon, label]) => (
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
          </>
        )}

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
          <span className="cl-mobile-title">
            {isInsideBot ? activeBot.name : "NovaMind"}
          </span>
        </div>

        {/* ── Pages ── */}
        {page === "bots" && (
          <BotSelector
            bots={bots}
            loading={botsLoading}
            onSelect={handleSelectBot}
            onCreate={() => { setEditingBot(null); navigate("create-bot"); }}
            onEdit={handleEditBot}
            onDelete={handleDeleteBot}
            onRefresh={loadBots}
          />
        )}

        {page === "create-bot" && (
          <BotCreate
            existing={editingBot}
            onCreated={handleBotCreated}
            onCancel={() => navigate(activeBot ? "dashboard" : "bots")}
          />
        )}

        {page === "subscription" && (
          <div className="cl-page">
            <div className="cl-page-header">
              <h1 className="cl-page-title">Subscription</h1>
              <p className="cl-page-sub">Manage your plan and billing.</p>
            </div>
            <div style={{
              background: "var(--bg2)", border: "1px solid var(--border)",
              borderRadius: 14, padding: 32, textAlign: "center",
              color: "var(--text3)", fontSize: 14,
            }}>
              Billing portal coming soon.
            </div>
          </div>
        )}

        {activeBot && page === "dashboard" && (
          <ClientDashboard key={dashboardKey} bot={activeBot} />
        )}
        {activeBot && page === "documents" && (
          <ClientDocuments bot={activeBot} onUpload={refreshDashboard} />
        )}
        {activeBot && page === "widget" && (
          <ClientWidget
            bot={activeBot}
            setBot={(updated) => {
              setActiveBot(updated);
              setBots(prev => prev.map(b => b.id === updated.id ? updated : b));
            }}
            user={user}
          />
        )}
        {activeBot && page === "feedback" && (
          <ClientFeedback bot={activeBot} />
        )}
        {activeBot && page === "tickets" && <ClientTickets bot={activeBot} />}
      </main>
    </div>
  );
}