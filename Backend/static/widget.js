(function () {
  const CONFIG   = window.NovaMindConfig || {};
  const API_KEY  = CONFIG.apiKey   || "";
  const API_BASE = CONFIG.apiBase  || "http://localhost:8000";
  const BOT_NAME = CONFIG.botName  || "NovaMind";
  const POSITION = CONFIG.position || "bottom-right";
  const ACCENT   = CONFIG.accent   || "#7F77DD";

  if (!API_KEY) {
    console.warn("[NovaMind] No apiKey provided — widget disabled.");
    return;
  }

  let sessionId = sessionStorage.getItem("nm_session") || null;
  let isOpen    = false;

  /* ── Shadow DOM host ─────────────────────────────────────────────────────── */
  const shadow = (() => {
    const host = document.createElement("div");
    host.id = "novamind-widget-host";
    document.body.appendChild(host);
    return host.attachShadow({ mode: "open" });
  })();

  const side   = POSITION.includes("right") ? "right: 24px;" : "left: 24px;";
  const vside  = POSITION.includes("bottom") ? "bottom:" : "top:";

  shadow.innerHTML = `
    <style>
      *, *::before, *::after { box-sizing: border-box; margin: 0; padding: 0; }
      :host { font-family: system-ui, sans-serif; font-size: 14px; }

      /* ── Bubble ── */
      #nm-bubble {
        position: fixed;
        ${side}
        ${vside} 24px;
        width: 52px; height: 52px;
        border-radius: 50%;
        background: ${ACCENT};
        cursor: pointer;
        display: flex; align-items: center; justify-content: center;
        border: none; outline: none;
        z-index: 2147483646;
        transition: transform 0.15s, box-shadow 0.15s;
        box-shadow: 0 4px 12px rgba(0,0,0,0.18);
      }
      #nm-bubble:hover { transform: scale(1.08); }
      #nm-bubble svg { width: 24px; height: 24px; fill: #fff; }

      /* ── Panel ── */
      #nm-panel {
        position: fixed;
        ${side}
        ${vside} 88px;
        width: 360px;
        height: 520px;
        background: #fff;
        border-radius: 16px;
        border: 1px solid #e5e5e3;
        display: none;               /* hidden by default */
        flex-direction: column;
        overflow: hidden;
        z-index: 2147483647;
        box-shadow: 0 8px 32px rgba(0,0,0,0.14);
        animation: nm-slide-in 0.2s ease;
      }
      #nm-panel.nm-open { display: flex; }

      @keyframes nm-slide-in {
        from { opacity: 0; transform: translateY(12px); }
        to   { opacity: 1; transform: translateY(0);    }
      }

      /* ── Header ── */
      #nm-header {
        background: ${ACCENT};
        color: #fff;
        padding: 14px 16px;
        display: flex;
        align-items: center;
        justify-content: space-between;
        flex-shrink: 0;
      }
      #nm-header span { font-weight: 600; font-size: 14px; }
      #nm-close {
        background: none; border: none; color: #fff;
        cursor: pointer; font-size: 18px; line-height: 1;
        opacity: 0.8; padding: 0 2px;
      }
      #nm-close:hover { opacity: 1; }

      /* ── Messages ── */
      #nm-messages {
        flex: 1;
        overflow-y: auto;
        padding: 16px;
        display: flex;
        flex-direction: column;
        gap: 10px;
        background: #fafaf8;
      }
      #nm-messages::-webkit-scrollbar { width: 4px; }
      #nm-messages::-webkit-scrollbar-thumb { background: #ddd; border-radius: 4px; }

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
        border-bottom-right-radius: 3px;
      }
      .nm-msg.nm-bot {
        align-self: flex-start;
        background: #fff;
        border: 1px solid #e5e5e3;
        color: #111;
        border-bottom-left-radius: 3px;
      }
      .nm-msg.nm-typing {
        align-self: flex-start;
        background: #fff;
        border: 1px solid #e5e5e3;
        color: #999;
        font-style: italic;
      }

      /* ── Input area ── */
      #nm-footer {
        display: flex;
        gap: 8px;
        padding: 10px 12px;
        border-top: 1px solid #e5e5e3;
        background: #fff;
        flex-shrink: 0;
      }
      #nm-input {
        flex: 1;
        border: 1px solid #e5e5e3;
        border-radius: 8px;
        padding: 8px 10px;
        font-size: 13px;
        font-family: inherit;
        resize: none;
        outline: none;
        max-height: 100px;
        line-height: 1.4;
        color: #111;
      }
      #nm-input:focus { border-color: ${ACCENT}; }
      #nm-send {
        background: ${ACCENT};
        color: #fff;
        border: none;
        border-radius: 8px;
        padding: 0 14px;
        cursor: pointer;
        font-size: 13px;
        font-weight: 600;
        flex-shrink: 0;
        transition: opacity 0.15s;
      }
      #nm-send:hover { opacity: 0.88; }
      #nm-send:disabled { opacity: 0.5; cursor: not-allowed; }

      /* ── Intervention panel ── */
      .nm-intervention {
        background: rgba(239,68,68,0.07);
        border: 1px solid rgba(239,68,68,0.22);
        border-radius: 10px;
        padding: 12px 14px;
        margin-top: 4px;
        font-size: 13px;
        line-height: 1.5;
        color: #111;
      }
      .nm-intervention p { margin: 0 0 10px; }
      .nm-intervention input {
        width: 100%;
        border: 1px solid #ddd;
        border-radius: 7px;
        padding: 7px 10px;
        font-size: 13px;
        font-family: inherit;
        margin-bottom: 8px;
        outline: none;
        color: #111;
      }
      .nm-intervention input:focus { border-color: ${ACCENT}; }
      .nm-int-btn {
        background: ${ACCENT};
        color: #fff;
        border: none;
        border-radius: 7px;
        padding: 8px 0;
        width: 100%;
        cursor: pointer;
        font-size: 13px;
        font-weight: 600;
        transition: opacity 0.15s;
      }
      .nm-int-btn:hover { opacity: 0.88; }
      .nm-int-btn:disabled { opacity: 0.5; cursor: not-allowed; }
      .nm-cancel {
        display: block;
        text-align: center;
        margin-top: 8px;
        font-size: 11px;
        color: #999;
        cursor: pointer;
      }
      .nm-cancel:hover { color: #555; }
      .nm-success {
        background: rgba(34,197,94,0.1);
        border: 1px solid rgba(34,197,94,0.28);
        border-radius: 8px;
        padding: 10px 12px;
        color: #166534;
        font-size: 13px;
      }
      .nm-err { color: #dc2626; font-size: 12px; margin-top: 6px; }
    </style>

    <button id="nm-bubble">
      <svg viewBox="0 0 24 24" xmlns="http://www.w3.org/2000/svg">
        <path d="M12 2C6.477 2 2 6.477 2 12c0 1.89.525 3.66 1.438 5.168L2 22l4.832-1.438A9.956 9.956 0 0012 22c5.523 0 10-4.477 10-10S17.523 2 12 2z"/>
      </svg>
    </button>

    <div id="nm-panel">
      <div id="nm-header">
        <span>${BOT_NAME}</span>
        <button id="nm-close">✕</button>
      </div>
      <div id="nm-messages"></div>
      <div id="nm-footer">
        <textarea id="nm-input" rows="1" placeholder="Type a message…"></textarea>
        <button id="nm-send">Send</button>
      </div>
    </div>
  `;

  /* ── Element refs ────────────────────────────────────────────────────────── */
  const panel   = shadow.getElementById("nm-panel");
  const bubble  = shadow.getElementById("nm-bubble");
  const closeBtn = shadow.getElementById("nm-close");
  const messages = shadow.getElementById("nm-messages");
  const input   = shadow.getElementById("nm-input");
  const sendBtn = shadow.getElementById("nm-send");

  /* ── Toggle open/close ───────────────────────────────────────────────────── */
  function openPanel()  { isOpen = true;  panel.classList.add("nm-open"); }
  function closePanel() { isOpen = false; panel.classList.remove("nm-open"); }

  bubble.addEventListener("click", () => isOpen ? closePanel() : openPanel());
  closeBtn.addEventListener("click", closePanel);

  /* ── Auto-resize textarea ────────────────────────────────────────────────── */
  input.addEventListener("input", () => {
    input.style.height = "auto";
    input.style.height = Math.min(input.scrollHeight, 100) + "px";
  });
  input.addEventListener("keydown", (e) => {
    if (e.key === "Enter" && !e.shiftKey) { e.preventDefault(); sendMessage(); }
  });

  /* ── Message helpers ─────────────────────────────────────────────────────── */
  function appendMsg(text, role) {
    const el = document.createElement("div");
    el.className = `nm-msg nm-${role}`;
    el.textContent = text;
    messages.appendChild(el);
    messages.scrollTop = messages.scrollHeight;
    return el;
  }

  /* ── Intervention state ──────────────────────────────────────────────────── */
  let nmIntervention = { active: false, step: "offer", ticketId: null, question: null };

  function showInterventionOffer(question) {
    nmIntervention = { active: true, step: "offer", question, ticketId: null };
    renderInterventionPanel();
  }

  function renderInterventionPanel() {
    const existing = shadow.getElementById("nm-int-panel");
    if (existing) existing.remove();

    const panel = document.createElement("div");
    panel.id = "nm-int-panel";
    panel.className = "nm-intervention";

    if (nmIntervention.step === "offer") {
      panel.innerHTML = `
        <p>Je n'ai pas trouvé de réponse. Souhaitez-vous contacter le support ?</p>
        <button class="nm-int-btn" id="nm-yes">Oui, contacter le support</button>
        <span class="nm-cancel" id="nm-no">Non merci</span>
      `;
      panel.querySelector("#nm-yes").onclick = () => { nmIntervention.step = "email"; renderInterventionPanel(); };
      panel.querySelector("#nm-no").onclick  = () => { nmIntervention.active = false; panel.remove(); };
    }

    else if (nmIntervention.step === "email") {
      panel.innerHTML = `
        <p>Entrez votre email pour recevoir la réponse :</p>
        <input id="nm-email" type="email" placeholder="vous@exemple.com" />
        <button class="nm-int-btn" id="nm-email-btn">Envoyer le code</button>
        <span class="nm-cancel" id="nm-back">Annuler</span>
      `;
      panel.querySelector("#nm-email-btn").onclick = async () => {
        const email = panel.querySelector("#nm-email").value.trim();
        if (!email || !email.includes("@")) {
          panel.querySelector("#nm-email").style.borderColor = "#dc2626"; return;
        }
        const btn = panel.querySelector("#nm-email-btn");
        btn.disabled = true; btn.textContent = "Envoi…";
        try {
          const res = await fetch(API_BASE + "/widget/intervention/request", {
            method: "POST",
            headers: { "Content-Type": "application/json", "X-Api-Key": API_KEY },
            body: JSON.stringify({ question: nmIntervention.question, session_id: sessionId, user_email: email }),
          });
          const data = await res.json();
          if (!res.ok) throw new Error(data.detail || "Erreur");
          nmIntervention.ticketId = data.ticket_id;
          nmIntervention.step = "verify";
          renderInterventionPanel();
        } catch (err) {
          btn.disabled = false; btn.textContent = "Réessayer";
          const e = document.createElement("p");
          e.className = "nm-err"; e.textContent = err.message;
          panel.appendChild(e);
        }
      };
      panel.querySelector("#nm-back").onclick = () => { nmIntervention.step = "offer"; renderInterventionPanel(); };
    }

    else if (nmIntervention.step === "verify") {
      panel.innerHTML = `
        <p>Code envoyé à votre email. Entrez-le ci-dessous :</p>
        <input id="nm-code" type="text" placeholder="000000" maxlength="6"
               style="text-align:center;font-size:18px;letter-spacing:6px;" />
        <button class="nm-int-btn" id="nm-verify-btn">Confirmer</button>
        <span class="nm-cancel" id="nm-back2">Annuler</span>
      `;
      panel.querySelector("#nm-verify-btn").onclick = async () => {
        const code = panel.querySelector("#nm-code").value.trim();
        if (code.length !== 6) return;
        const btn = panel.querySelector("#nm-verify-btn");
        btn.disabled = true; btn.textContent = "Vérification…";
        try {
          const res = await fetch(API_BASE + "/widget/intervention/verify", {
            method: "POST",
            headers: { "Content-Type": "application/json", "X-Api-Key": API_KEY },
            body: JSON.stringify({ ticket_id: nmIntervention.ticketId, code }),
          });
          const data = await res.json();
          if (!res.ok) throw new Error(data.detail || "Code invalide");
          nmIntervention.step = "done";
          renderInterventionPanel();
        } catch (err) {
          btn.disabled = false; btn.textContent = "Réessayer";
          panel.querySelector("#nm-code").style.borderColor = "#dc2626";
        }
      };
      panel.querySelector("#nm-back2").onclick = () => { nmIntervention.active = false; panel.remove(); };
    }

    else if (nmIntervention.step === "done") {
      panel.innerHTML = `
        <div class="nm-success">
          ✓ Demande transmise au support. Vous recevrez la réponse par email.
        </div>
      `;
      setTimeout(() => { panel.remove(); nmIntervention.active = false; }, 6000);
    }

    messages.appendChild(panel);
    messages.scrollTop = messages.scrollHeight;
  }

  /* ── Send message ────────────────────────────────────────────────────────── */
  async function sendMessage() {
    const text = input.value.trim();
    if (!text) return;

    input.value = "";
    input.style.height = "auto";
    sendBtn.disabled = true;
    appendMsg(text, "user");

    const typing = appendMsg("…", "typing");

    try {
      const res = await fetch(`${API_BASE}/widget/chat`, {
        method: "POST",
        headers: { "Content-Type": "application/json", "X-Api-Key": API_KEY },
        body: JSON.stringify({ message: text, session_id: sessionId }),
      });

      const data = await res.json();
      sessionId = data.session_id;
      sessionStorage.setItem("nm_session", sessionId);

      typing.remove();
      appendMsg(data.answer, "bot");

      if (data.answered === false && !nmIntervention.active) {
        showInterventionOffer(text);
      }
    } catch {
      typing.remove();
      appendMsg("Erreur de connexion. Réessayez.", "bot");
    } finally {
      sendBtn.disabled = false;
      input.focus();
    }
  }

  sendBtn.addEventListener("click", sendMessage);

})();