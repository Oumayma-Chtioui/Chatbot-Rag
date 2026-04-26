// Frontend/src/AdminSystem.tsx
// Fixes:
//   1. Reads faiss.total_size_mb instead of uploads.size_mb (which was wrong before)
//   2. Reads uploads.size_mb for real upload directory size
//   3. Shows CPU / RAM / disk resource bars
//   4. Handles empty/missing data gracefully

interface Props {
  system: any;
  loading: boolean;
}

function ResourceBar({ label, pct }: { label: string; pct: number }) {
  const color = pct >= 90 ? "#D85A30" : pct >= 70 ? "#BA7517" : "#7F77DD";
  return (
    <div style={{ marginBottom: 14 }}>
      <div style={{ display: "flex", justifyContent: "space-between", fontSize: 12, color: "var(--text2)", marginBottom: 5 }}>
        <span>{label}</span>
        <span style={{ color, fontWeight: 600 }}>{pct}%</span>
      </div>
      <div style={{ height: 5, borderRadius: 3, background: "rgba(128,128,128,0.15)", overflow: "hidden" }}>
        <div style={{ height: "100%", width: `${Math.min(100, pct)}%`, background: color, borderRadius: 3, transition: "width 0.4s" }} />
      </div>
    </div>
  );
}

export default function AdminSystem({ system, loading }: Props) {
  if (loading) return <div className="cl-loading">Loading system health…</div>;
  if (!system) return <div className="cl-empty">No system data available.</div>;

  const faiss   = system.faiss   || { total_indexes: 0, total_size_mb: 0, user_breakdown: [] };
  const uploads = system.uploads || { file_count: 0, size_mb: 0 };

  return (
    <>
      {/* ── System resources ── */}
      {(system.cpu_pct != null || system.ram_pct != null) && (
        <div className="cl-section">
          <h2 className="cl-section-title">🖥️ System Resources</h2>
          <div style={{ background: "var(--bg2)", border: "1px solid var(--border)", borderRadius: 10, padding: "18px 20px" }}>
            <ResourceBar label="CPU usage"  pct={system.cpu_pct  ?? 0} />
            <ResourceBar label="RAM usage"  pct={system.ram_pct  ?? 0} />
            <ResourceBar label="Disk usage" pct={system.disk_pct ?? 0} />
          </div>
        </div>
      )}

      {/* ── FAISS vector store ── */}
      <div className="cl-section">
        <h2 className="cl-section-title">⚡ FAISS Vector Store</h2>
        <div style={{ display: "grid", gridTemplateColumns: "repeat(2, 1fr)", gap: 12, marginBottom: 14 }}>
          <div className="cl-stat-card">
            <div className="cl-stat-value">{faiss.total_indexes}</div>
            <div className="cl-stat-label">Total indexes</div>
          </div>
          <div className="cl-stat-card">
            <div className="cl-stat-value">{faiss.total_size_mb} MB</div>
            <div className="cl-stat-label">Vector store size</div>
          </div>
        </div>

        {faiss.user_breakdown?.length > 0 ? (
          <div style={{ background: "var(--bg2)", border: "1px solid var(--border)", borderRadius: 10, padding: 14 }}>
            {faiss.user_breakdown.map((u: any, i: number) => (
              <div
                key={i}
                style={{
                  display: "flex", justifyContent: "space-between",
                  padding: "8px 0",
                  borderBottom: i < faiss.user_breakdown.length - 1 ? "1px solid var(--border)" : "none",
                  fontSize: 12, color: "var(--text2)",
                }}
              >
                <span style={{ color: "var(--text)", fontFamily: "'DM Mono', monospace" }}>{u.user}</span>
                <span>{u.indexes} index{u.indexes !== 1 ? "es" : ""} · {u.size_mb} MB</span>
              </div>
            ))}
          </div>
        ) : (
          <div className="cl-empty">No FAISS indexes found.</div>
        )}
      </div>

      {/* ── Uploads storage ── */}
      <div className="cl-section">
        <h2 className="cl-section-title">📁 Uploads Storage</h2>
        <div style={{ display: "grid", gridTemplateColumns: "repeat(2, 1fr)", gap: 12 }}>
          <div className="cl-stat-card">
            <div className="cl-stat-value">{uploads.file_count}</div>
            <div className="cl-stat-label">Uploaded files</div>
          </div>
          <div className="cl-stat-card">
            <div className="cl-stat-value">{uploads.size_mb} MB</div>
            <div className="cl-stat-label">Storage used</div>
          </div>
        </div>
      </div>

      {/* ── MongoDB collections ── */}
      {system.mongo_collections?.length > 0 && (
        <div className="cl-section">
          <h2 className="cl-section-title">🍃 MongoDB Collections</h2>
          <div style={{ background: "var(--bg2)", border: "1px solid var(--border)", borderRadius: 10, overflow: "hidden" }}>
            <table style={{ width: "100%", borderCollapse: "collapse", fontSize: 12 }}>
              <thead>
                <tr style={{ background: "var(--bg3)", borderBottom: "1px solid var(--border)" }}>
                  {["Collection", "Documents", "Size"].map((h) => (
                    <th key={h} style={{ padding: "8px 14px", textAlign: "left", fontWeight: 600, color: "var(--text3)", fontSize: 10, textTransform: "uppercase", letterSpacing: "0.05em" }}>
                      {h}
                    </th>
                  ))}
                </tr>
              </thead>
              <tbody>
                {system.mongo_collections.map((col: any, i: number) => (
                  <tr key={col.name} style={{ borderBottom: i < system.mongo_collections.length - 1 ? "1px solid var(--border)" : "none" }}>
                    <td style={{ padding: "9px 14px", color: "var(--text)", fontFamily: "'DM Mono', monospace", fontSize: 11 }}>{col.name}</td>
                    <td style={{ padding: "9px 14px", color: "var(--text2)" }}>{(col.count ?? 0).toLocaleString()}</td>
                    <td style={{ padding: "9px 14px", color: "var(--text2)" }}>{col.size_mb} MB</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </div>
      )}
    </>
  );
}