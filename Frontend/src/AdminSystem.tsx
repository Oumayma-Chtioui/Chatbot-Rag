interface Props {
  system: any;
  loading: boolean;
}

export default function AdminSystem({ system, loading }: Props) {
  if (loading || !system) return <div className="cl-loading">Loading system health…</div>;
  return (
    <>
      <div className="cl-section">
        <h2 className="cl-section-title">⚡ FAISS Vector Store</h2>
        <div style={{ display: "grid", gridTemplateColumns: "repeat(2, 1fr)", gap: 16, marginBottom: 16 }}>
          <div className="cl-stat-card">
            <div className="cl-stat-value">{system.faiss?.total_indexes}</div>
            <div className="cl-stat-label">Total indexes</div>
          </div>
          <div className="cl-stat-card">
            <div className="cl-stat-value">{system.uploads?.size_mb} MB</div>
            <div className="cl-stat-label">Total size</div>
          </div>
        </div>
        {system.faiss?.user_breakdown.length > 0 && (
          <div style={{ background: "var(--bg2)", border: "1px solid var(--border)", borderRadius: 10, padding: 14 }}>
            {system.faiss?.user_breakdown.map((u: any, i: number) => (
              <div
                key={i}
                style={{
                  display: "flex", justifyContent: "space-between",
                  padding: "8px 0", borderBottom: i < system.faiss?.user_breakdown.length - 1 ? "1px solid var(--border)" : "none",
                  fontSize: 12, color: "var(--text2)"
                }}
              >
                <span>{u.user}</span>
                <span>{u.indexes} indexes · {u.size_mb} MB</span>
              </div>
            ))}
          </div>
        )}
      </div>

      <div className="cl-section">
        <h2 className="cl-section-title">📁 Uploads Storage</h2>
        <div style={{ display: "grid", gridTemplateColumns: "repeat(2, 1fr)", gap: 16 }}>
          <div className="cl-stat-card">
            <div className="cl-stat-value">{system.uploads?.file_count}</div>
            <div className="cl-stat-label">Files</div>
          </div>
          <div className="cl-stat-card">
            <div className="cl-stat-value">{system.uploads.size_mb} MB</div>
            <div className="cl-stat-label">Total size</div>
          </div>
        </div>
      </div>
    </>
  );
}
