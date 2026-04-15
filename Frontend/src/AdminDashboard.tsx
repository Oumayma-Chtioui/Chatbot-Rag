import { useState, useEffect } from "react";
import * as api from "./api";

interface AdminDashboardProps {
  onClose: () => void;
}

export default function AdminDashboard({ onClose }: AdminDashboardProps) {
  const [tab, setTab] = useState<"stats" | "users" | "documents" | "system">("stats");
  const [stats, setStats] = useState<any>(null);
  const [users, setUsers] = useState<any[]>([]);
  const [documents, setDocuments] = useState<any[]>([]);
  const [system, setSystem] = useState<any>(null);
  const [loading, setLoading] = useState(false);

  useEffect(() => {
    loadTab(tab);
  }, [tab]);

  const loadTab = async (t: string) => {
    setLoading(true);
    try {
      if (t === "stats") setStats(await api.getAdminStats());
      if (t === "users") setUsers(await api.getAdminUsers());
      if (t === "documents") {
        const data = await api.getAdminDocuments();
        setDocuments(data.documents);
      }
      if (t === "system") setSystem(await api.getSystemHealth());
    } catch (err) {
      console.error(err);
    } finally {
      setLoading(false);
    }
  };

  const handleDeleteUser = async (userId: number) => {
    if (!confirm("Delete this user?")) return;
    await api.deleteAdminUser(userId);
    setUsers(u => u.filter(x => x.id !== userId));
  };

  const handleDeleteDoc = async (docId: string) => {
    if (!confirm("Delete this document?")) return;
    await api.deleteAdminDocument(docId);
    setDocuments(d => d.filter(x => x.id !== docId));
  };

  const tabStyle = (t: string) => ({
    padding: "8px 16px",
    borderRadius: 8,
    border: "none",
    cursor: "pointer",
    fontSize: 13,
    fontWeight: 600,
    background: tab === t ? "var(--accent)" : "var(--bg2)",
    color: tab === t ? "white" : "var(--text2)",
  });

  return (
    <div className="admin-modal" style={{
      position: "fixed", inset: 0, background: "rgba(0,0,0,0.7)",
      zIndex: 1000, display: "flex", alignItems: "center", justifyContent: "center"
    }}>
      <div className="admin-modal-dialog" style={{
        background: "var(--bg)", color: "var(--text)", borderRadius: 16, width: "95%", maxWidth: 1200,
        maxHeight: "95vh", overflow: "hidden"
      }}>
        {/* Sidebar */}
        <div className="admin-modal-sidebar" style={{
          background: "var(--bg2)", borderRight: "1px solid var(--border)",
          display: "flex", flexDirection: "column", padding: "20px 0"
        }}>
          <div style={{ padding: "0 16px", marginBottom: 24 }}>
            <div style={{ fontSize: 14, fontWeight: 600, color: "var(--text)" }}>⚙️ Admin</div>
          </div>
          <nav style={{ display: "flex", flexDirection: "column", gap: 4, flex: 1 }}>
            {["stats", "users", "documents", "system"].map(t => {
              const isActive = tab === t;
              return (
                <button
                  key={t}
                  onClick={() => setTab(t as any)}
                  style={{
                    background: isActive ? "rgba(127,119,221,0.15)" : "none",
                    border: "none", color: isActive ? "var(--accent)" : "var(--text3)",
                    padding: "10px 16px", textAlign: "left", cursor: "pointer",
                    fontSize: 12, fontWeight: isActive ? 600 : 400, transition: "all 0.2s"
                  }}
                >
                  {t === "stats" ? "📊 Statistics" :
                   t === "users" ? "👥 Users" :
                   t === "documents" ? "📄 Documents" : "🖥️ System"}
                </button>
              );
            })}
          </nav>
          <div style={{ padding: "0 16px", borderTop: "1px solid var(--border)", paddingTop: 16 }}>
            <button onClick={onClose} style={{
              background: "none", border: "1px solid var(--border)", color: "var(--text3)",
              padding: "8px 12px", borderRadius: 6, cursor: "pointer", fontSize: 12, width: "100%"
            }}>Close</button>
          </div>
        </div>

        {/* Content */}
        <div className="admin-modal-panel" style={{ flex: 1, overflowY: "auto", padding: "24px 28px", display: "flex", flexDirection: "column" }}>
          <div style={{ marginBottom: 20 }}>
            <h2 style={{ fontSize: 18, fontWeight: 600, margin: 0 }}>
              {tab === "stats" ? "Statistics" : tab === "users" ? "Users" : tab === "documents" ? "Documents" : "System Health"}
            </h2>
          </div>
          {loading && <div style={{ color: "var(--text3)", textAlign: "center" }}>Loading...</div>}

          {/* Stats Tab */}
          {tab === "stats" && stats && (
            <div>
              <div style={{ display: "grid", gridTemplateColumns: "repeat(3, 1fr)", gap: 16, marginBottom: 24 }}>
                {[
                  { label: "Total Users", value: stats.total_users, icon: "👥" },
                  { label: "Total Sessions", value: stats.total_sessions, icon: "💬" },
                  { label: "Total Messages", value: stats.total_messages, icon: "✉️" },
                  { label: "Total Documents", value: stats.total_documents, icon: "📄" },
                  { label: "Active Sessions (24h)", value: stats.active_sessions_24h, icon: "🟢" },
                ].map((stat, i) => (
                  <div key={i} style={{
                    background: "var(--bg2)", borderRadius: 12, padding: "16px 20px",
                    border: "1px solid var(--border)"
                  }}>
                    <div style={{ fontSize: 24 }}>{stat.icon}</div>
                    <div style={{ fontSize: 28, fontWeight: 700, color: "var(--accent)", margin: "8px 0 4px" }}>
                      {stat.value}
                    </div>
                    <div style={{ fontSize: 12, color: "var(--text3)" }}>{stat.label}</div>
                  </div>
                ))}
              </div>

              {/* Messages per day */}
              <div style={{ background: "var(--bg2)", borderRadius: 12, padding: 20, border: "1px solid var(--border)" }}>
                <div style={{ fontSize: 14, fontWeight: 600, marginBottom: 16, color: "var(--text3)" }}>
                  Messages per day (last 7 days)
                </div>
                <div style={{ display: "flex", gap: 8, alignItems: "flex-end", height: 120 }}>
                  {stats.messages_per_day.map((d: any, i: number) => {
                    const max = Math.max(...stats.messages_per_day.map((x: any) => x.count), 1);
                    const height = Math.max((d.count / max) * 100, 4);
                    return (
                      <div key={i} style={{ flex: 1, display: "flex", flexDirection: "column", alignItems: "center", gap: 4 }}>
                        <div style={{ fontSize: 10, color: "var(--text3)" }}>{d.count}</div>
                        <div style={{
                          width: "100%", height: `${height}px`,
                          background: "var(--accent)", borderRadius: 4
                        }} />
                        <div style={{ fontSize: 9, color: "var(--text3)" }}>
                          {d.date.slice(5)}
                        </div>
                      </div>
                    );
                  })}
                </div>
              </div>
            </div>
          )}

          {/* Users Tab */}
          {tab === "users" && (
            <div style={{ display: "flex", flexDirection: "column", gap: 8 }}>
              {users.map(u => (
                <div key={u.id} style={{
                  display: "flex", alignItems: "center", gap: 12,
                  background: "var(--bg2)", borderRadius: 10, padding: "12px 16px",
                  border: "1px solid var(--border)"
                }}>
                  <div style={{
                    width: 36, height: 36, borderRadius: "50%",
                    background: "var(--accent)", display: "flex",
                    alignItems: "center", justifyContent: "center",
                    color: "white", fontWeight: 700, fontSize: 14, flexShrink: 0
                  }}>
                    {u.name.charAt(0).toUpperCase()}
                  </div>
                  <div style={{ flex: 1 }}>
                    <div style={{ fontSize: 13, fontWeight: 600, color: "var(--text2)" }}>{u.name}</div>
                    <div style={{ fontSize: 11, color: "var(--text3)" }}>{u.email}</div>
                  </div>
                  <div style={{ fontSize: 11, color: "var(--text3)" }}>{u.session_count} sessions</div>
                  {u.is_admin && (
                    <span style={{
                      fontSize: 10, padding: "2px 8px", borderRadius: 4,
                      background: "var(--accent)22", color: "var(--accent)", fontWeight: 600
                    }}>Admin</span>
                  )}
                  <button onClick={() => handleDeleteUser(u.id)} style={{
                    background: "none", border: "1px solid var(--danger)",
                    color: "var(--danger)", borderRadius: 6, padding: "4px 10px",
                    cursor: "pointer", fontSize: 12
                  }}>Delete</button>
                </div>
              ))}
            </div>
          )}

          {/* Documents Tab */}
          {tab === "documents" && (
            <div style={{ display: "flex", flexDirection: "column", gap: 8 }}>
              {documents.map(d => (
                <div key={d.id} style={{
                  display: "flex", alignItems: "center", gap: 12,
                  background: "var(--bg2)", borderRadius: 10, padding: "12px 16px",
                  border: "1px solid var(--border)"
                }}>
                  <span style={{ fontSize: 18 }}>{d.type === "url" ? "🔗" : "📄"}</span>
                  <div style={{ flex: 1, minWidth: 0 }}>
                    <div style={{
                      fontSize: 13, fontWeight: 600, color: "var(--text2)",
                      overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap"
                    }}>{d.name}</div>
                    <div style={{ fontSize: 11, color: "var(--text3)" }}>
                      User {d.user_id} · {d.chunks || 0} chunks · {d.status}
                    </div>
                  </div>
                  <div style={{ fontSize: 11, color: "var(--text3)", flexShrink: 0 }}>{d.size}</div>
                  <button onClick={() => handleDeleteDoc(d.id)} style={{
                    background: "none", border: "1px solid var(--danger)",
                    color: "var(--danger)", borderRadius: 6, padding: "4px 10px",
                    cursor: "pointer", fontSize: 12
                  }}>Delete</button>
                </div>
              ))}
            </div>
          )}

          {/* System Tab */}
          {tab === "system" && system && (
            <div style={{ display: "flex", flexDirection: "column", gap: 16 }}>
              <div style={{ background: "var(--bg2)", borderRadius: 12, padding: 20, border: "1px solid var(--border)" }}>
                <div style={{ fontSize: 14, fontWeight: 600, marginBottom: 12, color: "var(--text2)" }}>
                  ⚡ FAISS Vector Store
                </div>
                <div style={{ display: "flex", gap: 24, marginBottom: 16 }}>
                  <div>
                    <div style={{ fontSize: 24, fontWeight: 700, color: "var(--accent)" }}>
                      {system.faiss.total_indexes}
                    </div>
                    <div style={{ fontSize: 11, color: "var(--text3)" }}>Total indexes</div>
                  </div>
                  <div>
                    <div style={{ fontSize: 24, fontWeight: 700, color: "var(--accent)" }}>
                      {system.faiss.total_size_mb} MB
                    </div>
                    <div style={{ fontSize: 11, color: "var(--text3)" }}>Total size</div>
                  </div>
                </div>
                {system.faiss.user_breakdown.map((u: any, i: number) => (
                  <div key={i} style={{
                    display: "flex", justifyContent: "space-between",
                    padding: "6px 0", borderTop: "1px solid var(--border)", fontSize: 12, color: "var(--text2)"
                  }}>
                    <span>{u.user}</span>
                    <span>{u.indexes} indexes · {u.size_mb} MB</span>
                  </div>
                ))}
              </div>

              <div style={{ background: "var(--bg2)", borderRadius: 12, padding: 20, border: "1px solid var(--border)" }}>
                <div style={{ fontSize: 14, fontWeight: 600, marginBottom: 12, color: "var(--text2)" }}>
                  📁 Uploads Storage
                </div>
                <div style={{ display: "flex", gap: 24 }}>
                  <div>
                    <div style={{ fontSize: 24, fontWeight: 700, color: "var(--accent)" }}>
                      {system.uploads.file_count}
                    </div>
                    <div style={{ fontSize: 11, color: "var(--text3)" }}>Files</div>
                  </div>
                  <div>
                    <div style={{ fontSize: 24, fontWeight: 700, color: "var(--accent)" }}>
                      {system.uploads.size_mb} MB
                    </div>
                    <div style={{ fontSize: 11, color: "var(--text3)" }}>Total size</div>
                  </div>
                </div>
              </div>
            </div>
          )}
        </div>
      </div>
    </div>
  );
}