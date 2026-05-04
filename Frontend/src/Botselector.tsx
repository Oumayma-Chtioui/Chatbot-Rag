// Frontend/src/BotSelector.tsx
import { useState } from "react";
import { Bot } from "./ClientApp";

interface Props {
  bots: Bot[];
  loading: boolean;
  onSelect: (bot: Bot) => void;
  onCreate: () => void;
  onEdit: (bot: Bot) => void;
  onDelete: (botId: string) => Promise<void>;
  onRefresh: () => void;
}

function timeAgo(iso?: string): string {
  if (!iso) return "";
  const diff = Date.now() - new Date(iso).getTime();
  const d = Math.floor(diff / 86400000);
  if (d === 0) return "Today";
  if (d === 1) return "Yesterday";
  if (d < 30) return `${d}d ago`;
  return new Date(iso).toLocaleDateString("en-US", { month: "short", day: "numeric" });
}

export default function BotSelector({ bots, loading, onSelect, onCreate, onEdit, onDelete, onRefresh }: Props) {
  const [hoveredId,      setHoveredId]      = useState<string | null>(null);
  const [confirmDelete,  setConfirmDelete]  = useState<string | null>(null);
  const [deletingId,     setDeletingId]     = useState<string | null>(null);
  const [deleteError,    setDeleteError]    = useState<string | null>(null);

  const handleDelete = async (botId: string) => {
    setDeletingId(botId);
    setDeleteError(null);
    try {
      await onDelete(botId);
      setConfirmDelete(null);
    } catch (err: any) {
      setDeleteError(err?.message || "Failed to delete bot. Please try again.");
      setConfirmDelete(null);
    } finally {
      setDeletingId(null);
    }
  };

  return (
    <div className="cl-page">
      <div className="cl-page-header" style={{ display: "flex", alignItems: "flex-end", justifyContent: "space-between", flexWrap: "wrap", gap: 12 }}>
        <div>
          <h1 className="cl-page-title">My Chatbots</h1>
          <p className="cl-page-sub">
            {bots.length === 0
              ? "Create your first chatbot to get started."
              : `${bots.length} chatbot${bots.length !== 1 ? "s" : ""} — select one to manage it.`}
          </p>
        </div>
        <div style={{ display: "flex", gap: 8 }}>
          <button
            onClick={onRefresh}
            style={{
              background: "var(--bg2)", border: "1px solid var(--border)",
              borderRadius: 8, color: "var(--text2)", fontSize: 12,
              padding: "7px 14px", cursor: "pointer", display: "flex",
              alignItems: "center", gap: 6,
            }}
          >
            <span style={{ fontSize: 14 }}>↻</span> Refresh
          </button>
          <button className="cl-btn-primary" onClick={onCreate} style={{ display: "flex", alignItems: "center", gap: 6 }}>
            <span style={{ fontSize: 16, lineHeight: 1 }}>+</span> New Bot
          </button>
        </div>
      </div>

      {deleteError && (
        <div style={{
          margin: "0 0 16px",
          padding: "10px 14px",
          background: "rgba(216,90,48,0.1)",
          border: "1px solid rgba(216,90,48,0.3)",
          borderRadius: 8,
          fontSize: 13,
          color: "#D85A30",
          display: "flex",
          alignItems: "center",
          justifyContent: "space-between",
          gap: 12,
        }}>
          <span>⚠ {deleteError}</span>
          <button
            onClick={() => setDeleteError(null)}
            style={{ background: "none", border: "none", color: "#D85A30", cursor: "pointer", fontSize: 16, lineHeight: 1, padding: 0 }}
          >×</button>
        </div>
      )}

      {loading ? (
        <div className="cl-loading" style={{ padding: "60px 0" }}>Loading your bots…</div>
      ) : bots.length === 0 ? (
        <EmptyState onCreate={onCreate} />
      ) : (
        <div style={{
          display: "grid",
          gridTemplateColumns: "repeat(auto-fill, minmax(300px, 1fr))",
          gap: 16,
        }}>
          {bots.map(bot => (
            <BotCard
              key={bot.id}
              bot={bot}
              hovered={hoveredId === bot.id}
              confirmingDelete={confirmDelete === bot.id}
              deleting={deletingId === bot.id}
              onHover={() => setHoveredId(bot.id)}
              onLeave={() => setHoveredId(null)}
              onSelect={() => onSelect(bot)}
              onEdit={(e) => { e.stopPropagation(); onEdit(bot); }}
              onDeleteRequest={(e) => { e.stopPropagation(); setDeleteError(null); setConfirmDelete(bot.id); }}
              onDeleteConfirm={(e) => { e.stopPropagation(); void handleDelete(bot.id); }}
              onDeleteCancel={(e) => { e.stopPropagation(); setConfirmDelete(null); }}
            />
          ))}

          {/* Create new card */}
          <button
            onClick={onCreate}
            style={{
              background: "transparent",
              border: "2px dashed var(--border2)",
              borderRadius: 14,
              padding: 28,
              cursor: "pointer",
              display: "flex",
              flexDirection: "column",
              alignItems: "center",
              justifyContent: "center",
              gap: 10,
              color: "var(--text3)",
              transition: "border-color 0.2s, color 0.2s",
              minHeight: 180,
            }}
            onMouseEnter={e => {
              (e.currentTarget as HTMLButtonElement).style.borderColor = "var(--accent)";
              (e.currentTarget as HTMLButtonElement).style.color = "var(--accent-light)";
            }}
            onMouseLeave={e => {
              (e.currentTarget as HTMLButtonElement).style.borderColor = "var(--border2)";
              (e.currentTarget as HTMLButtonElement).style.color = "var(--text3)";
            }}
          >
            <div style={{
              width: 44, height: 44, borderRadius: "50%",
              border: "2px dashed currentColor",
              display: "flex", alignItems: "center", justifyContent: "center",
              fontSize: 22, lineHeight: 1,
            }}>+</div>
            <span style={{ fontSize: 13, fontWeight: 500 }}>Create new bot</span>
          </button>
        </div>
      )}
    </div>
  );
}

// ── Bot card ──────────────────────────────────────────────────────────────────

interface CardProps {
  bot: Bot;
  hovered: boolean;
  confirmingDelete: boolean;
  deleting: boolean;
  onHover: () => void;
  onLeave: () => void;
  onSelect: () => void;
  onEdit: (e: React.MouseEvent) => void;
  onDeleteRequest: (e: React.MouseEvent) => void;
  onDeleteConfirm: (e: React.MouseEvent) => void;
  onDeleteCancel: (e: React.MouseEvent) => void;
}

function BotCard({
  bot, hovered, confirmingDelete, deleting,
  onHover, onLeave, onSelect, onEdit, onDeleteRequest, onDeleteConfirm, onDeleteCancel,
}: CardProps) {
  const accent = bot.accent_color || "#7F77DD";

  return (
    <div
      onClick={deleting ? undefined : onSelect}
      onMouseEnter={onHover}
      onMouseLeave={onLeave}
      style={{
        background: "var(--bg2)",
        border: `1px solid ${hovered && !deleting ? accent : "var(--border)"}`,
        borderRadius: 14,
        padding: 24,
        cursor: deleting ? "not-allowed" : "pointer",
        transition: "border-color 0.2s, transform 0.15s, box-shadow 0.2s",
        transform: hovered && !deleting ? "translateY(-2px)" : "translateY(0)",
        boxShadow: hovered && !deleting ? `0 8px 24px ${accent}22` : "none",
        display: "flex",
        flexDirection: "column",
        gap: 16,
        position: "relative",
        overflow: "hidden",
        opacity: deleting ? 0.5 : 1,
      }}
    >
      {/* Accent stripe */}
      <div style={{
        position: "absolute", top: 0, left: 0, right: 0, height: 3,
        background: accent,
        borderRadius: "14px 14px 0 0",
        opacity: hovered ? 1 : 0.5,
        transition: "opacity 0.2s",
      }} />

      {/* Header */}
      <div style={{ display: "flex", alignItems: "flex-start", gap: 12 }}>
        <div style={{
          width: 44, height: 44, borderRadius: 12, flexShrink: 0,
          background: `${accent}22`,
          border: `1px solid ${accent}44`,
          display: "flex", alignItems: "center", justifyContent: "center",
          fontSize: 20,
        }}>
          ◉
        </div>
        <div style={{ flex: 1, minWidth: 0 }}>
          <div style={{
            fontSize: 15, fontWeight: 600, color: "var(--text)",
            overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap",
            marginBottom: 3,
          }}>
            {bot.name}
          </div>
          <div style={{ fontSize: 11, color: "var(--text3)" }}>
            {timeAgo(bot.created_at)}
            {bot.docs_indexed ? ` · ${bot.docs_indexed} docs` : ""}
          </div>
        </div>
        <div style={{
          width: 8, height: 8, borderRadius: "50%",
          background: bot.is_active !== false ? "#1D9E75" : "#D85A30",
          flexShrink: 0, marginTop: 4,
          boxShadow: bot.is_active !== false ? "0 0 0 2px rgba(29,158,117,0.2)" : "none",
        }} />
      </div>

      {/* Welcome message preview */}
      <div style={{
        fontSize: 12, color: "var(--text2)", lineHeight: 1.5,
        background: "var(--bg3)", borderRadius: 8, padding: "10px 12px",
        border: "1px solid var(--border)",
        overflow: "hidden",
        display: "-webkit-box",
        WebkitLineClamp: 2,
        WebkitBoxOrient: "vertical",
      } as React.CSSProperties}>
        <span style={{ opacity: 0.5 }}>💬 </span>
        {bot.welcome_message || "Hi! How can I help you today?"}
      </div>

      {/* Stats row */}
      <div style={{ display: "flex", gap: 12, alignItems: "center" }}>
        {bot.allowed_origin ? (
          <div style={{
            fontSize: 10, padding: "3px 8px", borderRadius: 20,
            background: "rgba(29,158,117,0.1)", color: "#1D9E75",
            border: "1px solid rgba(29,158,117,0.2)",
            overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap",
            maxWidth: 140,
          }}>
            🔒 {bot.allowed_origin.replace(/https?:\/\//, "")}
          </div>
        ) : (
          <div style={{
            fontSize: 10, padding: "3px 8px", borderRadius: 20,
            background: "rgba(186,117,23,0.1)", color: "#BA7517",
            border: "1px solid rgba(186,117,23,0.2)",
          }}>
            🌐 Any origin
          </div>
        )}
        <div style={{
          marginLeft: "auto",
          width: 10, height: 10, borderRadius: 2,
          background: accent,
          boxShadow: `0 0 0 2px ${accent}44`,
        }} title={`Accent: ${accent}`} />
      </div>

      {/* Action buttons */}
      <div
        style={{
          display: "flex", gap: 6, paddingTop: 4,
          borderTop: "1px solid var(--border)",
        }}
        onClick={(e) => e.stopPropagation()}
      >
        {confirmingDelete || deleting ? (
          <>
            <span style={{ fontSize: 12, color: "var(--danger)", flex: 1, alignSelf: "center" }}>
              {deleting ? "Deleting…" : "Delete this bot?"}
            </span>
            {!deleting && (
              <button
                onClick={onDeleteConfirm}
                style={{
                  background: "rgba(216,90,48,0.15)", border: "1px solid rgba(216,90,48,0.3)",
                  color: "#D85A30", borderRadius: 6, padding: "4px 12px",
                  fontSize: 12, cursor: "pointer", fontWeight: 600,
                }}
              >
                Delete
              </button>
            )}
            {!deleting && (
              <button
                onClick={onDeleteCancel}
                style={{
                  background: "var(--bg3)", border: "1px solid var(--border)",
                  color: "var(--text2)", borderRadius: 6, padding: "4px 12px",
                  fontSize: 12, cursor: "pointer",
                }}
              >
                Cancel
              </button>
            )}
          </>
        ) : (
          <>
            <button
              onClick={onEdit}
              style={{
                background: "var(--bg3)", border: "1px solid var(--border)",
                color: "var(--text2)", borderRadius: 6, padding: "5px 12px",
                fontSize: 12, cursor: "pointer", flex: 1,
                transition: "border-color 0.15s, color 0.15s",
              }}
              onMouseEnter={e => {
                (e.currentTarget as HTMLButtonElement).style.borderColor = "var(--border2)";
                (e.currentTarget as HTMLButtonElement).style.color = "var(--text)";
              }}
              onMouseLeave={e => {
                (e.currentTarget as HTMLButtonElement).style.borderColor = "var(--border)";
                (e.currentTarget as HTMLButtonElement).style.color = "var(--text2)";
              }}
            >
              ✎ Edit
            </button>
            <button
              onClick={(e) => { e.stopPropagation(); onSelect(); }}
              style={{
                background: accent, border: "none",
                color: "#fff", borderRadius: 6, padding: "5px 14px",
                fontSize: 12, cursor: "pointer", flex: 2, fontWeight: 600,
                transition: "opacity 0.15s",
              }}
              onMouseEnter={e => (e.currentTarget as HTMLButtonElement).style.opacity = "0.88"}
              onMouseLeave={e => (e.currentTarget as HTMLButtonElement).style.opacity = "1"}
            >
              Open dashboard →
            </button>
            <button
              onClick={onDeleteRequest}
              style={{
                background: "none", border: "1px solid var(--border)",
                color: "var(--text3)", borderRadius: 6, padding: "5px 8px",
                fontSize: 12, cursor: "pointer",
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
              title="Delete bot"
            >
              🗑
            </button>
          </>
        )}
      </div>
    </div>
  );
}

// ── Empty state ───────────────────────────────────────────────────────────────

function EmptyState({ onCreate }: { onCreate: () => void }) {
  return (
    <div style={{
      display: "flex", flexDirection: "column", alignItems: "center",
      justifyContent: "center", gap: 20, padding: "80px 24px",
      textAlign: "center",
    }}>
      <div style={{
        width: 72, height: 72, borderRadius: 20,
        background: "rgba(127,119,221,0.1)",
        border: "1px solid rgba(127,119,221,0.2)",
        display: "flex", alignItems: "center", justifyContent: "center",
        fontSize: 32,
      }}>
        ◉
      </div>
      <div>
        <h2 style={{ fontSize: 18, fontWeight: 600, color: "var(--text)", marginBottom: 8 }}>
          No bots yet
        </h2>
        <p style={{ fontSize: 13, color: "var(--text3)", maxWidth: 340, lineHeight: 1.6 }}>
          Create your first chatbot, upload documents, and embed it on any website in minutes.
        </p>
      </div>
      <button
        className="cl-btn-primary"
        onClick={onCreate}
        style={{ padding: "10px 28px", fontSize: 14 }}
      >
        + Create my first bot
      </button>
    </div>
  );
}