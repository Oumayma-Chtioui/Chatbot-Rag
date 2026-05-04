// Frontend/src/AdminFeedback.tsx
// Fixed: old code assumed 1 bot per client (grouped by bot_id which implied 1 per user).
// Now clearly labels each group as a BOT (not a user), shows owner email under bot name,
// and renders the bot's accent color as a visual indicator.

import { useState } from "react";
import { deleteFeedback } from "./api";

interface FeedbackItem {
  id: string;
  bot_id: string;
  user_name: string;
  rating: number;
  comment: string;
  category: string;
  created_at: string;
}

interface BotFeedback {
  bot_id: string;
  bot_name: string;
  // Added: owner info so admin knows which client owns this bot
  owner_email?: string;
  owner_name?: string;
  accent_color?: string;
  avg_score: number;
  total_feedback: number;
  feedback_list: FeedbackItem[];
}

interface Props {
  feedback: BotFeedback[];
  loading: boolean;
}

const STAR_COLORS = ["#D85A30", "#BA7517", "#BA7517", "#1D9E75", "#1D9E75"];

export default function AdminFeedback({ feedback, loading }: Props) {
  const [expanded, setExpanded] = useState<Set<string>>(new Set());

  if (loading) return <div className="cl-loading">Loading feedback…</div>;

  const toggleExpand = (botId: string) => {
    setExpanded(prev => {
      const next = new Set(prev);
      next.has(botId) ? next.delete(botId) : next.add(botId);
      return next;
    });
  };

  const handleDeleteFeedback = async (botId: string) => {
    if (!confirm("Delete all feedback for this bot? This cannot be undone.")) return;
    try {
      await deleteFeedback(botId);
      window.location.reload();
    } catch (err: any) {
      alert("Error deleting feedback: " + (err.message || "Unknown error"));
    }
  };

  // Summary stats across all bots
  const totalReviews = feedback.reduce((s, b) => s + b.total_feedback, 0);
  const overallAvg   = feedback.length
    ? (feedback.reduce((s, b) => s + b.avg_score * b.total_feedback, 0) / (totalReviews || 1))
    : 0;

  return (
    <div className="cl-section">

      {/* Summary strip */}
      {feedback.length > 0 && (
        <div style={{ display: "grid", gridTemplateColumns: "repeat(3, 1fr)", gap: 12, marginBottom: 24 }}>
          <div className="cl-stat-card">
            <div className="cl-stat-value">{overallAvg.toFixed(1)} ★</div>
            <div className="cl-stat-label">Platform avg score</div>
          </div>
          <div className="cl-stat-card">
            <div className="cl-stat-value">{totalReviews}</div>
            <div className="cl-stat-label">Total reviews</div>
          </div>
          <div className="cl-stat-card">
            <div className="cl-stat-value">{feedback.length}</div>
            <div className="cl-stat-label">Bots with feedback</div>
          </div>
        </div>
      )}

      <h2 className="cl-section-title">Feedback by bot</h2>

      {feedback.length === 0 ? (
        <div className="cl-empty">No feedback yet.</div>
      ) : (
        <div className="cl-doc-list">
          {feedback.map((bot) => {
            const accent    = bot.accent_color || "#7F77DD";
            const isOpen    = expanded.has(bot.bot_id);
            const starColor = STAR_COLORS[Math.round(bot.avg_score) - 1] || "#7F77DD";

            return (
              <div
                key={bot.bot_id}
                style={{
                  background: "var(--bg2)",
                  border: `1px solid var(--border)`,
                  borderLeft: `3px solid ${accent}`,
                  borderRadius: 10,
                  overflow: "hidden",
                }}
              >
                {/* Bot header row */}
                <div
                  style={{
                    display: "flex", alignItems: "center", gap: 12,
                    padding: "14px 16px", cursor: "pointer",
                  }}
                  onClick={() => toggleExpand(bot.bot_id)}
                >
                  {/* Bot icon */}
                  <div style={{
                    width: 36, height: 36, borderRadius: 8, flexShrink: 0,
                    background: `${accent}22`, color: accent,
                    display: "flex", alignItems: "center", justifyContent: "center", fontSize: 16,
                  }}>
                    ◉
                  </div>

                  {/* Name + owner */}
                  <div style={{ flex: 1, minWidth: 0 }}>
                    <div style={{ fontSize: 14, fontWeight: 600, color: "var(--text)" }}>{bot.bot_name}</div>
                    {(bot.owner_name || bot.owner_email) && (
                      <div style={{ fontSize: 11, color: "var(--text3)" }}>
                        {bot.owner_name && <span>{bot.owner_name} · </span>}
                        {bot.owner_email}
                      </div>
                    )}
                  </div>

                  {/* Score */}
                  <div style={{ textAlign: "center", flexShrink: 0 }}>
                    <div style={{ fontSize: 20, fontWeight: 700, color: starColor }}>{bot.avg_score.toFixed(1)}</div>
                    <div style={{ fontSize: 10, color: "var(--text3)" }}>{bot.total_feedback} review{bot.total_feedback !== 1 ? "s" : ""}</div>
                  </div>

                  {/* Star bar */}
                  <div style={{ display: "flex", gap: 2, flexShrink: 0 }}>
                    {[1,2,3,4,5].map(s => (
                      <span key={s} style={{ fontSize: 14, color: s <= Math.round(bot.avg_score) ? accent : "var(--bg3)" }}>★</span>
                    ))}
                  </div>

                  {/* Expand chevron */}
                  <span style={{
                    fontSize: 11, color: "var(--text3)", flexShrink: 0,
                    transform: isOpen ? "rotate(180deg)" : "rotate(0deg)",
                    transition: "transform 0.2s", display: "inline-block",
                  }}>▼</span>

                  {/* Delete */}
                  <button
                    onClick={e => { e.stopPropagation(); handleDeleteFeedback(bot.bot_id); }}
                    style={{
                      background: "none", border: "1px solid rgba(216,90,48,0.3)",
                      color: "var(--danger)", borderRadius: 6, padding: "3px 10px",
                      cursor: "pointer", fontSize: 11, flexShrink: 0,
                    }}
                  >
                    ✕
                  </button>
                </div>

                {/* Expanded individual feedback */}
                {isOpen && (
                  <div style={{ borderTop: "1px solid var(--border)", padding: "12px 16px", display: "flex", flexDirection: "column", gap: 8 }}>
                    {bot.feedback_list.map(item => (
                      <div
                        key={item.id}
                        style={{ background: "var(--bg3)", border: "1px solid var(--border)", borderRadius: 8, padding: "12px 14px" }}
                      >
                        <div style={{ display: "flex", justifyContent: "space-between", alignItems: "flex-start", marginBottom: 8 }}>
                          <div style={{ display: "flex", alignItems: "center", gap: 8 }}>
                            <div style={{
                              width: 26, height: 26, borderRadius: "50%",
                              background: `${accent}22`, color: accent,
                              display: "flex", alignItems: "center", justifyContent: "center",
                              fontSize: 10, fontWeight: 700,
                            }}>
                              {(item.user_name || "?").charAt(0).toUpperCase()}
                            </div>
                            <span style={{ fontSize: 12, fontWeight: 500, color: "var(--text)" }}>{item.user_name || "Anonymous"}</span>
                            <span style={{ fontSize: 11, padding: "2px 7px", borderRadius: 20, background: `${accent}18`, color: accent }}>
                              {item.category}
                            </span>
                          </div>
                          <div style={{ display: "flex", gap: 1 }}>
                            {[1,2,3,4,5].map(s => (
                              <span key={s} style={{ fontSize: 12, color: s <= item.rating ? accent : "var(--bg3)" }}>★</span>
                            ))}
                          </div>
                        </div>
                        {item.comment && (
                          <p style={{ fontSize: 12, color: "var(--text2)", margin: "0 0 6px", lineHeight: 1.5 }}>
                            "{item.comment}"
                          </p>
                        )}
                        <div style={{ fontSize: 10, color: "var(--text3)" }}>
                          {new Date(item.created_at).toLocaleString()}
                        </div>
                      </div>
                    ))}
                  </div>
                )}
              </div>
            );
          })}
        </div>
      )}
    </div>
  );
}