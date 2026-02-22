import { useState, useRef, useEffect, ChangeEvent, DragEvent, KeyboardEvent } from "react";
import { Session, Doc, Message, AuthPageProps, SidebarProps, ChatPageProps, UploadPageProps } from './types.tsx';  // Import interfaces
function UploadPage({ docs, setDocs }: UploadPageProps) {
  const [uploadType, setUploadType] = useState<Doc["type"]>("pdf");
  const [url, setUrl] = useState<string>("");
  const [dragging, setDragging] = useState<boolean>(false);

  const handleAddUrl = (): void => {
    if (!url.trim()) return;
    const newDoc: Doc = { id: Date.now(), name: url, type: "url", size: "Web page", status: "processing" };
    setDocs((d: Doc[]) => [...d, newDoc]);
    const capturedUrl = url;
    setUrl("");
    setTimeout(() => {
      setDocs((d: Doc[]) => d.map((doc: Doc) => doc.name === capturedUrl ? { ...doc, status: "ready" } : doc));
    }, 2000);
  };

  const handleDelete = (id: number): void => {
    setDocs((d: Doc[]) => d.filter((doc: Doc) => doc.id !== id));
  };

  const handleFileDrop = (file: File): void => {
    const newDoc: Doc = {
      id: Date.now(),
      name: file.name,
      type: uploadType,
      size: `${(file.size / 1024).toFixed(0)} KB`,
      status: "ready",
    };
    setDocs((d: Doc[]) => [...d, newDoc]);
  };

  const typeIcons: Record<Doc["type"], string> = { pdf: "📄", url: "🔗", image: "🖼️" };

  const uploadTypes = [
    { key: "pdf" as Doc["type"], icon: "📄", title: "PDF / Document", sub: ".pdf, .txt, .docx, .md" },
    { key: "url" as Doc["type"], icon: "🔗", title: "Web URL", sub: "Any public webpage or article" },
    { key: "image" as Doc["type"], icon: "🖼️", title: "Image", sub: ".png, .jpg, .webp, screenshots" },
  ];

  return (
    <>
      <div className="topbar">
        <div className="topbar-title">Documents</div>
        <div className="topbar-actions">
          <span style={{ fontSize: 12, color: "var(--text3)" }}>{docs.length} loaded</span>
        </div>
      </div>

      <div className="upload-page">
        <div className="page-header">
          <div className="page-title">Load your knowledge</div>
          <div className="page-sub">Upload documents, paste URLs, or drop images to build your AI's context</div>
        </div>

        <div className="upload-grid">
          {uploadTypes.map((t) => (
            <div
              key={t.key}
              className={`upload-card ${uploadType === t.key ? "active" : ""}`}
              onClick={() => setUploadType(t.key)}
            >
              <span className="upload-card-icon">{t.icon}</span>
              <div className="upload-card-title">{t.title}</div>
              <div className="upload-card-sub">{t.sub}</div>
            </div>
          ))}
        </div>

        {uploadType === "url" ? (
          <div className="url-input-row">
            <input
              className="form-input"
              placeholder="https://example.com/article"
              value={url}
              onChange={(e: ChangeEvent<HTMLInputElement>) => setUrl(e.target.value)}
              onKeyDown={(e: KeyboardEvent<HTMLInputElement>) => e.key === "Enter" && handleAddUrl()}
            />
            <button className="url-btn" onClick={handleAddUrl}>Load URL</button>
          </div>
        ) : (
          <div
            className={`drop-zone ${dragging ? "dragging" : ""}`}
            onDragOver={(e: DragEvent<HTMLDivElement>) => { e.preventDefault(); setDragging(true); }}
            onDragLeave={() => setDragging(false)}
            onDrop={(e: DragEvent<HTMLDivElement>) => {
              e.preventDefault();
              setDragging(false);
              const file = e.dataTransfer.files[0];
              if (file) handleFileDrop(file);
            }}
          >
            <div className="drop-zone-icon">{uploadType === "image" ? "🖼️" : "📄"}</div>
            <div className="drop-zone-title">Drop your {uploadType === "image" ? "image" : "document"} here</div>
            <div className="drop-zone-sub">or click to browse · Max 50MB</div>
            <label style={{ cursor: "pointer" }}>
              <input
                type="file"
                style={{ display: "none" }}
                accept={uploadType === "image" ? "image/*" : ".pdf,.txt,.docx,.md"}
                onChange={(e: ChangeEvent<HTMLInputElement>) => {
                  const file = e.target.files?.[0];
                  if (file) handleFileDrop(file);
                }}
              />
              <span className="btn-outline">📂 Browse files</span>
            </label>
          </div>
        )}

        {docs.length > 0 && (
          <div className="loaded-docs animate-in">
            <div className="loaded-docs-header">
              <span>Loaded context ({docs.length})</span>
              <span style={{ fontSize: 11, color: "var(--accent)" }}>Ready for chat</span>
            </div>
            {docs.map((doc: Doc) => (
              <div key={doc.id} className="doc-row">
                <div className="doc-icon">{typeIcons[doc.type]}</div>
                <div className="doc-info">
                  <div className="doc-name">{doc.name}</div>
                  <div className="doc-meta">{doc.size} · {doc.type.toUpperCase()}</div>
                </div>
                <div className={`doc-status ${doc.status}`}>{doc.status === "ready" ? "✓ Ready" : "⟳ Processing"}</div>
                <button className="doc-delete" onClick={() => handleDelete(doc.id)}>✕</button>
              </div>
            ))}
          </div>
        )}
      </div>
    </>
  );

}
export default UploadPage;
