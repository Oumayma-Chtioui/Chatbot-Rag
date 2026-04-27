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

  /* ── Shadow DOM host ── */
  const shadow = (() => {
    const host = document.createElement("div");
    host.id = "novamind-widget-host";
    document.body.appendChild(host);
    return host.attachShadow({ mode: "open" });
  })();

  /* ── Load marked.js for markdown rendering ── */
  let markedReady = false;
  const markedScript = document.createElement("script");
  markedScript.src = "https://cdnjs.cloudflare.com/ajax/libs/marked/9.1.6/marked.min.js";
  markedScript.onload = () => { markedReady = true; };
  document.head.appendChild(markedScript);

  /* ── Inject CSS via fetch into shadow DOM ── */
  fetch(`${API_BASE}/static/widget.css`)
    .then(res => res.text())
    .then(cssText => {
      const accentOverride = `
        :host { --accent: ${ACCENT}; }
      `;
      const style = document.createElement("style");
      style.textContent = accentOverride + cssText;
      shadow.appendChild(style);
    });

  /* ── HTML template (no style block needed) ── */
  const side  = POSITION.includes("right") ? "right: 24px;" : "left: 24px;";
  const vside = POSITION.includes("bottom") ? "bottom:" : "top:";

  const template = document.createElement("div");
  template.innerHTML = `
    <button id="nm-bubble" style="${side} ${vside} 24px;">
      <svg viewBox="0 0 24 24" xmlns="http://www.w3.org/2000/svg">
        <path d="M12 2C6.477 2 2 6.477 2 12c0 1.89.525 3.66 1.438 5.168L2 22l4.832-1.438A9.956 9.956 0 0012 22c5.523 0 10-4.477 10-10S17.523 2 12 2z"/>
      </svg>
    </button>

    <div id="nm-panel" style="${side} ${vside} 88px;">
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

  // Append nodes into shadow
  while (template.firstChild) {
    shadow.appendChild(template.firstChild);
  }

  /* ── Element refs ── */
  const panel    = shadow.getElementById("nm-panel");
  const bubble   = shadow.getElementById("nm-bubble");
  const closeBtn = shadow.getElementById("nm-close");
  const messages = shadow.getElementById("nm-messages");
  const input    = shadow.getElementById("nm-input");
  const sendBtn  = shadow.getElementById("nm-send");

  /* ── Toggle open/close ── */
  function openPanel()  { isOpen = true;  panel.classList.add("nm-open"); }
  function closePanel() { isOpen = false; panel.classList.remove("nm-open"); }

  bubble.addEventListener("click", () => isOpen ? closePanel() : openPanel());
  closeBtn.addEventListener("click", closePanel);

  /* ── Auto-resize textarea ── */
  input.addEventListener("input", () => {
    input.style.height = "auto";
    input.style.height = Math.min(input.scrollHeight, 100) + "px";
  });
  input.addEventListener("keydown", (e) => {
    if (e.key === "Enter" && !e.shiftKey) { e.preventDefault(); sendMessage(); }
  });

  /* ── Message helpers ── */
  function appendMsg(text, role) {
    const el = document.createElement("div");
    el.className = `nm-msg nm-${role}`;

    if (role === "bot") {
        el.innerHTML = markedReady
            ? marked.parse(text)
            : text.replace(/\*\*(.*?)\*\*/g, "<strong>$1</strong>")  // fallback
                  .replace(/\*(.*?)\*/g, "<em>$1</em>")
                  .replace(/\n/g, "<br>");
    } else {
      el.textContent = text;
    }

    messages.appendChild(el);
    messages.scrollTop = messages.scrollHeight;
    return el;
  }

  /* ── Intervention state ── */
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

  /* ── Send message ── */
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