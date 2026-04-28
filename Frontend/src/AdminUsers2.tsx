import React, { useEffect, useState } from "react";
import * as api from "./api";

interface UserRow {
  id: number;
  name: string;
  email: string;
  is_admin: boolean;
  is_verified: boolean;
  created_at: string;
  session_count: number;
  bot: {
    id: string;
    name: string;
    doc_count: number;
    message_count: number;
  } | null;
}

interface Props {
  onViewBot: (bot: any) => void;
}

export default function AdminUsers2({ onViewBot }: Props) {
  const [users, setUsers] = useState<UserRow[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [search, setSearch] = useState("");
  const [docCountsByBotId, setDocCountsByBotId] = useState<Record<string, number>>({});


  const token = () => localStorage.getItem("admin_token");

  const load = async () => {
    setLoading(true);
    try {
      const res = await fetch("http://localhost:8000/admin/users", {
        headers: { Authorization: `Bearer ${token()}` },
      });
      if (!res.ok) throw new Error("Failed to fetch users");
      const data = await res.json();
      setUsers(data);

      // Get real document counts per bot (docs are keyed by user_id === bot.id).
      try {
        const docsData = await api.getAdminDocuments();
        const documents = docsData?.documents || [];
        const counts: Record<string, number> = {};
        for (const d of documents) {
          const botId = d?.user_id != null ? String(d.user_id) : null;
          if (!botId) continue;
          counts[botId] = (counts[botId] || 0) + 1;
        }
        setDocCountsByBotId(counts);
      } catch {
        // Optional: keep doc counts from user payload if this fails.
        setDocCountsByBotId({});
      }
    } catch (err: any) {
      setError(err.message);
    } finally {
      setLoading(false);
    }
  };

  const handleDelete = async (userId: number) => {
    if (!confirm("Delete this user? This cannot be undone.")) return;
    await fetch(`http://localhost:8000/admin/users/${userId}`, {
      method: "DELETE",
      headers: { Authorization: `Bearer ${token()}` },
    });
    setUsers(u => u.filter(x => x.id !== userId));
  };

  const handleViewBot = async (botSummary: NonNullable<UserRow["bot"]>) => {
    // When coming from users list, we only have a minimal bot object.
    // Enrich it from /admin/bots so the dashboard can show owner details.
    try {
      const data = await api.getAdminBots();
      const full = (data?.bots || []).find((b: any) => String(b.id) === String(botSummary.id));
      onViewBot(full || botSummary);
    } catch {
      onViewBot(botSummary);
    }
  };

  useEffect(() => { load(); }, []);

  const filtered = users.filter(u =>
    u.name?.toLowerCase().includes(search.toLowerCase()) ||
    u.email?.toLowerCase().includes(search.toLowerCase())
  );

  if (loading) return <div className="admin-loading">Loading users…</div>;
  if (error)   return <div className="admin-error">{error}</div>;

  return (
    <div>
      {/* ── summary strip ── */}
      <div style={{ display: "grid", gridTemplateColumns: "repeat(3,1fr)", gap: 12, marginBottom: 24 }}>
        {[
          { label: "Total users",    value: users.length },
          { label: "Verified",       value: users.filter(u => u.is_verified).length },
          { label: "With a bot",     value: users.filter(u => u.bot).length },
        ].map(s => (
          <div key={s.label} className="admin-metric">
            <p className="admin-metric__label">{s.label}</p>
            <p className="admin-metric__value">{s.value}</p>
          </div>
        ))}
      </div>

      {/* ── search ── */}
      <div style={{ display: "flex", gap: 10, marginBottom: 14, alignItems: "center" }}>
        <input
          type="text"
          placeholder="Search by name or email…"
          value={search}
          onChange={e => setSearch(e.target.value)}
          style={{
            padding: "7px 12px", borderRadius: 8,
            border: "1px solid var(--border)",
            background: "var(--bg2)", color: "var(--text)",
            fontSize: 13, flex: 1, maxWidth: 300, outline: "none",
          }}
        />
        <span style={{ fontSize: 12, color: "var(--text3)", marginLeft: "auto" }}>
          {filtered.length} users
        </span>
      </div>

      {/* ── table ── */}
      <div className="admin-card" style={{ padding: 0, overflow: "hidden" }}>
        <div style={{ overflowX: "auto" }}>
          <table style={{ width: "100%", borderCollapse: "collapse", fontSize: 12 }}>
            <thead>
              <tr style={{ borderBottom: "1px solid var(--border)", background: "var(--bg2)" }}>
                {["User", "Status", "Bot", "Bot activity", "Joined", "Actions"].map(h => (
                  <th key={h} style={{
                    padding: "10px 14px", textAlign: "left",
                    fontWeight: 600, color: "var(--text3)",
                    fontSize: 10, letterSpacing: "0.05em",
                    textTransform: "uppercase", whiteSpace: "nowrap",
                  }}>
                    {h}
                  </th>
                ))}
              </tr>
            </thead>
            <tbody>
              {filtered.map((u, i) => (
                <tr key={u.id} style={{
                  borderBottom: i < filtered.length - 1 ? "1px solid var(--border)" : "none",
                  background: i % 2 === 0 ? "var(--bg)" : "rgba(128,128,128,0.02)",
                }}>

                  {/* user */}
                  <td style={{ padding: "12px 14px" }}>
                    <div style={{ display: "flex", alignItems: "center", gap: 10 }}>
                      <div style={{
                        width: 32, height: 32, borderRadius: "50%",
                        background: u.is_admin ? "rgba(186,117,23,0.2)" : "rgba(127,119,221,0.2)",
                        color: u.is_admin ? "#BA7517" : "var(--accent-light)",
                        display: "flex", alignItems: "center", justifyContent: "center",
                        fontSize: 12, fontWeight: 700, flexShrink: 0,
                      }}>
                        {u.name?.charAt(0).toUpperCase()}
                      </div>
                      <div>
                        <div style={{ fontWeight: 500, color: "var(--text)" }}>
                          {u.name}
                          {u.is_admin && (
                            <span style={{
                              marginLeft: 6, fontSize: 9, padding: "1px 6px",
                              borderRadius: 4, background: "rgba(186,117,23,0.15)",
                              color: "#BA7517", fontWeight: 600,
                            }}>ADMIN</span>
                          )}
                        </div>
                        <div style={{ fontSize: 11, color: "var(--text3)" }}>{u.email}</div>
                      </div>
                    </div>
                  </td>

                  {/* verified status */}
                  <td style={{ padding: "12px 14px" }}>
                    <span style={{
                      padding: "3px 9px", borderRadius: 20, fontSize: 11, fontWeight: 600,
                      background: u.is_verified ? "rgba(29,158,117,0.12)" : "rgba(216,90,48,0.12)",
                      color: u.is_verified ? "#1D9E75" : "#D85A30",
                    }}>
                      {u.is_verified ? "✓ Verified" : "✗ Unverified"}
                    </span>
                  </td>

                  {/* bot name */}
                  <td style={{ padding: "12px 14px" }}>
                    {u.bot ? (
                      <div>
                        <div style={{ fontWeight: 500, color: "var(--text)" }}>{u.bot.name}</div>
                        <div style={{ fontSize: 11, color: "var(--text3)" }}>
                          {(docCountsByBotId[String(u.bot.id)] ?? u.bot.doc_count ?? 0)} docs
                        </div>
                      </div>
                    ) : (
                      <span style={{ fontSize: 11, color: "var(--text3)" }}>No bot</span>
                    )}
                  </td>

                  {/* bot activity */}
                  <td style={{ padding: "12px 14px" }}>
                    {u.bot ? (
                      <div style={{ fontSize: 12, color: "var(--text2)" }}>
                        {u.bot.message_count} messages
                      </div>
                    ) : (
                      <span style={{ fontSize: 11, color: "var(--text3)" }}>—</span>
                    )}
                  </td>

                  {/* joined */}
                  <td style={{ padding: "12px 14px", whiteSpace: "nowrap" }}>
                    <span style={{ fontSize: 11, color: "var(--text3)" }}>
                      {u.created_at ? new Date(u.created_at).toLocaleDateString("en-US", {
                        month: "short", day: "numeric", year: "numeric"
                      }) : "—"}
                    </span>
                  </td>

                  {/* actions */}
                  <td style={{ padding: "12px 14px" }}>
                    <div style={{ display: "flex", gap: 6 }}>
                      {u.bot && (
                        <button
                          onClick={() => void handleViewBot(u.bot!)}
                          style={{
                            background: "var(--accent)", border: "none",
                            borderRadius: 6, color: "white",
                            padding: "5px 10px", cursor: "pointer",
                            fontSize: 11, fontWeight: 600, whiteSpace: "nowrap",
                          }}
                        >
                          View Bot →
                        </button>
                      )}
                      <button
                        onClick={() => handleDelete(u.id)}
                        style={{
                          background: "none", border: "1px solid var(--danger)",
                          color: "var(--danger)", borderRadius: 6,
                          padding: "5px 10px", cursor: "pointer", fontSize: 11,
                        }}
                      >
                        Delete
                      </button>
                    </div>
                  </td>

                </tr>
              ))}
              {filtered.length === 0 && (
                <tr>
                  <td colSpan={7} style={{ padding: 24, textAlign: "center", color: "var(--text3)", fontSize: 13 }}>
                    No users found.
                  </td>
                </tr>
              )}
            </tbody>
          </table>
        </div>
      </div>
    </div>
  );
}