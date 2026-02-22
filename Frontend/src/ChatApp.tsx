import { useState } from "react";

import './style.css'
import AuthPage from './AuthPage.tsx'
import ChatPage from './ChatPage.tsx'
import Sidebar from './Sidebar.tsx'
import UploadPage from './UploadPage.tsx'

import { Session, Doc, Message, UploadPageProps } from './types.tsx';

const DOCS: Doc[] = [];
const INITIAL_MSGS: Message[] = [];

export default function App() {
  const storedUser = localStorage.getItem("user");
  const parsedUser = storedUser ? JSON.parse(storedUser) : null;

  const [authed, setAuthed] = useState<boolean>(!!localStorage.getItem("token"));
  const [userName, setUserName] = useState<string>(parsedUser?.name || "");
  const [page, setPage] = useState<string>("chat");
  const [activeSession, setActiveSession] = useState<number>(1);
  const [docs, setDocs] = useState<Doc[]>(DOCS);
  const [sessions, setSessions] = useState<Session[]>([]);
  const [sidebarOpen, setSidebarOpen] = useState<boolean>(false);
  const [sessionMessages, setSessionMessages] = useState<Record<number, Message[]>>({ 1: INITIAL_MSGS });

  const toggleSidebar = (): void => setSidebarOpen((o) => !o);
  const closeSidebar = (): void => setSidebarOpen(false);

  const handleLogin = (name: string): void => {
    setUserName(name);
    setAuthed(true);
  };

  const handleLogout = (): void => {
    localStorage.removeItem("token");
    localStorage.removeItem("user");
    setAuthed(false);
    setUserName("");
    setSessions([]);
    setSessionMessages({ 1: [] });
  };

  const handleNewChat = (): void => {
    const newId = Date.now();
    setSessions((s) => [{ id: newId, title: "New chat", time: "just now" }, ...s]);
    setSessionMessages((m) => ({ ...m, [newId]: [] }));
    setActiveSession(newId);
    setPage("chat");
    closeSidebar();
  };

  const handleSessionMessages = (sessionId: number, msgs: Message[]): void => {
    const firstUserMsg = msgs.find((m) => m.role === "user");
    if (firstUserMsg) {
      setSessions((s) =>
        s.map((sess) =>
          sess.id === sessionId ? { ...sess, title: firstUserMsg.content.slice(0, 40) } : sess
        )
      );
    }
    setSessionMessages((m) => ({ ...m, [sessionId]: msgs }));
  };

  const handleSetActiveSession = (id: number): void => {
    setActiveSession(id);
    closeSidebar();
  };

  return (
    <>
      {!authed ? (
        <AuthPage onLogin={handleLogin} />
      ) : (
        <div className="app-layout">
          <div className={`sidebar-overlay${sidebarOpen ? " open" : ""}`} onClick={closeSidebar} />
          <div className={`sidebar${sidebarOpen ? " open" : ""}`}>
            <Sidebar
              page={page}
              setPage={setPage}
              sessions={sessions}
              activeSession={activeSession}
              setActiveSession={handleSetActiveSession}
              onNewChat={handleNewChat}
              userName={userName}
              onLogout={handleLogout}
            />
          </div>
          <div className="main-content">
            {page === "chat" ? (
              <ChatPage
                key={activeSession}
                docs={docs}
                messages={sessionMessages[activeSession] || []}
                setMessages={(msgs) => handleSessionMessages(activeSession, msgs)}
                onToggleSidebar={toggleSidebar}
              />
            ) : (
              <UploadPage
                docs={docs}
                setDocs={setDocs as UploadPageProps["setDocs"]}
                onToggleSidebar={toggleSidebar}
              />
            )}
          </div>
        </div>
      )}
    </>
  );
}