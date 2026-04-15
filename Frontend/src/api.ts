// api.ts - Frontend API Integration for NovaMind

const API_BASE = "http://localhost:8000";

// ─────────────────────────────────────────────────────────────────────────────
// Helper: Get auth token
// ─────────────────────────────────────────────────────────────────────────────
function getToken(): string | null {
  return localStorage.getItem("token");
}

function getHeaders(): HeadersInit {
  const token = getToken();
  return {
    "Content-Type": "application/json",
    ...(token ? { Authorization: `Bearer ${token}` } : {}),
  };
}

function getAdminHeaders(): HeadersInit {
  const adminToken = localStorage.getItem("admin_token");
  return {
    "Content-Type": "application/json",
    ...(adminToken ? { Authorization: `Bearer ${adminToken}` } : {}),
  };
}

function getClientHeaders(): HeadersInit {
  const clientToken = localStorage.getItem("client_token");
  return {
    "Content-Type": "application/json",
    ...(clientToken ? { Authorization: `Bearer ${clientToken}` } : {}),
  };
}

// ─────────────────────────────────────────────────────────────────────────────
// Auth APIs
// ─────────────────────────────────────────────────────────────────────────────

export async function login(email: string, password: string) {
  const res = await fetch(`${API_BASE}/login`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ email, password }),
  });
  
  if (!res.ok) {
    const error = await res.json();
    throw new Error(error.detail || "Login failed");
  }
  
  return await res.json();
}

export async function register(name: string, email: string, password: string) {
  const res = await fetch(`${API_BASE}/register`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ name, email, password }),
  });
  
  if (!res.ok) {
    const error = await res.json();
    throw new Error(error.detail || "Registration failed");
  }
  
  return await res.json();
}

// ─────────────────────────────────────────────────────────────────────────────
// Document APIs
// ─────────────────────────────────────────────────────────────────────────────

/**
 * Upload a document (optionally assign to session)
 */
export async function uploadDocument(file: File, sessionId?: string): Promise<any> {
  const formData = new FormData();
  formData.append("file", file);
  
  const url = sessionId 
    ? `${API_BASE}/documents/upload?session_id=${sessionId}`
    : `${API_BASE}/documents/upload`;
  
  const res = await fetch(url, {
    method: "POST",
    headers: {
      Authorization: `Bearer ${getToken()}`,
    },
    body: formData,
  });
  
  if (!res.ok) {
    const error = await res.json();
    throw new Error(error.detail || "Upload failed");
  }
  
  return await res.json();
}

/**
 * Add URL as document
 */
export async function addUrlDocument(
  url: string,
  sessionId?: string,
  maxPages: number = 1
): Promise<any> {
  const endpoint = sessionId
    ? `${API_BASE}/documents/url?session_id=${sessionId}`
    : `${API_BASE}/documents/url`;
  
  const res = await fetch(endpoint, {
    method: "POST",
    headers: getHeaders(),
    body: JSON.stringify({ url, max_pages: maxPages }),
  });
  
  if (!res.ok) {
    const error = await res.json();
    throw new Error(error.detail || "Failed to add URL");
  }
  
  return await res.json();
}
export async function createSession(title: string = "New chat"): Promise<{ session_id: string }> {
  const res = await fetch(`${API_BASE}/sessions/create`, {
    method: "POST",
    headers: getHeaders(),
  });

  if (!res.ok) {
    const error = await res.json();
    throw new Error(error.detail || "Failed to create session");
  }

  return await res.json();
}
/**
 * Assign multiple documents to a session (when starting chat)
 */
export async function assignDocumentsToSession(
  docIds: string[],
  sessionId: string
): Promise<any> {
  const res = await fetch(`${API_BASE}/documents/assign-session`, {
    method: "POST",
    headers: getHeaders(),
    body: JSON.stringify({
      doc_ids: docIds,
      session_id: sessionId,
    }),
  });
  console.log("Token:", localStorage.getItem("token"));
  
  if (!res.ok) {
    const error = await res.json();
    throw new Error(error.detail || "Failed to assign documents");
  }
  
  return await res.json();
}

/**
 * Get all user documents (optionally filtered by session)
 */
export async function getDocuments(sessionId?: string): Promise<any> {
  const url = sessionId
    ? `${API_BASE}/documents?session_id=${sessionId}`
    : `${API_BASE}/documents`;
  
  const res = await fetch(url, {
    headers: getHeaders(),
  });
  
  if (!res.ok) {
    throw new Error("Failed to fetch documents");
  }
  
  return await res.json();
}

/**
 * Get documents for specific session
 */
export async function getSessionDocuments(sessionId: string): Promise<any> {
  const res = await fetch(`${API_BASE}/sessions/${sessionId}/documents`, { headers: getHeaders() });
  if (!res.ok) throw new Error("Failed to fetch session documents");
  return await res.json();
  
  if (!res.ok) {
    throw new Error("Failed to fetch session documents");
  }
  
  return await res.json();
}

/**
 * Delete a document
 */
export async function deleteDocument(docId: string): Promise<any> {
  const res = await fetch(`${API_BASE}/documents/${docId}`, {
    method: "DELETE",
    headers: getHeaders(),
  });
  
  if (!res.ok) {
    throw new Error("Failed to delete document");
  }
  
  return await res.json();
}

/**
 * Delete a session
 */
export async function deleteSession(sessionId: string): Promise<any> {
  const res = await fetch(`${API_BASE}/sessions/${sessionId}`, {
    method: "DELETE",
    headers: getHeaders(),
  });

  if (!res.ok) {
    throw new Error("Failed to delete session");
  }

  return await res.json();
}


// ─────────────────────────────────────────────────────────────────────────────
// Chat/RAG APIs
// ─────────────────────────────────────────────────────────────────────────────

/**
 * Send a chat message and get RAG response
 */
export async function sendMessage(
  sessionId: string,
  message: string,
  docIds: string[]
): Promise<any> {
  const res = await fetch(`${API_BASE}/chat`, {
    method: "POST",
    headers: getHeaders(),
    body: JSON.stringify({
      session_id: sessionId,
      message,
      doc_ids: docIds,
    }),
  });
  
  if (!res.ok) {
    const error = await res.json();
    throw new Error(error.detail || "Chat failed");
  }
  
  return await res.json();
}

/**
 * Send message with streaming response
 */
export async function* sendMessageStream(
  sessionId: string,
  message: string,
  docIds: string[]
): AsyncGenerator<string, void, unknown> {
  const res = await fetch(`${API_BASE}/chat/stream`, {
    method: "POST",
    headers: getHeaders(),
    body: JSON.stringify({
      session_id: sessionId,
      message,
      doc_ids: docIds,
    }),
  });
  
  if (!res.ok) {
    throw new Error("Streaming failed");
  }
  
  const reader = res.body?.getReader();
  const decoder = new TextDecoder();
  
  if (!reader) return;
  
  while (true) {
    const { done, value } = await reader.read();
    if (done) break;
    
    const chunk = decoder.decode(value);
    const lines = chunk.split("\n");
    
    for (const line of lines) {
      if (line.startsWith("data: ")) {
        const data = line.slice(6);
        if (data === "[DONE]") return;
        
        try {
          const parsed = JSON.parse(data);
          yield parsed.content || "";
        } catch {
          // Skip invalid JSON
        }
      }
    }
  }
}

// ─────────────────────────────────────────────────────────────────────────────
// Usage Examples
// ─────────────────────────────────────────────────────────────────────────────

/**
 * Example: Upload Flow (Upload Page → Start Chat)
 */
export async function exampleUploadFlow() {
  // 1. User uploads documents on Upload Page
  const file1 = new File(["content"], "doc1.pdf");
  const file2 = new File(["content"], "doc2.txt");
  
  const doc1 = await uploadDocument(file1); // No session_id yet
  const doc2 = await uploadDocument(file2);
  
  console.log("Uploaded:", doc1.document.id, doc2.document.id);
  
  // 2. User clicks "Start Conversation"
  const session = await createSession("New chat");
  const sessionId = session.session_id;  
  // Assign documents to the new session
  await assignDocumentsToSession(
    [doc1.document.id, doc2.document.id],
    sessionId
  );
  
  console.log("Session created:", sessionId);
  
  // 3. Navigate to Chat Page with sessionId
  return sessionId;
}

/**
 * Example: Chat Flow
 */
export async function exampleChatFlow(sessionId: string) {
  // 1. Get session documents
  const { documents } = await getSessionDocuments(sessionId);
  const docIds = documents.map((d: any) => d.id);
  
  console.log("Session has", docIds.length, "documents");
  
  // 2. Send message
  const response = await sendMessage(
    sessionId,
    "What is this document about?",
    docIds
  );
  
  console.log("Response:", response);
  
  // OR use streaming
  for await (const chunk of sendMessageStream(
    sessionId,
    "Summarize the key points",
    docIds
  )) {
    console.log("Chunk:", chunk);
  }
}

/**
 * Example: Add Document to Existing Chat
 */
export async function exampleAddDocumentToChat(
  sessionId: string,
  file: File
) {
  // Upload with session_id to immediately assign
  const doc = await uploadDocument(file, sessionId);
  
  console.log("Added document to session:", doc.document.id);
  
  return doc;
}

/**
 * Example: New Chat (return to Upload Page)
 */
export async function exampleNewChat() {
  // Clear pending documents state in frontend
  // User uploads new documents
  // Repeat upload flow
}

export async function getSessions(): Promise<any> {
  const res = await fetch(`${API_BASE}/sessions`, { headers: getHeaders() });
  if (!res.ok) throw new Error("Failed to fetch sessions");
  return await res.json();
}

export async function getSessionMessages(sessionId: string): Promise<any> {
  const res = await fetch(`${API_BASE}/sessions/${sessionId}/messages`, { headers: getHeaders() });
  if (!res.ok) throw new Error("Failed to fetch messages");
  return await res.json();
}


export async function cancelDocumentProcessing(docId: string): Promise<any> {
  const res = await fetch(`${API_BASE}/documents/cancel/${docId}`, {
    method: "POST",
    headers: getHeaders(),
  });
  if (!res.ok) throw new Error("Failed to cancel");
  return await res.json();
}

// admin API functions:

export async function getAdminStats(): Promise<any> {
  const res = await fetch(`${API_BASE}/admin/stats`, { headers: getAdminHeaders() });
  if (!res.ok) throw new Error("Failed to fetch stats");
  return await res.json();
}

export async function getAdminUsers(): Promise<any> {
  const res = await fetch(`${API_BASE}/admin/users`, { headers: getAdminHeaders() });
  if (!res.ok) throw new Error("Failed to fetch users");
  return await res.json();
}

export async function deleteAdminUser(userId: number): Promise<any> {
  const res = await fetch(`${API_BASE}/admin/users/${userId}`, {
    method: "DELETE", headers: getAdminHeaders()
  });
  if (!res.ok) throw new Error("Failed to delete user");
  return await res.json();
}

export async function getAdminDocuments(): Promise<any> {
  const res = await fetch(`${API_BASE}/admin/documents`, { headers: getAdminHeaders() });
  if (!res.ok) throw new Error("Failed to fetch documents");
  return await res.json();
}

export async function deleteAdminDocument(docId: string): Promise<any> {
  const res = await fetch(`${API_BASE}/admin/documents/${docId}`, {
    method: "DELETE", headers: getAdminHeaders()
  });
  if (!res.ok) throw new Error("Failed to delete document");
  return await res.json();
}

export async function adminLogin(email: string, password: string): Promise<any> {
  const res = await fetch(`${API_BASE}/admin/auth/login`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ email, password }),
  });
  if (!res.ok) {
    const error = await res.json().catch(() => ({}));
    throw new Error(error.detail || "Admin login failed");
  }
  return await res.json();
}

export async function getSystemHealth(): Promise<any> {
  const res = await fetch(`${API_BASE}/admin/system`, { headers: getAdminHeaders() });
  if (!res.ok) throw new Error("Failed to fetch system health");
  return await res.json();
}

export async function getAdminBilling(): Promise<any> {
  const res = await fetch(`${API_BASE}/admin/billing`, { headers: getAdminHeaders() });
  if (!res.ok) throw new Error("Failed to fetch billing data");
  return await res.json();
}

export async function getAdminBots(): Promise<any> {
  const res = await fetch(`${API_BASE}/admin/bots`, { headers: getAdminHeaders() });
  if (!res.ok) throw new Error("Failed to fetch bots");
  return await res.json();
}

export async function getAdminPreviewKey(botId: string): Promise<any> {
  const res = await fetch(`${API_BASE}/admin/bots/${botId}/preview-key`, {
    method: "POST",
    headers: getAdminHeaders(),
  });
  if (!res.ok) {
    const error = await res.json().catch(() => ({}));
    throw new Error(error.detail || "Failed to create preview key");
  }
  return await res.json();
}

export async function getAdminFeedback(): Promise<any> {
  const res = await fetch(`${API_BASE}/admin/feedback`, { headers: getAdminHeaders() });
  if (!res.ok) throw new Error("Failed to fetch admin feedback");
  return await res.json();
}

export async function getAdvancedAnalytics(botId: string): Promise<any> {
  const res = await fetch(`${API_BASE}/widgets/bots/${botId}/analytics/advanced`, {
    headers: getClientHeaders(),
  });
  if (!res.ok) throw new Error("Failed to fetch analytics");
  return await res.json();
}

export async function getTickets(): Promise<any> {
  const res = await fetch(`${API_BASE}/widgets/tickets`, {
    headers: getHeaders(),
  });
  if (!res.ok) throw new Error("Failed to fetch tickets");
  return await res.json();
}

export async function respondToTicket(ticketId: string, answer: string): Promise<any> {
  const res = await fetch(`${API_BASE}/widgets/tickets/${ticketId}/respond`, {
    method: "POST",
    headers: getHeaders(),
    body: JSON.stringify({ answer }),
  });
  if (!res.ok) throw new Error("Failed to respond to ticket");
  return await res.json();
}

export async function deleteBot(botId: string): Promise<any> {
  const res = await fetch(`${API_BASE}/admin/bots/${botId}`, {
    method: "DELETE",
    headers: getAdminHeaders(),
  });
  if (!res.ok) throw new Error("Failed to delete bot");
  return await res.json();
}