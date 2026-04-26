import React, { useState } from "react";
import { PieChart, Pie, Cell } from "recharts";
import { AdminOverviewData, TopClient, ActivityItem } from "./Adminapi";

// ── Stat card ─────────────────────────────────────────────────────────────────

const Metric: React.FC<{
  label: string;
  value: string | number;
  sub?: string;
  accent?: string;
  chip?: { label: string; positive: boolean };
}> = ({ label, value, sub, accent, chip }) => (
  <div className="admin-metric">
    <p className="admin-metric__label">{label}</p>
    <div style={{ display: "flex", alignItems: "baseline", gap: 8 }}>
      <p className="admin-metric__value" style={accent ? { color: accent } : undefined}>
        {value}
      </p>
      {chip && (
        <span style={{
          fontSize: 11, fontWeight: 600, padding: "2px 7px", borderRadius: 20,
          background: chip.positive ? "rgba(29,158,117,0.12)" : "rgba(216,90,48,0.12)",
          color: chip.positive ? "#0F6E56" : "#993C1D",
        }}>
          {chip.label}
        </span>
      )}
    </div>
    {sub && <p className="admin-metric__sub">{sub}</p>}
  </div>
);

// ── Plan pie ──────────────────────────────────────────────────────────────────

const PLAN_COLORS: Record<string, string> = {
  starter: "#1D9E75", growth: "#7F77DD", enterprise: "#BA7517", free: "#888780",
};

const PlanPie: React.FC<{ data: { plan: string; count: number; revenue: number }[] }> = ({ data }) => {
  const [active, setActive] = useState<number | null>(null);
  return (
    <div style={{ display: "flex", alignItems: "center", gap: 20 }}>
      <PieChart width={110} height={110}>
        <Pie data={data} cx={50} cy={50} innerRadius={30} outerRadius={50}
          dataKey="count" paddingAngle={3}
          onMouseEnter={(_, i) => setActive(i)} onMouseLeave={() => setActive(null)}>
          {data.map((entry, i) => (
            <Cell key={entry.plan}
              fill={PLAN_COLORS[entry.plan.toLowerCase()] ?? "#AFA9EC"}
              opacity={active === null || active === i ? 1 : 0.4} stroke="none" />
          ))}
        </Pie>
      </PieChart>
      <div style={{ display: "flex", flexDirection: "column", gap: 6 }}>
        {data.map((d) => (
          <div key={d.plan} style={{ display: "flex", alignItems: "center", gap: 7, fontSize: 12 }}>
            <span style={{ width: 8, height: 8, borderRadius: 2, flexShrink: 0, background: PLAN_COLORS[d.plan.toLowerCase()] ?? "#AFA9EC" }} />
            <span style={{ color: "var(--text)", textTransform: "capitalize" }}>{d.plan}</span>
            <span style={{ color: "var(--text2)", marginLeft: "auto", paddingLeft: 12 }}>
              {d.count} · <span style={{ color: "var(--text)" }}>${d.revenue.toLocaleString()}</span>
            </span>
          </div>
        ))}
      </div>
    </div>
  );
};

// ── Top client row ────────────────────────────────────────────────────────────

const PLAN_BADGE: Record<string, { bg: string; color: string }> = {
  starter:    { bg: "rgba(29,158,117,0.12)",  color: "#085041" },
  growth:     { bg: "rgba(127,119,221,0.15)", color: "#3C3489" },
  enterprise: { bg: "rgba(186,117,23,0.12)",  color: "#633806" },
  free:       { bg: "rgba(136,135,128,0.15)", color: "#444441" },
};

const TopClientRow: React.FC<{ client: TopClient; rank: number }> = ({ client, rank }) => {
  const badge = PLAN_BADGE[client.plan?.toLowerCase()] ?? PLAN_BADGE.free;
  const usagePct = Math.min(100, Math.round(client.usage_pct ?? 0));
  const barColor = usagePct >= 90 ? "#D85A30" : usagePct >= 70 ? "#BA7517" : "#7F77DD";
  return (
    <div style={{ display: "grid", gridTemplateColumns: "24px 1fr 90px 160px 80px 80px",
      alignItems: "center", gap: 12, padding: "10px 0", borderBottom: "1px solid var(--border)" }}>
      <span style={{ fontSize: 11, color: "var(--text3)", fontWeight: 600 }}>#{rank}</span>
      <div>
        <p style={{ fontSize: 13, fontWeight: 500, color: "var(--text)", marginBottom: 1 }}>{client.name}</p>
        <p style={{ fontSize: 11, color: "var(--text2)" }}>{client.email}</p>
      </div>
      <span style={{ padding: "3px 9px", borderRadius: 20, fontSize: 11, fontWeight: 600,
        background: badge.bg, color: badge.color, textTransform: "capitalize", textAlign: "center" }}>
        {client.plan}
      </span>
      <div>
        <div style={{ display: "flex", justifyContent: "space-between", fontSize: 10, color: "var(--text3)", marginBottom: 4 }}>
          <span>{(client.messages_used ?? 0).toLocaleString()} / {(client.messages_quota ?? 0).toLocaleString()} msgs</span>
          <span style={{ color: barColor, fontWeight: 600 }}>{usagePct}%</span>
        </div>
        <div style={{ height: 4, borderRadius: 2, background: "rgba(128,128,128,0.15)", overflow: "hidden" }}>
          <div style={{ height: "100%", width: `${usagePct}%`, background: barColor, borderRadius: 2 }} />
        </div>
      </div>
      <div style={{ textAlign: "right" }}>
        <p style={{ fontSize: 12, fontWeight: 500, color: "var(--text)" }}>{(client.storage_used_gb ?? 0).toFixed(1)} GB</p>
        <p style={{ fontSize: 10, color: "var(--text3)" }}>/ {client.storage_quota_gb ?? 0} GB</p>
      </div>
      <div style={{ textAlign: "right" }}>
        <p style={{ fontSize: 13, fontWeight: 600, color: "var(--text)" }}>${client.mrr ?? 0}</p>
        <p style={{ fontSize: 10, color: "var(--text3)" }}>/ mo</p>
      </div>
    </div>
  );
};

// ── Activity feed ─────────────────────────────────────────────────────────────

const ActivityFeed: React.FC<{ items: ActivityItem[] }> = ({ items }) => (
  <div style={{ display: "flex", flexDirection: "column" }}>
    {items.slice(0, 10).map((item, i) => (
      <div key={i} style={{ display: "flex", gap: 10, padding: "8px 0",
        borderBottom: i < items.length - 1 ? "1px solid var(--border)" : "none", alignItems: "flex-start" }}>
        <span style={{ width: 6, height: 6, borderRadius: "50%", background: "#7F77DD", flexShrink: 0, marginTop: 5 }} />
        <div style={{ flex: 1, minWidth: 0 }}>
          <p style={{ fontSize: 12, color: "var(--text)", marginBottom: 1 }}>
            <strong style={{ fontWeight: 600 }}>{item.bot_name}</strong>{" — "}
            <span style={{ overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap",
              display: "inline-block", maxWidth: 260, verticalAlign: "bottom" }}>{item.message}</span>
          </p>
          <p style={{ fontSize: 10, color: "var(--text3)" }}>
            {new Date(item.created_at).toLocaleTimeString("en-US", { hour: "2-digit", minute: "2-digit" })}
          </p>
        </div>
      </div>
    ))}
  </div>
);

// ── Main — now accepts data as props, no internal fetch ───────────────────────

interface Props {
  stats: AdminOverviewData | null;
  loading: boolean;
}

const AdminOverview: React.FC<Props> = ({ stats, loading }) => {
  if (loading) return <div className="admin-loading">Loading overview…</div>;
  if (!stats)  return <div className="admin-loading">Loading overview2026</div>;

  const data = stats;
  const revChange = data.revenue_change_pct ?? 0;

  return (
    <div className="admin-overview">
      <div className="admin-metrics-grid">
        <Metric label="MRR" value={`$${data.mrr.toLocaleString()}`} sub="monthly recurring"
          chip={{ label: `${revChange >= 0 ? "+" : ""}${revChange.toFixed(1)}% MoM`, positive: revChange >= 0 }} />
        <Metric label="ARR" value={`$${data.arr.toLocaleString()}`} sub="annual run rate" />
        <Metric label="Revenue this month" value={`$${data.revenue_this_month.toLocaleString()}`}
          sub={`vs $${data.revenue_last_month.toLocaleString()} last month`} accent="#1D9E75" />
        <Metric label="Total users"      value={data.total_users}      sub={`+${data.new_users_this_month} this month`} />
        <Metric label="Active bots"      value={data.active_bots}      sub={`${data.total_bots} total`} />
        <Metric label="Messages / month" value={data.messages_this_month.toLocaleString()} sub={`${data.total_messages.toLocaleString()} total`} />
      </div>

      <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 14 }}>
        <div className="admin-card">
          <p className="admin-card__title">Plan breakdown</p>
          {data.plan_breakdown?.length > 0
            ? <PlanPie data={data.plan_breakdown} />
            : <p className="admin-empty">No plan data.</p>}
        </div>
        <div className="admin-card">
          <p className="admin-card__title">Profit estimate</p>
          <div style={{ display: "flex", flexDirection: "column", gap: 10 }}>
            {[
              { label: "Gross revenue",   value: `$${data.revenue_this_month.toLocaleString()}`, color: "#1D9E75" },
              { label: "Est. AI costs",   value: `~$${Math.round(data.revenue_this_month * 0.3).toLocaleString()}`, color: "#D85A30", sub: "~30% of revenue" },
              { label: "Est. net profit", value: `~$${Math.round(data.revenue_this_month * 0.7).toLocaleString()}`, color: "#7F77DD", bold: true },
            ].map((row) => (
              <div key={row.label} style={{ display: "flex", justifyContent: "space-between", alignItems: "center" }}>
                <span style={{ fontSize: 12, color: "var(--text2)" }}>{row.label}</span>
                <span style={{ fontSize: (row as any).bold ? 16 : 13, fontWeight: (row as any).bold ? 600 : 400, color: row.color }}>
                  {row.value}
                  {(row as any).sub && <span style={{ fontSize: 10, color: "var(--text3)", marginLeft: 6 }}>{(row as any).sub}</span>}
                </span>
              </div>
            ))}
            <p style={{ fontSize: 10, color: "var(--text3)", marginTop: 4, fontStyle: "italic" }}>
              AI cost ratio is configurable in settings. Connect your billing provider for real figures.
            </p>
          </div>
        </div>
      </div>

      <div className="admin-card">
        <p className="admin-card__title">Top 5 clients</p>
        <div style={{ display: "grid", gridTemplateColumns: "24px 1fr 90px 160px 80px 80px",
          gap: 12, padding: "0 0 6px", borderBottom: "1px solid var(--border)" }}>
          {["#", "Client", "Plan", "Message usage", "Storage", "MRR"].map((h) => (
            <span key={h} style={{ fontSize: 10, color: "var(--text3)", fontWeight: 600, textTransform: "uppercase", letterSpacing: "0.05em" }}>{h}</span>
          ))}
        </div>
        {data.top_clients?.length > 0
          ? data.top_clients.slice(0, 5).map((c, i) => <TopClientRow key={c.id} client={c} rank={i + 1} />)
          : <p className="admin-empty">No client data.</p>}
      </div>

      <div className="admin-card">
        <p className="admin-card__title">Live activity
          <span style={{ fontSize: 10, color: "var(--text3)", fontWeight: 400, marginLeft: 6 }}>last 10 widget messages</span>
        </p>
        {data.activity_feed?.length > 0
          ? <ActivityFeed items={data.activity_feed} />
          : <p className="admin-empty">No recent activity.</p>}
      </div>
    </div>
  );
};

export default AdminOverview;