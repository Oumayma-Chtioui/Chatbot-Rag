import { useState, useEffect } from "react";
import * as api from "./api";

interface Props {
  bot: any;
  onBack: () => void;
}

const TABS = [
  { key: "overview",   label: "Overview",   icon: "▦" },
  { key: "documents",  label: "Documents",  icon: "◈" },
  { key: "feedback",   label: "Feedback",   icon: "✦" },
  { key: "messages",   label: "Messages",   icon: "✉" },
] as const;

type Tab = typeof TABS[number]["key"];

function StatCard({ label, value, sub, accent }: { label: string; value: string | number; sub?: string; accent?: string }) {
  return (
    <div style={{
      background: "var(--bg2)",
      border: "1px solid var(--border)",
      borderRadius: 10,
      padding: "16px 20px",
    }}>
      <div style={{ fontSize: 11, color: "var(--text3)", textTransform: "uppercase", letterSpacing: "0.06em", marginBottom: 8 }}>
        {label}
      </div>
      <div style={{ fontSize: 24, fontWeight: 600, color: accent || "var(--text)", lineHeight: 1, marginBottom: sub ? 4 : 0 }}>
        {value}
      </div>
      {sub && <div style={{ fontSize: 11, color: "var(--text3)", marginTop: 4 }}>{sub}</div>}
    </div>
  );
}

function InfoRow({ label, value, mono }: { label: string; value: string; mono?: boolean }) {
  return (
    <div style={{
      display: "flex",
      alignItems: "center",
      justifyContent: "space-between",
      padding: "10px 0",
      borderBottom: "1px solid var(--border)",
      gap: 16,
    }}>
      <span style={{ fontSize: 13, color: "var(--text3)", flexShrink: 0 }}>{label}</span>
      <span style={{
        fontSize: 13,
        color: "var(--text2)",
        fontFamily: mono ? "'DM Mono', monospace" : "inherit",
        textAlign: "right",
        wordBreak: "break-all",
      }}>
        {value}
      </span>
    </div>
  );
}

function StatusDot({ active }: { active: boolean }) {
  return (
    <span style={{
      display: "inline-flex",
      alignItems: "center",
      gap: 6,
      padding: "3px 10px",
      borderRadius: 20,
      fontSize: 11,
      fontWeight: 600,
      background: active ? "rgba(29,158,117,0.12)" : "rgba(216,90,48,0.1)",
      color: active ? "#1D9E75" : "#D85A30",
    }}>
      <span style={{
        width: 6, height: 6, borderRadius: "50%",
        background: active ? "#1D9E75" : "#D85A30",
        boxShadow: active ? "0 0 0 2px rgba(29,158,117,0.25)" : "none",
      }} />
      {active ? "Active" : "Inactive"}
    </span>
  );
}

export default function AdminBotDashboard({ bot, onBack }: Props) {
  const [tab, setTab]           = useState<Tab>("overview");
  const [feedback, setFeedback] = useState<any[]>([]);
  const [documents, setDocuments] = useState<any[]>([]);
  const [messages, setMessages] = useState<any[]>([]);
  const [analytics, setAnalytics] = useState<any>(null);
  const [loading, setLoading]   = useState(false);

  useEffect(() => { loadTab(tab); }, [tab]);

  const loadTab = async (t: Tab) => {
    setLoading(true);
    try {
      if (t === "overview") {
        try {
          const token = localStorage.getItem("admin_token");
          const res = await fetch(`http://localhost:8000/widgets/bots/${bot.id}/analytics/advanced`, {
            headers: { Authorization: `Bearer ${token}` },
          });
          if (res.ok) setAnalytics(await res.json());
        } catch { /* analytics optional */ }
      }
      if (t === "feedback") {
        const data = await api.getAdminFeedback();
        setFeedback((data.feedback || []).filter((f: any) => f.bot_id === bot.id));
      }
      if (t === "documents") {
        const data = await api.getAdminDocuments();
        setDocuments((data.documents || []).filter((d: any) => d.user_id === bot.id || d.user_id === String(bot.owner_id)));
      }
    } catch (err) {
      console.error(err);
    } finally {
      setLoading(false);
    }
  };

  const owner = bot.owner || {};

  return (
    <div style={{ display: "flex", flexDirection: "column", gap: 0 }}>

      {/* ── Header ── */}
      <div style={{
        display: "flex",
        alignItems: "flex-start",
        justifyContent: "space-between",
        marginBottom: 28,
        gap: 16,
        flexWrap: "wrap",
      }}>
        <div style={{ display: "flex", alignItems: "center", gap: 14 }}>
          <button
            onClick={onBack}
            style={{
              background: "var(--bg2)",
              border: "1px solid var(--border)",
              borderRadius: 8,
              color: "var(--text2)",
              cursor: "pointer",
              fontSize: 13,
              padding: "7px 12px",
              display: "flex",
              alignItems: "center",
              gap: 6,
              transition: "border-color 0.15s, color 0.15s",
              flexShrink: 0,
            }}
            onMouseEnter={e => { e.currentTarget.style.borderColor = "var(--border2)"; e.currentTarget.style.color = "var(--text)"; }}
            onMouseLeave={e => { e.currentTarget.style.borderColor = "var(--border)";  e.currentTarget.style.color = "var(--text2)"; }}
          >
            ← Back
          </button>

          {/* Bot avatar + name */}
          <div style={{ display: "flex", alignItems: "center", gap: 12 }}>
            <div style={{
              width: 44, height: 44,
              borderRadius: 12,
              background: "rgba(127,119,221,0.15)",
              border: "1px solid rgba(127,119,221,0.25)",
              display: "flex", alignItems: "center", justifyContent: "center",
              fontSize: 18, color: "var(--accent)", flexShrink: 0,
            }}>
              ◉
            </div>
            <div>
              <div style={{ fontSize: 18, fontWeight: 600, color: "var(--text)", letterSpacing: "-0.02em", lineHeight: 1.2 }}>
                {bot.name}
              </div>
              <div style={{ fontSize: 12, color: "var(--text3)", marginTop: 3 }}>
                {owner.email || "—"}
              </div>
            </div>
          </div>
        </div>

        <StatusDot active={bot.is_active !== false} />
      </div>

      {/* ── Tabs ── */}
      <div style={{
        display: "flex",
        gap: 4,
        marginBottom: 24,
        background: "var(--bg2)",
        border: "1px solid var(--border)",
        borderRadius: 10,
        padding: 4,
        width: "fit-content",
      }}>
        {TABS.map(({ key, label, icon }) => (
          <button
            key={key}
            onClick={() => setTab(key)}
            style={{
              display: "flex",
              alignItems: "center",
              gap: 7,
              padding: "7px 14px",
              borderRadius: 7,
              border: "none",
              background: tab === key ? "var(--bg)" : "transparent",
              color: tab === key ? "var(--text)" : "var(--text3)",
              fontSize: 13,
              fontFamily: "inherit",
              fontWeight: tab === key ? 500 : 400,
              cursor: "pointer",
              transition: "background 0.15s, color 0.15s",
              boxShadow: tab === key ? "0 1px 3px rgba(0,0,0,0.15)" : "none",
              whiteSpace: "nowrap",
            }}
          >
            <span style={{ fontSize: 12 }}>{icon}</span>
            {label}
          </button>
        ))}
      </div>

      {/* ── Loading ── */}
      {loading && (
        <div style={{ padding: "32px 0", textAlign: "center", color: "var(--text3)", fontSize: 13 }}>
          Loading…
        </div>
      )}

      {/* ════ OVERVIEW ════ */}
      {!loading && tab === "overview" && (
        <div style={{ display: "flex", flexDirection: "column", gap: 20 }}>

          {/* Stat row */}
          <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(140px, 1fr))", gap: 12 }}>
            <StatCard label="Total messages"  value={(bot.message_count ?? analytics?.total ?? 0).toLocaleString()} />
            <StatCard label="Documents"       value={bot.doc_count ?? analytics?.quota?.docs_used ?? 0} />
            <StatCard label="Success rate"    value={analytics ? `${analytics.success_rate}%` : "—"} accent={analytics?.success_rate >= 80 ? "#1D9E75" : analytics?.success_rate >= 60 ? "#BA7517" : undefined} />
            <StatCard label="Avg response"    value={analytics?.response_times?.length ? `${Math.round(analytics.response_times.filter((r: any) => r.avg_ms).reduce((s: number, r: any) => s + (r.avg_ms || 0), 0) / (analytics.response_times.filter((r: any) => r.avg_ms).length || 1))} ms` : "—"} />
          </div>

          {/* Two-column: info + owner */}
          <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 16 }}>

            {/* Bot info */}
            <div style={{ background: "var(--bg2)", border: "1px solid var(--border)", borderRadius: 10, padding: "18px 20px" }}>
              <div style={{ fontSize: 11, color: "var(--text3)", textTransform: "uppercase", letterSpacing: "0.06em", marginBottom: 14 }}>
                Bot details
              </div>
              <div>
                <InfoRow label="Bot ID"         value={bot.id}             mono />
                <InfoRow label="Created"        value={bot.created_at ? new Date(bot.created_at).toLocaleDateString("en-GB", { day: "2-digit", month: "short", year: "numeric" }) : "—"} />
                <InfoRow label="Allowed origin" value={bot.allowed_origin || "Any origin"} />
                <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", padding: "10px 0", gap: 16 }}>
                  <span style={{ fontSize: 13, color: "var(--text3)" }}>Status</span>
                  <StatusDot active={bot.is_active !== false} />
                </div>
              </div>
            </div>

            {/* Owner info */}
            <div style={{ background: "var(--bg2)", border: "1px solid var(--border)", borderRadius: 10, padding: "18px 20px" }}>
              <div style={{ fontSize: 11, color: "var(--text3)", textTransform: "uppercase", letterSpacing: "0.06em", marginBottom: 14 }}>
                Owner
              </div>
              {owner.name || owner.email ? (
                <>
                  <div style={{ display: "flex", alignItems: "center", gap: 10, marginBottom: 14 }}>
                    <div style={{
                      width: 36, height: 36, borderRadius: "50%",
                      background: "rgba(127,119,221,0.15)",
                      color: "var(--accent-light)",
                      display: "flex", alignItems: "center", justifyContent: "center",
                      fontSize: 13, fontWeight: 600, flexShrink: 0,
                    }}>
                      {(owner.name || owner.email || "?").charAt(0).toUpperCase()}
                    </div>
                    <div>
                      <div style={{ fontSize: 13, fontWeight: 500, color: "var(--text)" }}>{owner.name || "—"}</div>
                      <div style={{ fontSize: 11, color: "var(--text3)" }}>{owner.email || "—"}</div>
                    </div>
                  </div>
                  <InfoRow label="Owner ID" value={String(bot.owner_id || "—")} mono />
                </>
              ) : (
                <div style={{ fontSize: 13, color: "var(--text3)" }}>No owner info available.</div>
              )}
            </div>
          </div>

          {/* Unanswered questions if analytics available */}
          {analytics?.unanswered_questions?.length > 0 && (
            <div style={{ background: "var(--bg2)", border: "1px solid var(--border)", borderRadius: 10, padding: "18px 20px" }}>
              <div style={{ fontSize: 11, color: "var(--text3)", textTransform: "uppercase", letterSpacing: "0.06em", marginBottom: 14, display: "flex", alignItems: "center", justifyContent: "space-between" }}>
                <span>Unanswered questions</span>
                <span style={{ padding: "2px 8px", borderRadius: 20, background: "rgba(216,90,48,0.1)", color: "#D85A30", fontSize: 11, fontWeight: 700 }}>
                  {analytics.unanswered_questions.length}
                </span>
              </div>
              <div style={{ display: "flex", flexDirection: "column", gap: 6 }}>
                {analytics.unanswered_questions.slice(0, 5).map((q: any, i: number) => (
                  <div key={i} style={{
                    display: "flex", alignItems: "flex-start", gap: 10,
                    padding: "10px 12px",
                    background: "var(--bg3)",
                    borderRadius: 8,
                    fontSize: 13,
                  }}>
                    <span style={{ color: "#D85A30", flexShrink: 0, marginTop: 1, fontSize: 12 }}>?</span>
                    <span style={{ color: "var(--text2)", lineHeight: 1.5 }}>{q.question}</span>
                  </div>
                ))}
              </div>
            </div>
          )}
        </div>
      )}

      {/* ════ DOCUMENTS ════ */}
      {!loading && tab === "documents" && (
        <div>
          {documents.length === 0 ? (
            <div style={{ padding: "40px 0", textAlign: "center", color: "var(--text3)", fontSize: 13 }}>
              No documents found for this bot.
            </div>
          ) : (
            <div style={{ display: "flex", flexDirection: "column", gap: 6 }}>
              {documents.map((d) => (
                <div key={d.id} style={{
                  display: "flex",
                  alignItems: "center",
                  gap: 12,
                  padding: "12px 16px",
                  background: "var(--bg2)",
                  border: "1px solid var(--border)",
                  borderRadius: 10,
                }}>
                  <div style={{
                    width: 34, height: 34, borderRadius: 8, flexShrink: 0,
                    background: d.type === "url" ? "rgba(127,119,221,0.1)" : "rgba(29,158,117,0.1)",
                    color: d.type === "url" ? "var(--accent)" : "#1D9E75",
                    display: "flex", alignItems: "center", justifyContent: "center",
                    fontSize: 14,
                  }}>
                    {d.type === "url" ? "🔗" : "◈"}
                  </div>
                  <div style={{ flex: 1, minWidth: 0 }}>
                    <div style={{ fontSize: 13, color: "var(--text)", overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>
                      {d.name}
                    </div>
                    <div style={{ fontSize: 11, color: "var(--text3)", marginTop: 2 }}>
                      {d.size} · {d.chunks || 0} chunks · {d.type?.toUpperCase()}
                    </div>
                  </div>
                  <span style={{
                    padding: "3px 9px", borderRadius: 20, fontSize: 11, fontWeight: 600,
                    background: d.status === "indexed" ? "rgba(29,158,117,0.12)" : "rgba(186,117,23,0.12)",
                    color: d.status === "indexed" ? "#1D9E75" : "#BA7517",
                  }}>
                    {d.status}
                  </span>
                </div>
              ))}
            </div>
          )}
        </div>
      )}

      {/* ════ FEEDBACK ════ */}
      {!loading && tab === "feedback" && (
        <div>
          {feedback.length === 0 ? (
            <div style={{ padding: "40px 0", textAlign: "center", color: "var(--text3)", fontSize: 13 }}>
              No feedback submitted for this bot yet.
            </div>
          ) : (
            <>
              {/* Avg score banner */}
              <div style={{
                display: "flex",
                alignItems: "center",
                gap: 20,
                padding: "16px 20px",
                background: "var(--bg2)",
                border: "1px solid var(--border)",
                borderRadius: 10,
                marginBottom: 16,
              }}>
                <div>
                  <div style={{ fontSize: 32, fontWeight: 700, color: "var(--accent)", lineHeight: 1 }}>
                    {(feedback.reduce((s, f) => s + (f.rating || 0), 0) / feedback.length).toFixed(1)}
                  </div>
                  <div style={{ fontSize: 11, color: "var(--text3)", marginTop: 3 }}>Average rating</div>
                </div>
                <div style={{ width: 1, height: 40, background: "var(--border)" }} />
                <div>
                  <div style={{ fontSize: 24, fontWeight: 600, color: "var(--text)", lineHeight: 1 }}>{feedback.length}</div>
                  <div style={{ fontSize: 11, color: "var(--text3)", marginTop: 3 }}>Total reviews</div>
                </div>
                {/* Star display */}
                <div style={{ marginLeft: "auto", display: "flex", gap: 3 }}>
                  {[1,2,3,4,5].map(s => (
                    <span key={s} style={{
                      fontSize: 20,
                      color: s <= Math.round(feedback.reduce((a, f) => a + (f.rating||0), 0) / feedback.length)
                        ? "var(--accent)" : "var(--bg3)",
                    }}>★</span>
                  ))}
                </div>
              </div>

              <div style={{ display: "flex", flexDirection: "column", gap: 8 }}>
                {feedback.map((item: any) => (
                  <div key={item.id} style={{
                    background: "var(--bg2)",
                    border: "1px solid var(--border)",
                    borderRadius: 10,
                    padding: "14px 16px",
                  }}>
                    <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", marginBottom: 8 }}>
                      <div style={{ display: "flex", alignItems: "center", gap: 8 }}>
                        <div style={{
                          width: 28, height: 28, borderRadius: "50%",
                          background: "rgba(127,119,221,0.15)",
                          color: "var(--accent-light)",
                          display: "flex", alignItems: "center", justifyContent: "center",
                          fontSize: 11, fontWeight: 600,
                        }}>
                          {(item.user_name || "?").charAt(0).toUpperCase()}
                        </div>
                        <span style={{ fontSize: 13, color: "var(--text)", fontWeight: 500 }}>{item.user_name || "Anonymous"}</span>
                        <span style={{
                          padding: "2px 8px", borderRadius: 20,
                          background: "rgba(127,119,221,0.1)", color: "var(--accent-light)",
                          fontSize: 11,
                        }}>
                          {item.category}
                        </span>
                      </div>
                      <div style={{ display: "flex", gap: 2 }}>
                        {[1,2,3,4,5].map(s => (
                          <span key={s} style={{ fontSize: 14, color: s <= item.rating ? "var(--accent)" : "var(--bg3)" }}>★</span>
                        ))}
                      </div>
                    </div>
                    {item.comment && (
                      <p style={{ fontSize: 13, color: "var(--text2)", margin: 0, lineHeight: 1.55 }}>
                        "{item.comment}"
                      </p>
                    )}
                    <div style={{ fontSize: 11, color: "var(--text3)", marginTop: 8 }}>
                      {item.created_at ? new Date(item.created_at).toLocaleDateString("en-GB", { day: "2-digit", month: "short", year: "numeric" }) : ""}
                    </div>
                  </div>
                ))}
              </div>
            </>
          )}
        </div>
      )}

      {/* ════ MESSAGES ════ */}
      {!loading && tab === "messages" && (
        <div style={{ padding: "40px 0", textAlign: "center", color: "var(--text3)", fontSize: 13 }}>
          Message history is available in the widget analytics on the client dashboard.
        </div>
      )}
    </div>
  );
}