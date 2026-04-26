// Frontend/src/AdminBilling.tsx
// Fixes:
//   1. Reads from the new /admin/billing endpoint shape:
//      { email, name, plan_tier, mrr, messages_count, docs_count,
//        sessions_count, storage_mb }
//   2. Shows MRR, storage, and plan badge
//   3. Handles empty state gracefully

const PLAN_STYLE: Record<string, { bg: string; color: string }> = {
  free:       { bg: "rgba(136,135,128,0.15)", color: "var(--text3)" },
  starter:    { bg: "rgba(29,158,117,0.12)",  color: "#1D9E75" },
  growth:     { bg: "rgba(127,119,221,0.15)", color: "var(--accent-light)" },
  enterprise: { bg: "rgba(186,117,23,0.12)",  color: "#BA7517" },
};

interface BillingRow {
  name:           string;
  email:          string;
  plan_tier:      string;
  mrr:            number;
  messages_count: number;
  docs_count:     number;
  sessions_count: number;
  storage_mb:     number;
}

interface Props {
  billing: BillingRow[];
  loading: boolean;
}

export default function AdminBilling({ billing, loading }: Props) {
  if (loading) return <div className="cl-loading">Loading billing…</div>;

  const totalMrr = billing.reduce((s, r) => s + (r.mrr ?? 0), 0);
  const totalMsg = billing.reduce((s, r) => s + (r.messages_count ?? 0), 0);

  return (
    <div className="cl-section">
      {/* ── Summary strip ── */}
      <div style={{ display: "grid", gridTemplateColumns: "repeat(3, 1fr)", gap: 12, marginBottom: 24 }}>
        {[
          { label: "Total MRR",    value: `$${totalMrr.toLocaleString()}` },
          { label: "Total clients", value: billing.length },
          { label: "Messages (30d)", value: totalMsg.toLocaleString() },
        ].map((s) => (
          <div key={s.label} className="cl-stat-card">
            <div className="cl-stat-value" style={{ fontSize: 22 }}>{s.value}</div>
            <div className="cl-stat-label">{s.label}</div>
          </div>
        ))}
      </div>

      <h2 className="cl-section-title">Billing &amp; usage by client</h2>

      {billing.length === 0 ? (
        <div className="cl-empty">No clients found.</div>
      ) : (
        <div style={{ background: "var(--bg2)", border: "1px solid var(--border)", borderRadius: 10, overflow: "hidden" }}>
          <table style={{ width: "100%", borderCollapse: "collapse", fontSize: 12 }}>
            <thead>
              <tr style={{ background: "var(--bg3)", borderBottom: "1px solid var(--border)" }}>
                {["Client", "Plan", "MRR", "Messages (30d)", "Sessions", "Docs", "Storage"].map((h) => (
                  <th key={h} style={{
                    padding: "9px 14px", textAlign: "left",
                    fontWeight: 600, color: "var(--text3)",
                    fontSize: 10, textTransform: "uppercase", letterSpacing: "0.05em",
                    whiteSpace: "nowrap",
                  }}>
                    {h}
                  </th>
                ))}
              </tr>
            </thead>
            <tbody>
              {billing.map((row, i) => {
                const plan  = (row.plan_tier || "free").toLowerCase();
                const style = PLAN_STYLE[plan] ?? PLAN_STYLE.free;
                return (
                  <tr
                    key={row.email}
                    style={{
                      borderBottom: i < billing.length - 1 ? "1px solid var(--border)" : "none",
                      background:   i % 2 === 0 ? "var(--bg)" : "rgba(128,128,128,0.02)",
                    }}
                  >
                    {/* client */}
                    <td style={{ padding: "11px 14px" }}>
                      <div style={{ fontWeight: 500, color: "var(--text)", fontSize: 13 }}>{row.name}</div>
                      <div style={{ fontSize: 11, color: "var(--text3)", marginTop: 1 }}>{row.email}</div>
                    </td>

                    {/* plan badge */}
                    <td style={{ padding: "11px 14px" }}>
                      <span style={{
                        padding: "3px 9px", borderRadius: 20,
                        fontSize: 11, fontWeight: 600,
                        background: style.bg, color: style.color,
                        textTransform: "capitalize",
                      }}>
                        {plan}
                      </span>
                    </td>

                    {/* mrr */}
                    <td style={{ padding: "11px 14px" }}>
                      <span style={{ fontWeight: 600, color: "#1D9E75", fontSize: 13 }}>
                        ${row.mrr ?? 0}
                      </span>
                    </td>

                    {/* messages */}
                    <td style={{ padding: "11px 14px", color: "var(--text2)" }}>
                      {(row.messages_count ?? 0).toLocaleString()}
                    </td>

                    {/* sessions */}
                    <td style={{ padding: "11px 14px", color: "var(--text2)" }}>
                      {row.sessions_count ?? 0}
                    </td>

                    {/* docs */}
                    <td style={{ padding: "11px 14px", color: "var(--text2)" }}>
                      {row.docs_count ?? 0}
                    </td>

                    {/* storage */}
                    <td style={{ padding: "11px 14px", color: "var(--text2)" }}>
                      {row.storage_mb ?? 0} MB
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      )}
    </div>
  );
}