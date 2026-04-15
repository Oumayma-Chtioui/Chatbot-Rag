import { useState } from "react";
import * as api from "./api";

interface Props {
  bots: any[];
  loading: boolean;
  onDelete: (botId: string) => Promise<void>;
  onSelect: (bot: any) => void;
}

export default function AdminChatbots({ bots, loading, onDelete, onSelect }: Props) {
  if (loading) return <div className="cl-loading">Loading bots…</div>;

  const handleDeleteBot = async (botId: string) => {
    if (!confirm("Delete this bot?")) return;
    await onDelete(botId);
  };

  return (
    <div className="cl-section">
      <h2 className="cl-section-title">All bots</h2>
      {bots.length === 0 ? (
        <div className="cl-empty">No bots found.</div>
      ) : (
        <div className="cl-doc-list">
          {bots.map((bot) => (
            <div key={bot.id} className="cl-doc-row" style={{ cursor: "pointer" }} onClick={() => onSelect(bot)}>
              <div style={{ flex: 1 }}>
                <div className="cl-doc-name">{bot.name}</div>
                <div className="cl-doc-meta">Bot ID: {bot.id}</div>
                <div className="cl-doc-meta">Client: {bot.owner ? `${bot.owner.name} ` : "Unknown"} · Email: {bot.owner ? `${bot.owner.email} ` : "Unknown"} </div>
                <div className="cl-doc-meta">Status: {bot.is_active ? "Active" : "Inactive"} · Created at: {bot.created_at ? new Date(bot.created_at).toLocaleDateString() : "Unknown"}</div>
                <div className="cl-doc-meta">Allowed origin: {bot.allowed_origin || "None"} · Docs: {bot.doc_count} · Messages: {bot.message_count}</div>
              </div>
              <button onClick={(e) => { e.stopPropagation(); handleDeleteBot(bot.id); }} style={{
                    background: "none", border: "1px solid var(--danger)",
                    color: "var(--danger)", borderRadius: 6, padding: "4px 10px",
                    cursor: "pointer", fontSize: 12
                  }}>Delete</button>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}
