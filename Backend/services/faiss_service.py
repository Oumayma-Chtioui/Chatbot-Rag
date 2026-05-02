from asyncio.log import logger
import os
import faiss
from typing import List, Optional, Dict

# Path where your .index files are stored
INDEX_STORAGE_PATH = "storage/indexes"

def get_all_indexes(bot_ids: Optional[List[str]] = None) -> List[Dict]:
    """
    Scans the index storage to retrieve health and size metrics for FAISS indexes.
    Used by admin routes to monitor system and client storage usage.
    """
    index_metrics = []
    
    if not os.path.exists(INDEX_STORAGE_PATH):
        return []

    # Get all index files in the directory
    # Assumes files are named as {bot_id}.index
    all_files = [f for f in os.listdir(INDEX_STORAGE_PATH) if f.endswith(".index")]

    for file_name in all_files:
        bot_id = file_name.replace(".index", "")
        
        # If bot_ids filter is provided, skip files not in the list
        if bot_ids is not None and bot_id not in bot_ids:
            continue

        file_path = os.path.join(INDEX_STORAGE_PATH, file_name)
        
        try:
            # Get file size in MB
            file_size_mb = os.path.getsize(file_path) / (1024 * 1024)
            
            # Read index to get vector count (ntotal)
            # NOTE: For very large systems, you might want to cache this 
            # to avoid frequent disk I/O in the admin dashboard.
            temp_index = faiss.read_index(file_path, faiss.IO_FLAG_MMAP)
            vector_count = temp_index.ntotal
            
            index_metrics.append({
                "bot_id": bot_id,
                "vectors": vector_count,
                "size_mb": round(file_size_mb, 2)
            })
            
            # Explicitly clean up index reference
            del temp_index
            
        except Exception as e:
            # Log error and skip corrupted indexes
            print(f"Error reading index {file_name}: {e}")
            continue

    return index_metrics

from langchain_community.vectorstores import FAISS

def remove_vectors_from_disk(user_id, session_id, doc_id_to_remove, embeddings):
    """
    Surgically removes vectors from a local FAISS index based on doc_id.
    """
    vector_path = os.path.join(os.getcwd(), "vector_store", f"user_{user_id}", f"session_{session_id}")
    faiss_index_path = os.path.join(vector_path, "index.faiss")

    if not os.path.exists(faiss_index_path):
        logger.warning(f"No index found at {vector_path}")
        return

    # Load the index with allow_dangerous_deserialization for local pkl files
    db = FAISS.load_local(vector_path, embeddings, allow_dangerous_deserialization=True)

    # Find chunks belonging to this document
    chunks_to_remove = [
        id for id, doc in db.docstore._dict.items() 
        if doc.metadata.get("doc_id") == doc_id_to_remove
    ]

    if chunks_to_remove:
        db.delete(chunks_to_remove)
        db.save_local(vector_path)
        logger.info(f"🗑️ Removed {len(chunks_to_remove)} vectors for {doc_id_to_remove}")
    else:
        logger.info(f"No vectors found for doc_id: {doc_id_to_remove}")