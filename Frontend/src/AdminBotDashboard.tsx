import { useState, useEffect, useCallback, useRef } from "react";
import * as api from "./api";

interface Props {
  bot: any;
  onBack: () => void;
}

const TABS = [
  { key: "overview",  label: "Overview",  icon: "▦" },
  { key: "documents", label: "Documents", icon: "◈" },
  { key: "feedback",  label: "Feedback",  icon: "✦" },
  { key: "messages",  label: "Messages",  icon: "✉" },
] as const;

type Tab = typeof TABS[number]["key"];

// ── Period filter ─────────────────────────────────────────────────────────────
const PERIODS = [
  { label: "7d",  value: 7  },
  { label: "30d", value: 30 },
  { label: "90d", value: 90 },
] as const;
type Period = typeof PERIODS[number]["value"];

// ── Dual-line SVG chart ───────────────────────────────────────────────────────
type ChartPoint = { date: string; messages: number; sessions: number };

function DualLineChart({ data }: { data: ChartPoint[] }) {
  const W = 560, H = 150;
  const PAD = { top: 14, right: 12, bottom: 26, left: 34 };
  const iW = W - PAD.left - PAD.right;
  const iH = H - PAD.top - PAD.bottom;
  const n  = data.length;

  if (!n) return (
    <div style={{ height: 150, display: "flex", alignItems: "center", justifyContent: "center", color: "var(--text3)", fontSize: 12 }}>
      No data available
    </div>
  );

  const allVals = data.flatMap(d => [d.messages, d.sessions]);
  const maxVal  = Math.max(...allVals, 1);

  const x = (i: number) => PAD.left + (n === 1 ? iW / 2 : (i / (n - 1)) * iW);
  const y = (v: number) => PAD.top + iH - (v / maxVal) * iH;

  const pts = (key: "messages" | "sessions") =>
    data.map((d, i) => `${x(i)},${y(d[key])}`).join(" ");

  const area = (key: "messages" | "sessions") =>
    `${x(0)},${PAD.top + iH} ${pts(key)} ${x(n - 1)},${PAD.top + iH}`;

  const ticks = [0, 0.5, 1].map(t => Math.round(t * maxVal));

  // Show at most ~8 x-labels
  const step = Math.max(1, Math.ceil(n / 8));

  return (
    <svg viewBox={`0 0 ${W} ${H}`} style={{ width: "100%", height: "auto", overflow: "visible" }}>
      <defs>
        <linearGradient id="gMsg" x1="0" y1="0" x2="0" y2="1">
          <stop offset="0%" stopColor="#7f77dd" stopOpacity="0.22" />
          <stop offset="100%" stopColor="#7f77dd" stopOpacity="0" />
        </linearGradient>
        <linearGradient id="gSes" x1="0" y1="0" x2="0" y2="1">
          <stop offset="0%" stopColor="#34d399" stopOpacity="0.18" />
          <stop offset="100%" stopColor="#34d399" stopOpacity="0" />
        </linearGradient>
      </defs>

      {/* Grid */}
      {ticks.map((tick, i) => (
        <g key={i}>
          <line x1={PAD.left} x2={PAD.left + iW} y1={y(tick)} y2={y(tick)}
            stroke="var(--border)" strokeWidth="1" strokeDasharray="3 3" />
          <text x={PAD.left - 6} y={y(tick) + 4} fill="var(--text3)" fontSize="9" textAnchor="end">
            {tick}
          </text>
        </g>
      ))}

      {/* Areas */}
      <polygon points={area("messages")} fill="url(#gMsg)" />
      <polygon points={area("sessions")} fill="url(#gSes)" />

      {/* Lines */}
      <polyline points={pts("messages")} fill="none" stroke="#7f77dd" strokeWidth="2"
        strokeLinejoin="round" strokeLinecap="round" />
      <polyline points={pts("sessions")} fill="none" stroke="#34d399" strokeWidth="2"
        strokeLinejoin="round" strokeLinecap="round" />

      {/* Dots + x-labels */}
      {data.map((d, i) => (
        <g key={i}>
          <circle cx={x(i)} cy={y(d.messages)} r="3" fill="#7f77dd" />
          <circle cx={x(i)} cy={y(d.sessions)}  r="3" fill="#34d399" />
          {i % step === 0 && (
            <text x={x(i)} y={H - 4} fill="var(--text3)" fontSize="8" textAnchor="middle">
              {d.date.slice(5)}
            </text>
          )}
        </g>
      ))}
    </svg>
  );
}

// ── Helpers ───────────────────────────────────────────────────────────────────
function buildChartData(
  msgsPerDay: { date: string; count: number }[],
  sesPerDay:  { date: string; count: number }[],
  days: number
): ChartPoint[] {
  const dateSet = new Set([...msgsPerDay.map(d => d.date), ...sesPerDay.map(d => d.date)]);
  const sorted  = Array.from(dateSet).sort().slice(-days);
  const mMap    = Object.fromEntries(msgsPerDay.map(d => [d.date, d.count]));
  const sMap    = Object.fromEntries(sesPerDay.map(d  => [d.date, d.count]));
  return sorted.map(date => ({ date, messages: mMap[date] ?? 0, sessions: sMap[date] ?? 0 }));
}

// ── Sub-components ────────────────────────────────────────────────────────────
function StatCard({ label, value, sub, accent }: { label: string; value: string | number; sub?: string; accent?: string }) {
  return (
    <div style={{ background: "var(--bg2)", border: "1px solid var(--border)", borderRadius: 10, padding: "16px 20px" }}>
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
      display: "flex", alignItems: "center", justifyContent: "space-between",
      padding: "10px 0", borderBottom: "1px solid var(--border)", gap: 16,
    }}>
      <span style={{ fontSize: 13, color: "var(--text3)", flexShrink: 0 }}>{label}</span>
      <span style={{
        fontSize: 13, color: "var(--text2)",
        fontFamily: mono ? "'DM Mono', monospace" : "inherit",
        textAlign: "right", wordBreak: "break-all",
      }}>
        {value}
      </span>
    </div>
  );
}

function StatusDot({ active }: { active: boolean }) {
  return (
    <span style={{
      display: "inline-flex", alignItems: "center", gap: 6,
      padding: "3px 10px", borderRadius: 20, fontSize: 11, fontWeight: 600,
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

// ── Main ──────────────────────────────────────────────────────────────────────
export default function AdminBotDashboard({ bot: initialBot, onBack }: Props) {
  const [tab, setTab]             = useState<Tab>("overview");
  const [bot, setBot]             = useState<any>(initialBot);
  const [feedback, setFeedback]   = useState<any[]>([]);
  const [documents, setDocuments] = useState<any[]>([]);
  const [analytics, setAnalytics] = useState<any>(null);
  const [loading, setLoading]     = useState(false);
  const [refreshKey, setRefreshKey] = useState(0);
  const [chartPeriod, setChartPeriod] = useState<Period>(30);

  const adminToken = () => localStorage.getItem("admin_token");

  const fetchBot = async () => {
    const token = adminToken();
    if (!token) return;
    const res = await fetch(`http://localhost:8000/admin/bots/${initialBot.id}`, {
      headers: { Authorization: `Bearer ${token}` },
    });
    if (res.ok) {
      const data = await res.json();
      setBot(data);
      localStorage.setItem("admin_selected_chatbot", JSON.stringify(data));
    }
  };

  const loadTab = useCallback(async (t: Tab) => {
    setLoading(true);
    try {
      if (t === "overview") {
        await fetchBot();
        setAnalytics(null);
        const res = await fetch(`http://localhost:8000/admin/bots/${initialBot.id}/analytics`, {
          headers: { Authorization: `Bearer ${adminToken()}` },
        });
        if (res.ok) setAnalytics(await res.json());
      }
      if (t === "feedback") {
        setFeedback([]);
        const data = await api.getAdminFeedback();
        setFeedback((data.feedback || []).filter((f: any) => f.bot_id === initialBot.id));
      }
      if (t === "documents") {
        setDocuments([]);
        const data = await api.getAdminDocuments();
        setDocuments((data.documents || []).filter((d: any) => String(d.user_id) === String(initialBot.id)));
      }
    } finally {
      setLoading(false);
    }
  }, [initialBot.id]);

  useEffect(() => { loadTab(tab); }, [tab, refreshKey, loadTab]);

  const owner = bot.owner || {};

  // Build chart data from analytics
  const chartData: ChartPoint[] = analytics
    ? buildChartData(
        analytics.messages_per_day  ?? [],
        analytics.sessions_per_day  ?? [],   // ensure your API returns this
        chartPeriod
      )
    : [];

  return (
    <div style={{ display: "flex", flexDirection: "column", gap: 0 }}>

      {/* ── Header ── */}
      <div style={{
        display: "flex", alignItems: "flex-start", justifyContent: "space-between",
        marginBottom: 28, gap: 16, flexWrap: "wrap",
      }}>
        <div style={{ display: "flex", alignItems: "center", gap: 14 }}>
          <button
            onClick={onBack}
            style={{
              background: "var(--bg2)", border: "1px solid var(--border)", borderRadius: 8,
              color: "var(--text2)", cursor: "pointer", fontSize: 13, padding: "7px 12px",
              display: "flex", alignItems: "center", gap: 6, transition: "border-color 0.15s, color 0.15s", flexShrink: 0,
            }}
            onMouseEnter={e => { e.currentTarget.style.borderColor = "var(--border2)"; e.currentTarget.style.color = "var(--text)"; }}
            onMouseLeave={e => { e.currentTarget.style.borderColor = "var(--border)";  e.currentTarget.style.color = "var(--text2)"; }}
          >
            ← Back
          </button>
          <button
            onClick={() => setRefreshKey(k => k + 1)}
            disabled={loading}
            style={{
              background: "var(--bg2)", border: "1px solid var(--border)", borderRadius: 8,
              color: loading ? "var(--text3)" : "var(--text2)", fontSize: 12,
              padding: "6px 14px", cursor: loading ? "not-allowed" : "pointer",
              display: "flex", alignItems: "center", gap: 6, opacity: loading ? 0.6 : 1,
            }}
          >
            <span style={{ fontSize: 14, display: "inline-block", animation: loading ? "spin 1s linear infinite" : "none" }}>↻</span>
            Refresh
          </button>

          <div style={{ display: "flex", alignItems: "center", gap: 12 }}>
            <div style={{
              width: 44, height: 44, borderRadius: 12,
              background: "rgba(127,119,221,0.15)", border: "1px solid rgba(127,119,221,0.25)",
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
        display: "flex", gap: 4, marginBottom: 24,
        background: "var(--bg2)", border: "1px solid var(--border)",
        borderRadius: 10, padding: 4, width: "fit-content",
      }}>
        {TABS.map(({ key, label, icon }) => (
          <button
            key={key}
            onClick={() => setTab(key)}
            style={{
              display: "flex", alignItems: "center", gap: 7, padding: "7px 14px",
              borderRadius: 7, border: "none",
              background: tab === key ? "var(--bg)" : "transparent",
              color: tab === key ? "var(--text)" : "var(--text3)",
              fontSize: 13, fontFamily: "inherit", fontWeight: tab === key ? 500 : 400,
              cursor: "pointer", transition: "background 0.15s, color 0.15s",
              boxShadow: tab === key ? "0 1px 3px rgba(0,0,0,0.15)" : "none", whiteSpace: "nowrap",
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

          {/* KPI cards */}
          <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(140px, 1fr))", gap: 12 }}>
            <StatCard label="Total messages" value={analytics?.total ?? 0} />
            <StatCard label="Documents"      value={analytics?.quota?.docs_used ?? 0} />
            <StatCard
              label="Success rate"
              value={analytics?.success_rate !== undefined ? `${analytics.success_rate}%` : "—"}
              accent={analytics?.success_rate >= 80 ? "#1D9E75" : analytics?.success_rate >= 60 ? "#BA7517" : undefined}
            />
            <StatCard
              label="Avg response"
              value={
                analytics?.response_times?.filter((r: any) => r.avg_ms).length
                  ? `${Math.round(analytics.response_times.filter((r: any) => r.avg_ms).reduce((s: number, r: any) => s + r.avg_ms, 0) / analytics.response_times.filter((r: any) => r.avg_ms).length)} ms`
                  : "—"
              }
            />
          </div>

          {/* ── Activity chart ── */}
          <div style={{ background: "var(--bg2)", border: "1px solid var(--border)", borderRadius: 10, padding: "18px 20px" }}>
            {/* Header row */}
            <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", marginBottom: 16, gap: 12, flexWrap: "wrap" }}>
              <div>
                <div style={{ fontSize: 11, color: "var(--text3)", textTransform: "uppercase", letterSpacing: "0.06em", marginBottom: 8 }}>
                  Activity over time
                </div>
                {/* Legend */}
                <div style={{ display: "flex", gap: 14 }}>
                  <div style={{ display: "flex", alignItems: "center", gap: 6 }}>
                    <div style={{ width: 20, height: 2.5, borderRadius: 2, background: "#7f77dd" }} />
                    <span style={{ fontSize: 11, color: "var(--text3)" }}>Messages</span>
                  </div>
                  <div style={{ display: "flex", alignItems: "center", gap: 6 }}>
                    <div style={{ width: 20, height: 2.5, borderRadius: 2, background: "#34d399" }} />
                    <span style={{ fontSize: 11, color: "var(--text3)" }}>Sessions opened</span>
                  </div>
                </div>
              </div>

              {/* Period pills */}
              <div style={{
                display: "flex", gap: 3, background: "var(--bg3, var(--bg))",
                borderRadius: 8, padding: 3, border: "1px solid var(--border)",
              }}>
                {PERIODS.map(p => (
                  <button
                    key={p.value}
                    onClick={() => setChartPeriod(p.value)}
                    style={{
                      padding: "4px 12px", borderRadius: 6, border: "none",
                      cursor: "pointer", fontSize: 12, fontWeight: 500,
                      transition: "all 0.15s",
                      background: chartPeriod === p.value ? "var(--accent)" : "transparent",
                      color: chartPeriod === p.value ? "#fff" : "var(--text3)",
                      fontFamily: "inherit",
                    }}
                  >
                    {p.label}
                  </button>
                ))}
              </div>
            </div>

            <DualLineChart data={chartData} />
          </div>

          <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 16 }}>

            {/* Bot info */}
            <div style={{ background: "var(--bg2)", border: "1px solid var(--border)", borderRadius: 10, padding: "18px 20px" }}>
              <div style={{ fontSize: 11, color: "var(--text3)", textTransform: "uppercase", letterSpacing: "0.06em", marginBottom: 14 }}>
                Bot details
              </div>
              <InfoRow label="Bot ID"         value={bot.id}   mono />
              <InfoRow label="Created"        value={
                bot.created_at
                  ? new Date(bot.created_at).toLocaleDateString("en-GB", { day: "2-digit", month: "short", year: "numeric" })
                  : "—"
              } />
              <InfoRow label="Allowed origin" value={bot.allowed_origin || "Any origin"} />
              <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", padding: "10px 0", gap: 16 }}>
                <span style={{ fontSize: 13, color: "var(--text3)" }}>Status</span>
                <StatusDot active={bot.is_active !== false} />
              </div>
            </div>

            {/* Owner info */}
            <div style={{ background: "var(--bg2)", border: "1px solid var(--border)", borderRadius: 10, padding: "18px 20px" }}>
              <div style={{ fontSize: 11, color: "var(--text3)", textTransform: "uppercase", letterSpacing: "0.06em", marginBottom: 14 }}>
                Owner
              </div>
              {(owner.name && owner.name !== "—") || (owner.email && owner.email !== "—") ? (
                <>
                  <div style={{ display: "flex", alignItems: "center", gap: 10, marginBottom: 14 }}>
                    <div style={{
                      width: 36, height: 36, borderRadius: "50%",
                      background: "rgba(127,119,221,0.15)", color: "var(--accent-light)",
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
                    padding: "10px 12px", background: "var(--bg3)", borderRadius: 8, fontSize: 13,
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
                  display: "flex", alignItems: "center", gap: 12, padding: "12px 16px",
                  background: "var(--bg2)", border: "1px solid var(--border)", borderRadius: 10,
                }}>
                  <div style={{
                    width: 34, height: 34, borderRadius: 8, flexShrink: 0,
                    background: d.type === "url" ? "rgba(127,119,221,0.1)" : "rgba(29,158,117,0.1)",
                    color: d.type === "url" ? "var(--accent)" : "#1D9E75",
                    display: "flex", alignItems: "center", justifyContent: "center", fontSize: 14,
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
              <div style={{
                display: "flex", alignItems: "center", gap: 20, padding: "16px 20px",
                background: "var(--bg2)", border: "1px solid var(--border)", borderRadius: 10, marginBottom: 16,
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
                <div style={{ marginLeft: "auto", display: "flex", gap: 3 }}>
                  {[1,2,3,4,5].map(s => (
                    <span key={s} style={{
                      fontSize: 20,
                      color: s <= Math.round(feedback.reduce((a, f) => a + (f.rating||0), 0) / feedback.length) ? "var(--accent)" : "var(--bg3)",
                    }}>★</span>
                  ))}
                </div>
              </div>

              <div style={{ display: "flex", flexDirection: "column", gap: 8 }}>
                {feedback.map((item: any) => (
                  <div key={item.id} style={{
                    background: "var(--bg2)", border: "1px solid var(--border)", borderRadius: 10, padding: "14px 16px",
                  }}>
                    <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", marginBottom: 8 }}>
                      <div style={{ display: "flex", alignItems: "center", gap: 8 }}>
                        <div style={{
                          width: 28, height: 28, borderRadius: "50%",
                          background: "rgba(127,119,221,0.15)", color: "var(--accent-light)",
                          display: "flex", alignItems: "center", justifyContent: "center",
                          fontSize: 11, fontWeight: 600,
                        }}>
                          {(item.user_name || "?").charAt(0).toUpperCase()}
                        </div>
                        <span style={{ fontSize: 13, color: "var(--text)", fontWeight: 500 }}>{item.user_name || "Anonymous"}</span>
                        <span style={{
                          padding: "2px 8px", borderRadius: 20,
                          background: "rgba(127,119,221,0.1)", color: "var(--accent-light)", fontSize: 11,
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
    </div>
  );
}