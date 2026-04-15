interface Props {
  billing: any[];
  loading: boolean;
}

export default function AdminBilling({ billing, loading }: Props) {
  if (loading) return <div className="cl-loading">Loading billing…</div>;

  return (
    <div className="cl-section">
      <h2 className="cl-section-title">Billing & usage by client</h2>
      {billing.length === 0 ? (
        <div className="cl-empty">No billing data available.</div>
      ) : (
        <div className="cl-doc-list">
          {billing.map((row) => (
            <div key={row.email} className="cl-doc-row">
              <div style={{ flex: 1 }}>
                <div className="cl-doc-name">{row.email}</div>
                <div className="cl-doc-meta">
                  Messages: {row.messages_count} · Docs: {row.docs_count} · Sessions: {row.sessions_count}
                </div>
                <div style={{ fontSize: 11, color: "var(--accent)", marginTop: 4 }}>
                  Plan: <strong>{row.plan_tier}</strong>
                </div>
              </div>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}
