import { AreaChart, Area, XAxis, Tooltip, ResponsiveContainer } from "recharts";

interface Props {
  stats: any;
  loading: boolean;
}

export default function AdminOverview({ stats, loading }: Props) {
  if (loading) return <div className="cl-loading">Loading overview…</div>;
  if (!stats) return null;

  return (
    <>
      <div className="cl-stats-grid">
        {[
          { label: "Clients", value: stats.total_bots },
          { label: "Sessions", value: stats.total_sessions },
          { label: "Messages", value: stats.total_messages },
          { label: "Docs", value: stats.total_documents },
          { label: "Active 24h", value: stats.active_sessions_24h },
        ].map((item) => (
          <div className="cl-stat-card" key={item.label}>
            <div className="cl-stat-value">{item.value}</div>
            <div className="cl-stat-label">{item.label}</div>
          </div>
        ))}
      </div>

      <div className="cl-section">
        <h2 className="cl-section-title">Messages per day (last 7 days)</h2>
        <div style={{ width: "100%", height: 200 }}>
          <ResponsiveContainer width="100%" height={200}>
            <AreaChart data={stats.messages_per_day}>
              <defs>
                <linearGradient id="colorMsgAdmin" x1="0" y1="0" x2="0" y2="1">
                  <stop offset="5%" stopColor="var(--accent)" stopOpacity={0.3} />
                  <stop offset="95%" stopColor="var(--accent)" stopOpacity={0} />
                </linearGradient>
              </defs>
              <XAxis dataKey="date" tick={{ fontSize: 10, fill: "var(--text3)" }} tickFormatter={(v) => String(v).slice(5)} />
              <Tooltip contentStyle={{ background: "var(--bg2)", border: "1px solid var(--border)", borderRadius: 8 }} />
              <Area type="monotone" dataKey="count" stroke="var(--accent)" fill="url(#colorMsgAdmin)" strokeWidth={2} dot={false} />
            </AreaChart>
          </ResponsiveContainer>
        </div>
      </div>
    </>
  );
}
