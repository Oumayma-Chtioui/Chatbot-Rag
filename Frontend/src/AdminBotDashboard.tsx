import { useState, useEffect } from "react";
import * as api from "./api";

interface Props {
  bot: any;
  onBack: () => void;
}

export default function AdminBotDashboard({ bot, onBack }: Props) {
  const [tab, setTab] = useState<"overview" | "feedback" | "billing" | "system" | "documents" | "messages">("overview");
  const [feedback, setFeedback] = useState<any[]>([]);
  const [billing, setBilling] = useState<any[]>([]);
  const [system, setSystem] = useState<any>(null);
  const [documents, setDocuments] = useState<any[]>([]);
  const [messages, setMessages] = useState<any[]>([]);
  const [loading, setLoading] = useState(false);

  useEffect(() => {
    loadTab(tab);
  }, [tab]);

  const loadTab = async (t: string) => {
    setLoading(true);
    try {
      if (t === "feedback") setFeedback((await api.getAdminFeedback()).feedback || []);
      if (t === "billing") setBilling((await api.getAdminBilling()).clients || []);
      if (t === "system") setSystem(await api.getSystemHealth());
      if (t === "documents") {
        const data = await api.getAdminDocuments();
        setDocuments(data.documents.filter((d: any) => d.user_id === bot.id));
      }
      if (t === "messages") {
        // Assume there's an API for messages, for now placeholder
        setMessages([]);
      }
    } catch (err) {
      console.error(err);
    } finally {
      setLoading(false);
    }
  };

  const filteredFeedback = feedback.filter((f: any) => f.bot_id === bot.id);
  const filteredBilling = billing.filter((b: any) => b.email === bot.owner?.email);

  return (
    <div className="cl-section">
      <div style={{ display: "flex", alignItems: "center", marginBottom: 20 }}>
        <button onClick={onBack} style={{
                    background: "none", border: "1px solid", color: "var(--text)", borderRadius: 6, padding: "4px 10px", marginRight: 20,
                    cursor: "pointer", fontSize: 12
                  }}>← Back</button>
        <h2 style={{fontSize :20}}>Dashboard for {bot.name}</h2>
      </div>

      <div style={{ display: "flex", gap: 10, marginBottom: 20, flexWrap: "wrap" }}>
        {["overview", "feedback", "billing", "system", "documents", "messages"].map((t) => (
          <button
            key={t}
            onClick={() => setTab(t as any)}
            style={{
              padding: "10px 20px",
              background: tab === t ? "var(--primary)" : "var(--bg)",
              color: tab === t ? "white" : "var(--text)",
              border: "1px solid var(--border)",
              borderRadius: 6,
              cursor: "pointer",
              fontSize: 14,
              fontWeight: tab === t ? "bold" : "normal",
            }}
          >
            {t.charAt(0).toUpperCase() + t.slice(1)}
          </button>
        ))}
      </div>

      {loading && <div className="cl-loading">Loading…</div>}

      {tab === "overview" && (
        <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 20 }}>
          <div style={{ border: "1px solid var(--border)", borderRadius: 8, padding: 20 }}>
            <h3>Bot Information</h3>
            <p><strong>ID:</strong> {bot.id}</p>
            <p><strong>Name:</strong> {bot.name}</p>
            <p><strong>Status:</strong> {bot.status}</p>
            <p><strong>Allowed Origin:</strong> {bot.allowed_origin || "None"}</p>
          </div>
          <div style={{ border: "1px solid var(--border)", borderRadius: 8, padding: 20 }}>
            <h3>Statistics</h3>
            <p><strong>Created At:</strong> {bot.created_at ? new Date(bot.created_at).toLocaleDateString() : "Unknown"}</p>
            <p><strong>Owner:</strong> {bot.owner ? `${bot.owner.name} (${bot.owner.email})` : "Unknown"}</p>
            <p><strong>Documents:</strong> {bot.doc_count}</p>
            <p><strong>Messages:</strong> {bot.message_count}</p>
          </div>
        </div>
      )}

      {tab === "feedback" && (
        <div>
          <h3>Feedback for {bot.name}</h3>
          {filteredFeedback.length === 0 ? (
            <div className="cl-empty">No feedback found.</div>
          ) : (
            <div className="cl-doc-list">
              {filteredFeedback.map((f, i) => (
                <div key={i} className="cl-doc-row">
                  <div className="cl-doc-name">Bot: {f.bot_name}</div>
                  <div className="cl-doc-meta">Average Score: {f.avg_score} · Total Feedback: {f.total_feedback}</div>
                </div>
              ))}
            </div>
          )}
        </div>
      )}

      {tab === "billing" && (
        <div>
          <h3>Billing for {bot.owner?.name || "Owner"}</h3>
          {filteredBilling.length === 0 ? (
            <div className="cl-empty">No billing data found.</div>
          ) : (
            <div className="cl-doc-list">
              {filteredBilling.map((b, i) => (
                <div key={i} className="cl-doc-row">
                  <div className="cl-doc-name">Email: {b.email}</div>
                  <div className="cl-doc-meta">Messages: {b.messages_count} · Docs: {b.docs_count} · Sessions: {b.sessions_count} · Plan: {b.plan_tier}</div>
                </div>
              ))}
            </div>
          )}
        </div>
      )}

      {tab === "system" && (
        <div>
          <h3>System Health</h3>
          <div style={{ border: "1px solid var(--border)", borderRadius: 8, padding: 20, background: "var(--bg)" }}>
            <pre style={{ margin: 0, whiteSpace: "pre-wrap", fontFamily: "monospace", fontSize: 12 }}>
              {JSON.stringify(system, null, 2)}
            </pre>
          </div>
        </div>
      )}

      {tab === "documents" && (
        <div>
          <h3>Documents for {bot.name}</h3>
          {documents.length === 0 ? (
            <div className="cl-empty">No documents found.</div>
          ) : (
            <div className="cl-doc-list">
              {documents.map((d) => (
                <div key={d.id} className="cl-doc-row">
                  <div className="cl-doc-name">{d.name}</div>
                  <div className="cl-doc-meta">ID: {d.id} · Size: {d.size} · Uploaded: {d.uploaded_at}</div>
                </div>
              ))}
            </div>
          )}
        </div>
      )}

      {tab === "messages" && (
        <div>
          <h3>Messages for {bot.name}</h3>
          {messages.length === 0 ? (
            <div className="cl-empty">No messages found.</div>
          ) : (
            <div className="cl-doc-list">
              {messages.map((m, i) => (
                <div key={i} className="cl-doc-row">
                  <div>{JSON.stringify(m)}</div>
                </div>
              ))}
            </div>
          )}
        </div>
      )}
    </div>
  );
}