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

def is_cancelled(doc_id):
    return doc_id and cancellation_registry.get(doc_id, False) 

async def process_document(file, file_path, user_id, session_id, max_pages, doc_id=None):
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

    try:
        source_name = file_path if file is None else file.filename
        logger.info(f"📄 Processing document: {source_name}")

        # 🔴 CANCEL EARLY
        if is_cancelled(doc_id):
            return {"success": False, "error": "Cancelled early", "chunks": 0}

        # ================= LOAD =================
        if file_path.startswith('http'):
            from services.scraper_service import scrape_website, scrape_url
            documents = scrape_url(file_path,doc_id=doc_id) if max_pages == 1 else scrape_website(file_path, max_pages,max_workers=7, doc_id=doc_id)

        elif file.filename.endswith('.pdf'):
            documents = PyPDFLoader(file_path).load()

        elif file.filename.endswith(('.txt', '.md')):
            documents = TextLoader(file_path, encoding='utf-8').load()

        elif file.filename.endswith('.docx'):
            documents = Docx2txtLoader(file_path).load()

        else:
            return {"success": False, "error": "Unsupported file type", "chunks": 0}

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

        db = None

        for i, batch in enumerate(all_batches):
            if is_cancelled(doc_id):
                logger.info(f"🛑 Cancelled during embeddings at batch {i}")
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