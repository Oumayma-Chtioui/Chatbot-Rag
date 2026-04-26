// ─────────────────────────────────────────────────────────────────────────────
// ClientDocuments.tsx  — add onUpload callback prop so the dashboard refreshes
// CHANGES:
//   1. Accept optional `onUpload?: () => void` prop
//   2. Call onUpload() after every successful upload / URL add / delete
// ─────────────────────────────────────────────────────────────────────────────

import { useState, useEffect, ChangeEvent } from "react";
import { Bot } from "./ClientApp";

const API = "http://localhost:8000";
const token = () => localStorage.getItem("client_token");

interface Doc {
  id: string;
  name: string;
  size: string;
  status: string;
  chunks: number;
  created_at: string;
}

interface Props {
  bot: Bot | null;
  onUpload?: () => void;   // NEW — called after any successful mutation
}

export default function ClientDocuments({ bot, onUpload }: Props) {
  const [docs, setDocs] = useState<Doc[]>([]);
  const [uploading, setUploading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [url, setUrl] = useState("");
  const [maxPages, setMaxPages] = useState(1);

  const loadDocs = async () => {
    if (!bot) return;
    const res = await fetch(`${API}/widgets/bots/${bot.id}/documents`, {
      headers: { Authorization: `Bearer ${token()}` },
    });
    const data = await res.json();
    setDocs(data.documents || []);
  };

  useEffect(() => { loadDocs(); }, [bot]);

  const handleFileUpload = async (file: File) => {
    if (!bot) return;
    setUploading(true);
    setError(null);
    const form = new FormData();
    form.append("file", file);
    try {
      const res = await fetch(
        `${API}/widgets/bots/${bot.id}/documents/upload`,
        { method: "POST", headers: { Authorization: `Bearer ${token()}` }, body: form }
      );
      if (!res.ok) {
        const e = await res.json();
        throw new Error(e.detail || "Upload failed");
      }
      await loadDocs();
      onUpload?.();          // ← notify parent
    } catch (err: any) {
      setError(err.message);
    } finally {
      setUploading(false);
    }
  };

  const handleUrlAdd = async () => {
    if (!bot || !url.trim()) return;
    setUploading(true);
    setError(null);
    try {
      const res = await fetch(
        `${API}/widgets/bots/${bot.id}/documents/url`,
        {
          method: "POST",
          headers: { "Content-Type": "application/json", Authorization: `Bearer ${token()}` },
          body: JSON.stringify({ url, max_pages: maxPages }),
        }
      );
      if (!res.ok) {
        const e = await res.json();
        throw new Error(e.detail || "Failed to load URL");
      }
      setUrl("");
      await loadDocs();
      onUpload?.();          // ← notify parent
    } catch (err: any) {
      setError(err.message);
    } finally {
      setUploading(false);
    }
  };

  const handleDelete = async (id: string) => {
    await fetch(`${API}/widgets/bots/${bot!.id}/documents/${id}`, {
      method: "DELETE",
      headers: { Authorization: `Bearer ${token()}` },
    });
    setDocs((d) => d.filter((doc) => doc.id !== id));
    onUpload?.();            // ← notify parent (storage drops)
  };

  return (
    <div className="cl-page">
      <div className="cl-page-header">
        <h1 className="cl-page-title">Documents</h1>
        <p className="cl-page-sub">Upload files or URLs your chatbot will answer from.</p>
      </div>

      <div className="cl-section">
        <h2 className="cl-section-title">Upload file</h2>
        <label className="cl-drop-zone">
          <input
            type="file"
            style={{ display: "none" }}
            accept=".pdf,.txt,.docx,.md"
            onChange={(e: ChangeEvent<HTMLInputElement>) => {
              const f = e.target.files?.[0];
              if (f) handleFileUpload(f);
            }}
            disabled={uploading}
          />
          <span className="cl-drop-icon">◈</span>
          <span className="cl-drop-text">
            {uploading ? "Uploading..." : "Click to browse · .pdf .txt .docx .md · max 50MB"}
          </span>
        </label>
      </div>

      <div className="cl-section">
        <h2 className="cl-section-title">Add URL</h2>
        <div className="cl-url-row">
          <input
            className="cl-input"
            placeholder="https://example.com"
            value={url}
            onChange={(e) => setUrl(e.target.value)}
            disabled={uploading}
          />
          <select
            className="cl-select"
            value={maxPages}
            onChange={(e) => setMaxPages(Number(e.target.value))}
            disabled={uploading}
          >
            <option value={1}>Single page</option>
            <option value={20}>Small site (20)</option>
            <option value={50}>Docs / Manual (50)</option>
            <option value={100}>Knowledge base (100)</option>
          </select>
          <button
            className="cl-btn-primary"
            onClick={handleUrlAdd}
            disabled={uploading || !url.trim()}
          >
            {uploading ? "Loading..." : "Load"}
          </button>
        </div>
      </div>

      {error && <div className="cl-error">{error}</div>}

      <div className="cl-section">
        <h2 className="cl-section-title">Indexed documents ({docs.length})</h2>
        {docs.length === 0 ? (
          <div className="cl-empty">No documents yet. Upload something above.</div>
        ) : (
          <div className="cl-doc-list">
            {docs.map((doc) => (
              <div className="cl-doc-row" key={doc.id}>
                <div className="cl-doc-icon">◈</div>
                <div className="cl-doc-info">
                  <div className="cl-doc-name">{doc.name}</div>
                  <div className="cl-doc-meta">{doc.size} · {doc.chunks} chunks</div>
                </div>
                <div className={`cl-badge ${doc.status === "indexed" ? "success" : "warn"}`}>
                  {doc.status}
                </div>
                <button className="cl-btn-danger" onClick={() => handleDelete(doc.id)}>✕</button>
              </div>
            ))}
          </div>
        )}
      </div>
    </div>
  );
}