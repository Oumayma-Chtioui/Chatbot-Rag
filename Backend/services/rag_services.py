import os
from langchain_community.document_loaders import PyPDFLoader, TextLoader, Docx2txtLoader
from langchain_text_splitters import RecursiveCharacterTextSplitter
from langchain_community.vectorstores import FAISS
from langchain_community.embeddings import HuggingFaceEmbeddings
from datetime import datetime
import logging
import uuid
from services.shared_state import cancellation_registry
logger = logging.getLogger(__name__)
import time
from fastapi import HTTPException

def is_cancelled(doc_id):
    return doc_id and cancellation_registry.get(doc_id, False) 


# Detect URL function
import re

def is_url(input_str: str) -> bool:
    return "." in input_str and " " not in input_str

# ================= LOAD =================
async def load_url(file, file_path, user_id, session_id, max_pages, doc_id=None):
    from services.scraper_service import scrape_url, scrape_website
    if not file_path.startswith(("http://", "https://")):
            file_path = "https://" + file_path
    logger.info(f"🌐 Detected URL: {file_path}")
    try:
        documents = scrape_url(file_path,doc_id=doc_id) if max_pages == 1 else scrape_website(file_path, max_pages,max_workers=7, doc_id=doc_id)
        return await process_document(documents=documents, file=file, file_path=file_path, user_id=user_id, session_id=session_id, max_pages=max_pages, doc_id=doc_id)
    except Exception as e:
        logger.error(f"❌ Failed to scrape URL: {e}")
        return {"success": False, "error": str(e), "chunks": 0}

async def load_document(file, file_path, user_id, session_id, max_pages, doc_id=None):
    if file and file.filename.endswith('.pdf'):
        logger.info(f"📄 Detected PDF file: {file.filename}")
        documents = PyPDFLoader(file_path).load()
        return await process_document(documents=documents, file=file, file_path=file_path, user_id=user_id, session_id=session_id, max_pages=max_pages, doc_id=doc_id)

    elif file and file.filename.endswith(('.txt', '.md')):
        logger.info(f"📝 Detected text file: {file.filename}")
        documents = TextLoader(file_path, encoding='utf-8').load()
        return await process_document(documents=documents, file=file, file_path=file_path, user_id=user_id, session_id=session_id, max_pages=max_pages, doc_id=doc_id)

    elif file and file.filename.endswith('.docx'):
        logger.info(f"📑 Detected Word file: {file.filename}")
        documents = Docx2txtLoader(file_path).load()
        return await process_document(documents=documents, file=file, file_path=file_path, user_id=user_id, session_id=session_id, max_pages=max_pages, doc_id=doc_id)
   
    else:
        logger.warning(f"⚠️  Unsupported file type or invalid URL: {file_path}")
        return {"success": False, "error": "Unsupported file type or invalid URL", "chunks": 0}

async def process_document(documents, file, file_path, user_id, session_id, max_pages, doc_id=None):
    clean_session_id = session_id.replace("session_", "").replace("session-", "")
    
     
    VECTOR_PATH = os.path.join(
        os.getcwd(),
        "vector_store",
        f"user_{user_id}",
        f"session_{clean_session_id}"
    )

    os.makedirs(VECTOR_PATH, exist_ok=True)
    logger.info(f"📁 Vector store path: {VECTOR_PATH}")

    faiss_index_path = os.path.join(VECTOR_PATH, "index.faiss")
    faiss_exists = os.path.exists(faiss_index_path)

    start_time=time.time()

    try:
        source_name = file_path if file is None else file.filename
        logger.info(f"Enetered process_document function {source_name}")

        # 🔴 CANCEL EARLY
        if is_cancelled(doc_id):
            return {"success": False, "error": "Cancelled early", "chunks": 0}

        
        if not documents:
            return {"success": False, "error": "No content extracted", "chunks": 0}

        if is_cancelled(doc_id):
            return {"success": False, "error": "Cancelled after load", "chunks": 0}

        # ================= METADATA =================
        for doc in documents:
            doc.metadata.update({
                "source": source_name,
                "upload_time": str(datetime.now()),
                "doc_id": str(uuid.uuid4()),
                "user_id": user_id,
                "session_id": clean_session_id
            })

        # ================= CHUNKING =================
        splitter = RecursiveCharacterTextSplitter(
            chunk_size=1000,
            chunk_overlap=200
        )

        chunks = []
        for doc in documents:
            if is_cancelled(doc_id):
                return {"success": False, "error": "Cancelled during chunking", "chunks": 0}
            chunks.extend(splitter.split_documents([doc]))

        logger.info(f"✂️ Split into {len(chunks)} chunks")

        if not chunks:
            return {"success": False, "error": "No chunks created", "chunks": 0}

        # ================= EMBEDDINGS =================
        embeddings = HuggingFaceEmbeddings(
            model_name="all-MiniLM-L6-v2",
            model_kwargs={'device': 'cpu'},
            encode_kwargs={'normalize_embeddings': True}
        )

        if is_cancelled(doc_id):
            return {"success": False, "error": "Cancelled before embeddings", "chunks": 0}

        # 🔥 IMPORTANT: batch processing (interruptible)
        BATCH_SIZE = 32
        all_batches = [chunks[i:i+BATCH_SIZE] for i in range(0, len(chunks), BATCH_SIZE)]

        # ✅ Load existing index if it exists, otherwise start fresh
        if os.path.exists(faiss_index_path):
            logger.info(f"📂 Loading existing index to merge into")
            db = FAISS.load_local(VECTOR_PATH, embeddings, allow_dangerous_deserialization=True)
        else:
            db = None

        for i, batch in enumerate(all_batches):
            if is_cancelled(doc_id):
                return {"success": False, "error": "Cancelled during embeddings", "chunks": 0}

            if db is None:
                db = FAISS.from_documents(batch, embeddings)
            else:
                db.add_documents(batch)

            logger.info(f"✅ Processed batch {i+1}/{len(all_batches)}")

        # ================= SAVE =================
        if is_cancelled(doc_id):
            return {"success": False, "error": "Cancelled before saving", "chunks": 0}

        db.save_local(VECTOR_PATH)

    

        logger.info("💾 Vector store saved")

        end_time = time.time()
        logger.info(f"⏱️  Total processing time: {end_time - start_time:.2f} seconds")

        return {
            "success": True,
            "chunks": len(chunks),
            "vector_store": VECTOR_PATH,
            "session_id": clean_session_id
        }

    except Exception as e:
        logger.error(f"❌ Error: {e}")
        return {"success": False, "error": str(e), "chunks": 0}

def get_vector_store(user_id: int, session_id: str):
    """
    Load vector store for a specific user session
    Returns None if store doesn't exist
    """
    # Clean session ID
    clean_session_id = session_id.replace("session_", "").replace("session-", "")
    
    VECTOR_PATH = os.path.join(
        os.getcwd(),
        "vector_store",
        f"user_{user_id}",
        f"session_{clean_session_id}"
    )
    
    faiss_index_path = os.path.join(VECTOR_PATH, "index.faiss")
    
    if not os.path.exists(faiss_index_path):
        logger.warning(f"⚠️  No vector store found at {faiss_index_path}")
        return None
    
    try:
        logger.info(f"📂 Loading vector store from {VECTOR_PATH}")
        embeddings = HuggingFaceEmbeddings(
            model_name="all-MiniLM-L6-v2",
            model_kwargs={'device': 'cpu'},
            encode_kwargs={'normalize_embeddings': True}
        )
        
        db = FAISS.load_local(
            VECTOR_PATH, 
            embeddings, 
            allow_dangerous_deserialization=True
        )
        
        logger.info(f"✅ Vector store loaded successfully")
        return db
        
    except Exception as e:
        logger.error(f"❌ Failed to load vector store: {e}")
        return None


def search_documents(user_id: int, session_id: str, query: str, k: int = 5):
    """
    Search for relevant documents in the vector store
    """
    clean_session_id = session_id.replace("session_", "").replace("session-", "")
    db = get_vector_store(user_id, clean_session_id)
    
    if db is None:
        logger.warning(f"⚠️  No vector store available for user {user_id}, session {clean_session_id}")
        return []
    
    try:
        logger.info(f"🔍 Searching for: {query[:50]}...")
        results = db.similarity_search_with_score(query, k=k)
        
        logger.info(f"✅ Found {len(results)} results")
        
        formatted_results = []
        for doc, score in results:
            formatted_results.append({
                "content": doc.page_content,
                "metadata": doc.metadata,
                "score": float(score)
            })
        
        return formatted_results
        
    except Exception as e:
        logger.error(f"❌ Search failed: {e}")
        return []


def delete_session_vectors(user_id: int, session_id: str):
    """
    Delete vector store for a session
    """
    clean_session_id = session_id.replace("session_", "").replace("session-", "")
    
    VECTOR_PATH = os.path.join(
        os.getcwd(),
        "vector_store",
        f"user_{user_id}",
        f"session_{clean_session_id}"
    )
    clean_memory_path = session_id.replace("session_", "").replace("session-", "")
    memory_path=os.path.join(os.getcwd(), "vector_store", f"user_{user_id}", f"session_{clean_memory_path}_memory")

    if os.path.exists(VECTOR_PATH):
        import shutil
        try:
            shutil.rmtree(VECTOR_PATH)
            logger.info(f"🗑️  Deleted vector store: {VECTOR_PATH}")
            shutil.rmtree(memory_path)
            logger.info(f"🗑️  Deleted memory store: {memory_path}")
            return True
        except Exception as e:
            logger.error(f"❌ Failed to delete vector store: {e}")
            return False
    else:
        logger.warning(f"⚠️  Vector store not found: {VECTOR_PATH}")
        return False