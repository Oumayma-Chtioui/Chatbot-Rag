#!/usr/bin/env python3
"""
FAISS Database Inspector - Updated for Per-Session Structure
Inspect, query, and manage your per-user/per-session FAISS vector stores
"""

import os
import sys
from pathlib import Path
from typing import List, Optional
import json
from langchain_community.vectorstores import FAISS
from langchain_community.embeddings import HuggingFaceEmbeddings

# Configuration
BACKEND_DIR = Path(__file__).parent.absolute()
VECTOR_BASE_PATH = os.path.join(BACKEND_DIR, "vector_store")

def discover_vector_stores():
    """Discover all user/session vector stores"""
    stores = []
    
    if not os.path.exists(VECTOR_BASE_PATH):
        print(f"❌ Vector store base path not found: {VECTOR_BASE_PATH}")
        return stores
    
    print(f"📂 Scanning: {VECTOR_BASE_PATH}\n")
    
    # Walk through user directories
    for user_dir in os.listdir(VECTOR_BASE_PATH):
        user_path = os.path.join(VECTOR_BASE_PATH, user_dir)
        
        if not os.path.isdir(user_path) or not user_dir.startswith("user_"):
            continue
        
        user_id = user_dir.replace("user_", "")
        
        # Walk through session directories
        for session_dir in os.listdir(user_path):
            session_path = os.path.join(user_path, session_dir)
            
            if not os.path.isdir(session_path) or not session_dir.startswith("session_"):
                continue
            
            session_id = session_dir.replace("session_", "")
            
            # Check if FAISS index exists
            faiss_index = os.path.join(session_path, "index.faiss")
            faiss_pkl = os.path.join(session_path, "index.pkl")
            
            if os.path.exists(faiss_index) and os.path.exists(faiss_pkl):
                stores.append({
                    "user_id": user_id,
                    "session_id": session_id,
                    "path": session_path,
                    "faiss_size": os.path.getsize(faiss_index),
                    "pkl_size": os.path.getsize(faiss_pkl)
                })
    
    return stores

def list_all_stores():
    """List all available vector stores"""
    print("\n" + "="*60)
    print("📚 DISCOVERED VECTOR STORES")
    print("="*60 + "\n")
    
    stores = discover_vector_stores()
    
    if not stores:
        print("❌ No vector stores found!")
        print(f"\nSearched in: {VECTOR_BASE_PATH}")
        print("\nMake sure you've uploaded documents first.")
        return stores
    
    print(f"Found {len(stores)} vector store(s):\n")
    
    for i, store in enumerate(stores, 1):
        print(f"📦 Store #{i}")
        print(f"   User ID: {store['user_id']}")
        print(f"   Session ID: {store['session_id']}")
        print(f"   Path: {store['path']}")
        print(f"   FAISS size: {store['faiss_size'] / 1024:.2f} KB")
        print(f"   PKL size: {store['pkl_size'] / 1024:.2f} KB")
        print("-" * 40)
    
    return stores

def load_store(user_id: str, session_id: str):
    """Load a specific vector store"""
    vector_path = os.path.join(VECTOR_BASE_PATH, f"user_{user_id}", f"session_{session_id}")
    
    if not os.path.exists(os.path.join(vector_path, "index.faiss")):
        print(f"❌ FAISS database not found at: {vector_path}")
        return None
    
    print(f"📂 Loading FAISS database from: {vector_path}")
    
    # Initialize embeddings
    embeddings = HuggingFaceEmbeddings(
        model_name="BAAI/bge-base-en-v1.5",
        model_kwargs={'device': 'cpu'},
        encode_kwargs={'normalize_embeddings': True}
    )
    
    # Load FAISS
    db = FAISS.load_local(
        vector_path,
        embeddings,
        allow_dangerous_deserialization=True
    )
    
    print("✅ FAISS database loaded successfully")
    return db

def get_database_stats(db, user_id: str, session_id: str):
    """Get statistics about the FAISS database"""
    print("\n" + "="*60)
    print("📊 FAISS DATABASE STATISTICS")
    print("="*60)
    
    print(f"\n🆔 User ID: {user_id}")
    print(f"🔗 Session ID: {session_id}")
    
    # Get index stats
    index = db.index
    print(f"\n🔢 Total vectors: {index.ntotal}")
    print(f"📐 Vector dimension: {index.d}")
    
    # Get all documents
    try:
        docstore = db.docstore
        all_docs = list(docstore._dict.values())
        
        print(f"📄 Total documents: {len(all_docs)}")
        
        # Analyze metadata
        sources = set()
        doc_ids = set()
        upload_times = []
        
        for doc in all_docs:
            if hasattr(doc, 'metadata'):
                sources.add(doc.metadata.get('source', 'Unknown'))
                doc_id = doc.metadata.get('doc_id')
                if doc_id:
                    doc_ids.add(doc_id)
                upload_time = doc.metadata.get('upload_time')
                if upload_time:
                    upload_times.append(upload_time)
        
        print(f"\n📚 Unique sources: {len(sources)}")
        print(f"🆔 Unique document IDs: {len(doc_ids)}")
        
        # Show sources
        if sources:
            print("\n📋 Documents in this session:")
            for i, source in enumerate(sorted(sources), 1):
                print(f"   {i}. {source}")
        
        # Show upload times
        if upload_times:
            print(f"\n🕒 First upload: {min(upload_times)}")
            print(f"🕒 Last upload: {max(upload_times)}")
        
        return {
            "user_id": user_id,
            "session_id": session_id,
            "total_vectors": index.ntotal,
            "dimension": index.d,
            "total_documents": len(all_docs),
            "sources": list(sources),
            "doc_ids": list(doc_ids)
        }
        
    except Exception as e:
        print(f"⚠️ Could not access docstore: {e}")
        return {
            "total_vectors": index.ntotal,
            "dimension": index.d
        }

def search_documents(db, query: str, k: int = 5):
    """Search for similar documents"""
    print("\n" + "="*60)
    print(f"🔍 SEARCHING: '{query}'")
    print("="*60 + "\n")
    
    try:
        # Similarity search
        results = db.similarity_search_with_score(query, k=k)
        
        print(f"Found {len(results)} results:\n")
        
        for i, (doc, score) in enumerate(results, 1):
            print(f"📄 Result #{i} (Score: {score:.4f})")
            print(f"   Content: {doc.page_content[:200]}...")
            
            if hasattr(doc, 'metadata'):
                print(f"   Source: {doc.metadata.get('source', 'Unknown')}")
                print(f"   Doc ID: {doc.metadata.get('doc_id', 'N/A')}")
            print("-" * 40)
            print()
        
        return results
        
    except Exception as e:
        print(f"❌ Search error: {e}")
        return []

def interactive_query(db, user_id: str, session_id: str):
    """Interactive query mode"""
    print("\n" + "="*60)
    print("💬 INTERACTIVE QUERY MODE")
    print("="*60)
    print(f"\n🆔 User: {user_id} | Session: {session_id}")
    print("\nType your questions (or 'quit' to exit):\n")
    
    while True:
        try:
            query = input("🔍 Query: ").strip()
            
            if query.lower() in ['quit', 'exit', 'q']:
                print("👋 Goodbye!")
                break
            
            if not query:
                continue
            
            search_documents(db, query, k=3)
            
        except KeyboardInterrupt:
            print("\n👋 Goodbye!")
            break
        except Exception as e:
            print(f"❌ Error: {e}")

def export_store_to_json(db, user_id: str, session_id: str, output_file: str = None):
    """Export vector store to JSON"""
    if not output_file:
        output_file = f"faiss_export_user{user_id}_session{session_id}.json"
    
    print(f"\n💾 Exporting to {output_file}...")
    
    try:
        docstore = db.docstore
        all_docs = list(docstore._dict.values())
        
        export_data = {
            "user_id": user_id,
            "session_id": session_id,
            "total_documents": len(all_docs),
            "documents": []
        }
        
        for doc in all_docs:
            export_data["documents"].append({
                "content": doc.page_content,
                "metadata": doc.metadata if hasattr(doc, 'metadata') else {}
            })
        
        with open(output_file, 'w', encoding='utf-8') as f:
            json.dump(export_data, f, indent=2, ensure_ascii=False)
        
        print(f"✅ Exported {len(all_docs)} documents to {output_file}")
        
    except Exception as e:
        print(f"❌ Export error: {e}")


def delete_vector_store(user_id: str, session_id: str):
    """Delete a vector store permanently"""
    import shutil
    
    vector_path = os.path.join(VECTOR_BASE_PATH, f"user_{user_id}", f"session_{session_id}")
    
    if not os.path.exists(vector_path):
        print(f"❌ Vector store not found at: {vector_path}")
        return False
    
    print(f"\n⚠️  WARNING: You are about to DELETE:")
    print(f"   User ID: {user_id}")
    print(f"   Session ID: {session_id}")
    print(f"   Path: {vector_path}")
    print(f"\n❌ This action CANNOT be undone!")
    
    confirm = input("\nType 'DELETE' (all caps) to confirm: ").strip()
    
    if confirm != "DELETE":
        print("❌ Deletion cancelled")
        return False
    
    try:
        from services.rag_services import delete_session_vectors as rag_delete_vector_store
        if rag_delete_vector_store(user_id, session_id):
            print(f"✅ Successfully deleted vector store")
        
        # Check if user directory is now empty
        user_path = os.path.join(VECTOR_BASE_PATH, f"user_{user_id}")
        if os.path.exists(user_path) and not os.listdir(user_path):
            print(f"🗑️  Removing empty user directory: {user_path}")
            os.rmdir(user_path)
        
        return True
        
    except Exception as e:
        print(f"❌ Failed to delete: {e}")
        return False

def main():
    """Main CLI interface"""
    print("\n" + "="*60)
    print("🔧 FAISS DATABASE INSPECTOR (Per-Session)")
    print("="*60)
    
    # Discover all stores
    stores = list_all_stores()
    
    if not stores:
        return
    
    # Interactive menu
    while True:
        print("\n" + "="*60)
        print("📋 MAIN MENU")
        print("="*60)
        print("\n1. View all stores")
        print("2. Inspect a specific store")
        print("3. Search in a store")
        print("4. Interactive query mode")
        print("5. Export store to JSON")
        print("6. Delete a vector store")
        print("7. Exit")
        
        choice = input("\nSelect option (1-7): ").strip()
        
        if choice == "1":
            stores = list_all_stores()
        
        elif choice == "2":
            # Select store
            if len(stores) == 1:
                store = stores[0]
            else:
                print("\nSelect a store:")
                for i, s in enumerate(stores, 1):
                    print(f"{i}. User {s['user_id']} - Session {s['session_id']}")
                
                idx = input("\nEnter number: ").strip()
                try:
                    store = stores[int(idx) - 1]
                except:
                    print("❌ Invalid selection")
                    continue
            
            db = load_store(store['user_id'], store['session_id'])
            if db:
                get_database_stats(db, store['user_id'], store['session_id'])
        
        elif choice == "3":
            # Search
            if len(stores) == 1:
                store = stores[0]
            else:
                print("\nSelect a store:")
                for i, s in enumerate(stores, 1):
                    print(f"{i}. User {s['user_id']} - Session {s['session_id']}")
                
                idx = input("\nEnter number: ").strip()
                try:
                    store = stores[int(idx) - 1]
                except:
                    print("❌ Invalid selection")
                    continue
            
            db = load_store(store['user_id'], store['session_id'])
            if db:
                query = input("Enter search query: ").strip()
                if query:
                    search_documents(db, query)
        
        elif choice == "4":
            # Interactive query
            if len(stores) == 1:
                store = stores[0]
            else:
                print("\nSelect a store:")
                for i, s in enumerate(stores, 1):
                    print(f"{i}. User {s['user_id']} - Session {s['session_id']}")
                
                idx = input("\nEnter number: ").strip()
                try:
                    store = stores[int(idx) - 1]
                except:
                    print("❌ Invalid selection")
                    continue
            
            db = load_store(store['user_id'], store['session_id'])
            if db:
                interactive_query(db, store['user_id'], store['session_id'])
        
        elif choice == "5":
            # Export
            if len(stores) == 1:
                store = stores[0]
            else:
                print("\nSelect a store:")
                for i, s in enumerate(stores, 1):
                    print(f"{i}. User {s['user_id']} - Session {s['session_id']}")
                
                idx = input("\nEnter number: ").strip()
                try:
                    store = stores[int(idx) - 1]
                except:
                    print("❌ Invalid selection")
                    continue
            
            db = load_store(store['user_id'], store['session_id'])
            if db:
                output = input("Enter output filename (or press Enter for default): ").strip()
                export_store_to_json(db, store['user_id'], store['session_id'], output or None)
        
        elif choice == "6":
            # Delete
            if len(stores) == 1:
                store = stores[0]
            else:
                print("\nSelect a store to DELETE:")
                for i, s in enumerate(stores, 1):
                    print(f"{i}. User {s['user_id']} - Session {s['session_id'][:30]}...")
                
                idx = input("\nEnter number: ").strip()
                try:
                    store = stores[int(idx) - 1]
                except:
                    print("❌ Invalid selection")
                    continue
            
            if delete_vector_store(store['user_id'], store['session_id']):
                # Refresh store list after deletion
                stores = discover_vector_stores()
                if not stores:
                    print("\n✅ All stores deleted. Exiting...")
                    break
        
        elif choice == "7":
            print("👋 Goodbye!")
            break
        
        else:
            print("❌ Invalid option")

if __name__ == "__main__":
    main()