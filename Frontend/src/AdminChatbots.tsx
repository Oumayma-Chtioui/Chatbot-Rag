// Frontend/src/AdminChatbots.tsx
import { useState } from "react";
import * as api from "./api";

interface Props {
  bots: any[];
  loading: boolean;
  onDelete: (botId: string) => Promise<void>;
  onSelect: (bot: any) => void;
}

export default function AdminChatbots({ bots, loading, onDelete, onSelect }: Props) {
  const [search, setSearch] = useState("");
  const [confirmId, setConfirmId] = useState<string | null>(null);

  if (loading) return <div className="cl-loading">Loading bots…</div>;

  const filtered = bots.filter(b =>
    b.name?.toLowerCase().includes(search.toLowerCase()) ||
    b.owner_email?.toLowerCase().includes(search.toLowerCase()) ||
    b.owner?.email?.toLowerCase().includes(search.toLowerCase())
  );

  const handleDelete = async (botId: string) => {
    await onDelete(botId);
    setConfirmId(null);
  };

  return (
    <div className="cl-section">
      {/* Header */}
      <div style={{ display: "flex", alignItems: "center", gap: 12, marginBottom: 20 }}>
        <input
          type="text"
          placeholder="Search bots or owner…"
          value={search}
          onChange={e => setSearch(e.target.value)}
          style={{
            flex: 1, maxWidth: 300,
            padding: "7px 12px", borderRadius: 8,
            border: "1px solid var(--border)",
            background: "var(--bg2)", color: "var(--text)",
            fontSize: 13, outline: "none",
          }}
        />
        <span style={{ fontSize: 12, color: "var(--text3)", marginLeft: "auto" }}>
          {filtered.length} bot{filtered.length !== 1 ? "s" : ""}
        </span>
      </div>

      {filtered.length === 0 ? (
        <div className="cl-empty">No bots found.</div>
      ) : (
        <div className="cl-doc-list">
          {filtered.map((bot) => {
            const accent = bot.accent_color || "#7F77DD";
            const ownerName  = bot.owner?.name  || "Unknown";
            const ownerEmail = bot.owner?.email || bot.owner_email || "Unknown";

            return (
              <div
                key={bot.id}
                className="cl-doc-row"
                style={{
                  cursor: "pointer",
                  border: "1px solid var(--border)",
                  borderRadius: 10,
                  padding: "14px 16px",
                  display: "flex",
                  alignItems: "center",
                  gap: 14,
                  transition: "border-color 0.15s",
                  position: "relative",
                  overflow: "hidden",
                }}
                onClick={() => onSelect(bot)}
                onMouseEnter={e => (e.currentTarget as HTMLDivElement).style.borderColor = accent}
                onMouseLeave={e => (e.currentTarget as HTMLDivElement).style.borderColor = "var(--border)"}
              >
                {/* Accent left border */}
                <div style={{
                  position: "absolute", left: 0, top: 0, bottom: 0, width: 3,
                  background: accent, borderRadius: "10px 0 0 10px",
                }} />

                {/* Bot icon */}
                <div style={{
                  width: 40, height: 40, borderRadius: 10, flexShrink: 0,
                  background: `${accent}22`,
                  border: `1px solid ${accent}44`,
                  display: "flex", alignItems: "center", justifyContent: "center",
                  fontSize: 18, color: accent,
                  marginLeft: 8,
                }}>
                  ◉
                </div>

                {/* Main info */}
                <div style={{ flex: 1, minWidth: 0 }}>
                  <div style={{ display: "flex", alignItems: "center", gap: 8, marginBottom: 3 }}>
                    <span style={{ fontSize: 14, fontWeight: 600, color: "var(--text)" }}>
                      {bot.name}
                    </span>
                    {/* Active dot */}
                    <span style={{
                      width: 6, height: 6, borderRadius: "50%", flexShrink: 0,
                      background: bot.is_active ? "#1D9E75" : "#D85A30",
                    }} />
                    {/* Accent color swatch */}
                    <span
                      title={`Accent: ${accent}`}
                      style={{
                        width: 12, height: 12, borderRadius: 3,
                        background: accent, flexShrink: 0,
                        border: "1px solid rgba(0,0,0,0.1)",
                      }}
                    />
                  </div>

                  {/* Welcome message preview */}
                  {bot.welcome_message && (
                    <div style={{
                      fontSize: 11, color: "var(--text3)",
                      overflow: "hidden", textOverflow: "ellipsis",
                      whiteSpace: "nowrap", maxWidth: 320,
                      marginBottom: 4,
                    }}>
                      💬 {bot.welcome_message}
                    </div>
                  )}

                  <div style={{ fontSize: 11, color: "var(--text3)" }}>
                    {ownerName} · {ownerEmail}
                  </div>
                </div>

                {/* Stats */}
                <div style={{
                  display: "flex", gap: 16, flexShrink: 0,
                  fontSize: 12, color: "var(--text2)", textAlign: "center",
                }}>
                  <div>
                    <div style={{ fontWeight: 600, color: "var(--text)" }}>
                      {bot.total_messages?.toLocaleString() || 0}
                    </div>
                    <div style={{ fontSize: 10, color: "var(--text3)" }}>messages</div>
                  </div>
                  <div>
                    <div style={{
                      fontWeight: 600,
                      color: bot.success_rate >= 80 ? "#1D9E75" : bot.success_rate >= 60 ? "#BA7517" : "#D85A30",
                    }}>
                      {bot.success_rate ?? 0}%
                    </div>
                    <div style={{ fontSize: 10, color: "var(--text3)" }}>success</div>
                  </div>
                  <div>
                    <div style={{ fontWeight: 600, color: "var(--text)" }}>
                      {bot.docs_indexed || 0}
                    </div>
                    <div style={{ fontSize: 10, color: "var(--text3)" }}>docs</div>
                  </div>
                  <div>
                    <div style={{ fontSize: 10, color: "var(--text3)", marginBottom: 2 }}>created</div>
                    <div style={{ fontSize: 11, color: "var(--text2)" }}>
                      {bot.created_at
                        ? new Date(bot.created_at).toLocaleDateString("en-US", { month: "short", day: "numeric", year: "numeric" })
                        : "—"}
                    </div>
                  </div>
                </div>

                {/* Origin badge */}
                {bot.allowed_origin && (
                  <div style={{
                    fontSize: 10, padding: "3px 8px", borderRadius: 20,
                    background: "rgba(29,158,117,0.1)", color: "#1D9E75",
                    border: "1px solid rgba(29,158,117,0.2)",
                    whiteSpace: "nowrap", flexShrink: 0,
                    maxWidth: 140, overflow: "hidden", textOverflow: "ellipsis",
                  }}>
                    🔒 {bot.allowed_origin.replace(/https?:\/\//, "")}
                  </div>
                )}

                {/* Delete button */}
                <div onClick={e => e.stopPropagation()} style={{ flexShrink: 0 }}>
                  {confirmId === bot.id ? (
                    <div style={{ display: "flex", gap: 6, alignItems: "center" }}>
                      <span style={{ fontSize: 11, color: "var(--danger)" }}>Delete?</span>
                      <button
                        onClick={() => handleDelete(bot.id)}
                        style={{
                          background: "rgba(216,90,48,0.15)", border: "1px solid rgba(216,90,48,0.3)",
                          color: "#D85A30", borderRadius: 6, padding: "3px 10px",
                          cursor: "pointer", fontSize: 11, fontWeight: 600,
                        }}
                      >
                        Yes
                      </button>
                      <button
                        onClick={() => setConfirmId(null)}
                        style={{
                          background: "var(--bg3)", border: "1px solid var(--border)",
                          color: "var(--text2)", borderRadius: 6, padding: "3px 10px",
                          cursor: "pointer", fontSize: 11,
                        }}
                      >
                        No
                      </button>
                    </div>
                  ) : (
                    <button
                      onClick={() => setConfirmId(bot.id)}
                      style={{
                        background: "none", border: "1px solid var(--border)",
                        color: "var(--text3)", borderRadius: 6, padding: "4px 10px",
                        cursor: "pointer", fontSize: 12,
                        transition: "border-color 0.15s, color 0.15s",
                      }}
                      onMouseEnter={e => {
                        (e.currentTarget as HTMLButtonElement).style.borderColor = "rgba(216,90,48,0.4)";
                        (e.currentTarget as HTMLButtonElement).style.color = "#D85A30";
                      }}
                      onMouseLeave={e => {
                        (e.currentTarget as HTMLButtonElement).style.borderColor = "var(--border)";
                        (e.currentTarget as HTMLButtonElement).style.color = "var(--text3)";
                      }}
                    >
                      Delete
                    </button>
                  )}
                </div>
              </div>
            );
          })}
        </div>
      )}
    </div>
  );
}