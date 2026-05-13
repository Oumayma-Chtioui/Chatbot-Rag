

import { useState, useRef, useEffect, ChangeEvent } from "react";
import ReactMarkdown from "react-markdown";
import "./trial.css";
const API = "http://localhost:8000";

const MAX_MESSAGES = 6;   // max user turns
const MAX_FILES    = 1;   // max uploaded files

interface Message {
  role: "user" | "assistant";
  content: string;
  sources?: string[];
}

interface Props {
  onSignUp: () => void;
  onLogin:  () => void;
}

export default function TrialChat({ onSignUp, onLogin }: Props) {
  const [sessionId, setSessionId]     = useState<string | null>(null);
  const [messages,  setMessages]      = useState<Message[]>([]);
  const [input,     setInput]         = useState("");
  const [streaming, setStreaming]     = useState(false);
  const [uploading, setUploading]     = useState(false);
  const [fileName,  setFileName]      = useState<string | null>(null);
  const [docId,     setDocId]         = useState<string | null>(null);
  const [error,     setError]         = useState<string | null>(null);
  const [limitHit,  setLimitHit]      = useState(false);

  const messagesEndRef = useRef<HTMLDivElement>(null);
  const abortRef       = useRef<AbortController | null>(null);
  const sessionRef     = useRef<string | null>(null);

  // Track session in ref too for cleanup on unmount
  useEffect(() => { sessionRef.current = sessionId; }, [sessionId]);

  // Cleanup on unmount
  useEffect(() => {
    return () => {
      if (sessionRef.current) deleteSession(sessionRef.current);
    };
  }, []);

  // Auto-scroll
  useEffect(() => {
    messagesEndRef.current?.scrollIntoView({ behavior: "smooth" });
  }, [messages, streaming]);

  // ── Session helpers ──────────────────────────────────────────────────────

  const ensureSession = async (): Promise<string> => {
    if (sessionId) return sessionId;
    const res = await fetch(`${API}/trial/session`, { method: "POST" });
    if (!res.ok) throw new Error("Could not start trial session");
    const { session_id } = await res.json();
    setSessionId(session_id);
    return session_id;
  };

  const deleteSession = (sid: string) => {
    // best-effort fire-and-forget cleanup
    fetch(`${API}/trial/session/${sid}`, { method: "DELETE" }).catch(() => {});
  };

  // ── File upload ──────────────────────────────────────────────────────────

  const handleFileChange = async (e: ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;
    setError(null);
    setUploading(true);
    try {
      const sid = await ensureSession();
      const form = new FormData();
      form.append("file", file);
      const res = await fetch(`${API}/trial/upload?session_id=${sid}`, {
        method: "POST",
        body: form,
      });
      if (!res.ok) {
        const data = await res.json().catch(() => ({}));
        throw new Error(data.detail || "Upload failed");
      }
      const data = await res.json();
      setDocId(data.doc_id);
      setFileName(file.name);
    } catch (err: any) {
      setError(err.message);
    } finally {
      setUploading(false);
      e.target.value = "";
    }
  };

  // ── Chat send ────────────────────────────────────────────────────────────

  const handleSend = async () => {
    const text = input.trim();
    if (!text || streaming || limitHit) return;

    const userCount = messages.filter((m) => m.role === "user").length;
    if (userCount >= MAX_MESSAGES) {
      setLimitHit(true);
      return;
    }

    setInput("");
    setError(null);
    const userMsg: Message = { role: "user", content: text };
    setMessages((prev) => [...prev, userMsg]);

    try {
      const sid = await ensureSession();
      setStreaming(true);

      const ctrl = new AbortController();
      abortRef.current = ctrl;

      const res = await fetch(`${API}/trial/chat/stream`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ message: text, session_id: sid }),
        signal: ctrl.signal,
      });

      if (!res.ok) {
        const d = await res.json().catch(() => ({}));
        throw new Error(d.detail || `Error ${res.status}`);
      }

      const reader  = res.body?.getReader();
      const decoder = new TextDecoder();
      let   full    = "";
      let   sources: string[] = [];

      // Insert empty assistant bubble
      setMessages((prev) => [...prev, { role: "assistant", content: "" }]);

      while (reader) {
        const { done, value } = await reader.read();
        if (done) break;
        const chunk = decoder.decode(value, { stream: true });

        if (chunk.includes("__SOURCES__:")) {
          const parts = chunk.split("__SOURCES__:");
          full += parts[0];
          try { sources = JSON.parse(parts[1].trim()); } catch {}
        } else {
          full += chunk;
        }

        const current = full;
        setMessages((prev) => {
          const updated = [...prev];
          updated[updated.length - 1] = { role: "assistant", content: current };
          return updated;
        });
      }

      // Finalise with sources
      setMessages((prev) => {
        const updated = [...prev];
        updated[updated.length - 1] = { role: "assistant", content: full, sources };
        return updated;
      });

      // Check if limit now reached
      const newCount = userCount + 1;
      if (newCount >= MAX_MESSAGES) setLimitHit(true);

    } catch (err: any) {
      if (err.name === "AbortError") return;
      setError(err.message);
      setMessages((prev) => prev.slice(0, -1)); // remove empty bubble
    } finally {
      setStreaming(false);
      abortRef.current = null;
    }
  };

  const handleKeyDown = (e: React.KeyboardEvent) => {
    if (e.key === "Enter" && !e.shiftKey) {
      e.preventDefault();
      handleSend();
    }
  };

  const userTurns = messages.filter((m) => m.role === "user").length;
  const turnsLeft = MAX_MESSAGES - userTurns;

  return (
    <>
      

      <div className="trial-wrap">
        {/* Header */}
        <div className="trial-header">
          <div className="trial-header-dot" />
          <span className="trial-header-title">Try it now — live demo</span>
          {!limitHit && (
            <span className="trial-turns-badge">
              {turnsLeft}/{MAX_MESSAGES} messages left
            </span>
          )}
        </div>

        {/* Messages */}
        <div className="trial-messages">
          {messages.length === 0 ? (
            <div className="trial-empty">
              <div className="trial-empty-icon">✦</div>
              <div className="trial-empty-text">
                Upload a document and ask anything.<br />
                No account needed to try.
              </div>
            </div>
          ) : (
            messages.map((msg, i) => {
              const isLastBot = msg.role === "assistant" && i === messages.length - 1;
              return (
                <div key={i} className={`trial-msg ${msg.role}`}>
                  <div className={`trial-avatar ${msg.role === "assistant" ? "bot" : "user-av"}`}>
                    {msg.role === "assistant" ? "✦" : "U"}
                  </div>
                  <div>
                    <div className={`trial-bubble ${msg.role === "assistant" ? "bot" : "user"}`}>
                        {msg.role === "assistant"
                            ? <ReactMarkdown>{msg.content || ""}</ReactMarkdown>
                            : msg.content}
                        {isLastBot && streaming && <span className="trial-cursor" />}
                    </div>
                    {msg.sources && msg.sources.length > 0 && (
                      <div className="trial-sources">
                        {msg.sources.slice(0, 3).map((s: any, si: number) => (
                          <span key={si} className="trial-source-tag">
                            ◈ {(typeof s === "string" ? s : s?.source || "")
                                .split("/").pop()?.slice(0, 30) || "source"}
                          </span>
                        ))}
                      </div>
                    )}
                  </div>
                </div>
              );
            })
          )}
          <div ref={messagesEndRef} />
        </div>

        {/* Error */}
        {error && <div className="trial-error">⚠ {error}</div>}

        {/* Limit reached CTA */}
        {limitHit && (
          <div className="trial-limit-banner">
            <div className="trial-limit-title">You've reached the free trial limit</div>
            <div className="trial-limit-sub">
              Create a free account to unlock unlimited messages, multiple bots, and full document indexing.
            </div>
            <div className="trial-limit-btns">
              <button className="trial-cta-primary" onClick={onSignUp}>
                Create free account →
              </button>
              <button className="trial-cta-ghost" onClick={onLogin}>
                Sign in
              </button>
            </div>
          </div>
        )}

        {/* Upload bar */}
        {!limitHit && docId === null && (
          <div className="trial-upload-bar">
            <label
              className={`trial-upload-label${uploading ? " loading" : ""}${fileName ? " has-file" : ""}`}
            >
              <input
                type="file"
                accept=".pdf,.txt,.docx,.md"
                style={{ display: "none" }}
                onChange={handleFileChange}
                disabled={uploading || !!docId}
              />
              <span className="trial-upload-icon">
                {uploading ? "⏳" : fileName ? "✓" : "◈"}
              </span>
              {uploading
                ? "Uploading…"
                : fileName
                ? fileName.slice(0, 28)
                : "Upload a document (optional)"}
            </label>
            <span style={{ fontSize: 11, color: "var(--text3)", marginLeft: "auto" }}>
              .pdf .txt .docx .md · max 50MB
            </span>
          </div>
        )}

        {/* File uploaded indicator */}
        {!limitHit && docId !== null && (
          <div className="trial-upload-bar">
            <span style={{ fontSize: 12, color: "var(--success)" }}>
              ✓ {fileName} indexed
            </span>
            <button
              style={{
                marginLeft: "auto",
                background: "none",
                border: "none",
                color: "var(--text3)",
                cursor: "pointer",
                fontSize: 12,
              }}
              onClick={() => { setDocId(null); setFileName(null); }}
            >
              Remove
            </button>
          </div>
        )}

        {/* Input row */}
        {!limitHit && (
          <div className="trial-input-row">
            <textarea
              className="trial-textarea"
              placeholder={
                docId
                  ? "Ask about your document…"
                  : "Ask me anything…"
              }
              value={input}
              onChange={(e) => setInput(e.target.value)}
              onKeyDown={handleKeyDown}
              rows={1}
              disabled={streaming || limitHit}
            />
            <button
              className="trial-send-btn"
              onClick={handleSend}
              disabled={!input.trim() || streaming || limitHit}
              title="Send"
            >
              ↑
            </button>
          </div>
        )}
      </div>
    </>
  );
}