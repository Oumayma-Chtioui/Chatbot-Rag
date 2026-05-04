// Frontend/src/ClientFeedback.tsx
// Updated: accent color from bot, bot name shown in header

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

interface TestSession {
  session_id: string;
  email: string;
  granted_at: string;
  expires_at: string;
  duration_label: string;
  is_active: boolean;
}

interface Props {
  bot: Bot | null;
}

const TEST_DURATIONS = [
  { label: "30 min",       minutes: 30 },
  { label: "1 hour",       minutes: 60 },
  { label: "6 hours",      minutes: 360 },
  { label: "24 hours",     minutes: 1440 },
  { label: "7 days",       minutes: 10080 },
  { label: "Always active",minutes: 0 },
];

function minutesUntilExpiry(expiresAt: string): string {
  if (!expiresAt) return "Always active";
  const diff = new Date(expiresAt).getTime() - Date.now();
  if (diff <= 0) return "Expired";
  const mins = Math.floor(diff / 60000);
  if (mins < 60) return `${mins}m remaining`;
  const hrs = Math.floor(mins / 60);
  const rem = mins % 60;
  return rem > 0 ? `${hrs}h ${rem}m remaining` : `${hrs}h remaining`;
}

export default function ClientFeedback({ bot }: Props) {
  const [feedback,     setFeedback]     = useState<FeedbackItem[]>([]);
  const [avgScore,     setAvgScore]     = useState(0);
  const [total,        setTotal]        = useState(0);
  const [loading,      setLoading]      = useState(true);
  const [error,        setError]        = useState<string | null>(null);
  const [allowTesting, setAllowTesting] = useState(false);
  const [testDuration, setTestDuration] = useState(TEST_DURATIONS[0]);
  const [testSessions, setTestSessions] = useState<TestSession[]>([]);
  const [activating,   setActivating]   = useState(false);
  const [testMsg,      setTestMsg]      = useState<string | null>(null);

  const accent = bot?.accent_color || "var(--accent)";

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

  const loadTestSessions = async () => {
    if (!bot) return;
    try {
      const res = await fetch(`${API}/widgets/bots/${bot.id}/test-sessions`, {
        headers: { Authorization: `Bearer ${token()}` },
      });
      if (res.ok) {
        const data = await res.json();
        setTestSessions(data.sessions || []);
      }
    } catch { /* silently fail */ }
  };

  useEffect(() => {
    loadFeedback();
    loadTestSessions();
  }, [bot]);

  const handleActivateTest = async () => {
    if (!bot) return;
    setActivating(true);
    setTestMsg(null);
    try {
      const res = await fetch(`${API}/widgets/bots/${bot.id}/test-sessions`, {
        method: "POST",
        headers: { "Content-Type": "application/json", Authorization: `Bearer ${token()}` },
        body: JSON.stringify({ duration_minutes: testDuration.minutes }),
      });
      if (!res.ok) {
        const e = await res.json();
        throw new Error(e.detail || "Failed to activate test access");
      }
      const data = await res.json();
      setTestMsg(
        testDuration.minutes === 0
          ? "Permanent test access granted."
          : `Test access activated for ${testDuration.label}. Expires at ${new Date(data.expires_at).toLocaleTimeString()}.`
      );
      setAllowTesting(false);
      await loadTestSessions();
    } catch (err: any) {
      setTestMsg(`Error: ${err.message}`);
    } finally {
      setActivating(false);
    }
  };

  const handleRevokeTest = async (sessionId: string) => {
    if (!bot) return;
    try {
      await fetch(`${API}/widgets/bots/${bot.id}/test-sessions/${sessionId}`, {
        method: "DELETE",
        headers: { Authorization: `Bearer ${token()}` },
      });
      await loadTestSessions();
    } catch { /* silently fail */ }
  };

  if (!bot) return null;

  return (
    <div className="cl-page">
      <div className="cl-page-header">
        <h1 className="cl-page-title">Feedback</h1>
        <p className="cl-page-sub">
          Ratings for <strong>{bot.name}</strong> · manage temporary admin test access.
        </p>
      </div>

      {loading ? (
        <div className="cl-loading">Loading feedback…</div>
      ) : error ? (
        <div className="cl-error">{error}</div>
      ) : (
        <>
          <div className="cl-stats-grid">
            <div className="cl-stat-card">
              <div className="cl-stat-icon" style={{ color: accent }}>★</div>
              <div className="cl-stat-value">{avgScore.toFixed(1)}</div>
              <div className="cl-stat-label">Avg score</div>
            </div>
            <div className="cl-stat-card">
              <div className="cl-stat-icon" style={{ color: accent }}>✉</div>
              <div className="cl-stat-value">{total}</div>
              <div className="cl-stat-label">Submissions</div>
            </div>
          </div>

          <div className="cl-section">
            <div className="cl-feedback-card">
              <div className="cl-section-title">Share feedback</div>
              <p className="cl-hint">Rate the bot so we can improve accuracy, speed, and relevance.</p>
              <FeedbackWidget bot={bot} onSuccess={loadFeedback} />

              {/* Allow testing toggle */}
              <div style={{ marginTop: 20, paddingTop: 16, borderTop: "1px solid var(--border)", display: "flex", flexDirection: "column", gap: 10 }}>
                <div style={{ display: "flex", alignItems: "center", gap: 10, flexWrap: "wrap" }}>
                  <label style={{
                    display: "flex", alignItems: "center", gap: 8,
                    cursor: "pointer", padding: "7px 14px",
                    borderRadius: "var(--radius-sm)",
                    border: "1px solid var(--border)",
                    background: allowTesting ? `${accent}11` : "var(--bg2)",
                    fontSize: 13, color: "var(--text2)", userSelect: "none",
                  } as React.CSSProperties}>
                    <input
                      type="checkbox"
                      checked={allowTesting}
                      onChange={(e) => { setAllowTesting(e.target.checked); setTestMsg(null); }}
                      style={{ accentColor: accent }}
                    />
                    Allow admin testing
                  </label>
                </div>

                {allowTesting && (
                  <div style={{
                    display: "flex", alignItems: "center", gap: 10, flexWrap: "wrap",
                    padding: "12px 14px", background: "var(--bg2)",
                    borderRadius: "var(--radius-sm)", border: "1px solid var(--border)",
                  }}>
                    <span style={{ fontSize: 13, color: "var(--text2)", whiteSpace: "nowrap" }}>Duration:</span>
                    <div style={{ display: "flex", gap: 6, flexWrap: "wrap" }}>
                      {TEST_DURATIONS.map((d) => (
                        <label
                          key={d.label}
                          style={{
                            display: "flex", alignItems: "center", gap: 5,
                            fontSize: 12, padding: "5px 10px", borderRadius: 20,
                            border: "1px solid",
                            borderColor: testDuration.label === d.label ? accent : "var(--border)",
                            background: testDuration.label === d.label ? `${accent}18` : "var(--bg3)",
                            color: testDuration.label === d.label ? accent : "var(--text2)",
                            cursor: "pointer", userSelect: "none",
                          } as React.CSSProperties}
                        >
                          <input
                            type="radio"
                            name="testDuration"
                            checked={testDuration.label === d.label}
                            onChange={() => setTestDuration(d)}
                            style={{ display: "none" }}
                          />
                          {d.label}
                        </label>
                      ))}
                    </div>
                    <button
                      className="cl-btn-primary"
                      onClick={handleActivateTest}
                      disabled={activating}
                      style={{ marginLeft: "auto", background: accent }}
                    >
                      {activating ? "Activating…" : "Activate"}
                    </button>
                  </div>
                )}

                {testMsg && (
                  <div style={{
                    fontSize: 12, padding: "8px 12px", borderRadius: "var(--radius-sm)",
                    background: testMsg.startsWith("Error") ? "rgba(216,90,48,0.08)" : "rgba(29,158,117,0.08)",
                    border: `1px solid ${testMsg.startsWith("Error") ? "rgba(216,90,48,0.2)" : "rgba(29,158,117,0.2)"}`,
                    color: testMsg.startsWith("Error") ? "var(--danger)" : "var(--success)",
                  }}>
                    {testMsg}
                  </div>
                )}
              </div>
            </div>
          </div>

          {/* Active test sessions */}
          {testSessions.length > 0 && (
            <div className="cl-section">
              <h2 className="cl-section-title">Active test sessions</h2>
              <div className="cl-doc-list">
                {testSessions.map((s: any) => (
                  <div key={s.session_id} className="cl-doc-row">
                    <div className="cl-doc-info" style={{ flex: 1 }}>
                      <div className="cl-doc-name">{s.email || "Admin"}</div>
                      <div className="cl-doc-meta">
                        Granted {new Date(s.granted_at).toLocaleDateString()} ·{" "}
                        {s.expires_at ? minutesUntilExpiry(s.expires_at) : "Always active"}
                      </div>
                    </div>
                    <div className={`cl-badge ${s.is_active ? "success" : "warn"}`}>
                      {s.is_active ? "Active" : "Expired"}
                    </div>
                    <button className="cl-btn-danger" onClick={() => handleRevokeTest(s.session_id)}>✕</button>
                  </div>
                ))}
              </div>
            </div>
          )}

          {/* Recent feedback */}
          <div className="cl-section">
            <h2 className="cl-section-title">Recent feedback</h2>
            {feedback.length === 0 ? (
              <div className="cl-empty">No feedback submitted yet.</div>
            ) : (
              <div className="feedback-list">
                {feedback.map((item) => (
                  <div key={item.id} className="feedback-card">
                    <div className="feedback-card-header">
                      <span className="rating-pill" style={{ background: `${accent}18`, color: accent }}>
                        {item.rating} ★
                      </span>
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