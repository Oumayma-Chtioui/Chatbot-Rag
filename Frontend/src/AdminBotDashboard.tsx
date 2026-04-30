import { useState, useEffect, useCallback, useRef } from "react";
import {
  AreaChart, Area,
  XAxis, YAxis,
  Tooltip, ResponsiveContainer,
} from "recharts";
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
type Period = "week" | "month" | "year";

// ── Chart helpers ─────────────────────────────────────────────────────────────
type ChartPoint = { date: string; messages: number; sessions: number };

function fmt(d: Date, opts: Intl.DateTimeFormatOptions) {
  return d.toLocaleDateString("en-US", opts);
}

function buildMsgChartData(
  raw: { date: string; count: number }[],
  period: Period,
  offset: number
): { label: string; messages: number }[] {
  const today = new Date();
  const rawMap: Record<string, number> = {};
  raw.forEach(r => { rawMap[r.date.slice(0, 10)] = r.count; });

  if (period === "week") {
    const start = new Date(today);
    start.setDate(today.getDate() - today.getDay() + offset * 7);
    return Array.from({ length: 7 }, (_, i) => {
      const d = new Date(start);
      d.setDate(start.getDate() + i);
      return { label: fmt(d, { weekday: "short" }), messages: rawMap[d.toISOString().slice(0, 10)] ?? 0 };
    });
  }
  if (period === "month") {
    const ref = new Date(today.getFullYear(), today.getMonth() + offset, 1);
    const days = new Date(ref.getFullYear(), ref.getMonth() + 1, 0).getDate();
    return Array.from({ length: days }, (_, i) => {
      const d = new Date(ref.getFullYear(), ref.getMonth(), i + 1);
      return { label: `${i + 1}`, messages: rawMap[d.toISOString().slice(0, 10)] ?? 0 };
    });
  }
  const year = today.getFullYear() + offset;
  return ["Jan","Feb","Mar","Apr","May","Jun","Jul","Aug","Sep","Oct","Nov","Dec"].map((label, m) => ({
    label,
    messages: raw
      .filter(r => { const d = new Date(r.date); return d.getFullYear() === year && d.getMonth() === m; })
      .reduce((s, r) => s + r.count, 0),
  }));
}

function periodLabel(period: Period, offset: number): string {
  const today = new Date();
  if (period === "week") {
    const start = new Date(today);
    start.setDate(today.getDate() - today.getDay() + offset * 7);
    const end = new Date(start);
    end.setDate(start.getDate() + 6);
    return `${fmt(start, { month: "short", day: "numeric" })} – ${fmt(end, { month: "short", day: "numeric" })}`;
  }
  if (period === "month") {
    const ref = new Date(today.getFullYear(), today.getMonth() + offset, 1);
    return fmt(ref, { month: "long", year: "numeric" });
  }
  return String(today.getFullYear() + offset);
}

const MsgTooltip = ({ active, payload, label }: any) => {
  if (!active || !payload?.length) return null;
  return (
    <div style={{ background: "var(--bg2)", border: "1px solid var(--border)", borderRadius: 8, padding: "6px 10px", fontSize: 12 }}>
      <div style={{ color: "var(--text3)", marginBottom: 2 }}>{label}</div>
      <div style={{ color: "#AFA9EC", fontWeight: 500 }}>{payload[0].value} messages</div>
    </div>
  );
};

// ── Helpers ───────────────────────────────────────────────────────────────────

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
  const [chartPeriod, setChartPeriod] = useState<Period>("week");
  const [chartOffset, setChartOffset] = useState(0);

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
  const chartData = analytics
    ? buildMsgChartData(analytics.messages_per_day ?? [], chartPeriod, chartOffset)
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
              <div style={{ fontSize: 13, fontWeight: 600, color: "var(--text)" }}>
                Messages over time
              </div>
              <div style={{ display: "flex", alignItems: "center", gap: 10, flexWrap: "wrap" }}>
                {/* Period pills */}
                <div style={{ display: "flex", gap: 4 }}>
                  {(["week", "month", "year"] as Period[]).map(p => (
                    <button
                      key={p}
                      onClick={() => { setChartPeriod(p); setChartOffset(0); }}
                      style={{
                        padding: "4px 12px", borderRadius: 20, fontSize: 12, fontWeight: 500,
                        border: "1px solid",
                        borderColor: chartPeriod === p ? "var(--accent)" : "var(--border)",
                        background: chartPeriod === p ? "rgba(127,119,221,0.15)" : "var(--bg3)",
                        color: chartPeriod === p ? "var(--accent-light, #AFA9EC)" : "var(--text3)",
                        cursor: "pointer", fontFamily: "inherit",
                      }}
                    >
                      {p.charAt(0).toUpperCase() + p.slice(1)}
                    </button>
                  ))}
                </div>
                {/* Nav arrows + label */}
                <div style={{ display: "flex", alignItems: "center", gap: 6 }}>
                  <button
                    onClick={() => setChartOffset(o => o - 1)}
                    style={{ width: 26, height: 26, borderRadius: 7, border: "1px solid var(--border)", background: "var(--bg3)", color: "var(--text2)", cursor: "pointer", display: "flex", alignItems: "center", justifyContent: "center", fontSize: 12 }}
                  >←</button>
                  <span style={{ fontSize: 12, color: "var(--text2)", minWidth: 130, textAlign: "center", fontWeight: 500 }}>
                    {periodLabel(chartPeriod, chartOffset)}
                  </span>
                  <button
                    onClick={() => setChartOffset(o => Math.min(0, o + 1))}
                    disabled={chartOffset >= 0}
                    style={{ width: 26, height: 26, borderRadius: 7, border: "1px solid var(--border)", background: "var(--bg3)", color: "var(--text2)", cursor: chartOffset >= 0 ? "default" : "pointer", display: "flex", alignItems: "center", justifyContent: "center", fontSize: 12, opacity: chartOffset >= 0 ? 0.3 : 1 }}
                  >→</button>
                </div>
              </div>
            </div>

            <ResponsiveContainer width="100%" height={190}>
              <AreaChart data={chartData} margin={{ left: -10, right: 4 }}>
                <defs>
                  <linearGradient id="gMsgAdmin" x1="0" y1="0" x2="0" y2="1">
                    <stop offset="5%"  stopColor="#7F77DD" stopOpacity={0.25} />
                    <stop offset="95%" stopColor="#7F77DD" stopOpacity={0} />
                  </linearGradient>
                </defs>
                <XAxis dataKey="label" tick={{ fontSize: 10, fill: "var(--text3)" }} interval={chartPeriod === "month" ? 4 : 0} />
                <YAxis tick={{ fontSize: 10, fill: "var(--text3)" }} width={28} />
                <Tooltip content={<MsgTooltip />} />
                <Area type="monotone" dataKey="messages" stroke="#7F77DD" fill="url(#gMsgAdmin)" strokeWidth={2} dot={chartPeriod === "week"} />
              </AreaChart>
            </ResponsiveContainer>
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