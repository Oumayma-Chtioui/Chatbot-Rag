import { useEffect, useState } from "react";
import AdminLogin from "./AdminLogin";
import AdminOverview from "./AdminOverview";
import AdminChatbots from "./AdminChatbots";
import AdminBotDashboard from "./AdminBotDashboard";
import AdminUsers from "./AdminUsers";
import AdminFeedback from "./AdminFeedback";
import AdminBilling from "./AdminBilling";
import AdminSystem from "./AdminSystem";
import AdminTestBot from "./AdminTestBot";
import * as api from "./api";
import { getAdminOverview, AdminOverviewData } from "./Adminapi";
import { useTheme } from "./UseTheme";
import AdminUsers2 from "./AdminUsers2";

const adminToken = () => localStorage.getItem("admin_token");

const tabItems = [
  { key: "overview", label: "Overview", icon: "◈" },
  { key: "users",    label: "Users",    icon: "👥" },
  { key: "chatbots", label: "Chatbots", icon: "◉" },
  { key: "feedback", label: "Feedback", icon: "✦" },
  { key: "billing",  label: "Billing",  icon: "◎" },
  { key: "system",   label: "System",   icon: "⬡" },
  { key: "testbot",  label: "Test Bot", icon: "▷" },
] as const;

interface BillingRow { email: string; messages_count: number; docs_count: number; sessions_count: number; storage_mb: number; plan_tier: string; }
interface BotRow { id: string; name: string; status: string; doc_count: number; message_count: number; }
interface FeedbackRow { bot_id: string; bot_name: string; avg_score: number; total_feedback: number; }

export default function AdminApp() {
  const [theme, toggleTheme] = useTheme();

  const [authenticated, setAuthenticated] = useState(!!adminToken());
  const [adminName, setAdminName] = useState<string>(() => {
    try { return JSON.parse(localStorage.getItem("admin_user") || "null")?.name || ""; } catch { return ""; }
  });
  const VALID_TABS = ["overview", "users", "chatbots", "feedback", "billing", "system", "testbot"];

  const [tab, setTab] = useState<typeof tabItems[number]["key"]>(() => {
    const saved = localStorage.getItem("admin_tab");
    return (VALID_TABS.includes(saved!) ? saved : "overview") as typeof tabItems[number]["key"];
  });
  const [stats, setStats]       = useState<AdminOverviewData | null>(null);
  const [bots, setBots]         = useState<BotRow[]>([]);
  const [users, setUsers]       = useState<any[]>([]);
  const [feedback, setFeedback] = useState<FeedbackRow[]>([]);
  const [billing, setBilling]   = useState<BillingRow[]>([]);
  const [system, setSystem]     = useState<any>(null);
  const [selectedBot, setSelectedBot]       = useState<string>("");
  const [selectedChatbot, setSelectedChatbot] = useState<any>(() => {
    try { return JSON.parse(localStorage.getItem("admin_selected_chatbot") || "null"); }
    catch { return null; }
  });
  const [loading, setLoading] = useState(false);
  const [error, setError]     = useState<string | null>(null);
  const [sidebarOpen, setSidebarOpen] = useState(false);

  const selectChatbot = (bot: any) => {
    setSelectedChatbot(bot);
    if (bot) localStorage.setItem("admin_selected_chatbot", JSON.stringify(bot));
    else localStorage.removeItem("admin_selected_chatbot");
  };

  useEffect(() => {
    if (!authenticated) return;
    loadTab(tab);
  }, [authenticated, tab]);

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => { if (e.key === "Escape") setSidebarOpen(false); };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, []);

  const navigate = (t: typeof tabItems[number]["key"]) => {
    setTab(t);
    localStorage.setItem("admin_tab", t);
    setSidebarOpen(false);
  };

  const handleLogin = (name: string) => {
    setAdminName(name);
    setAuthenticated(true);
    // Tab is already "overview" but useEffect won't re-fire since authenticated
    // didn't change yet — so manually trigger load after state settles
    setTimeout(() => loadTab("overview"), 0);
  };

  const handleLogout = () => {
    localStorage.removeItem("admin_tab");
    localStorage.removeItem("admin_token");
    localStorage.removeItem("admin_user");
    setAuthenticated(false);
    setAdminName("");
    setStats(null);
  };

  const fetchWithAuth = async (url: string) => {
    const token = adminToken();
    const API = "http://localhost:8000";
    const res = await fetch(`${API}${url}`, { headers: { Authorization: `Bearer ${token}` } });
    if (!res.ok) {
      const data = await res.json().catch(() => ({}));
      throw new Error(data.detail || "Admin API request failed");
    }
    return await res.json();
  };

  const handleDeleteUser = async (userId: number) => {
    try {
      const token = adminToken();
      const API = "http://localhost:8000";
      const res = await fetch(`${API}/admin/users/${userId}`, {
        method: "DELETE",
        headers: { Authorization: `Bearer ${token}` },
      });
      if (!res.ok) {
        const data = await res.json().catch(() => ({}));
        throw new Error(data.detail || "Delete failed");
      }
      setUsers(users.filter((u) => u.id !== userId));
    } catch (err: any) { setError(err.message); }
  };

  const handleDeleteBot = async (botId: string) => {
    try {
      const token = adminToken();
      const API = "http://localhost:8000";
      const res = await fetch(`${API}/admin/bots/${botId}`, {
        method: "DELETE",
        headers: { Authorization: `Bearer ${token}` },
      });
      if (!res.ok) {
        const data = await res.json().catch(() => ({}));
        throw new Error(data.detail || "Delete failed");
      }
      setBots(bots.filter((b) => b.id !== botId));
    } catch (err: any) { setError(err.message); }
  };

  const loadTab = async (activeTab: typeof tabItems[number]["key"]) => {
    setError(null);
    setLoading(true);
    try {
      if (activeTab === "overview") {
        // Use Adminapi.ts which calls /admin/overview (the rich endpoint)
        setStats(await getAdminOverview());
      }
      if (activeTab === "chatbots" || activeTab === "testbot") {
        const data = await api.getAdminBots();
        setBots(data.bots || []);
        if (!selectedBot && data.bots?.length) setSelectedBot(data.bots[0].id);
      }
      if (activeTab === "feedback") {
        const data = await fetchWithAuth("/admin/feedback");
        setFeedback(data.feedback || []);
      }
      if (activeTab === "billing") {
        const data = await fetchWithAuth("/admin/billing");
        setBilling(data.clients || []);
      }
      if (activeTab === "system") {
        setSystem(await api.getSystemHealth());
      }
      if (activeTab === "users") {
  // data is fetched inside the component itself
    }
    } catch (err: any) {
      setError(err.message || "Could not load admin data.");
    } finally {
      setLoading(false);
    }
  };

  if (!authenticated) {
    return <AdminLogin onLogin={handleLogin} />;
  }
  const tabLabelMap: Record<string, string> = {
    overview: "Overview",users:    "Users",  chatbots: "Chatbots", feedback: "Feedback",
    billing: "Billing",   system: "System",      testbot: "Test Bot",
  };


  return (
    <div className="admin-layout">
      <div className={`admin-sidebar-overlay${sidebarOpen ? " open" : ""}`}
        onClick={() => setSidebarOpen(false)} aria-hidden="true" />

      <aside className={`admin-sidebar${sidebarOpen ? " open" : ""}`}>
        <div className="cl-brand">
          <span className="cl-brand-icon">⚙️</span>
          <span className="cl-brand-name">NovaMind Admin</span>
        </div>
        <nav className="cl-nav">
          {tabItems.map((item) => (
            <button key={item.key}
              className={`cl-nav-item${tab === item.key ? " active" : ""}`}
              onClick={() => navigate(item.key)}>
              <span className="cl-nav-icon">{item.icon}</span>
              {item.label}
            </button>
          ))}
        </nav>
        <div className="cl-sidebar-footer">
          <div className="cl-user-info">
            <div className="cl-avatar">{adminName?.charAt(0)?.toUpperCase() || "A"}</div>
            <div>
              <div className="cl-user-name">{adminName || "Admin"}</div>
              <div className="cl-user-role">Administrator</div>
            </div>
          </div>
          <button className="cl-theme-toggle" onClick={toggleTheme}
            title={`Switch to ${theme === "dark" ? "light" : "dark"} mode`}>
            {theme === "dark" ? "☀️" : "🌙"}
          </button>
          <button className="cl-logout" onClick={handleLogout}>Sign out</button>
        </div>
      </aside>

      <main className="cl-main">
        <div className="cl-mobile-topbar">
          <button className="cl-hamburger" onClick={() => setSidebarOpen(!sidebarOpen)} aria-label="Toggle navigation">☰</button>
          <span className="cl-mobile-title">Admin Console</span>
        </div>

        <div className="cl-page">
          <div className="cl-page-header">
            <h1 className="cl-page-title">{tabLabelMap[tab] || "Admin Console"}</h1>
            <p className="cl-page-sub">Manage platform, metrics, bots, users, and system health.</p>
          </div>

          {error && <div className="cl-error">{error}</div>}

          {tab === "overview" && <AdminOverview stats={stats} loading={loading} />}
          {tab === "users" && (<AdminUsers2 onViewBot={(bot) => { setTab("chatbots"); selectChatbot(bot);}}/>)}
          {tab === "chatbots" && (selectedChatbot
            ? <AdminBotDashboard bot={selectedChatbot} onBack={() => selectChatbot(null)} />
            : <AdminChatbots bots={bots} loading={loading} onDelete={handleDeleteBot} onSelect={selectChatbot} />
          )}
          {tab === "feedback" && <AdminFeedback feedback={feedback} loading={loading} />}
          {tab === "billing"  && <AdminBilling  billing={billing}   loading={loading} />}
          {tab === "system"   && <AdminSystem   system={system}     loading={loading} />}
          {tab === "testbot"  && <AdminTestBot  bots={bots} selectedBot={selectedBot} onBotSelect={setSelectedBot} loading={loading} />}
        </div>
      </main>
    </div>
  );
}