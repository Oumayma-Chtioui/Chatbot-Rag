import React, { useEffect, useState, useCallback } from "react";
import {
  AreaChart, Area,
  XAxis, YAxis,
  Tooltip, ResponsiveContainer,
} from "recharts";
import { getAdvancedAnalytics } from "./api";

// ─────────────────────────────────────────────────────────────────────────────
// Types
// ─────────────────────────────────────────────────────────────────────────────

interface Keyword    { word: string; count: number }
interface Unanswered { question: string; created_at: string }
interface DocUsage   { name: string; citations: number }
interface RtPoint    { date: string; avg_ms: number | null; count: number }
interface MsgPoint   { date: string; count: number }

interface Quota {
  messages_used:     number;
  messages_limit:    number;
  docs_used:         number;
  docs_limit:        number;
  storage_mb:        number;
  storage_limit_mb:  number;
  api_keys_used:     number;
  api_keys_limit:    number;
}

interface Analytics {
  total:                    number;
  success_count:            number;
  failure_count:            number;
  success_rate:             number;
  top_keywords:             Keyword[];
  unanswered_questions:     Unanswered[];
  avg_messages_per_session: number;
  total_sessions:           number;
  pending_tickets:          number;
  messages_per_day:         MsgPoint[];
  response_times:           RtPoint[];
  document_usage:           DocUsage[];
  quota:                    Quota;
}

interface Props { bot: { id: string; name: string } }

type Period  = "week" | "month" | "year";
type KwCount = 5 | 10 | 20;
type ClearState = "idle" | "confirming" | "loading" | "done" | "error";

// ─────────────────────────────────────────────────────────────────────────────
// Palette (matches AdminOverview.tsx)
// ─────────────────────────────────────────────────────────────────────────────

const C = {
  purple:  "#7c6aff",
  green:   "#4ade80",
  amber:   "#BA7517",
  red:     "#ff5572",
  green12: "rgba(74,222,128,0.12)",
  red12:   "rgba(255,85,114,0.12)",
};

// ─────────────────────────────────────────────────────────────────────────────
// Helpers
// ─────────────────────────────────────────────────────────────────────────────

function fmt(d: Date, opts: Intl.DateTimeFormatOptions) {
  return d.toLocaleDateString("en-US", opts);
}

function fmtN(n: number) { return (n ?? 0).toLocaleString(); }

function buildMsgChartData(
  raw: MsgPoint[],
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

// ─────────────────────────────────────────────────────────────────────────────
// Shared sub-components
// ─────────────────────────────────────────────────────────────────────────────

/** Tiny chip — mirrors AdminOverview's Chip */
function Chip({ label, positive }: { label: string; positive: boolean }) {
  return (
    <span style={{
      fontSize: 10, fontWeight: 700, padding: "2px 7px", borderRadius: 20,
      background: positive ? C.green12 : C.red12,
      color: positive ? "#1a7a52" : "#c44060",
    }}>{label}</span>
  );
}

/** Period toggle pills */
const PeriodPills: React.FC<{ options: string[]; value: string; onChange: (v: any) => void }> = ({ options, value, onChange }) => (
  <div style={{ display: "flex", gap: 5 }}>
    {options.map(o => (
      <button key={o} onClick={() => onChange(o)} style={{
        padding: "4px 12px", borderRadius: 20, border: "1px solid",
        borderColor: value === o ? "var(--accent)" : "var(--border)",
        background: value === o ? "var(--accent-glow)" : "var(--surface2)",
        color: value === o ? "var(--accent)" : "var(--text2)",
        fontSize: 11, cursor: "pointer", fontWeight: value === o ? 700 : 400,
        fontFamily: "inherit", transition: "0.15s",
      }}>
        {o.charAt(0).toUpperCase() + o.slice(1)}
      </button>
    ))}
  </div>
);

const navBtnStyle: React.CSSProperties = {
  width: 28, height: 28, borderRadius: 6,
  border: "1px solid var(--border)", background: "var(--surface2)",
  color: "var(--text2)", cursor: "pointer",
  display: "flex", alignItems: "center", justifyContent: "center", fontSize: 12,
  fontFamily: "inherit",
};

const PeriodNav: React.FC<{ label: string; offset: number; onPrev: () => void; onNext: () => void }> = ({ label, offset, onPrev, onNext }) => (
  <div style={{ display: "flex", alignItems: "center", gap: 5 }}>
    <button onClick={onPrev} style={navBtnStyle}>←</button>
    <span style={{ fontSize: 11, fontWeight: 600, color: "var(--text2)", minWidth: 130, textAlign: "center" }}>{label}</span>
    <button onClick={onNext} disabled={offset >= 0} style={{ ...navBtnStyle, opacity: offset >= 0 ? 0.3 : 1, cursor: offset >= 0 ? "default" : "pointer" }}>→</button>
  </div>
);

// ─────────────────────────────────────────────────────────────────────────────
// Metric card — mirrors TrendCard from AdminOverview
// ─────────────────────────────────────────────────────────────────────────────

interface MetricCardProps {
  label: string;
  value: string | number;
  sub?: string;
  accent?: string;
  icon?: string;
  chip?: { label: string; positive: boolean };
}

const MetricCard: React.FC<MetricCardProps> = ({ label, value, sub, accent, icon, chip }) => (
  <div className="admin-metric" style={{ display: "flex", flexDirection: "column", gap: 6 }}>
    <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between" }}>
      <p className="admin-metric__label" style={{ margin: 0 }}>{label}</p>
      {icon && <span style={{ fontSize: 15, opacity: 0.4 }}>{icon}</span>}
    </div>
    <p className="admin-metric__value" style={{ margin: 0, ...(accent ? { color: accent } : {}) }}>
      {value}
    </p>
    {chip && (
      <div style={{ display: "flex", gap: 5, flexWrap: "wrap" }}>
        <Chip label={chip.label} positive={chip.positive} />
      </div>
    )}
    {sub && <p className="admin-metric__sub" style={{ margin: 0 }}>{sub}</p>}
  </div>
);

// ─────────────────────────────────────────────────────────────────────────────
// Quota bar — styled with admin tokens
// ─────────────────────────────────────────────────────────────────────────────

interface QuotaBarProps { label: string; used: number; total: number; unit?: string; color?: string }

const QuotaBar: React.FC<QuotaBarProps> = ({ label, used, total, unit = "", color = C.purple }) => {
  const pct = total > 0 ? Math.min(100, Math.round((used / total) * 100)) : 0;
  const barColor = pct >= 90 ? C.red : pct >= 70 ? C.amber : color;
  return (
    <div className="admin-metric" style={{ display: "flex", flexDirection: "column", gap: 6 }}>
      <p className="admin-metric__label" style={{ margin: 0 }}>{label}</p>
      <p className="admin-metric__value" style={{ margin: 0, fontSize: 20 }}>
        {typeof used === "number" ? used.toLocaleString() : used}{unit}
        <span style={{ fontSize: 11, color: "var(--text3)", fontWeight: 400 }}> / {typeof total === "number" ? total.toLocaleString() : total}{unit}</span>
      </p>
      <div style={{ height: 5, borderRadius: 3, background: "rgba(128,128,128,0.12)", overflow: "hidden" }}>
        <div style={{ height: "100%", width: `${pct}%`, background: barColor, borderRadius: 3, transition: "width 0.5s" }} />
      </div>
      <p style={{ fontSize: 10, color: "var(--text3)", margin: 0 }}>{pct}% used · {(total - used).toLocaleString()}{unit} remaining</p>
    </div>
  );
};

// ─────────────────────────────────────────────────────────────────────────────
// Donut chart
// ─────────────────────────────────────────────────────────────────────────────

const DonutChart: React.FC<{ success: number; failure: number; total: number }> = ({ success, failure, total }) => {
  const R = 52; const circ = 2 * Math.PI * R;
  const rate = total > 0 ? success / total : 0;
  const sd = rate * circ;
  return (
    <div className="donut-wrapper">
      <svg viewBox="0 0 140 140" width="140" height="140">
        <circle cx="70" cy="70" r={R} fill="none" stroke={C.red} strokeWidth="18" opacity="0.22" />
        {failure > 0 && (
          <circle cx="70" cy="70" r={R} fill="none" stroke={C.red} strokeWidth="18"
            strokeDasharray={`${circ - sd} ${circ}`} strokeDashoffset={-sd} transform="rotate(-90 70 70)" />
        )}
        {success > 0 && (
          <circle cx="70" cy="70" r={R} fill="none" stroke={C.green} strokeWidth="18"
            strokeDasharray={`${sd} ${circ}`} transform="rotate(-90 70 70)" />
        )}
        <text x="70" y="64" textAnchor="middle" fill="var(--text)" fontSize="22" fontWeight="700">
          {Math.round(rate * 100)}%
        </text>
        <text x="70" y="82" textAnchor="middle" fill="var(--text3)" fontSize="11">success</text>
      </svg>
      <div className="donut-legend">
        <span className="legend-dot success" /><span>{success} answered</span>
        <span className="legend-dot failure" /><span>{failure} unanswered</span>
      </div>
    </div>
  );
};

// ─────────────────────────────────────────────────────────────────────────────
// Keyword tag
// ─────────────────────────────────────────────────────────────────────────────

const KeywordTag: React.FC<{ word: string; count: number; max: number }> = ({ word, count, max }) => {
  const intensity = Math.max(1, Math.round((count / max) * 5));
  return (
    <span className={`kw-tag kw-tag--${intensity}`} title={`${count} occurrence${count !== 1 ? "s" : ""}`}>
      {word}<span className="kw-tag__count">{count}</span>
    </span>
  );
};

// ─────────────────────────────────────────────────────────────────────────────
// Chart tooltips
// ─────────────────────────────────────────────────────────────────────────────

const MsgTooltip = ({ active, payload, label }: any) => {
  if (!active || !payload?.length) return null;
  return (
    <div style={{ background: "var(--surface2)", border: "1px solid var(--border)", borderRadius: 8, padding: "6px 10px", fontSize: 12 }}>
      <div style={{ color: "var(--text3)", marginBottom: 2 }}>{label}</div>
      <div style={{ color: C.purple, fontWeight: 600 }}>{payload[0].value} messages</div>
    </div>
  );
};

// ─────────────────────────────────────────────────────────────────────────────
// Memory clear button
// ─────────────────────────────────────────────────────────────────────────────

const ClearMemoryButton: React.FC<{ botId: string }> = ({ botId }) => {
  const [state,   setState]   = useState<ClearState>("idle");
  const [message, setMessage] = useState("");

  const handleClick = () => {
    if (state === "idle" || state === "done" || state === "error") setState("confirming");
  };

  const handleConfirm = async () => {
    setState("loading");
    try {
      const clientToken = localStorage.getItem("client_token");
      const res = await fetch(`http://localhost:8000/widgets/bots/${botId}/memory`, {
        method: "DELETE",
        headers: { Authorization: `Bearer ${clientToken}` },
      });
      const data = await res.json();
      if (res.ok && data.ok) {
        setMessage(data.message || "Memory cleared.");
        setState("done");
      }
    } catch {
      setMessage("Network error.");
      setState("error");
    }
    setTimeout(() => setState("idle"), 4000);
  };

  const handleCancel = () => setState("idle");

  const btnBase: React.CSSProperties = {
    padding: "6px 14px", borderRadius: 6, border: "1px solid",
    fontSize: 12, fontWeight: 500, cursor: "pointer",
    fontFamily: "inherit", transition: "opacity 0.2s",
  };

  if (state === "confirming") {
    return (
      <div style={{ display: "flex", alignItems: "center", gap: 8, flexWrap: "wrap" }}>
        <span style={{ fontSize: 12, color: "var(--text2)" }}>Clear all active conversation memory?</span>
        <button onClick={handleConfirm} style={{ ...btnBase, borderColor: C.red, background: "rgba(255,85,114,0.1)", color: C.red }}>
          Yes, clear
        </button>
        <button onClick={handleCancel} style={{ ...btnBase, borderColor: "var(--border)", background: "var(--surface2)", color: "var(--text2)" }}>
          Cancel
        </button>
      </div>
    );
  }
  if (state === "loading") return <span style={{ fontSize: 12, color: "var(--text3)" }}>Clearing…</span>;
  if (state === "done")    return <span style={{ fontSize: 12, color: C.green }}>✓ {message}</span>;
  if (state === "error")   return <span style={{ fontSize: 12, color: C.red }}>✗ {message}</span>;

  return (
    <button onClick={handleClick} style={{ ...btnBase, borderColor: "var(--border)", background: "var(--surface2)", color: "var(--text2)" }}>
      🧹 Clear conversation memory
    </button>
  );
};

// ─────────────────────────────────────────────────────────────────────────────
// Main component
// ─────────────────────────────────────────────────────────────────────────────

const ClientDashboard: React.FC<Props> = ({ bot }) => {
  const [data,      setData]      = useState<Analytics | null>(null);
  const [loading,   setLoading]   = useState(true);
  const [error,     setError]     = useState<string | null>(null);
  const [msgPeriod, setMsgPeriod] = useState<Period>("week");
  const [msgOffset, setMsgOffset] = useState(0);
  const [kwCount,   setKwCount]   = useState<KwCount>(10);

  const load = useCallback(async () => {
    try {
      setLoading(true);
      const res = await getAdvancedAnalytics(bot.id);
      setData(res);
    } catch {
      setError("Could not load analytics.");
    } finally {
      setLoading(false);
    }
  }, [bot.id]);

  useEffect(() => { load(); }, [load]);

  if (loading) return <div className="dash-loading">Loading…</div>;
  if (error)   return <div className="dash-error">{error}</div>;
  if (!data)   return null;

  const rawMsgs      = data.messages_per_day ?? [];
  const msgChartData = buildMsgChartData(rawMsgs, msgPeriod, msgOffset);
  const kwSlice      = (data.top_keywords ?? []).slice(0, kwCount);
  const maxKw        = kwSlice[0]?.count ?? 1;
  const docUsage     = (data.document_usage ?? []).slice(0, 8);
  const maxCitations = docUsage[0]?.citations ?? 1;

  const q = data.quota ?? {
    messages_used: data.total, messages_limit: 5000,
    docs_used: 0, docs_limit: 50,
    storage_mb: 0, storage_limit_mb: 5120,
    api_keys_used: 0, api_keys_limit: 5,
  };

  return (
    <div className="client-dashboard">

      {/* ── Row 1: KPI metric cards ──────────────────────────────────────── */}
      <div className="admin-metrics-grid">
        <MetricCard
          label="Messages / session"
          value={data.avg_messages_per_session}
          icon="💬"
          sub={`${fmtN(data.total_sessions)} total sessions`}
        />
        <MetricCard
          label="Total exchanges"
          value={fmtN(data.total)}
          icon="📊"
          sub={`${fmtN(data.success_count)} answered · ${fmtN(data.failure_count)} unanswered`}
        />
        <MetricCard
          label="Pending tickets"
          value={data.pending_tickets}
          icon="🎫"
          accent={data.pending_tickets > 0 ? C.amber : undefined}
          sub="human interventions needed"
          chip={data.pending_tickets > 0 ? { label: "needs attention", positive: false } : undefined}
        />
      </div>

      {/* ── Row 2: Plan & quota ──────────────────────────────────────────── */}
      <div className="admin-card">
        <p className="admin-card__title">
          Plan &amp; quota
        </p>
        <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(180px, 1fr))", gap: 14 }}>
          <QuotaBar label="Messages this month" used={q.messages_used}    total={q.messages_limit}     color={C.purple} />
          <QuotaBar label="Documents indexed"   used={q.docs_used}        total={q.docs_limit}         color={C.amber} />
          <QuotaBar
            label="Storage"
            used={+(q.storage_mb / 1024).toFixed(2)}
            total={+(q.storage_limit_mb / 1024).toFixed(0)}
            unit=" GB"
            color={C.green}
          />
        </div>
      </div>

      {/* ── Messages chart ───────────────────────────────────────────────── */}
      <div className="admin-card">
        <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: 14, flexWrap: "wrap", gap: 10 }}>
          <p className="admin-card__title" style={{ margin: 0 }}>
            Messages over time
            <span style={{ fontSize: 10, color: "var(--text3)", fontWeight: 400, marginLeft: 6 }}>
              {periodLabel(msgPeriod, msgOffset)}
            </span>
          </p>
          <div style={{ display: "flex", alignItems: "center", gap: 10, flexWrap: "wrap" }}>
            <PeriodPills options={["week", "month", "year"]} value={msgPeriod} onChange={p => { setMsgPeriod(p); setMsgOffset(0); }} />
            <PeriodNav
              label={periodLabel(msgPeriod, msgOffset)}
              offset={msgOffset}
              onPrev={() => setMsgOffset(o => o - 1)}
              onNext={() => setMsgOffset(o => Math.min(0, o + 1))}
            />
          </div>
        </div>
        <ResponsiveContainer width="100%" height={200}>
          <AreaChart data={msgChartData} margin={{ left: -10, right: 4, top: 4 }}>
            <defs>
              <linearGradient id="gMsg" x1="0" y1="0" x2="0" y2="1">
                <stop offset="5%"  stopColor={C.purple} stopOpacity={0.22} />
                <stop offset="95%" stopColor={C.purple} stopOpacity={0} />
              </linearGradient>
            </defs>
            <XAxis dataKey="label" tick={{ fontSize: 10, fill: "var(--text3)" }} interval={msgPeriod === "month" ? 4 : 0} />
            <YAxis tick={{ fontSize: 10, fill: "var(--text3)" }} width={28} />
            <Tooltip content={<MsgTooltip />} />
            <Area type="monotone" dataKey="messages" stroke={C.purple} fill="url(#gMsg)" strokeWidth={2.5} dot={msgPeriod === "week"} />
          </AreaChart>
        </ResponsiveContainer>
      </div>

      {/* ── Document usage ───────────────────────────────────────────────── */}
      {docUsage.length > 0 && (
        <div className="admin-card">
          <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: 14 }}>
            <p className="admin-card__title" style={{ margin: 0 }}>📄 Document usage</p>
            <span style={{ fontSize: 10, color: "var(--text3)" }}>citations in answers</span>
          </div>
          <div style={{ display: "flex", flexDirection: "column", gap: 0 }}>
            {docUsage.map((doc, i) => {
              const pct = Math.round((doc.citations / maxCitations) * 100);
              return (
                <div key={i} style={{ display: "flex", alignItems: "center", gap: 10, padding: "9px 0", borderBottom: i < docUsage.length - 1 ? "1px solid var(--border)" : "none" }}>
                  <span style={{ width: 20, height: 20, borderRadius: 5, background: "var(--accent-glow)", color: "var(--accent)", display: "flex", alignItems: "center", justifyContent: "center", fontSize: 10, fontWeight: 700, flexShrink: 0 }}>{i + 1}</span>
                  <span style={{ fontSize: 12, color: "var(--text)", flexShrink: 0, width: 160, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>{doc.name}</span>
                  <div style={{ flex: 1, height: 4, borderRadius: 2, background: "rgba(128,128,128,0.12)", overflow: "hidden" }}>
                    <div style={{ height: "100%", width: `${pct}%`, background: C.purple, borderRadius: 2, transition: "width 0.4s" }} />
                  </div>
                  <span style={{ fontSize: 11, color: "var(--text2)", flexShrink: 0, width: 36, textAlign: "right" }}>{doc.citations}</span>
                  <span style={{ fontSize: 10, color: "var(--text3)", flexShrink: 0, width: 34, textAlign: "right" }}>{pct}%</span>
                </div>
              );
            })}
          </div>
        </div>
      )}

      {/* ── Success / failure + unanswered questions ─────────────────────── */}
      <div className="analytics-row">
        <div className="admin-card donut-card">
          <p className="admin-card__title">Success / failure rate</p>
          <DonutChart success={data.success_count} failure={data.failure_count} total={data.total} />
          <p className="donut-total">{data.total} exchange{data.total !== 1 ? "s" : ""} total</p>
        </div>

        <div className="admin-card unanswered-card" style={{ display: "flex", flexDirection: "column" }}>
          <p className="admin-card__title" style={{ margin: 0, marginBottom: 14 }}>
            Unanswered questions
            <span className="badge badge--danger" style={{ marginLeft: 8 }}>{data.unanswered_questions.length}</span>
          </p>
          {data.unanswered_questions.length === 0 ? (
            <p className="admin-empty">No unanswered questions 🎉</p>
          ) : (
            <ul className="unanswered-list">
              {[...data.unanswered_questions].reverse().map((q, i) => (
                <li key={i} className="unanswered-item">
                  <span className="unanswered-icon">?</span>
                  <div>
                    <p className="unanswered-question">{q.question}</p>
                    <p className="unanswered-date">{q.created_at ? new Date(q.created_at).toLocaleDateString("en-US", { day: "2-digit", month: "short", year: "numeric" }) : ""}</p>
                  </div>
                </li>
              ))}
            </ul>
          )}
        </div>
      </div>

      {/* ── Keywords ─────────────────────────────────────────────────────── */}
      <div className="admin-card keywords-card">
        <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: 14, flexWrap: "wrap", gap: 8 }}>
          <p className="admin-card__title" style={{ margin: 0 }}>Frequent keywords</p>
          <div style={{ display: "flex", gap: 5 }}>
            {([5, 10, 20] as KwCount[]).map(n => (
              <button key={n} onClick={() => setKwCount(n)} style={{
                padding: "4px 10px", borderRadius: 20, border: "1px solid",
                borderColor: kwCount === n ? "var(--accent)" : "var(--border)",
                background: kwCount === n ? "var(--accent-glow)" : "var(--surface2)",
                color: kwCount === n ? "var(--accent)" : "var(--text2)",
                fontSize: 11, cursor: "pointer", fontWeight: kwCount === n ? 700 : 400,
                fontFamily: "inherit",
              }}>Top {n}</button>
            ))}
          </div>
        </div>
        {kwSlice.length === 0
          ? <p className="admin-empty">No data available.</p>
          : <div className="kw-cloud">{kwSlice.map(kw => <KeywordTag key={kw.word} word={kw.word} count={kw.count} max={maxKw} />)}</div>
        }
      </div>

      {/* ── Bot info + memory management ─────────────────────────────────── */}
      <div className="admin-card">
        <p className="admin-card__title">🤖 Your bot</p>
        <div style={{ display: "flex", flexDirection: "column", gap: 0 }}>
          {[
            { label: "Bot name",            value: <span style={{ fontSize: 13, color: "var(--text)", fontWeight: 500 }}>{bot?.name ?? "—"}</span> },
            { label: "Bot ID",              value: <span className="cl-mono">{bot?.id ?? "—"}</span> },
            { label: "Conversation memory", value: <ClearMemoryButton botId={bot.id} /> },
          ].map(({ label, value }, i, arr) => (
            <div key={i} style={{ display: "flex", alignItems: "center", justifyContent: "space-between", padding: "12px 0", borderBottom: i < arr.length - 1 ? "1px solid var(--border)" : "none", gap: 12, flexWrap: "wrap" }}>
              <span style={{ fontSize: 11, fontWeight: 700, textTransform: "uppercase" as const, letterSpacing: "0.06em", color: "var(--text3)" }}>{label}</span>
              {value}
            </div>
          ))}
        </div>
      </div>

    </div>
  );
};

export default ClientDashboard;