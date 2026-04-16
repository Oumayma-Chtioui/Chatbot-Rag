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
  avg_score: number;
  total_feedback: number;
  feedback_list: FeedbackItem[];
}

interface Props {
  feedback: BotFeedback[];
  loading: boolean;
}

export default function AdminFeedback({ feedback, loading }: Props) {
  if (loading) return <div className="cl-loading">Loading feedback…</div>;
  const handleDeleteFeedback = async (botId: string) => {
    if (!confirm("Delete all feedback for this bot? This cannot be undone.")) return;
    try {
      await deleteFeedback(botId);
      // Trigger reload by calling the parent's refetch, or update state
      window.location.reload();
    } catch (err: any) {
      alert("Error deleting feedback: " + (err.message || "Unknown error"));
    }
  };

  return (
    <div className="cl-section">
      <h2 className="cl-section-title">Bot feedback</h2>
      {feedback.length === 0 ? (
        <div className="cl-empty">No feedback yet.</div>
      ) : (
        <div className="cl-doc-list">
          {feedback.map((bot) => (
            <div key={bot.bot_id} className="cl-doc-row">
              <div style={{ width: "100%" }}>
                <div style={{ display: "flex", justifyContent: "space-between", alignItems: "flex-start", marginBottom: "10px" }}>
                  <div>
                    <div className="cl-doc-name">{bot.bot_name}</div>
                    <div className="cl-doc-meta">Avg score: {bot.avg_score.toFixed(1)} ⭐ · {bot.total_feedback} reviews</div>
                  </div>
                  <button className="cl-btn-danger" onClick={() => handleDeleteFeedback(bot.bot_id)}>✕</button>
                </div>

                <div style={{ marginTop: "15px" }}>
                  <h4 style={{ fontSize: "14px", fontWeight: "600", marginBottom: "10px", color: "var(--text)" }}>
                    Individual Feedback:
                  </h4>
                  {bot.feedback_list.map((item) => (
                    <div key={item.id} style={{
                      border: "1px solid var(--border)",
                      borderRadius: "6px",
                      padding: "12px",
                      marginBottom: "8px",
                      backgroundColor: "var(--bg2)"
                    }}>
                      <div style={{ display: "flex", justifyContent: "space-between", alignItems: "flex-start", marginBottom: "8px" }}>
                        <div style={{ fontSize: "13px", fontWeight: "500", color: "var(--text)" }}>
                          {item.user_name} • {item.category}
                        </div>
                        <div style={{ fontSize: "13px", color: "var(--text3)" }}>
                          {"⭐".repeat(item.rating)} ({item.rating}/5)
                        </div>
                      </div>
                      {item.comment && (
                        <div style={{ fontSize: "13px", color: "var(--text)", lineHeight: "1.4", marginBottom: "4px" }}>
                          "{item.comment}"
                        </div>
                      )}
                      <div style={{ fontSize: "11px", color: "var(--text3)" }}>
                        {new Date(item.created_at).toLocaleString()}
                      </div>
                    </div>
                  ))}
                </div>
              </div>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}
