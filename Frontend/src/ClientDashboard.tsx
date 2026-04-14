import { useEffect, useState } from "react";
import { Bot, ClientUser } from "./ClientApp";

const API = "http://localhost:8000";
const token = () => localStorage.getItem("client_token");

interface Props {
  bot: Bot | null;
  user: ClientUser | null;
}

interface Stats {
  total_messages: number;
  total_sessions: number;
  total_documents: number;
  messages_today: number;
}

export default function ClientDashboard({ bot, user }: Props) {
  const [stats, setStats] = useState<Stats | null>(null);
  const [loading, setLoading] = useState(true);

  if (!bot) return <div className="cl-page"><div className="cl-loading">Setting up your bot...</div></div>;
  
  useEffect(() => {
    if (!bot) return;
    fetch(`${API}/widgets/bots/${bot.id}/analytics`, {
      headers: { Authorization: `Bearer ${token()}` },
    })
      .then((r) => r.json())
      .then((data) => {
        setStats(data);
        setLoading(false);
      })
      .catch(() => setLoading(false));
  }, [bot]);

  const cards = [
    { label: "Messages today", value: stats?.messages_today ?? 0, icon: "◎" },
    { label: "Total sessions",  value: stats?.total_sessions  ?? 0, icon: "◈" },
    { label: "Documents indexed", value: stats?.total_documents ?? 0, icon: "▦" },
    { label: "Total messages",  value: stats?.total_messages  ?? 0, icon: "◉" },
  ];

  return (
    <div className="cl-page">
      <div className="cl-page-header">
        <h1 className="cl-page-title">Welcome back, {user?.name}</h1>
        <p className="cl-page-sub">Here's what's happening with your widget today.</p>
      </div>

      {loading ? (
        <div className="cl-loading">Loading stats...</div>
      ) : (
        <div className="cl-stats-grid">
          {cards.map((c) => (
            <div className="cl-stat-card" key={c.label}>
              <div className="cl-stat-icon">{c.icon}</div>
              <div className="cl-stat-value">{c.value.toLocaleString()}</div>
              <div className="cl-stat-label">{c.label}</div>
            </div>
          ))}
        </div>
      )}

      <div className="cl-section">
        <h2 className="cl-section-title">Your bot</h2>
        <div className="cl-info-card">
          <div className="cl-info-row">
            <span className="cl-info-label">Bot name</span>
            <span className="cl-info-value">{bot?.name ?? "—"}</span>
          </div>
          <div className="cl-info-row">
            <span className="cl-info-label">Bot ID</span>
            <span className="cl-info-value cl-mono">{bot?.id ?? "—"}</span>
          </div>
          <div className="cl-info-row">
            <span className="cl-info-label">Allowed origin</span>
            <span className="cl-info-value">{bot?.allowed_origin ?? "Any"}</span>
          </div>
        </div>
      </div>
    </div>
  );
}
