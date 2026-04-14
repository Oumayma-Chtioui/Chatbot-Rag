import { useEffect, useState } from "react";
import { Bot } from "./ClientApp";

const API = "http://localhost:8000";
const token = () => localStorage.getItem("client_token");

interface Props { bot: Bot | null; }

interface DayData { date: string; count: number; }
interface Analytics {
  total_messages: number;
  total_sessions: number;
  messages_today: number;
  messages_per_day: DayData[];
  top_questions: string[];
}

export default function ClientAnalytics({ bot }: Props) {
  const [data, setData] = useState<Analytics | null>(null);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    if (!bot) return;
    fetch(`${API}/widgets/bots/${bot.id}/analytics`, {
      headers: { Authorization: `Bearer ${token()}` },
    })
      .then((r) => r.json())
      .then((d) => { console.log("Analytics response:", d); setData(d); setLoading(false); })
      .catch((err) => { console.log("Analytics error:", err); setLoading(false); });
  }, [bot]);

  const maxCount = Math.max(...(data?.messages_per_day.map((d) => d.count) || [1]), 1);

  return (
    <div className="cl-page">
      <div className="cl-page-header">
        <h1 className="cl-page-title">Analytics</h1>
        <p className="cl-page-sub">How users are interacting with your widget.</p>
      </div>

      {loading ? (
        <div className="cl-loading">Loading analytics...</div>
      ) : !data ? (
        <div className="cl-empty">No analytics data yet.</div>
      ) : (
        <>
          <div className="cl-stats-grid">
            {[
              { label: "Messages today", value: data.messages_today },
              { label: "Total messages",  value: data.total_messages },
              { label: "Total sessions",  value: data.total_sessions },
            ].map((c) => (
              <div className="cl-stat-card" key={c.label}>
                <div className="cl-stat-value">{c.value.toLocaleString()}</div>
                <div className="cl-stat-label">{c.label}</div>
              </div>
            ))}
          </div>

          <div className="cl-section">
            <h2 className="cl-section-title">Messages per day</h2>
            <div className="cl-bar-chart">
              {data.messages_per_day.slice(-14).map((d) => (
                <div className="cl-bar-col" key={d.date}>
                  <div
                    className="cl-bar"
                    style={{ height: `${Math.round((d.count / maxCount) * 120)}px` }}
                  />
                  <div className="cl-bar-label">
                    {new Date(d.date).toLocaleDateString("en", { month: "short", day: "numeric" })}
                  </div>
                </div>
              ))}
            </div>
          </div>

          {data.top_questions?.length > 0 && (
            <div className="cl-section">
              <h2 className="cl-section-title">Top questions</h2>
              <div className="cl-doc-list">
                {data.top_questions.map((q, i) => (
                  <div className="cl-doc-row" key={i}>
                    <span className="cl-rank">#{i + 1}</span>
                    <span className="cl-doc-name">{q}</span>
                  </div>
                ))}
              </div>
            </div>
          )}
        </>
      )}
    </div>
  );
}
