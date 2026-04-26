import React, { useEffect, useState, useCallback } from "react";
import {
  AreaChart, Area,
  BarChart, Bar,
  XAxis, YAxis,
  Tooltip, ResponsiveContainer,
} from "recharts";
import { getAdvancedAnalytics } from "./api";

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

function fmt(d: Date, opts: Intl.DateTimeFormatOptions) {
  return d.toLocaleDateString("en-US", opts);
}

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

function buildRtChartData(
  raw: RtPoint[],
  period: "week" | "month",
  offset: number
): { label: string; avg_ms: number | null }[] {
  const today = new Date();
  const rawMap: Record<string, number | null> = {};
  raw.forEach(r => { rawMap[r.date.slice(0, 10)] = r.avg_ms; });

  if (period === "week") {
    const start = new Date(today);
    start.setDate(today.getDate() - today.getDay() + offset * 7);
    return Array.from({ length: 7 }, (_, i) => {
      const d = new Date(start);
      d.setDate(start.getDate() + i);
      const key = d.toISOString().slice(0, 10);
      return { label: fmt(d, { weekday: "short" }), avg_ms: rawMap[key] ?? null };
    });
  }
  const ref = new Date(today.getFullYear(), today.getMonth() + offset, 1);
  const days = new Date(ref.getFullYear(), ref.getMonth() + 1, 0).getDate();
  return Array.from({ length: days }, (_, i) => {
    const d = new Date(ref.getFullYear(), ref.getMonth(), i + 1);
    return { label: `${i + 1}`, avg_ms: rawMap[d.toISOString().slice(0, 10)] ?? null };
  });
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

const RtTooltip = ({ active, payload, label }: any) => {
  if (!active || !payload?.length || payload[0].value == null) return null;
  return (
    <div style={{ background: "var(--bg2)", border: "1px solid var(--border)", borderRadius: 8, padding: "6px 10px", fontSize: 12 }}>
      <div style={{ color: "var(--text3)", marginBottom: 2 }}>{label}</div>
      <div style={{ color: "#5DCAA5", fontWeight: 500 }}>{payload[0].value} ms</div>
    </div>
  );
};

const DonutChart: React.FC<{ success: number; failure: number; total: number }> = ({ success, failure, total }) => {
  const R = 52; const C = 2 * Math.PI * R;
  const rate = total > 0 ? success / total : 0;
  const sd = rate * C;
  return (
    <div className="donut-wrapper">
      <svg viewBox="0 0 140 140" width="140" height="140">
        <circle cx="70" cy="70" r={R} fill="none" stroke="#ef4444" strokeWidth="18" opacity="0.25" />
        {failure > 0 && <circle cx="70" cy="70" r={R} fill="none" stroke="#ef4444" strokeWidth="18" strokeDasharray={`${C - sd} ${C}`} strokeDashoffset={-sd} transform="rotate(-90 70 70)" />}
        {success > 0 && <circle cx="70" cy="70" r={R} fill="none" stroke="#22c55e" strokeWidth="18" strokeDasharray={`${sd} ${C}`} transform="rotate(-90 70 70)" />}
        <text x="70" y="64" textAnchor="middle" fill="var(--text-primary)" fontSize="22" fontWeight="700">{Math.round(rate * 100)}%</text>
        <text x="70" y="82" textAnchor="middle" fill="var(--text-muted)" fontSize="11">success</text>
      </svg>
      <div className="donut-legend">
        <span className="legend-dot success" /><span>{success} answered</span>
        <span className="legend-dot failure" /><span>{failure} unanswered</span>
      </div>
    </div>
  );
};

const KeywordTag: React.FC<{ word: string; count: number; max: number }> = ({ word, count, max }) => {
  const intensity = Math.max(1, Math.round((count / max) * 5));
  return (
    <span className={`kw-tag kw-tag--${intensity}`} title={`${count} occurrence${count !== 1 ? "s" : ""}`}>
      {word}<span className="kw-tag__count">{count}</span>
    </span>
  );
};

const StatCard: React.FC<{ label: string; value: string | number; sub?: string; accent?: string }> = ({ label, value, sub, accent }) => (
  <div className="stat-card">
    <p className="stat-card__label">{label}</p>
    <p className="stat-card__value" style={accent ? { color: accent } : undefined}>{value}</p>
    {sub && <p className="stat-card__sub">{sub}</p>}
  </div>
);

interface QuotaBarProps { label: string; used: number; total: number; unit?: string; color?: string }
const QuotaBar: React.FC<QuotaBarProps> = ({ label, used, total, unit = "", color = "#7F77DD" }) => {
  const pct = total > 0 ? Math.min(100, Math.round((used / total) * 100)) : 0;
  const barColor = pct >= 90 ? "#D85A30" : pct >= 70 ? "#BA7517" : color;
  return (
    <div className="stat-card" style={{ display: "flex", flexDirection: "column", gap: 6 }}>
      <p className="stat-card__label">{label}</p>
      <p className="stat-card__value" style={{ fontSize: 20 }}>
        {typeof used === "number" ? used.toLocaleString() : used}{unit}
        <span style={{ fontSize: 11, color: "var(--text-muted)", fontWeight: 400 }}>{" "}/ {typeof total === "number" ? total.toLocaleString() : total}{unit}</span>
      </p>
      <div style={{ height: 5, borderRadius: 3, background: "rgba(128,128,128,0.15)", overflow: "hidden" }}>
        <div style={{ height: "100%", width: `${pct}%`, background: barColor, borderRadius: 3, transition: "width 0.5s" }} />
      </div>
      <p style={{ fontSize: 10, color: "var(--text-muted)", marginTop: 2 }}>{pct}% used · {(total - used).toLocaleString()}{unit} remaining</p>
    </div>
  );
};

const PeriodPills: React.FC<{ options: string[]; value: string; onChange: (v: any) => void }> = ({ options, value, onChange }) => (
  <div style={{ display: "flex", gap: 6 }}>
    {options.map(o => (
      <button key={o} onClick={() => onChange(o)} style={{ padding: "4px 12px", borderRadius: 20, border: "1px solid", borderColor: value === o ? "var(--accent)" : "var(--border)", background: value === o ? "rgba(127,119,221,0.15)" : "var(--bg3)", color: value === o ? "var(--accent-light)" : "var(--text2)", fontSize: 12, cursor: "pointer", fontWeight: value === o ? 600 : 400 }}>
        {o.charAt(0).toUpperCase() + o.slice(1)}
      </button>
    ))}
  </div>
);

const navBtnStyle: React.CSSProperties = { width: 28, height: 28, borderRadius: 8, border: "1px solid var(--border)", background: "var(--bg3)", color: "var(--text2)", cursor: "pointer", display: "flex", alignItems: "center", justifyContent: "center", fontSize: 13 };

const PeriodNav: React.FC<{ label: string; offset: number; onPrev: () => void; onNext: () => void }> = ({ label, offset, onPrev, onNext }) => (
  <div style={{ display: "flex", alignItems: "center", gap: 6 }}>
    <button onClick={onPrev} style={navBtnStyle}>←</button>
    <span style={{ fontSize: 12, fontWeight: 500, color: "var(--text2)", minWidth: 140, textAlign: "center" }}>{label}</span>
    <button onClick={onNext} disabled={offset >= 0} style={{ ...navBtnStyle, opacity: offset >= 0 ? 0.3 : 1, cursor: offset >= 0 ? "default" : "pointer" }}>→</button>
  </div>
);

const ClientDashboard: React.FC<Props> = ({ bot }) => {
  const [data,      setData]      = useState<Analytics | null>(null);
  const [loading,   setLoading]   = useState(true);
  const [error,     setError]     = useState<string | null>(null);
  const [msgPeriod, setMsgPeriod] = useState<Period>("week");
  const [msgOffset, setMsgOffset] = useState(0);
  const [rtPeriod,  setRtPeriod]  = useState<"week" | "month">("week");
  const [rtOffset,  setRtOffset]  = useState(0);
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
  const rtChartData  = buildRtChartData(data.response_times ?? [], rtPeriod, rtOffset);
  const kwSlice      = (data.top_keywords ?? []).slice(0, kwCount);
  const maxKw        = kwSlice[0]?.count ?? 1;
  const docUsage     = (data.document_usage ?? []).slice(0, 8);
  const maxCitations = docUsage[0]?.citations ?? 1;

  // Average response time for the selected period, skipping null entries
  const rtValues = rtChartData.filter(d => d.avg_ms !== null).map(d => d.avg_ms as number);
  const avgRt    = rtValues.length ? Math.round(rtValues.reduce((s, v) => s + v, 0) / rtValues.length) : null;

  const q = data.quota ?? {
    messages_used: data.total, messages_limit: 5000,
    docs_used: 0, docs_limit: 50,
    storage_mb: 0, storage_limit_mb: 5120,
    api_keys_used: 0, api_keys_limit: 5,
  };

  return (
    <div className="client-dashboard">

      {/* ── Stat cards ── */}
      <div className="stat-grid">
        <StatCard label="Avg messages / session" value={data.avg_messages_per_session} sub="per conversation" />
        <StatCard label="Pending tickets" value={data.pending_tickets} accent={data.pending_tickets > 0 ? "#f59e0b" : undefined} sub="human interventions" />
        <StatCard label="Success rate" value={`${data.success_rate}%`} accent="#22c55e" />
        <StatCard
          label="Avg response time"
          value={avgRt !== null ? `${avgRt} ms` : "—"}
          accent={avgRt === null ? undefined : avgRt > 2500 ? "#D85A30" : avgRt > 1500 ? "#BA7517" : "#1D9E75"}
          sub="across selected period"
        />
      </div>

      {/* ── Messages chart ── */}
      <div className="card analytics-card" style={{ marginBottom: 14 }}>
        <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: 14, flexWrap: "wrap", gap: 10 }}>
          <h3 className="card-title" style={{ margin: 0 }}>Messages over time</h3>
          <div style={{ display: "flex", alignItems: "center", gap: 12, flexWrap: "wrap" }}>
            <PeriodPills options={["week", "month", "year"]} value={msgPeriod} onChange={p => { setMsgPeriod(p); setMsgOffset(0); }} />
            <PeriodNav label={periodLabel(msgPeriod, msgOffset)} offset={msgOffset} onPrev={() => setMsgOffset(o => o - 1)} onNext={() => setMsgOffset(o => Math.min(0, o + 1))} />
          </div>
        </div>
        <ResponsiveContainer width="100%" height={190}>
          <AreaChart data={msgChartData} margin={{ left: -10, right: 4 }}>
            <defs>
              <linearGradient id="gMsg" x1="0" y1="0" x2="0" y2="1">
                <stop offset="5%"  stopColor="#7F77DD" stopOpacity={0.25} />
                <stop offset="95%" stopColor="#7F77DD" stopOpacity={0} />
              </linearGradient>
            </defs>
            <XAxis dataKey="label" tick={{ fontSize: 10, fill: "var(--text3)" }} interval={msgPeriod === "month" ? 4 : 0} />
            <YAxis tick={{ fontSize: 10, fill: "var(--text3)" }} width={28} />
            <Tooltip content={<MsgTooltip />} />
            <Area type="monotone" dataKey="messages" stroke="#7F77DD" fill="url(#gMsg)" strokeWidth={2} dot={msgPeriod === "week"} />
          </AreaChart>
        </ResponsiveContainer>
      </div>

      {/* ── Response time chart ── */}
      <div className="card analytics-card" style={{ marginBottom: 14 }}>
        <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: 14, flexWrap: "wrap", gap: 10 }}>
          <h3 className="card-title" style={{ margin: 0 }}>
            Avg response time
            {avgRt !== null && (
              <span style={{ fontSize: 12, fontWeight: 400, marginLeft: 10, color: "var(--text3)" }}>
                {avgRt} ms avg for period
              </span>
            )}
          </h3>
          <div style={{ display: "flex", alignItems: "center", gap: 12, flexWrap: "wrap" }}>
            <PeriodPills options={["week", "month"]} value={rtPeriod} onChange={p => { setRtPeriod(p); setRtOffset(0); }} />
            <PeriodNav label={periodLabel(rtPeriod, rtOffset)} offset={rtOffset} onPrev={() => setRtOffset(o => o - 1)} onNext={() => setRtOffset(o => Math.min(0, o + 1))} />
          </div>
        </div>

        {rtValues.length === 0 ? (
          <div style={{ height: 170, display: "flex", alignItems: "center", justifyContent: "center", color: "var(--text3)", fontSize: 13 }}>
            No response time data yet — data is recorded as users chat with your widget.
          </div>
        ) : (
          <ResponsiveContainer width="100%" height={170}>
            <BarChart data={rtChartData} margin={{ left: -10, right: 4 }}>
              <XAxis dataKey="label" tick={{ fontSize: 10, fill: "var(--text3)" }} interval={rtPeriod === "month" ? 4 : 0} />
              <YAxis tick={{ fontSize: 10, fill: "var(--text3)" }} width={36} />
              <Tooltip content={<RtTooltip />} />
              <Bar dataKey="avg_ms" fill="#1D9E75" radius={[3, 3, 0, 0]} maxBarSize={32} />
            </BarChart>
          </ResponsiveContainer>
        )}
      </div>

      {/* ── Plan & quota — REAL DATA ── */}
      <div className="card analytics-card" style={{ marginBottom: 14 }}>
        <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: 14 }}>
          <h3 className="card-title" style={{ margin: 0 }}>Plan &amp; quota</h3>
        </div>
        <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(160px, 1fr))", gap: 10 }}>
          <QuotaBar label="Messages this month" used={q.messages_used}    total={q.messages_limit}     color="#7F77DD" />
          <QuotaBar label="Documents indexed"   used={q.docs_used}        total={q.docs_limit}         color="#BA7517" />
          <QuotaBar label="Storage"             used={+(q.storage_mb / 1024).toFixed(2)} total={+(q.storage_limit_mb / 1024).toFixed(0)} unit=" GB" color="#1D9E75" />
          <QuotaBar label="API keys"            used={q.api_keys_used}    total={q.api_keys_limit}     color="#378ADD" />
        </div>
      </div>

      {/* ── Document usage — REAL DATA ── */}
      {docUsage.length > 0 && (
        <div className="card analytics-card" style={{ marginBottom: 14 }}>
          <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: 14 }}>
            <h3 className="card-title" style={{ margin: 0 }}>Document usage</h3>
            <span style={{ fontSize: 11, color: "var(--text3)" }}>citations in answers</span>
          </div>
          <div style={{ display: "flex", flexDirection: "column", gap: 0 }}>
            {docUsage.map((doc, i) => {
              const pct = Math.round((doc.citations / maxCitations) * 100);
              return (
                <div key={i} style={{ display: "flex", alignItems: "center", gap: 10, padding: "9px 0", borderBottom: i < docUsage.length - 1 ? "1px solid var(--border)" : "none" }}>
                  <span style={{ width: 18, height: 18, borderRadius: 4, background: "rgba(127,119,221,0.12)", color: "var(--accent-light)", display: "flex", alignItems: "center", justifyContent: "center", fontSize: 10, fontWeight: 600, flexShrink: 0 }}>{i + 1}</span>
                  <span style={{ fontSize: 12, color: "var(--text)", flexShrink: 0, width: 160, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>{doc.name}</span>
                  <div style={{ flex: 1, height: 4, borderRadius: 2, background: "rgba(128,128,128,0.12)", overflow: "hidden" }}>
                    <div style={{ height: "100%", width: `${pct}%`, background: "var(--accent)", borderRadius: 2, transition: "width 0.4s" }} />
                  </div>
                  <span style={{ fontSize: 11, color: "var(--text2)", flexShrink: 0, width: 40, textAlign: "right" }}>{doc.citations}</span>
                  <span style={{ fontSize: 10, color: "var(--text3)", flexShrink: 0, width: 32, textAlign: "right" }}>{pct}%</span>
                </div>
              );
            })}
          </div>
        </div>
      )}

      {/* ── Success / failure donut + unanswered ── */}
      <div className="analytics-row">
        <div className="card analytics-card donut-card">
          <h3 className="card-title">Success / failure rate</h3>
          <DonutChart success={data.success_count} failure={data.failure_count} total={data.total} />
          <p className="donut-total">{data.total} exchange{data.total !== 1 ? "s" : ""} total</p>
        </div>
        <div className="card analytics-card unanswered-card">
          <h3 className="card-title">
            Unanswered questions
            <span className="badge badge--danger">{data.unanswered_questions.length}</span>
          </h3>
          {data.unanswered_questions.length === 0 ? (
            <p className="empty-state">No unanswered questions 🎉</p>
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

      {/* ── Keywords ── */}
      <div className="card analytics-card keywords-card" style={{ marginBottom: 14 }}>
        <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: 14, flexWrap: "wrap", gap: 8 }}>
          <h3 className="card-title" style={{ margin: 0 }}>Frequent keywords</h3>
          <div style={{ display: "flex", gap: 6 }}>
            {([5, 10, 20] as KwCount[]).map(n => (
              <button key={n} onClick={() => setKwCount(n)} style={{ padding: "4px 10px", borderRadius: 20, border: "1px solid", borderColor: kwCount === n ? "var(--accent)" : "var(--border)", background: kwCount === n ? "rgba(127,119,221,0.15)" : "var(--bg3)", color: kwCount === n ? "var(--accent-light)" : "var(--text2)", fontSize: 12, cursor: "pointer", fontWeight: kwCount === n ? 600 : 400 }}>Top {n}</button>
            ))}
          </div>
        </div>
        {kwSlice.length === 0 ? <p className="empty-state">No data available.</p> : (
          <div className="kw-cloud">{kwSlice.map(kw => <KeywordTag key={kw.word} word={kw.word} count={kw.count} max={maxKw} />)}</div>
        )}
      </div>

      {/* ── Bot info ── */}
      <div className="cl-section">
        <h2 className="cl-section-title">Your bot</h2>
        <div className="cl-info-card">
          <div className="cl-info-row"><span className="cl-info-label">Bot name</span><span className="cl-info-value">{bot?.name ?? "—"}</span></div>
          <div className="cl-info-row"><span className="cl-info-label">Bot ID</span><span className="cl-info-value cl-mono">{bot?.id ?? "—"}</span></div>
        </div>
      </div>
    </div>
  );
};

export default ClientDashboard;