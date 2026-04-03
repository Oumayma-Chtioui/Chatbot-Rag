import { useState, useRef, useEffect, ChangeEvent, KeyboardEvent } from "react";
import { Doc, Message } from './types.tsx';
import * as api from "./api";
import ReactMarkdown from "react-markdown";

interface ChatPageProps {
  docs: Doc[];
  sessionId: string;
  messages: Message[];
  setMessages: (messages: Message[]) => void;
  onToggleSidebar: () => void;
  onAddDocs?: (docs: Doc[]) => void;
  userName: string;
}

function ChatPage({ docs, sessionId, messages, setMessages, onToggleSidebar, onAddDocs, userName }: ChatPageProps) {
  const [input, setInput] = useState<string>("");
  const [thinking, setThinking] = useState<boolean>(false);
  const [showDocUpload, setShowDocUpload] = useState<boolean>(false);
  const bottomRef = useRef<HTMLDivElement>(null);
  const [urlInput, setUrlInput] = useState<string>("");
  const [uploading, setUploading] = useState<boolean>(false);
  const [maxPages, setMaxPages] = useState<number>();

  useEffect(() => {
    bottomRef.current?.scrollIntoView({ behavior: "smooth" });
  }, [messages, thinking]);

  const handleSend = async (): Promise<void> => {
    if (!input.trim() || thinking) return;
    
    const userMsg: Message = {
      id: Date.now(),
      role: "user",
      content: input,
      time: new Date().toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" }),
    };
    
    const newMsgs = [...messages, userMsg];
    setMessages(newMsgs);
    setInput("");
    setThinking(true);

    try {
      // Get token from localStorage (assuming you store it after login)
      const token = localStorage.getItem('token');
    
      if (!token) {
        console.error('No token found');
        // Redirect to login or show error
        return;
      }
      
      // Your FastAPI backend URL
      const API_URL = 'http://localhost:8000';
    
      console.log('Sending request to:', `${API_URL}/chat`);
      console.log('Question:', userMsg.content);
      
      const response = await fetch(`${API_URL}/chat`, {  // 👈 USE BACKTICKS, not quotes
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'Authorization': `Bearer ${token}`
        },
        body: JSON.stringify({
          message: userMsg.content,
          session_id: sessionId,
        })
      });
      
      console.log('Response status:', response.status);
      
      if (!response.ok) {
        throw new Error(`HTTP error! status: ${response.status}`);
      }
      
      const data = await response.json();
      
      // Format sources properly
      const sources = data.sources.map((source: any) => ({
        source: source.source || source,
        content_preview: source.content_preview || "",
        confidence: source.confidence ?? null,
        score: source.score ?? null,
      }));
      
      const reply: Message = {
        id: Date.now() + 1,
        role: "assistant",
        content: data.answer,
        sources: sources,
        time: new Date().toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" }),
      };
      
      setMessages([...newMsgs, reply]);
    } catch (error) {
      console.error('Error getting response:', error);
      
      const errorReply: Message = {
        id: Date.now() + 1,
        role: "assistant",
        content: "Sorry, I encountered an error processing your request. Please make sure the backend server is running.",
        sources: [],
        time: new Date().toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" }),
      };
      
      setMessages([...newMsgs, errorReply]);
    } finally {
      setThinking(false);
    }
  };

  const handleKey = (e: KeyboardEvent<HTMLTextAreaElement>): void => {
    if (e.key === "Enter" && !e.shiftKey) {
      e.preventDefault();
      handleSend();
    }
  };

  const handleFileAdd = async (file: File): Promise<void> => {
    if (!onAddDocs) return;

    try {
      // 🔥 Upload to backend
      const result = await api.uploadDocument(file, sessionId);

      const newDoc: Doc = {
        id: result.document.id,   // Now result exists
        name: result.document.name || file.name,
        type: "pdf",
        size: `${(file.size / 1024).toFixed(0)} KB`,
        status: "ready",
      };

      onAddDocs([newDoc]);
      setShowDocUpload(false);

    } catch (err: any) {
      console.error("Upload failed:", err.message);
    }
    };

  const handleUrlAdd = async (url: string, maxPages: number): Promise<void> => {
    if (!url.trim() || !onAddDocs) return;
    setUploading(true);
    try {
      const result = await api.addUrlDocument(url, sessionId, maxPages);
      const newDoc: Doc = {
        id: result.document.id,
        name: result.document.name,
        type: "url",
        size: "Web page",
        status: "ready",
      };
      onAddDocs([newDoc]);
      setUrlInput("");
      setShowDocUpload(false);
    } catch (err: any) {
      console.error("URL add failed:", err.message);
      alert("Failed to add URL.");
    } finally {
      setUploading(false);
    }
  };

  const crawlOptions = [
    { label: "Single page", value: 1 },
    { label: "Small company site", value: 20 },
    { label: "Documentation / Manual", value: 50 },
    { label: "Knowledge base", value: 100 },
    { label: "Large docs / Blog", value: 200 },
    { label: "E-commerce / Large site", value: 500 },
  ];

  return (
    <>
      <div className="topbar">
        <button className="hamburger" onClick={onToggleSidebar}>☰</button>
        <div className="topbar-title">
          {messages.length > 0 && messages.find(m => m.role === "user")
            ? messages.find(m => m.role === "user")!.content.slice(0, 40) + "..."
            : "New Conversation"}
        </div>
        <div className="topbar-actions">
          <span style={{ fontSize: 12, color: "var(--text3)" }}>
            {docs.length} doc{docs.length !== 1 ? "s" : ""}
          </span>
          <button 
            className="icon-btn" 
            title="Add documents"
            onClick={() => setShowDocUpload(!showDocUpload)}
          >
            📎
          </button>
          
        </div>
      </div>

      {/* Quick doc upload in chat */}
      {showDocUpload && (
        <div style={{
          background: 'var(--bg2)',
          borderBottom: '1px solid var(--border)',
          padding: '16px 20px',
          display: 'flex',
          flexDirection: 'column',
          gap: '12px'
        }}>
          {/* Loaded documents list */}
          {docs.length > 0 && (
            <div>
              <div style={{ fontSize: 12, color: 'var(--text3)', marginBottom: 8 }}>
                Loaded documents ({docs.length})
              </div>
              <div style={{ display: 'flex', flexDirection: 'column', gap: 6 }}>
                {docs.map((doc, i) => (
                  <div key={i} style={{
                    display: 'flex',
                    alignItems: 'center',
                    gap: 8,
                    fontSize: 13,
                    padding: '6px 10px',
                    background: 'var(--bg1)',
                    borderRadius: 8,
                    border: '1px solid var(--border)'
                  }}>
                    <span>📄</span>
                    <span style={{ color: 'var(--text1)', flex: 1 }}>{doc.name}</span>
                    <span style={{ color: 'var(--text3)', fontSize: 11 }}>{doc.size}</span>
                    
                    <span style={{
                      fontSize: 11,
                      padding: '2px 6px',
                      background: 'var(--accent)22',
                      color: 'var(--accent)',
                      borderRadius: 4
                    }}>
                      ✓ Ready
                    </span>
                  </div>
                ))}
              </div>
            </div>
          )}

          {/* Add more documents */}
          <div style={{ display: 'flex', alignItems: 'center', gap: '12px' }}>
            <span style={{ fontSize: 13, color: 'var(--text3)' }}>Add more documents:</span>
            <label style={{ cursor: 'pointer' }}>
              <input
                type="file"
                style={{ display: "none" }}
                accept=".pdf,.txt,.docx,.md"
                onChange={(e: ChangeEvent<HTMLInputElement>) => {
                  const file = e.target.files?.[0];
                  if (file) handleFileAdd(file);
                }}
              />
              <span className="btn-outline" style={{ fontSize: 12, padding: '6px 12px' }}>
                📂 Browse
              </span>
            </label>
            {/* Add URL */}
            <div style={{ display: 'flex', alignItems: 'center', gap: '10px' }}>
              <span style={{ fontSize: 13, color: 'var(--text3)', whiteSpace: 'nowrap' }}>Add URL:</span>
              <input
                className="form-input"
                placeholder="https://example.com"
                value={urlInput}
                onChange={(e: ChangeEvent<HTMLInputElement>) => setUrlInput(e.target.value)}
                onKeyDown={(e) => e.key === "Enter" && handleUrlAdd(urlInput, maxPages )}
                style={{ flex: 1, fontSize: 12, padding: '6px 10px' }}
                disabled={uploading}
              />
              <div style={{ display: "flex", alignItems: "center", gap: "10px" }}>
              <span style={{ fontSize: 12, color: "var(--text3)", whiteSpace: "nowrap" }}>
                Crawl depth:
              </span>
              <select
                value={maxPages}
                onChange={(e: ChangeEvent<HTMLSelectElement>) => setMaxPages(Number(e.target.value))}
                disabled={uploading}
                style={{
                  background: "#1e1e1e",
                  border: "1px solid var(--border)",
                  borderRadius: "var(--radius-sm)",
                  color: "var(--text)",
                  fontSize: 12,
                  padding: "6px 10px",
                  cursor: "pointer",
                  flex: 1,
                }}
              >
                {crawlOptions.map((opt) => (
                  <option key={opt.value} value={opt.value}>
                    {opt.label} ({opt.value === 1 ? "1 page" : `up to ${opt.value} pages`})
                  </option>
                ))}
              </select>
            </div>
              <button
                className="btn-outline"
                onClick={() => handleUrlAdd(urlInput, maxPages)}
                disabled={uploading || !urlInput.trim()}
                style={{ fontSize: 12, padding: '6px 12px', whiteSpace: 'nowrap' }}
              >
                {uploading ? '⟳' : 'Load'}
              </button>
            </div>
            <button
              onClick={() => setShowDocUpload(false)}
              style={{
                marginLeft: 'auto',
                background: 'none',
                border: 'none',
                color: 'var(--text3)',
                cursor: 'pointer',
                fontSize: 18
              }}
            >
              ✕
            </button>
          </div>
        </div>
      )}

      <div className="chat-area">
        {messages.length === 0 && (
          <div style={{ 
            textAlign: "center", 
            color: "var(--text3)", 
            marginTop: 60, 
            fontSize: 14 
          }}>
            <div style={{ fontSize: 32, marginBottom: 16 }}>💬</div>
            <div style={{ marginBottom: 8 }}>
              Ready to chat with your {docs.length} document{docs.length !== 1 ? "s" : ""}
            </div>
            <div style={{ fontSize: 12, opacity: 0.7 }}>
              Ask anything about the uploaded content
            </div>
          </div>
        )}
        

        {messages.map((msg: Message) => (
          <div key={msg.id} className={`message ${msg.role} animate-in`}>
            <div className={`msg-avatar ${msg.role === "assistant" ? "ai" : "user-av"}`}>
              {msg.role === "assistant" ? "✦" : userName.charAt(0).toUpperCase()}
            </div>
            <div className="msg-content">
              <div className="msg-bubble">
                <ReactMarkdown>{msg.content}</ReactMarkdown>
              </div>
              {msg.sources && msg.sources.length > 0 && (
              <div className="source-chips">
                {msg.sources.map((s: any, i: number) => {
                  const sourceName = typeof s === "object" ? s.source : s;
                  return (
                    <div key={i} className="source-chip" title={s.content_preview || sourceName}>
                      <span>📄</span>
                      <span>{sourceName.split("/").pop() || sourceName}</span>
                    </div>
                  );
                })}
              </div>
            )}
              <div className="msg-meta">{msg.time}</div>
            </div>
          </div>
        ))}

        {thinking && (
          <div className="message assistant animate-in">
            <div className="msg-avatar ai">✦</div>
            <div className="msg-content">
              <div className="thinking">
                <div className="thinking-dot" />
                <div className="thinking-dot" />
                <div className="thinking-dot" />
              </div>
            </div>
          </div>
        )}

        <div ref={bottomRef} />
      </div>

      <div className="input-area">
        <div className="input-wrapper">
          <div className="input-toolbar">
            {/* Document badges */}
            {docs.length > 0 && messages.length === 0 && (
              <div style={{ 
                display: 'flex', 
                gap: '6px', 
                flexWrap: 'wrap',
                marginBottom: '8px' 
              }}>
                {docs.slice(0, 3).map((doc, i) => (
                  <span 
                    key={i}
                    style={{
                      fontSize: 11,
                      padding: '4px 8px',
                      background: 'var(--bg2)',
                      border: '1px solid var(--border)',
                      borderRadius: 6,
                      color: 'var(--text3)'
                    }}
                  >
                    📄 {doc.name.slice(0, 20)}{doc.name.length > 20 ? '...' : ''}
                  </span>
                ))}
                {docs.length > 3 && (
                  <span style={{
                    fontSize: 11,
                    padding: '4px 8px',
                    color: 'var(--text3)'
                  }}>
                    +{docs.length - 3} more
                  </span>
                )}
              </div>
            )}
          </div>
          <textarea
            className="chat-input"
            placeholder="Ask anything about your documents…"
            value={input}
            onChange={(e: ChangeEvent<HTMLTextAreaElement>) => setInput(e.target.value)}
            onKeyDown={handleKey}
            rows={1}
          />
          <div className="input-footer">
            <span className="input-hint">↵ Send · ⇧↵ Newline</span>
            <button 
              className="send-btn" 
              onClick={handleSend} 
              disabled={!input.trim() || thinking}
            >
              ➤
            </button>
          </div>
        </div>
      </div>
    </>
  );
}

export default ChatPage;