import React, { useState } from "react";
import {
  ComposedChart, Area, Bar, XAxis, YAxis, CartesianGrid,
  Tooltip, ResponsiveContainer, Legend, LineChart, Line,
} from "recharts";
import { AdminOverviewData, TopClient } from "./Adminapi";

// ─────────────────────────────────────────────────────────────────────────────
// Palette
// ─────────────────────────────────────────────────────────────────────────────

const C = {
  purple:  "#7F77DD",
  green:   "#1D9E75",
  amber:   "#BA7517",
  red:     "#D85A30",
  grey:    "#888780",
  green12: "rgba(29,158,117,0.12)",
  red12:   "rgba(216,90,48,0.12)",
};

const PLAN_COLORS: Record<string, string> = {
  starter: C.green, growth: C.purple, enterprise: C.amber, free: C.grey,
};

const PLAN_BADGE: Record<string, { bg: string; color: string }> = {
  starter:    { bg: "rgba(29,158,117,0.12)",  color: "#085041" },
  growth:     { bg: "rgba(127,119,221,0.15)", color: "#3C3489" },
  enterprise: { bg: "rgba(186,117,23,0.12)",  color: "#633806" },
  free:       { bg: "rgba(136,135,128,0.15)", color: "#444441" },
};

// ─────────────────────────────────────────────────────────────────────────────
// Helpers
// ─────────────────────────────────────────────────────────────────────────────

const fmt   = (n: number) => (n ?? 0).toLocaleString();
const fmtMs = (ms: number) => ms >= 1000 ? `${(ms / 1000).toFixed(1)}s` : `${Math.round(ms)}ms`;

function Chip({ label, positive }: { label: string; positive: boolean }) {
  return (
    <span style={{
      fontSize: 10, fontWeight: 700, padding: "2px 7px", borderRadius: 20,
      background: positive ? C.green12 : C.red12,
      color: positive ? "#0F6E56" : "#993C1D",
    }}>{label}</span>
  );
}

// ─────────────────────────────────────────────────────────────────────────────
// KPI Trend Card
// ─────────────────────────────────────────────────────────────────────────────

interface TrendCardProps {
  label: string;
  value: string | number;
  sub?: string;
  accent?: string;
  icon?: string;
  chips?: { label: string; positive: boolean; tag?: string }[];
}

const TrendCard: React.FC<TrendCardProps> = ({ label, value, sub, accent, icon, chips }) => (
  <div className="admin-metric" style={{ display: "flex", flexDirection: "column", gap: 6 }}>
    <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between" }}>
      <p className="admin-metric__label" style={{ margin: 0 }}>{label}</p>
      {icon && <span style={{ fontSize: 15, opacity: 0.45 }}>{icon}</span>}
    </div>
    <p className="admin-metric__value" style={{ margin: 0, ...(accent ? { color: accent } : {}) }}>
      {value}
    </p>
    {chips && chips.length > 0 && (
      <div style={{ display: "flex", gap: 5, flexWrap: "wrap" }}>
        {chips.map((c, i) => (
          <div key={i} style={{ display: "flex", alignItems: "center", gap: 3 }}>
            {c.tag && <span style={{ fontSize: 9, color: "var(--text3)", fontWeight: 700 }}>{c.tag}</span>}
            <Chip label={c.label} positive={c.positive} />
          </div>
        ))}
      </div>
    )}
    {sub && <p className="admin-metric__sub" style={{ margin: 0 }}>{sub}</p>}
  </div>
);

// ─────────────────────────────────────────────────────────────────────────────
// Revenue + Profit wide card (spans 2 columns)
// ─────────────────────────────────────────────────────────────────────────────

const RevProfitCard: React.FC<{
  revenue: number; revLast: number; revChange: number;
  profit: number;  aiCost: number;
}> = ({ revenue, revLast, revChange, profit, aiCost }) => (
  <div className="admin-metric" style={{ gridColumn: "span 2", display: "flex", flexDirection: "column", gap: 8 }}>
    <p className="admin-metric__label" style={{ margin: 0 }}>Revenue &amp; Profit</p>
    <div style={{ display: "flex", gap: 28, alignItems: "flex-end", flexWrap: "wrap" }}>
      {/* Revenue */}
      <div style={{ display: "flex", flexDirection: "column", gap: 4 }}>
        <span style={{ fontSize: 11, color: "var(--text3)" }}>This month</span>
        <span style={{ fontSize: 26, fontWeight: 700, color: C.green, lineHeight: 1 }}>
          ${fmt(revenue)}
        </span>
        <div style={{ display: "flex", gap: 6, alignItems: "center", flexWrap: "wrap" }}>
          <Chip
            label={`${revChange >= 0 ? "+" : ""}${revChange.toFixed(1)}% vs last month`}
            positive={revChange >= 0}
          />
          <span style={{ fontSize: 10, color: "var(--text3)" }}>${fmt(revLast)} last mo</span>
        </div>
      </div>

      <div style={{ width: 1, height: 44, background: "var(--border)", alignSelf: "center" }} />

      {/* Profit */}
      <div style={{ display: "flex", flexDirection: "column", gap: 4 }}>
        <span style={{ fontSize: 11, color: "var(--text3)" }}>Est. net profit</span>
        <span style={{ fontSize: 26, fontWeight: 700, color: C.purple, lineHeight: 1 }}>
          ~${fmt(profit)}
        </span>
        <span style={{ fontSize: 10, color: "var(--text3)" }}>
          After ~${fmt(aiCost)} AI costs (~30%)
        </span>
      </div>
    </div>
  </div>
);

// ─────────────────────────────────────────────────────────────────────────────
// Gas gauge
// ─────────────────────────────────────────────────────────────────────────────

const GasGauge: React.FC<{ used: number; quota: number }> = ({ used, quota }) => {
  const hasData = used > 0 && quota > 0;
  const pct     = hasData ? Math.min(100, (used / quota) * 100) : 0;
  const color   = pct >= 90 ? C.red : pct >= 70 ? C.amber : C.green;
  const r = 44, cx = 58, cy = 58;
  const startAngle = Math.PI * 0.8, endAngle = Math.PI * 2.2;
  const sweep = endAngle - startAngle;
  const angle = startAngle + sweep * (pct / 100);
  const x1 = cx + r * Math.cos(startAngle), y1 = cy + r * Math.sin(startAngle);
  const x2 = cx + r * Math.cos(endAngle),   y2 = cy + r * Math.sin(endAngle);
  const xp = cx + r * Math.cos(angle),       yp = cy + r * Math.sin(angle);
  const largeArc = sweep * (pct / 100) > Math.PI ? 1 : 0;

  return (
    <div style={{ display: "flex", alignItems: "center", gap: 14, marginTop: 4 }}>
      <svg width={116} height={80} viewBox="0 0 116 80" style={{ flexShrink: 0 }}>
        <path d={`M ${x1} ${y1} A ${r} ${r} 0 1 1 ${x2} ${y2}`}
          fill="none" stroke="rgba(128,128,128,0.12)" strokeWidth={9} strokeLinecap="round" />
        {hasData && (
          <path d={`M ${x1} ${y1} A ${r} ${r} 0 ${largeArc} 1 ${xp} ${yp}`}
            fill="none" stroke={color} strokeWidth={9} strokeLinecap="round" />
        )}
        <text x={cx} y={cy + 6} textAnchor="middle" fontSize={15} fontWeight={700} fill={hasData ? color : "var(--text3)"}>
          {hasData ? `${Math.round(pct)}%` : "—"}
        </text>
        <text x={cx} y={cy + 19} textAnchor="middle" fontSize={8} fill="var(--text3)">
          {hasData ? "of quota" : "no data yet"}
        </text>
      </svg>
      <div style={{ fontSize: 11, color: "var(--text2)", lineHeight: 1.8 }}>
        <div><strong style={{ color: "var(--text)" }}>{hasData ? fmt(used) : "—"}</strong> used</div>
        <div style={{ color: "var(--text3)" }}>{hasData ? fmt(quota) : "—"} quota</div>
        <div style={{ color: "var(--text3)", fontSize: 10 }}>Mistral API / mo</div>
      </div>
    </div>
  );
};

// ─────────────────────────────────────────────────────────────────────────────
// Doc type bars
// ─────────────────────────────────────────────────────────────────────────────

const DocTypeChart: React.FC<{ data: { type: string; count: number }[] }> = ({ data }) => {
  const colors = [C.purple, C.green, C.amber, C.red, C.grey];
  const max = Math.max(...data.map(d => d.count), 1);
  return (
    <div style={{ display: "flex", flexDirection: "column", gap: 10 }}>
      {data.map((d, i) => (
        <div key={d.type}>
          <div style={{ display: "flex", justifyContent: "space-between", fontSize: 11, marginBottom: 3 }}>
            <span style={{ color: "var(--text2)", fontWeight: 600 }}>{d.type}</span>
            <span style={{ color: "var(--text)", fontWeight: 600 }}>{fmt(d.count)}</span>
          </div>
          <div style={{ height: 5, borderRadius: 3, background: "rgba(128,128,128,0.1)", overflow: "hidden" }}>
            <div style={{
              height: "100%", width: `${(d.count / max) * 100}%`,
              background: colors[i % colors.length], borderRadius: 3,
              transition: "width 0.5s cubic-bezier(0.34,1.56,0.64,1)",
            }} />
          </div>
        </div>
      ))}
    </div>
  );
};

// ─────────────────────────────────────────────────────────────────────────────
// Response time sparkline
// ─────────────────────────────────────────────────────────────────────────────

const ResponseSparkline: React.FC<{
  data: { date: string; avg_ms: number }[];
  avgMs: number;
}> = ({ data, avgMs }) => {
  const color = avgMs >= 3000 ? C.red : avgMs >= 1500 ? C.amber : C.green;
  return (
    <div>
      <div style={{ display: "flex", alignItems: "baseline", gap: 6, marginBottom: 8 }}>
        <span style={{ fontSize: 26, fontWeight: 700, color, lineHeight: 1 }}>{fmtMs(avgMs)}</span>
        <span style={{ fontSize: 10, color: "var(--text3)" }}>avg this month</span>
      </div>
      <ResponsiveContainer width="100%" height={55}>
        <LineChart data={data} margin={{ top: 2, right: 0, left: 0, bottom: 0 }}>
          <Line type="monotone" dataKey="avg_ms" stroke={color} strokeWidth={2} dot={false} />
          <Tooltip
            contentStyle={{ background: "var(--bg2)", border: "1px solid var(--border)", borderRadius: 8, fontSize: 11 }}
            formatter={(v: any) => [fmtMs(v), "Avg"]}
            labelStyle={{ color: "var(--text3)" }}
          />
        </LineChart>
      </ResponsiveContainer>
      <div style={{ display: "flex", gap: 10, marginTop: 8 }}>
        {[{ l: "≤1s Fast", c: C.green }, { l: "1–3s OK", c: C.amber }, { l: ">3s Slow", c: C.red }].map(t => (
          <div key={t.l} style={{ display: "flex", alignItems: "center", gap: 3 }}>
            <span style={{ width: 6, height: 6, borderRadius: "50%", background: t.c }} />
            <span style={{ fontSize: 9, color: "var(--text3)" }}>{t.l}</span>
          </div>
        ))}
      </div>
    </div>
  );
};

// ─────────────────────────────────────────────────────────────────────────────
// Top clients table — sorted by message count, supports multiple bots per client
// ─────────────────────────────────────────────────────────────────────────────

// Normalise a TopClient so it always has a `bots` array.
// Supports three backend shapes:
//   1. New:  { bots: BotSummary[] }
//   2. Old:  { bot: BotSummary | null }
//   3. None: neither field present (legacy flat record)
interface BotSummary {
  id: string;
  name: string;
  message_count?: number;   // preferred name
  messages?: number;        // alternate name some backends use
  doc_count?: number;
  docs_indexed?: number;
  accent_color?: string;
}

function normaliseBots(c: TopClient): BotSummary[] {
  if (Array.isArray((c as any).bots) && (c as any).bots.length > 0) {
    return (c as any).bots as BotSummary[];
  }
  if ((c as any).bot) {
    return [(c as any).bot as BotSummary];
  }
  return [];
}

const BotPill: React.FC<{ bot: BotSummary }> = ({ bot }) => {
  const accent = bot.accent_color || C.purple;
  const msgs   = bot.message_count ?? bot.messages ?? 0;
  const docs   = bot.doc_count     ?? bot.docs_indexed ?? 0;
  return (
    <div style={{
      display: "flex", alignItems: "center", gap: 7,
      padding: "5px 10px",
      background: `${accent}10`,
      border: `1px solid ${accent}30`,
      borderLeft: `3px solid ${accent}`,
      borderRadius: 7,
    }}>
      <div style={{ width: 7, height: 7, borderRadius: 2, background: accent, flexShrink: 0 }} />
      <span style={{ fontSize: 11, fontWeight: 500, color: "var(--text)", flex: 1, minWidth: 0, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>
        {bot.name}
      </span>
      <span style={{ fontSize: 10, color: "var(--text3)", whiteSpace: "nowrap" }}>
        {fmt(msgs)} msgs · {fmt(docs)} docs
      </span>
    </div>
  );
};

const TopClientsTable: React.FC<{ clients: TopClient[] }> = ({ clients }) => {
  const [expanded, setExpanded] = useState<Set<string | number>>(new Set());
  const all = clients ?? [];

  if (all.length === 0) {
    return <p className="admin-empty">No client data.</p>;
  }

  // Sort by messages
  const sorted = [...all].sort(
    (a, b) => (b.messages_used ?? 0) - (a.messages_used ?? 0)
  );

  const top5 = sorted.slice(0, 5);

  // Total messages (ALL users, not just top 5)
  const totalMsgs = all.reduce((sum, c) => sum + (c.messages_used ?? 0), 0);
  const top5Total = top5.reduce((sum, c) => sum + (c.messages_used ?? 0), 0);
  const othersMsgs = totalMsgs - top5Total;

  const getPct = (val: number) =>
    totalMsgs > 0 ? Math.round((val / totalMsgs) * 100) : 0;

  const toggleExpand = (id: string | number) => {
    setExpanded(prev => {
      const next = new Set(prev);
      next.has(id) ? next.delete(id) : next.add(id);
      return next;
    });
  };

  return (
    <div>
      {/* Header */}
      <div style={{
        display: "grid",
        gridTemplateColumns: "22px 1fr 80px 1fr 70px 60px",
        gap: 12,
        paddingBottom: 8,
        borderBottom: "1px solid var(--border)",
      }}>
        {["#", "Client", "Plan", "Messages", "Storage", "Bots"].map((h) => (
          <span key={h} style={{ fontSize: 10, color: "var(--text3)", fontWeight: 600, textTransform: "uppercase" }}>
            {h}
          </span>
        ))}
      </div>

      {/* Top 5 rows */}
      {top5.map((c, i) => {
        const badge    = PLAN_BADGE[c.plan?.toLowerCase()] ?? PLAN_BADGE.free;
        const pct      = getPct(c.messages_used ?? 0);
        const barColor = pct >= 40 ? C.red : pct >= 20 ? C.amber : C.purple;
        const bots     = normaliseBots(c);
        const rowId    = c.id ?? i;
        const isOpen   = expanded.has(rowId);

        return (
          <React.Fragment key={rowId}>
            <div style={{
              display: "grid",
              gridTemplateColumns: "22px 1fr 80px 1fr 70px 60px",
              alignItems: "center",
              gap: 12,
              padding: "10px 0",
              borderBottom: "1px solid var(--border)",
            }}>
              {/* Rank */}
              <span style={{ fontSize: 11, color: "var(--text3)", fontWeight: 600 }}>#{i + 1}</span>

              {/* Client info */}
              <div>
                <p style={{ margin: 0, fontSize: 13, fontWeight: 500 }}>
                  {c.name || c.email?.split("@")[0] || "—"}
                </p>
                <p style={{ margin: 0, fontSize: 11, color: "var(--text2)" }}>{c.email}</p>
              </div>

              {/* Plan badge */}
              <span style={{
                padding: "3px 9px", borderRadius: 20, fontSize: 11,
                background: badge.bg, color: badge.color, textTransform: "capitalize",
              }}>
                {c.plan ?? "free"}
              </span>

              {/* Messages bar */}
              <div>
                <div style={{ display: "flex", justifyContent: "space-between", fontSize: 10, marginBottom: 4 }}>
                  <span>{fmt(c.messages_used ?? 0)} msgs</span>
                  <span style={{ fontWeight: 700 }}>{pct}%</span>
                </div>
                <div style={{ height: 4, background: "rgba(128,128,128,0.12)", borderRadius: 2 }}>
                  <div style={{ height: "100%", width: `${pct}%`, background: barColor, borderRadius: 2 }} />
                </div>
              </div>

              {/* Storage */}
              <div>
                <p style={{ margin: 0, fontSize: 12 }}>{(c.storage_used_gb ?? 0).toFixed(1)} GB</p>
                <p style={{ margin: 0, fontSize: 10, color: "var(--text3)" }}>/ {c.storage_quota_gb ?? "—"} GB</p>
              </div>

              {/* Bot count — click to expand */}
              <div>
                {bots.length === 0 ? (
                  <span style={{ fontSize: 11, color: "var(--text3)" }}>—</span>
                ) : (
                  <button
                    onClick={() => toggleExpand(rowId)}
                    style={{
                      display: "inline-flex", alignItems: "center", gap: 4,
                      background: isOpen ? "rgba(127,119,221,0.15)" : "rgba(127,119,221,0.08)",
                      border: "1px solid rgba(127,119,221,0.25)",
                      borderRadius: 6, color: C.purple,
                      padding: "3px 9px", cursor: "pointer",
                      fontSize: 11, fontWeight: 600,
                    }}
                  >
                    {bots.length}
                    <span style={{
                      fontSize: 8,
                      display: "inline-block",
                      transition: "transform 0.15s",
                      transform: isOpen ? "rotate(180deg)" : "rotate(0deg)",
                    }}>▼</span>
                  </button>
                )}
              </div>
            </div>

            {/* Expanded bots list */}
            {isOpen && bots.length > 0 && (
              <div style={{
                paddingLeft: 34,
                paddingBottom: 10,
                borderBottom: "1px solid var(--border)",
                display: "flex", flexDirection: "column", gap: 5,
              }}>
                <p style={{ margin: "6px 0 4px", fontSize: 10, color: "var(--text3)", fontWeight: 600, textTransform: "uppercase", letterSpacing: "0.04em" }}>
                  Bots ({bots.length})
                </p>
                {bots.map(bot => <BotPill key={bot.id} bot={bot} />)}
              </div>
            )}
          </React.Fragment>
        );
      })}

      {/* Others row */}
      {othersMsgs > 0 && (
        <div style={{
          display: "grid",
          gridTemplateColumns: "22px 1fr 80px 1fr 70px 60px",
          alignItems: "center",
          gap: 12,
          padding: "10px 0",
        }}>
          <span style={{ fontSize: 11, color: "var(--text3)" }}>+</span>
          <div>
            <p style={{ margin: 0, fontSize: 13 }}>Other users</p>
          </div>
          <span style={{ fontSize: 11, color: "var(--text3)" }}>—</span>
          <div>
            <div style={{ display: "flex", justifyContent: "space-between", fontSize: 10, marginBottom: 4 }}>
              <span>{fmt(othersMsgs)} msgs</span>
              <span style={{ fontWeight: 700 }}>{getPct(othersMsgs)}%</span>
            </div>
            <div style={{ height: 4, background: "rgba(128,128,128,0.12)", borderRadius: 2 }}>
              <div style={{ height: "100%", width: `${getPct(othersMsgs)}%`, background: C.grey, borderRadius: 2 }} />
            </div>
          </div>
          <div />
          <div />
        </div>
      )}
    </div>
  );
};
// ─────────────────────────────────────────────────────────────────────────────
// Dual-axis chart tooltip
// ─────────────────────────────────────────────────────────────────────────────

const DualTooltip = ({ active, payload, label }: any) => {
  if (!active || !payload?.length) return null;
  return (
    <div style={{
      background: "var(--bg2)", border: "1px solid var(--border)",
      borderRadius: 10, padding: "10px 14px", fontSize: 12,
    }}>
      <p style={{ color: "var(--text3)", marginBottom: 6, fontSize: 11 }}>{label}</p>
      {payload.map((p: any) => (
        <p key={p.dataKey} style={{ color: p.color, margin: "2px 0" }}>
          <strong>{p.name}:</strong>{" "}
          {p.dataKey === "revenue" ? `$${fmt(p.value)}` : fmt(p.value)}
        </p>
      ))}
    </div>
  );
};

// ─────────────────────────────────────────────────────────────────────────────
// Main
// ─────────────────────────────────────────────────────────────────────────────

interface Props { stats: AdminOverviewData | null; loading: boolean; }

const AdminOverview: React.FC<Props> = ({ stats, loading }) => {
  if (loading) return <div className="admin-loading">Loading overview…</div>;
  if (!stats)  return <div className="admin-loading">No data available.</div>;

  const d          = stats;
  const revChange  = d.revenue_change_pct ?? 0;
  const profit     = Math.round(d.revenue_this_month * 0.7);
  const aiCost     = Math.round(d.revenue_this_month * 0.3);

  const avgMsgPerSession = d.total_sessions && d.total_sessions > 0
    ? Math.round((d.messages_this_month / d.total_sessions) * 10) / 10
    : null;

  const ww  = d.user_change_ww  ?? null;
  const mom = d.user_change_mom ?? null;
  const yoy = d.user_change_yoy ?? null;

  const revenueTimeline = d.revenue_per_day ?? (d.messages_per_day ?? []).map((x: any) => ({
    date: x.date,
    revenue:   Math.round(x.count * 0.4),
    new_users: x.new_users ?? Math.round(x.count * 0.05),
  }));

  const avgResponseMs   = d.avg_response_ms ?? 0;
  const responseTimeline = d.response_time_per_day ?? (d.messages_per_day ?? []).map((x: any) => ({
    date: x.date, avg_ms: avgResponseMs,
  }));

  // Only show real token values — no fallback estimation
  const tokensUsed  = d.tokens_used_this_month  ?? 0;
  const tokensQuota = d.tokens_quota_this_month ?? 0;

  const docTypes = (d.doc_types ?? []).filter(t => t.count > 0);

  return (
    <div className="admin-overview">

      {/* ── Row 1: KPI cards (4-col) ─────────────────────────────────────── */}
      <div className="admin-metrics-grid" style={{ gridTemplateColumns: "repeat(4, 1fr)" }}>
        {/* Revenue + Profit (spans 2) */}
        <RevProfitCard
          revenue={d.revenue_this_month}
          revLast={d.revenue_last_month}
          revChange={revChange}
          profit={profit}
          aiCost={aiCost}
        />

        {/* Messages */}
        <TrendCard
          label="Messages / month"
          value={fmt(d.messages_this_month)}
          icon="💬"
          chips={d.messages_change_pct != null ? [{
            label: `${d.messages_change_pct >= 0 ? "+" : ""}${d.messages_change_pct.toFixed(1)}% MoM`,
            positive: d.messages_change_pct >= 0,
          }] : undefined}
          sub={avgMsgPerSession != null
            ? `${avgMsgPerSession} avg/session · ${fmt(d.total_messages)} total`
            : `${fmt(d.total_messages)} total`}
        />

        {/* New users + growth badges */}
        <TrendCard
          label="New users (30d)"
          value={fmt(d.new_users_this_month)}
          icon="📈"
          sub={`${fmt(d.total_users)} total · ${fmt(d.total_bots)} bots`}
          chips={[
            ...(ww  != null ? [{ label: `${ww  >= 0 ? "+" : ""}${ww.toFixed(1)}%`,  positive: ww  >= 0, tag: "W/W" }] : []),
            ...(mom != null ? [{ label: `${mom >= 0 ? "+" : ""}${mom.toFixed(1)}%`, positive: mom >= 0, tag: "M/M" }] : []),
            ...(yoy != null ? [{ label: `${yoy >= 0 ? "+" : ""}${yoy.toFixed(1)}%`, positive: yoy >= 0, tag: "Y/Y" }] : []),
          ]}
        />
      </div>

      {/* ── Revenue & User Growth chart ───────────────────────────────────── */}
      {revenueTimeline.length > 0 && (
        <div className="admin-card">
          <p className="admin-card__title">
            Revenue &amp; User Growth
            <span style={{ fontSize: 10, color: "var(--text3)", fontWeight: 400, marginLeft: 6 }}>
              last {revenueTimeline.length} days
            </span>
          </p>
          <ResponsiveContainer width="100%" height={210}>
            <ComposedChart data={revenueTimeline} margin={{ top: 8, right: 16, left: 0, bottom: 0 }}>
              <defs>
                <linearGradient id="revGrad" x1="0" y1="0" x2="0" y2="1">
                  <stop offset="5%"  stopColor={C.green} stopOpacity={0.18} />
                  <stop offset="95%" stopColor={C.green} stopOpacity={0}    />
                </linearGradient>
                <linearGradient id="userGrad" x1="0" y1="0" x2="0" y2="1">
                  <stop offset="5%"  stopColor={C.purple} stopOpacity={0.2} />
                  <stop offset="95%" stopColor={C.purple} stopOpacity={0}   />
                </linearGradient>
              </defs>
              <CartesianGrid strokeDasharray="3 3" stroke="var(--border)" vertical={false} />
              <XAxis dataKey="date" tick={{ fontSize: 10, fill: "var(--text3)" }}
                tickFormatter={(v: string) => v.slice(5)} />
              <YAxis yAxisId="rev" orientation="left" width={52}
                tick={{ fontSize: 10, fill: "var(--text3)" }}
                tickFormatter={(v: number) => `$${v >= 1000 ? `${(v / 1000).toFixed(0)}k` : v}`} />
              <YAxis yAxisId="users" orientation="right" width={32}
                tick={{ fontSize: 10, fill: "var(--text3)" }} />
              <Tooltip content={<DualTooltip />} />
              <Legend wrapperStyle={{ fontSize: 11, paddingTop: 8 }} />
              <Area yAxisId="rev" type="monotone" dataKey="revenue" name="Revenue ($)"
                stroke={C.green} strokeWidth={2.5} fill="url(#revGrad)" dot={false} />
              <Area yAxisId="users" type="monotone" dataKey="new_users" name="New users"
                stroke={C.purple} strokeWidth={2} fill="url(#userGrad)" dot={false} />
            </ComposedChart>
          </ResponsiveContainer>
        </div>
      )}

      {/* ── Perf / Token / Doc cards ──────────────────────────────────────── */}
      <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr 1fr", gap: 14 }}>

        <div className="admin-card">
          <p className="admin-card__title">⚡ Avg. Response Time</p>
          {avgResponseMs > 0
            ? <ResponseSparkline data={responseTimeline} avgMs={avgResponseMs} />
            : <p className="admin-empty" style={{ marginTop: 12 }}>No response-time data yet.</p>
          }
        </div>

        <div className="admin-card">
          <p className="admin-card__title">🪙 Token Consumption</p>
          <GasGauge used={tokensUsed} quota={tokensQuota} />
          {tokensUsed === 0 && (
            <p style={{ fontSize: 10, color: "var(--text3)", marginTop: 10, fontStyle: "italic" }}>
              Track real usage by storing a <code>tokens_used</code> field on each widget_message.
            </p>
          )}
        </div>

        <div className="admin-card">
          <p className="admin-card__title">📄 Document Types</p>
          {docTypes.length > 0
            ? <DocTypeChart data={docTypes} />
            : <p className="admin-empty" style={{ marginTop: 12 }}>No documents indexed yet.</p>
          }
        </div>
      </div>

      {/* ── Top 5 clients by message count ───────────────────────────────── */}
      <div className="admin-card">
        <p className="admin-card__title">
          Top 5 clients
          <span style={{ fontSize: 10, color: "var(--text3)", fontWeight: 400, marginLeft: 6 }}>
            ranked by messages
          </span>
        </p>
        <TopClientsTable clients={d.top_clients ?? []} />
      </div>

      

    </div>
  );
};

export default AdminOverview;