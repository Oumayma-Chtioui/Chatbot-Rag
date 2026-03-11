import { useState, ChangeEvent, DragEvent, KeyboardEvent } from "react";
import { Doc } from './types.tsx';
import * as api from "./api";


import { uploadDocument } from "./api";
import './style.css'
interface UploadPageProps {
  docs: Doc[];
  setDocs: React.Dispatch<React.SetStateAction<Doc[]>>;
  onToggleSidebar: () => void;
  onStartChat: () => void;
}

function UploadPage({ docs, setDocs, onToggleSidebar, onStartChat }: UploadPageProps) {
  const [uploadType, setUploadType] = useState<Doc["type"]>("pdf");
  const [url, setUrl] = useState<string>("");
  const [dragging, setDragging] = useState<boolean>(false);
  const [uploading, setUploading] = useState<boolean>(false);

  // const handleAddUrl = async (): Promise<void> => {
  //   if (!url.trim() || uploading) return;
    
  //   setUploading(true);
  //   const tempId = Date.now();
  //   const newDoc: Doc = { 
  //     id: tempId, 
  //     name: url, 
  //     type: "url", 
  //     size: "Web page", 
  //     status: "processing" 
  //   };
    
  //   setDocs((d: Doc[]) => [...d, newDoc]);
  //   const capturedUrl = url;
  //   setUrl("");

  //   try {
  //     const token = localStorage.getItem('token');
  //     if (!token) throw new Error('No token');

  //     const response = await fetch('http://localhost:8000/documents/url', {
  //       method: 'POST',
  //       headers: {
  //         'Content-Type': 'application/json',
  //         'Authorization': `Bearer ${token}`
  //       },
  //       body: JSON.stringify({ url: capturedUrl })
  //     });

  //     if (!response.ok) throw new Error('Upload failed');

  //     const data = await response.json();
  //     console.log('✅ URL uploaded:', data);

  //     setDocs((d: Doc[]) => 
  //       d.map((doc: Doc) => 
  //         doc.id === tempId ? { ...doc, status: "ready" } : doc
  //       )
  //     );
  //   } catch (error) {
  //     console.error('❌ URL upload error:', error);
  //     setDocs((d: Doc[]) => d.filter((doc: Doc) => doc.id !== tempId));
  //     alert('Failed to add URL. Please try again.');
  //   } finally {
  //     setUploading(false);
  //   }
  // };

   const handleDelete = (id: string): void => {
     setDocs((d: Doc[]) => d.filter((doc: Doc) => doc.id !== id));
   };

  const handleFileDrop = async (file: File) => {
  try {
    const result = await uploadDocument(file);
    
    const newDoc: Doc = {
      id: result.document.id,
      name: result.document.name,
      type: "pdf",
      size: `${(file.size / 1024).toFixed(0)} KB`,
      status: "ready",
    };

    setDocs((d) => [...d, newDoc]);
  } catch (err: any) {
    console.error(err.message);
  }
};

  const typeIcons: Record<Doc["type"], string> = { 
    pdf: "📄", 
    url: "🔗", 
    image: "🖼️" 
  };

  const uploadTypes = [
    { key: "pdf" as Doc["type"], icon: "📄", title: "PDF / Document", sub: ".pdf, .txt, .docx, .md" },
    { key: "url" as Doc["type"], icon: "🔗", title: "Web URL", sub: "Any public webpage or article" },
    { key: "image" as Doc["type"], icon: "🖼️", title: "Image", sub: ".png, .jpg, .webp, screenshots" },
  ];

  const allDocsReady = docs.length > 0 && docs.every(doc => doc.status === "ready");

  return (
    <>
      <div className="topbar">
        <button className="hamburger" onClick={onToggleSidebar}>☰</button>
        <div className="topbar-title">Upload Documents</div>
        <div className="topbar-actions">
          <span style={{ fontSize: 12, color: "var(--text3)" }}>
            {docs.length} document{docs.length !== 1 ? "s" : ""}
          </span>
        </div>
      </div>

      <div className="upload-page">
        <div className="page-header">
          <div className="page-title">Load your knowledge</div>
          <div className="page-sub">
            Upload documents, paste URLs, or drop images to build your AI's context
          </div>
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
              //onKeyDown={(e: KeyboardEvent<HTMLInputElement>) => e.key === "Enter" && handleAddUrl()}
              disabled={uploading}
            />
            <button 
              className="url-btn" 
              //onClick={handleAddUrl}
              disabled={uploading || !url.trim()}
            >
              {uploading ? 'Uploading...' : 'Load URL'}
            </button>
          </div>
        ) : (
          <div
            className={`drop-zone ${dragging ? "dragging" : ""} ${uploading ? 'uploading' : ''}`}
            onDragOver={(e: DragEvent<HTMLDivElement>) => { 
              e.preventDefault(); 
              setDragging(true); 
            }}
            onDragLeave={() => setDragging(false)}
            onDrop={(e: DragEvent<HTMLDivElement>) => {
              e.preventDefault();
              setDragging(false);
              const file = e.dataTransfer.files[0];
              if (file && !uploading) handleFileDrop(file);
            }}
          >
            <div className="drop-zone-icon">
              {uploadType === "image" ? "🖼️" : "📄"}
            </div>
            <div className="drop-zone-title">
              {uploading ? 'Uploading...' : `Drop your ${uploadType === "image" ? "image" : "document"} here`}
            </div>
            <div className="drop-zone-sub">or click to browse · Max 50MB</div>
            <label style={{ cursor: uploading ? 'not-allowed' : 'pointer' }}>
              <input
                type="file"
                style={{ display: "none" }}
                accept={uploadType === "image" ? "image/*" : ".pdf,.txt,.docx,.md"}
                onChange={(e: ChangeEvent<HTMLInputElement>) => {
                  const file = e.target.files?.[0];
                  if (file && !uploading) handleFileDrop(file);
                }}
                disabled={uploading}
              />
              <span className="btn-outline">📂 Browse files</span>
            </label>
          </div>
        )}

        {docs.length > 0 && (
          <div className="loaded-docs animate-in">
            <div className="loaded-docs-header">
              <span>Loaded documents ({docs.length})</span>
              {allDocsReady ? (
                <span style={{ fontSize: 11, color: "var(--accent)" }}>✓ All ready</span>
              ) : (
                <span style={{ fontSize: 11, color: "var(--text3)" }}>Processing...</span>
              )}
            </div>
            {docs.map((doc: Doc) => (
              <div key={doc.id} className="doc-row">
                <div className="doc-icon">{typeIcons[doc.type]}</div>
                <div className="doc-info">
                  <div className="doc-name">{doc.name}</div>
                  <div className="doc-meta">{doc.size} · {doc.type.toUpperCase()}</div>
                </div>
                <div className={`doc-status ${doc.status}`}>
                  {doc.status === "ready" ? "✓ Ready" : "⟳ Processing"}
                </div>
                <button 
                  className="doc-delete" 
                  onClick={() => handleDelete(doc.id)}
                  disabled={uploading}
                >
                  ✕
                </button>
              </div>
            ))}
          </div>
        )}

        {/* Start Chat Button */}
        {docs.length > 0 && (
          <div style={{ 
            display: 'flex', 
            justifyContent: 'center', 
            marginTop: '24px',
            paddingBottom: '24px'
          }}>
            <button 
              className="btn-primary" 
              onClick={onStartChat}
              disabled={!allDocsReady || uploading}
              style={{
                padding: '12px 32px',
                fontSize: '15px',
                fontWeight: 600,
                opacity: (allDocsReady && !uploading) ? 1 : 0.5,
                cursor: (allDocsReady && !uploading) ? 'pointer' : 'not-allowed'
              }}
            >
              {uploading ? '⟳ Uploading...' : allDocsReady ? '💬 Start Conversation' : '⟳ Processing documents...'}
            </button>
          </div>
        )}
      </div>
    </>
  );
}

export default UploadPage;