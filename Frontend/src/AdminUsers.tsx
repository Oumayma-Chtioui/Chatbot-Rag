import { useState } from "react";
import * as api from "./api";

interface Props {
  users: any[];
  loading: boolean;
  onDelete: (userId: number) => Promise<void>;
}

export default function AdminUsers({ users, loading, onDelete }: Props) {
  if (loading) return <div className="cl-loading">Loading users…</div>;

  const handleDelete = async (userId: number) => {
    if (!confirm("Delete this user?")) return;
    await onDelete(userId);
  };

  const handleDeleteUser = async (userId: number) => {
      if (!confirm("Delete this user?")) return;
      await api.deleteAdminUser(userId);
      const index = users.findIndex(x => x.id === userId);
        if (index !== -1) {
        users.splice(index, 1);
        }
    };
 
  return (
    <div className="cl-section">
      <h2 className="cl-section-title">Users ({users.length})</h2>
      {users.length === 0 ? (
        <div className="cl-empty">No users found.</div>
      ) : (
        <div className="cl-doc-list">
          {users.map((u) => (
            <div key={u.id} className="cl-doc-row" style={{ display: "flex", alignItems: "center", gap: 12 }}>
              <div style={{
                width: 36, height: 36, borderRadius: "50%",
                background: "rgba(127,119,221,0.2)", display: "flex",
                alignItems: "center", justifyContent: "center",
                color: "var(--accent)", fontWeight: 700, fontSize: 12, flexShrink: 0
              }}>
                {u.name?.charAt(0).toUpperCase()}
              </div>
              <div style={{ flex: 1, minWidth: 0 }}>
                <div className="cl-doc-name">{u.name}</div>
                <div className="cl-doc-meta">{u.email} · {u.session_count} sessions</div>
              </div>
              {u.is_admin && (
                <span className="cl-badge success">Admin</span>
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
    </div>
  );
}
