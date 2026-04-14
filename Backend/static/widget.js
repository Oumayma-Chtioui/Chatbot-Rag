(function () {
  const CONFIG = window.NovaMindConfig || {};
  const API_KEY   = CONFIG.apiKey   || "";
  const API_BASE  = CONFIG.apiBase  || "http://localhost:8000";
  const BOT_NAME  = CONFIG.botName  || "NovaMind";
  const POSITION  = CONFIG.position || "bottom-right";
  const ACCENT    = CONFIG.accent   || "#7F77DD";

  if (!API_KEY) {
    console.warn("[NovaMind] No apiKey provided — widget disabled.");
    return;
  }

  let sessionId = sessionStorage.getItem("nm_session") || null;
  let isOpen = false;

  const shadow = (() => {
    const host = document.createElement("div");
    host.id = "novamind-widget-host";
    document.body.appendChild(host);
    return host.attachShadow({ mode: "open" });
  })();

  shadow.innerHTML = `
    <style>
      *, *::before, *::after { box-sizing: border-box; margin: 0; padding: 0; }
      :host { font-family: system-ui, sans-serif; font-size: 14px; }

      #nm-bubble {
        position: fixed;
        ${POSITION.includes("right") ? "right: 24px;" : "left: 24px;"}
        ${POSITION.includes("bottom") ? "bottom: 24px;" : "top: 24px;"}
        width: 52px; height: 52px;
        border-radius: 50%;
        background: ${ACCENT};
        cursor: pointer;
        display: flex; align-items: center; justify-content: center;
        border: none; outline: none;
        transition: transform 0.15s;
        z-index: 2147483646;
      }
      #nm-bubble:hover { transform: scale(1.08); }
      #nm-bubble svg { width: 24px; height: 24px; }

      #nm-panel {
        position: fixed;
        ${POSITION.includes("right") ? "right: 24px;" : "left: 24px;"}
        ${POSITION.includes("bottom") ? "bottom: 88px;" : "top: 88px;"}
        width: 360px;
        height: 520px;
        background: #fff;
        border-radius: 16px;
        border: 1px solid #e5e5e3;
        display: flex;
        flex-direction: column;
        overflow: hidden;
        z-index: 2147483647;
        transition: opacity 0.15s, transform 0.15s;
      }
      #nm-panel.nm-hidden {
        opacity: 0;
        pointer-events: none;
        transform: translateY(8px);
      }

      #nm-header {
        padding: 14px 16px;
        background: ${ACCENT};
        display: flex; align-items: center; justify-content: space-between;
        flex-shrink: 0;
      }
      #nm-header-title { color: #fff; font-weight: 500; font-size: 14px; }
      #nm-close {
        background: none; border: none; cursor: pointer;
        color: rgba(255,255,255,0.8); font-size: 18px; line-height: 1;
        padding: 2px 6px; border-radius: 6px;
      }
      #nm-close:hover { color: #fff; background: rgba(255,255,255,0.15); }

      #nm-messages {
        flex: 1;
        overflow-y: auto;
        padding: 16px;
        display: flex;
        flex-direction: column;
        gap: 10px;
        background: #fafaf8;
      }

      .nm-msg {
        max-width: 82%;
        padding: 9px 13px;
        border-radius: 12px;
        font-size: 13px;
        line-height: 1.5;
        word-break: break-word;
      }
      .nm-msg.nm-user {
        align-self: flex-end;
        background: ${ACCENT};
        color: #fff;
        border-bottom-right-radius: 4px;
      }
      .nm-msg.nm-bot {
        align-self: flex-start;
        background: #fff;
        color: #1a1a18;
        border: 1px solid #e5e5e3;
        border-bottom-left-radius: 4px;
      }
      .nm-msg.nm-bot.nm-thinking {
        display: flex; gap: 5px; align-items: center;
        padding: 12px 16px;
      }
      .nm-dot {
        width: 7px; height: 7px; border-radius: 50%;
        background: #b4b2a9;
        animation: nm-bounce 1.2s infinite ease-in-out;
      }
      .nm-dot:nth-child(2) { animation-delay: 0.2s; }
      .nm-dot:nth-child(3) { animation-delay: 0.4s; }
      @keyframes nm-bounce {
        0%, 80%, 100% { transform: scale(0.7); opacity: 0.5; }
        40% { transform: scale(1); opacity: 1; }
      }

      .nm-sources {
        margin-top: 6px;
        display: flex;
        flex-wrap: wrap;
        gap: 4px;
      }
      .nm-source-chip {
        font-size: 11px;
        padding: 2px 8px;
        background: #f1efea;
        color: #5f5e5a;
        border-radius: 20px;
        border: 1px solid #d3d1c7;
      }

      #nm-input-row {
        display: flex;
        gap: 8px;
        padding: 12px;
        border-top: 1px solid #e5e5e3;
        background: #fff;
        flex-shrink: 0;
      }
      #nm-input {
        flex: 1;
        border: 1px solid #d3d1c7;
        border-radius: 8px;
        padding: 8px 12px;
        font-size: 13px;
        font-family: inherit;
        outline: none;
        resize: none;
        height: 36px;
        line-height: 1.4;
        color: #1a1a18;
        background: #fff;
      }
      #nm-input:focus { border-color: ${ACCENT}; }
      #nm-send {
        width: 36px; height: 36px; flex-shrink: 0;
        background: ${ACCENT};
        border: none; border-radius: 8px;
        cursor: pointer;
        display: flex; align-items: center; justify-content: center;
        transition: opacity 0.15s;
      }
      #nm-send:disabled { opacity: 0.4; cursor: not-allowed; }
      #nm-send svg { width: 16px; height: 16px; }
    </style>

    <button id="nm-bubble" aria-label="Open chat">
      <svg viewBox="0 0 24 24" fill="none" stroke="#fff" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">
        <path d="M21 15a2 2 0 0 1-2 2H7l-4 4V5a2 2 0 0 1 2-2h14a2 2 0 0 1 2 2z"/>
      </svg>
    </button>

    <div id="nm-panel" class="nm-hidden" role="dialog" aria-label="${BOT_NAME} chat">
      <div id="nm-header">
        <span id="nm-header-title">${BOT_NAME}</span>
        <button id="nm-close" aria-label="Close chat">✕</button>
      </div>
      <div id="nm-messages"></div>
      <div id="nm-input-row">
        <textarea id="nm-input" placeholder="Ask a question…" rows="1" aria-label="Message input"></textarea>
        <button id="nm-send" disabled aria-label="Send">
          <svg viewBox="0 0 24 24" fill="none" stroke="#fff" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round">
            <line x1="22" y1="2" x2="11" y2="13"/>
            <polygon points="22 2 15 22 11 13 2 9 22 2"/>
          </svg>
        </button>
      </div>
    </div>
  `;

  const bubble   = shadow.getElementById("nm-bubble");
  const panel    = shadow.getElementById("nm-panel");
  const closeBtn = shadow.getElementById("nm-close");
  const messages = shadow.getElementById("nm-messages");
  const input    = shadow.getElementById("nm-input");
  const sendBtn  = shadow.getElementById("nm-send");

  bubble.addEventListener("click", () => togglePanel(true));
  closeBtn.addEventListener("click", () => togglePanel(false));

  function togglePanel(open) {
    isOpen = open;
    panel.classList.toggle("nm-hidden", !open);
    if (open && messages.children.length === 0) appendWelcome();
  }

  function appendWelcome() {
    appendBotMessage("Hi! I'm " + BOT_NAME + ". Ask me anything about this site's content.", []);
  }

  input.addEventListener("input", () => {
    sendBtn.disabled = !input.value.trim();
    input.style.height = "36px";
    input.style.height = Math.min(input.scrollHeight, 100) + "px";
  });

  input.addEventListener("keydown", (e) => {
    if (e.key === "Enter" && !e.shiftKey) {
      e.preventDefault();
      if (!sendBtn.disabled) sendMessage();
    }
  });

  sendBtn.addEventListener("click", sendMessage);

  function appendUserMessage(text) {
    const el = document.createElement("div");
    el.className = "nm-msg nm-user";
    el.textContent = text;
    messages.appendChild(el);
    scrollBottom();
    return el;
  }

  function appendThinking() {
    const el = document.createElement("div");
    el.className = "nm-msg nm-bot nm-thinking";
    el.innerHTML = '<div class="nm-dot"></div><div class="nm-dot"></div><div class="nm-dot"></div>';
    messages.appendChild(el);
    scrollBottom();
    return el;
  }

  function appendBotMessage(text, sources) {
    const el = document.createElement("div");
    el.className = "nm-msg nm-bot";
    el.textContent = text;

    if (sources && sources.length > 0) {
      const chips = document.createElement("div");
      chips.className = "nm-sources";
      const seen = new Set();
      sources.forEach(s => {
        const name = typeof s === "string" ? s : s.source;
        const label = name.split("/").pop() || name;
        if (seen.has(label)) return;
        seen.add(label);
        const chip = document.createElement("span");
        chip.className = "nm-source-chip";
        chip.textContent = label;
        chips.appendChild(chip);
      });
      el.appendChild(chips);
    }

    messages.appendChild(el);
    scrollBottom();
    return el;
  }

  function scrollBottom() {
    messages.scrollTop = messages.scrollHeight;
  }

  async function sendMessage() {
    const text = input.value.trim();
    if (!text) return;

    input.value = "";
    input.style.height = "36px";
    sendBtn.disabled = true;

    appendUserMessage(text);
    const thinking = appendThinking();

    try {
      const res = await fetch(`${API_BASE}/widget/chat`, {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          "X-Api-Key": API_KEY,
        },
        body: JSON.stringify({ message: text, session_id: sessionId }),
      });

      const data = await res.json();

      if (!res.ok) {
        throw new Error(data.detail || "Request failed");
      }

      sessionId = data.session_id;
      sessionStorage.setItem("nm_session", sessionId);

      thinking.remove();
      appendBotMessage(data.answer, data.sources);

    } catch (err) {
      thinking.remove();
      appendBotMessage("Sorry, something went wrong. Please try again.", []);
      console.error("[NovaMind]", err);
    }
  }
})();