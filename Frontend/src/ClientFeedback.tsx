import { useEffect, useState } from "react";
import { Bot } from "./ClientApp";
import FeedbackWidget from "./FeedbackWidget";

const API = "http://localhost:8000";
const token = () => localStorage.getItem("client_token");

interface FeedbackItem {
  id: string;
  rating: number;
  comment: string;
  category: string;
  user_name: string;
  created_at: string;
}

interface Props {
  bot: Bot | null;
}

export default function ClientFeedback({ bot }: Props) {
  const [feedback, setFeedback] = useState<FeedbackItem[]>([]);
  const [avgScore, setAvgScore] = useState(0);
  const [total, setTotal] = useState(0);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const loadFeedback = async () => {
    if (!bot) return;
    setLoading(true);
    setError(null);
    try {
      const res = await fetch(`${API}/widgets/bots/${bot.id}/feedback`, {
        headers: { Authorization: `Bearer ${token()}` },
      });
      if (!res.ok) {
        const data = await res.json();
        throw new Error(data.detail || "Failed to fetch feedback");
      }
      const data = await res.json();
      setFeedback(data.feedback || []);
      setAvgScore(data.avg_score || 0);
      setTotal(data.total_feedback || 0);
    } catch (err: any) {
      setError(err.message || "Could not load feedback.");
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    loadFeedback();
  }, [bot]);

  if (!bot) return null;

  return (
    <div className="cl-page">
      <div className="cl-page-header">
        <h1 className="cl-page-title">Feedback</h1>
        <p className="cl-page-sub">Help us improve your bot by rating its performance and sharing what can be better.</p>
      </div>

      {loading ? (
        <div className="cl-loading">Loading feedback…</div>
      ) : error ? (
        <div className="cl-error">{error}</div>
      ) : (
        <>
          <div className="cl-stats-grid">
            <div className="cl-stat-card">
              <div className="cl-stat-value">{avgScore.toFixed(1)}</div>
              <div className="cl-stat-label">Avg score</div>
            </div>
            <div className="cl-stat-card">
              <div className="cl-stat-value">{total}</div>
              <div className="cl-stat-label">Feedback submissions</div>
            </div>
          </div>

          <div className="cl-section">
            <FeedbackWidget bot={bot} onSuccess={loadFeedback} />
          </div>

          <div className="cl-section">
            <h2 className="cl-section-title">Recent feedback</h2>
            {feedback.length === 0 ? (
              <div className="cl-empty">No feedback submitted yet.</div>
            ) : (
              <div className="feedback-list">
                {feedback.map((item) => (
                  <div key={item.id} className="feedback-card">
                    <div className="feedback-card-header">
                      <span className="rating-pill">{item.rating} ★</span>
                      <span className="feedback-category">{item.category}</span>
                    </div>
                    <p className="feedback-comment">{item.comment || "No comment provided."}</p>
                    <div className="feedback-meta">
                      <span>{item.user_name}</span>
                      <span>{new Date(item.created_at).toLocaleDateString()}</span>
                    </div>
                  </div>
                ))}
              </div>
            )}
          </div>
        </>
      )}
    </div>
  );
}
