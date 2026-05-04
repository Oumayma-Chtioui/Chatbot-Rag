// Frontend/src/BotCreate.tsx
import { useState, ChangeEvent } from "react";
import { Bot } from "./ClientApp";

const API = "http://localhost:8000";
const token = () => localStorage.getItem("client_token");

interface Props {
  existing: Bot | null;
  onCreated: (bot: Bot) => void;
  onCancel: () => void;
}

const PRESET_COLORS = [
  "#7F77DD", "#1D9E75", "#D85A30", "#BA7517",
  "#0ea5e9", "#ec4899", "#8b5cf6", "#14b8a6",
];

export default function BotCreate({ existing, onCreated, onCancel }: Props) {
  const isEdit = !!existing;

  const [name, setName]               = useState(existing?.name || "");
  const [accentColor, setAccentColor] = useState(existing?.accent_color || "#7F77DD");
  const [welcome, setWelcome]         = useState(existing?.welcome_message || "Hi! How can I help you today?");
  const [systemPrompt, setSystemPrompt] = useState(existing?.system_prompt || "You are a helpful assistant.");
  const [allowedOrigin, setAllowedOrigin] = useState(existing?.allowed_origin || "");
  const [loading, setLoading]         = useState(false);
  const [error, setError]             = useState<string | null>(null);

  const handleSubmit = async () => {
    setError(null);
    if (!name.trim()) { setError("Bot name is required."); return; }
    setLoading(true);
    try {
      const body = {
        name: name.trim(),
        accent_color: accentColor,
        welcome_message: welcome.trim(),
        system_prompt: systemPrompt.trim() || "You are a helpful assistant.",
        allowed_origin: allowedOrigin.trim() || null,
      };

      let res: Response;
      if (isEdit) {
        res = await fetch(`${API}/widgets/bots/${existing!.id}`, {
          method: "PATCH",
          headers: { "Content-Type": "application/json", Authorization: `Bearer ${token()}` },
          body: JSON.stringify(body),
        });
      } else {
        res = await fetch(`${API}/widgets/bots`, {
          method: "POST",
          headers: { "Content-Type": "application/json", Authorization: `Bearer ${token()}` },
          body: JSON.stringify(body),
        });
      }

      if (!res.ok) {
        const e = await res.json();
        throw new Error(e.detail || "Request failed");
      }

      const data = await res.json();
      // Both POST and PATCH now return the full bot object from the backend.
      // For POST, bot_id is returned as both `bot_id` and `id` for compatibility.
      const bot: Bot = isEdit
        ? { ...existing!, ...data }
        : {
            id:              data.bot_id || data.id,
            name:            data.name,
            accent_color:    data.accent_color    ?? accentColor,
            welcome_message: data.welcome_message ?? welcome.trim(),
            system_prompt:   data.system_prompt   ?? systemPrompt.trim(),
            allowed_origin:  data.allowed_origin  ?? (allowedOrigin.trim() || null),
            docs_indexed:    data.docs_indexed     ?? 0,
            is_active:       data.is_active        ?? true,
            created_at:      data.created_at       ?? new Date().toISOString(),
          };

      onCreated(bot);
    } catch (err: any) {
      setError(err.message || "Something went wrong.");
    } finally {
      setLoading(false);
    }
  };

  return (
    <div className="cl-page">
      <div className="cl-page-header" style={{ display: "flex", alignItems: "center", gap: 12 }}>
        <button
          onClick={onCancel}
          style={{
            background: "none", border: "1px solid var(--border)",
            borderRadius: 8, color: "var(--text2)", padding: "6px 12px",
            cursor: "pointer", fontSize: 13, display: "flex", alignItems: "center", gap: 6,
          }}
        >
          ← Back
        </button>
        <div>
          <h1 className="cl-page-title">{isEdit ? "Edit bot" : "Create a new bot"}</h1>
          <p className="cl-page-sub">
            {isEdit ? "Update your bot's settings." : "Configure your chatbot before uploading documents."}
          </p>
        </div>
      </div>

      <div style={{ display: "grid", gridTemplateColumns: "1fr 340px", gap: 24, alignItems: "start" }}>

        {/* ── Left: form ── */}
        <div style={{ display: "flex", flexDirection: "column", gap: 20 }}>

          {/* Name */}
          <FormSection title="Bot name" hint="Shown to users in the chat widget header.">
            <input
              className="cl-input"
              placeholder="e.g. Support Assistant, Sales Bot…"
              value={name}
              onChange={(e: ChangeEvent<HTMLInputElement>) => setName(e.target.value)}
              disabled={loading}
            />
          </FormSection>

          {/* Welcome message */}
          <FormSection title="Welcome message" hint="The first message users see when they open the widget.">
            <textarea
              className="cl-input"
              rows={3}
              placeholder="Hi! How can I help you today?"
              value={welcome}
              onChange={(e: ChangeEvent<HTMLTextAreaElement>) => setWelcome(e.target.value)}
              disabled={loading}
              style={{ resize: "vertical" }}
            />
          </FormSection>

          {/* System prompt */}
          <FormSection title="System prompt" hint="Instructions that shape how your bot behaves and responds.">
            <textarea
              className="cl-input"
              rows={5}
              placeholder="You are a helpful assistant that answers questions based on the provided documents."
              value={systemPrompt}
              onChange={(e: ChangeEvent<HTMLTextAreaElement>) => setSystemPrompt(e.target.value)}
              disabled={loading}
              style={{ resize: "vertical" }}
            />
          </FormSection>

          {/* Allowed origin */}
          <FormSection
            title="Allowed origin"
            hint="Only requests from this domain will be accepted. Leave empty to allow any origin."
          >
            <input
              className="cl-input"
              placeholder="https://mywebsite.com"
              value={allowedOrigin}
              onChange={(e: ChangeEvent<HTMLInputElement>) => setAllowedOrigin(e.target.value)}
              disabled={loading}
            />
          </FormSection>

          {/* Accent color */}
          <FormSection title="Accent color" hint="Widget header, send button, and highlights.">
            <div style={{ display: "flex", alignItems: "center", gap: 10, flexWrap: "wrap" }}>
              {PRESET_COLORS.map(c => (
                <button
                  key={c}
                  onClick={() => setAccentColor(c)}
                  title={c}
                  style={{
                    width: 32, height: 32, borderRadius: 8,
                    background: c, border: "none", cursor: "pointer",
                    outline: accentColor === c ? `3px solid ${c}` : "none",
                    outlineOffset: 2,
                    transform: accentColor === c ? "scale(1.15)" : "scale(1)",
                    transition: "transform 0.15s",
                    boxShadow: accentColor === c ? `0 0 0 2px var(--bg2), 0 0 0 4px ${c}` : "none",
                  }}
                />
              ))}
              {/* Custom color picker */}
              <label
                title="Custom color"
                style={{
                  width: 32, height: 32, borderRadius: 8,
                  border: "2px dashed var(--border2)",
                  cursor: "pointer", display: "flex",
                  alignItems: "center", justifyContent: "center",
                  fontSize: 16, color: "var(--text3)",
                  overflow: "hidden", position: "relative",
                }}
              >
                <input
                  type="color"
                  value={accentColor}
                  onChange={(e) => setAccentColor(e.target.value)}
                  style={{
                    position: "absolute", opacity: 0,
                    width: "100%", height: "100%", cursor: "pointer",
                  }}
                />
                +
              </label>
              <div style={{
                fontFamily: "monospace", fontSize: 12,
                color: "var(--text2)", padding: "4px 10px",
                background: "var(--bg3)", borderRadius: 6,
                border: "1px solid var(--border)",
              }}>
                {accentColor}
              </div>
            </div>
          </FormSection>

          {error && <div className="cl-error">{error}</div>}

          <div style={{ display: "flex", gap: 10, paddingTop: 4 }}>
            <button
              className="cl-btn-primary"
              onClick={handleSubmit}
              disabled={loading}
              style={{ flex: 1, padding: "10px" }}
            >
              {loading
                ? (isEdit ? "Saving…" : "Creating…")
                : (isEdit ? "Save changes" : "Create bot")}
            </button>
            <button
              onClick={onCancel}
              style={{
                background: "none", border: "1px solid var(--border)",
                borderRadius: 6, color: "var(--text2)", padding: "10px 20px",
                cursor: "pointer", fontSize: 13,
              }}
            >
              Cancel
            </button>
          </div>
        </div>

        {/* ── Right: live preview ── */}
        <div style={{ position: "sticky", top: 24 }}>
          <div style={{
            fontSize: 11, fontWeight: 600, color: "var(--text3)",
            textTransform: "uppercase", letterSpacing: "0.08em",
            marginBottom: 12,
          }}>
            Widget preview
          </div>
          <WidgetPreview
            name={name || "My Bot"}
            accentColor={accentColor}
            welcome={welcome || "Hi! How can I help you today?"}
          />
        </div>
      </div>
    </div>
  );
}

// ── Form section wrapper ──────────────────────────────────────────────────────

function FormSection({ title, hint, children }: {
  title: string;
  hint?: string;
  children: React.ReactNode;
}) {
  return (
    <div style={{ display: "flex", flexDirection: "column", gap: 8 }}>
      <div>
        <label style={{
          display: "block", fontSize: 12, fontWeight: 600,
          color: "var(--text)", marginBottom: 3,
          textTransform: "uppercase", letterSpacing: "0.05em",
        }}>
          {title}
        </label>
        {hint && <p style={{ fontSize: 11, color: "var(--text3)", lineHeight: 1.5 }}>{hint}</p>}
      </div>
      {children}
    </div>
  );
}

// ── Mini widget preview ───────────────────────────────────────────────────────

function WidgetPreview({
  name,
  accentColor,
  welcome,
}: {
  name: string;
  accentColor: string;
  welcome: string;
}) {
  return (
    <div style={{
      background: "var(--bg2)",
      border: "1px solid var(--border)",
      borderRadius: 16,
      overflow: "hidden",
      fontFamily: "system-ui, sans-serif",
      boxShadow: "0 4px 24px rgba(0,0,0,0.2)",
    }}>
      {/* Header */}
      <div style={{
        background: accentColor,
        padding: "12px 16px",
        display: "flex",
        alignItems: "center",
        justifyContent: "space-between",
      }}>
        <div style={{ display: "flex", alignItems: "center", gap: 8 }}>
          <div style={{
            width: 28, height: 28, borderRadius: "50%",
            background: "rgba(255,255,255,0.2)",
            display: "flex", alignItems: "center", justifyContent: "center",
            fontSize: 13, color: "#fff",
          }}>
            ◉
          </div>
          <span style={{ color: "#fff", fontWeight: 600, fontSize: 13 }}>
            {name}
          </span>
        </div>
        <span style={{ color: "rgba(255,255,255,0.7)", fontSize: 16, cursor: "pointer" }}>✕</span>
      </div>

      {/* Messages area */}
      <div style={{
        padding: 16,
        background: "#fafaf8",
        minHeight: 160,
        display: "flex",
        flexDirection: "column",
        gap: 10,
      }}>
        {/* Bot welcome bubble */}
        <div style={{ display: "flex", gap: 8, alignItems: "flex-start" }}>
          <div style={{
            width: 24, height: 24, borderRadius: "50%",
            background: accentColor,
            display: "flex", alignItems: "center", justifyContent: "center",
            fontSize: 11, color: "#fff", flexShrink: 0,
          }}>◉</div>
          <div style={{
            background: "#fff",
            border: "1px solid #e5e5e3",
            borderRadius: "4px 12px 12px 12px",
            padding: "8px 12px",
            fontSize: 12,
            color: "#111",
            maxWidth: "80%",
            lineHeight: 1.5,
          }}>
            {welcome}
          </div>
        </div>

        {/* User example bubble */}
        <div style={{ display: "flex", justifyContent: "flex-end" }}>
          <div style={{
            background: accentColor,
            borderRadius: "12px 4px 12px 12px",
            padding: "8px 12px",
            fontSize: 12,
            color: "#fff",
            maxWidth: "70%",
          }}>
            How can you help me?
          </div>
        </div>
      </div>

      {/* Input area */}
      <div style={{
        padding: "8px 10px",
        borderTop: "1px solid #e5e5e3",
        background: "#fff",
        display: "flex",
        gap: 6,
        alignItems: "center",
      }}>
        <div style={{
          flex: 1, background: "#f5f5f4",
          border: "1px solid #e5e5e3",
          borderRadius: 8,
          padding: "6px 10px",
          fontSize: 11,
          color: "#999",
        }}>
          Type a message…
        </div>
        <div style={{
          background: accentColor,
          borderRadius: 8,
          padding: "6px 10px",
          fontSize: 11,
          color: "#fff",
          fontWeight: 600,
        }}>
          Send
        </div>
      </div>
    </div>
  );
}