import { useState, useRef, useEffect, ChangeEvent, DragEvent, KeyboardEvent } from "react";
import { Session, Doc, Message, AuthPageProps, SidebarProps, ChatPageProps, UploadPageProps } from './types.tsx';  // Import interfaces
function ChatPage({ docs, messages, setMessages, onToggleSidebar  }: ChatPageProps) {
  const [input, setInput] = useState<string>("");
  const [thinking, setThinking] = useState<boolean>(false);
  const bottomRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    bottomRef.current?.scrollIntoView({ behavior: "smooth" });
  }, [messages, thinking]);

  const handleSend = (): void => {
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

    setTimeout(() => {
      setThinking(false);
      const reply: Message = {
        id: Date.now() + 1,
        role: "assistant",
        content: "Based on the document, I found relevant context. This is a simulated response — connect your LangChain RAG backend to get real answers from your loaded documents.",
        sources: docs.length > 0 ? [`${docs[0].name} · p.3`] : [],
        time: new Date().toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" }),
      };
      setMessages([...newMsgs, reply]);
    }, 1800);
  };

  const handleKey = (e: KeyboardEvent<HTMLTextAreaElement>): void => {
    if (e.key === "Enter" && !e.shiftKey) {
      e.preventDefault();
      handleSend();
    }
  };

  return (
    <>
      <div className="topbar">
        <button className="hamburger" onClick={onToggleSidebar}>☰</button>  {/* ADD THIS */}
        <div className="topbar-title">MachineLearning-Lecture01</div>
        <div className="topbar-actions">
          <span style={{ fontSize: 12, color: "var(--text3)" }}>{docs.length} doc{docs.length !== 1 ? "s" : ""} loaded</span>
          <button className="icon-btn" title="Search">🔍</button>
          <button className="icon-btn" title="Share">↗</button>
        </div>
      </div>

      <div className="chat-area">
        {messages.length === 0 && (
          <div style={{ textAlign: "center", color: "var(--text3)", marginTop: 60, fontSize: 14 }}>
            No messages yet — start the conversation below.
          </div>
        )}

        {messages.map((msg: Message) => (
          <div key={msg.id} className={`message ${msg.role} animate-in`}>
            <div className={`msg-avatar ${msg.role === "assistant" ? "ai" : "user-av"}`}>
              {msg.role === "assistant" ? "✦" : "A"}
            </div>
            <div className="msg-content">
              <div className="msg-bubble" style={{ whiteSpace: "pre-line" }}>{msg.content}</div>
              {msg.sources && msg.sources.length > 0 && (
                <div className="source-chips">
                  {msg.sources.map((s: string, i: number) => (
                    <div key={i} className="source-chip">📄 {s}</div>
                  ))}
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
            <button className="toolbar-btn" title="Attach file">📎</button>
            <button className="toolbar-btn" title="Select document">📄</button>
            <button className="toolbar-btn" title="Web search">🌐</button>
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
            <button className="send-btn" onClick={handleSend} disabled={!input.trim() || thinking}>➤</button>
          </div>
        </div>
      </div>
    </>
  );
}

export default ChatPage;
