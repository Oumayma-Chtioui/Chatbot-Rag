// Frontend/src/AdminUsers2.tsx
// Fixed: each user can have multiple bots — now shows a list of all their bots,
// not just the first one. "View Bot →" button works for each bot individually.

import React, { useEffect, useState } from "react";
import * as api from "./api";

interface BotSummary {
  id: string;
  name: string;
  doc_count: number;
  message_count: number;
  accent_color?: string;
}

interface UserRow {
  id: number;
  name: string;
  email: string;
  is_admin: boolean;
  is_verified: boolean;
  created_at: string;
  session_count: number;
  // Fixed: was `bot: single | null`, now `bots: array`
  bots: BotSummary[];
  // Keep old `bot` field for backward compat in case backend still sends it
  bot?: BotSummary | null;
}

interface Props {
  onViewBot: (bot: any) => void;
}

export default function AdminUsers2({ onViewBot }: Props) {
  const [users,   setUsers]   = useState<UserRow[]>([]);
  const [loading, setLoading] = useState(true);
  const [error,   setError]   = useState<string | null>(null);
  const [search,  setSearch]  = useState("");
  const [expanded, setExpanded] = useState<Set<number>>(new Set());

  const token = () => localStorage.getItem("admin_token");

  const load = async () => {
    setLoading(true);
    try {
      const res = await fetch("http://localhost:8000/admin/users", {
        headers: { Authorization: `Bearer ${token()}` },
      });
      if (!res.ok) throw new Error("Failed to fetch users");
      const data: any[] = await res.json();

      // Normalise: backend may return single `bot` or array `bots`
      // Support both shapes so this works before and after a backend update
      const normalised: UserRow[] = data.map(u => ({
        ...u,
        bots: u.bots
          ? u.bots                          // new shape: array already
          : u.bot
            ? [u.bot]                        // old shape: wrap single in array
            : [],                            // no bots
      }));
      setUsers(normalised);
    } catch (err: any) {
      setError(err.message);
    } finally {
      setLoading(false);
    }
  };

  const handleDelete = async (userId: number) => {
    if (!confirm("Delete this user? This cannot be undone.")) return;
    try {
      const res = await fetch(`http://localhost:8000/admin/users/${userId}`, {
        method: "DELETE",
        headers: { Authorization: `Bearer ${token()}` },
      });
      if (!res.ok) {
        const data = await res.json().catch(() => ({}));
        throw new Error(data.detail || "Delete failed");
      }
      setUsers(u => u.filter(x => x.id !== userId));
    } catch (err: any) {
      setError(err.message);
    }
  };

  const handleViewBot = async (botSummary: BotSummary) => {
    try {
      const data = await api.getAdminBots();
      const full = (data?.bots || []).find((b: any) => String(b.id) === String(botSummary.id));
      onViewBot(full || botSummary);
    } catch {
      onViewBot(botSummary);
    }
  };

  const toggleExpand = (userId: number) => {
    setExpanded(prev => {
      const next = new Set(prev);
      next.has(userId) ? next.delete(userId) : next.add(userId);
      return next;
    });
  };

  useEffect(() => { load(); }, []);

  const filtered = users.filter(u =>
    u.name?.toLowerCase().includes(search.toLowerCase()) ||
    u.email?.toLowerCase().includes(search.toLowerCase())
  );

  if (loading) return <div className="admin-loading">Loading users…</div>;
  if (error)   return <div className="admin-error">{error}</div>;

  const totalBots = users.reduce((s, u) => s + u.bots.length, 0);

  return (
    <div>
      {/* Summary strip */}
      <div style={{ display: "grid", gridTemplateColumns: "repeat(3,1fr)", gap: 12, marginBottom: 24 }}>
        {[
          { label: "Total users",  value: users.length },
          { label: "Verified",     value: users.filter(u => u.is_verified).length },
          { label: "Total bots",   value: totalBots },
        ].map(s => (
          <div key={s.label} className="cl-stat-card">
            <div className="cl-stat-value">{s.value}</div>
            <div className="cl-stat-label">{s.label}</div>
          </div>
        ))}
      </div>

      {/* Search */}
      <div style={{ display: "flex", gap: 10, marginBottom: 14, alignItems: "center" }}>
        <input
          type="text"
          placeholder="Search by name or email…"
          value={search}
          onChange={e => setSearch(e.target.value)}
          style={{
            padding: "7px 12px", borderRadius: 8, border: "1px solid var(--border)",
            background: "var(--bg2)", color: "var(--text)", fontSize: 13, flex: 1, maxWidth: 300, outline: "none",
          }}
        />
        <span style={{ fontSize: 12, color: "var(--text3)", marginLeft: "auto" }}>
          {filtered.length} users
        </span>
      </div>

      {/* Table */}
      <div className="admin-card" style={{ padding: 0, overflow: "hidden" }}>
        <div style={{ overflowX: "auto" }}>
          <table style={{ width: "100%", borderCollapse: "collapse", fontSize: 12 }}>
            <thead>
              <tr style={{ borderBottom: "1px solid var(--border)", background: "var(--bg2)" }}>
                {["User", "Status", "Bots", "Joined", "Actions"].map(h => (
                  <th key={h} style={{ padding: "10px 14px", textAlign: "left", fontWeight: 600, color: "var(--text3)", fontSize: 10, letterSpacing: "0.05em", textTransform: "uppercase", whiteSpace: "nowrap" }}>
                    {h}
                  </th>
                ))}
              </tr>
            </thead>
            <tbody>
              {filtered.map((u, i) => {
                const isExpanded = expanded.has(u.id);
                return (
                  <React.Fragment key={u.id}>
                    <tr style={{ borderBottom: "1px solid var(--border)", background: i % 2 === 0 ? "var(--bg)" : "rgba(128,128,128,0.02)" }}>

                      {/* User */}
                      <td style={{ padding: "12px 14px" }}>
                        <div style={{ display: "flex", alignItems: "center", gap: 10 }}>
                          <div style={{
                            width: 32, height: 32, borderRadius: "50%", flexShrink: 0,
                            background: u.is_admin ? "rgba(186,117,23,0.2)" : "rgba(127,119,221,0.2)",
                            color: u.is_admin ? "#BA7517" : "var(--accent-light)",
                            display: "flex", alignItems: "center", justifyContent: "center", fontSize: 12, fontWeight: 700,
                          }}>
                            {u.name?.charAt(0).toUpperCase()}
                          </div>
                          <div>
                            <div style={{ fontWeight: 500, color: "var(--text)" }}>
                              {u.name}
                              {u.is_admin && (
                                <span style={{ marginLeft: 6, fontSize: 9, padding: "1px 6px", borderRadius: 4, background: "rgba(186,117,23,0.15)", color: "#BA7517", fontWeight: 600 }}>ADMIN</span>
                              )}
                            </div>
                            <div style={{ fontSize: 11, color: "var(--text3)" }}>{u.email}</div>
                          </div>
                        </div>
                      </td>

                      {/* Verified */}
                      <td style={{ padding: "12px 14px" }}>
                        <span style={{
                          padding: "3px 9px", borderRadius: 20, fontSize: 11, fontWeight: 600,
                          background: u.is_verified ? "rgba(29,158,117,0.12)" : "rgba(216,90,48,0.12)",
                          color: u.is_verified ? "#1D9E75" : "#D85A30",
                        }}>
                          {u.is_verified ? "✓ Verified" : "✗ Unverified"}
                        </span>
                      </td>

                      {/* Bots count — click to expand */}
                      <td style={{ padding: "12px 14px" }}>
                        {u.bots.length === 0 ? (
                          <span style={{ fontSize: 11, color: "var(--text3)" }}>No bots</span>
                        ) : (
                          <button
                            onClick={() => toggleExpand(u.id)}
                            style={{
                              background: "rgba(127,119,221,0.1)", border: "1px solid rgba(127,119,221,0.2)",
                              borderRadius: 6, color: "var(--accent-light)", padding: "3px 10px",
                              cursor: "pointer", fontSize: 11, fontWeight: 600, display: "flex", alignItems: "center", gap: 4,
                            }}
                          >
                            {u.bots.length} bot{u.bots.length !== 1 ? "s" : ""}
                            <span style={{ fontSize: 9, transition: "transform 0.15s", transform: isExpanded ? "rotate(180deg)" : "rotate(0deg)", display: "inline-block" }}>▼</span>
                          </button>
                        )}
                      </td>

                      {/* Joined */}
                      <td style={{ padding: "12px 14px", whiteSpace: "nowrap" }}>
                        <span style={{ fontSize: 11, color: "var(--text3)" }}>
                          {u.created_at ? new Date(u.created_at).toLocaleDateString("en-US", { month: "short", day: "numeric", year: "numeric" }) : "—"}
                        </span>
                      </td>

                      {/* Actions */}
                      <td style={{ padding: "12px 14px" }}>
                        <button
                          onClick={() => handleDelete(u.id)}
                          style={{
                            background: "none", border: "1px solid var(--danger)",
                            color: "var(--danger)", borderRadius: 6, padding: "5px 10px",
                            cursor: "pointer", fontSize: 11,
                          }}
                        >
                          Delete
                        </button>
                      </td>
                    </tr>

                    {/* Expanded bots row */}
                    {isExpanded && u.bots.length > 0 && (
                      <tr style={{ borderBottom: "1px solid var(--border)", background: "rgba(127,119,221,0.03)" }}>
                        <td colSpan={5} style={{ padding: "8px 14px 12px 60px" }}>
                          <div style={{ display: "flex", flexDirection: "column", gap: 6 }}>
                            {u.bots.map(bot => {
                              const accent = bot.accent_color || "#7F77DD";
                              return (
                                <div
                                  key={bot.id}
                                  style={{
                                    display: "flex", alignItems: "center", gap: 10,
                                    padding: "8px 12px",
                                    background: "var(--bg2)",
                                    border: `1px solid ${accent}33`,
                                    borderLeft: `3px solid ${accent}`,
                                    borderRadius: 8,
                                  }}
                                >
                                  <div style={{ width: 8, height: 8, borderRadius: 2, background: accent, flexShrink: 0 }} />
                                  <div style={{ flex: 1, minWidth: 0 }}>
                                    <span style={{ fontSize: 12, fontWeight: 500, color: "var(--text)" }}>{bot.name}</span>
                                    <span style={{ fontSize: 11, color: "var(--text3)", marginLeft: 8 }}>
                                      {bot.doc_count} docs · {bot.message_count} messages
                                    </span>
                                  </div>
                                  <button
                                    onClick={() => void handleViewBot(bot)}
                                    style={{
                                      background: accent, border: "none", borderRadius: 6,
                                      color: "white", padding: "4px 12px",
                                      cursor: "pointer", fontSize: 11, fontWeight: 600, whiteSpace: "nowrap",
                                    }}
                                  >
                                    View Bot →
                                  </button>
                                </div>
                              );
                            })}
                          </div>
                        </td>
                      </tr>
                    )}
                  </React.Fragment>
                );
              })}
              {filtered.length === 0 && (
                <tr>
                  <td colSpan={5} style={{ padding: 24, textAlign: "center", color: "var(--text3)", fontSize: 13 }}>No users found.</td>
                </tr>
              )}
            </tbody>
          </table>
        </div>
      </div>
    </div>
  );
}