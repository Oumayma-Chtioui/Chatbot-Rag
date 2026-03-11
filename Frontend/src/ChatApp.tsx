import { useState } from "react";

import './style.css'
import AuthPage from './AuthPage.tsx'
import ChatPage from './ChatPage.tsx'
import Sidebar from './Sidebar.tsx'
import UploadPage from './UploadPage.tsx'

import * as api from './api'; 

import { Session, Doc, Message } from './types.tsx';

export default function App() {
  const storedUser = localStorage.getItem("user");
  const parsedUser = storedUser ? JSON.parse(storedUser) : null;

  const [authed, setAuthed] = useState<boolean>(!!localStorage.getItem("token"));
  const [userName, setUserName] = useState<string>(parsedUser?.name || "");
  
  // View state: 'upload' or 'chat'
  const [view, setView] = useState<'upload' | 'chat'>('upload');
  
  // Active session and its documents
  const [activeSessionId, setActiveSessionId] = useState<string | null>(null);  
  // All sessions with their own documents and messages
  const [sessions, setSessions] = useState<Session[]>([]);
  
  // Documents being prepared in upload view (temporary state)
  const [pendingDocs, setPendingDocs] = useState<Doc[]>([]);
  
  const [sidebarOpen, setSidebarOpen] = useState<boolean>(false);

  const [pendingSessionId, setPendingSessionId] = useState<string | null>(null);

  
  const toggleSidebar = (): void => setSidebarOpen((o) => !o);
  const closeSidebar = (): void => setSidebarOpen(false);

  const initNewSession = async () => {
    const { session_id } = await api.createSession();
    setPendingSessionId(session_id);
  };

  const handleLogin = (name: string): void => {
    setUserName(name);
    setAuthed(true);
    setView('upload'); // Start at upload page after login
    initNewSession();
  };

  const handleLogout = (): void => {
    localStorage.removeItem("token");
    localStorage.removeItem("user");
    setAuthed(false);
    setUserName("");
    setSessions([]);
    setActiveSessionId(null);
    setPendingDocs([]);
    setView('upload');
  };

  // Start a new chat from upload page
  const handleStartChat = async (): Promise<void> => {
  if (pendingDocs.length === 0) {
    alert("Please upload at least one document before starting a chat.");
    return;
  }
  
  try {
    const sessionResponse = await api.createSession("New chat");
    const sessionId = sessionResponse.id;

    // Extract document IDs (they must come from backend upload)
    const docIds = pendingDocs.map((doc) => doc.id);

    console.log("Doc IDs:", docIds);
    console.log("Session ID:", sessionId);
    // 🔥 Tell backend to assign documents to this session
    await api.assignDocumentsToSession(docIds, sessionId);
    
    const newSession: Session = {
      id: sessionId,
      title: "New conversation",
      time: "just now",
      docs: [...pendingDocs],
      messages: []
    };

    setSessions((prev) => [newSession, ...prev]);
    setActiveSessionId(sessionId);
    setPendingDocs([]);
    setPendingSessionId(null);
    setView("chat");
    closeSidebar();

  } catch (err: any) {
    console.error("Start chat error:", err.message);
    alert("Failed to start chat session.");
  }
};
  // New chat button - go back to upload page
  const handleNewChat = (): void => {
    setPendingDocs([]); // Clear any pending docs
    setActiveSessionId(null); // No active session
    setView('upload'); // Go to upload view
    closeSidebar();
    initNewSession();
  };

  // Switch to existing chat session
  const handleSelectSession = (id: string): void => {
    setActiveSessionId(id);
    setView('chat');
    closeSidebar();
  };

  // Update messages for active session
  const handleUpdateMessages = (messages: Message[]): void => {
    if (!activeSessionId) return;

    setSessions((prev) =>
      prev.map((session) => {
        if (session.id === activeSessionId) {
          // Update title based on first user message
          const firstUserMsg = messages.find((m) => m.role === "user");
          const newTitle = firstUserMsg 
            ? firstUserMsg.content.slice(0, 40) + (firstUserMsg.content.length > 40 ? "..." : "")
            : session.title;

          return {
            ...session,
            messages,
            title: newTitle
          };
        }
        return session;
      })
    );
  };

  // Add more documents to current chat session
  const handleAddDocsToSession = (newDocs: Doc[]): void => {
    if (!activeSessionId) return;

    setSessions((prev) =>
      prev.map((session) =>
        session.id === activeSessionId
          ? { ...session, docs: [...session.docs, ...newDocs] }
          : session
      )
    );
  };

  // Get current session data
  const activeSession = sessions.find((s) => s.id === activeSessionId);

  return (
    <>
      {!authed ? (
        <AuthPage onLogin={handleLogin} />
      ) : (
        <div className="app-layout">
          <div className={`sidebar-overlay${sidebarOpen ? " open" : ""}`} onClick={closeSidebar} />
          <div className={`sidebar${sidebarOpen ? " open" : ""}`}>
            <Sidebar
              page={view === 'chat' ? 'chat' : 'upload'}
              setPage={(page) => {
                if (page === 'upload') {
                  handleNewChat();
                }
              }}
              sessions={sessions}
              activeSession={activeSessionId}
              setActiveSession={handleSelectSession}
              onNewChat={handleNewChat}
              userName={userName}
              onLogout={handleLogout}
            />
          </div>
          <div className="main-content">
            {view === 'upload' ? (
              <UploadPage
                docs={pendingDocs}
                setDocs={setPendingDocs}
                onToggleSidebar={toggleSidebar}
                onStartChat={handleStartChat}
                sessionId={pendingSessionId ?? ""}
              />
            ) : activeSession ? (
              <ChatPage
                key={activeSessionId}
                sessionId={activeSessionId!}
                docs={activeSession.docs}
                messages={activeSession.messages}
                setMessages={handleUpdateMessages}
                onToggleSidebar={toggleSidebar}
                onAddDocs={handleAddDocsToSession}
              />
            ) : (
              <div style={{ 
                display: 'flex', 
                alignItems: 'center', 
                justifyContent: 'center', 
                height: '100vh',
                color: 'var(--text3)'
              }}>
                No active session
              </div>
            )}
          </div>
        </div>
      )}
    </>
  );
}