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