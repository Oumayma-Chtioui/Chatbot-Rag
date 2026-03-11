import os
from langchain_community.document_loaders import PyPDFLoader, TextLoader
from langchain_text_splitters import RecursiveCharacterTextSplitter
from langchain_community.vectorstores import FAISS
from langchain_community.embeddings import HuggingFaceEmbeddings
from datetime import datetime
import logging
import uuid

logger = logging.getLogger(__name__)


async def process_document(file, file_path, user_id, session_id):
    """
    Process document and add to vector store with per-session isolation
    
    CRITICAL FIX: Don't add "session_" prefix if already present
    """
    # Remove "session_" prefix if it exists to avoid double prefix
    clean_session_id = session_id.replace("session_", "").replace("session-", "")
    
    # Build path for this user's session
    VECTOR_PATH = os.path.join(
        os.getcwd(),
        "vector_store",
        f"user_{user_id}",
        f"session_{clean_session_id}"  # Now always has exactly one "session_" prefix
    )

    # Create directory structure if it doesn't exist
    os.makedirs(VECTOR_PATH, exist_ok=True)
    logger.info(f"📁 Vector store path: {VECTOR_PATH}")
    
    # Check if FAISS index FILE exists (not just directory)
    faiss_index_path = os.path.join(VECTOR_PATH, "index.faiss")
    faiss_exists = os.path.exists(faiss_index_path)
    logger.info(f"🔍 FAISS index exists: {faiss_exists}")
    
    try:
        logger.info(f"📄 Processing document: {file.filename}")
        
        # Load document based on file type
        if file.filename.endswith('.pdf'):
            loader = PyPDFLoader(file_path)
            documents = loader.load()
            logger.info(f"✅ Loaded PDF with {len(documents)} pages")
        elif file.filename.endswith('.txt'):
            loader = TextLoader(file_path, encoding='utf-8')
            documents = loader.load()
            logger.info(f"✅ Loaded text file")
        elif file.filename.endswith('.md'):
            loader = TextLoader(file_path, encoding='utf-8')
            documents = loader.load()
            logger.info(f"✅ Loaded markdown file")
        else:
            logger.warning(f"⚠️  Unsupported file type: {file.filename}")
            return {"success": False, "error": "Unsupported file type", "chunks": 0}
        
        # Add metadata to each document
        for doc in documents:
            doc.metadata["source"] = file.filename
            doc.metadata["upload_time"] = str(datetime.now())
            doc.metadata["doc_id"] = str(uuid.uuid4())
            doc.metadata["user_id"] = user_id
            doc.metadata["session_id"] = clean_session_id
        
        # Split into chunks
        text_splitter = RecursiveCharacterTextSplitter(
            chunk_size=1000,
            chunk_overlap=200,
            length_function=len,
            separators=["\n\n", "\n", ". ", " ", ""]
        )
        chunks = text_splitter.split_documents(documents)
        logger.info(f"✂️  Split into {len(chunks)} chunks")
        
        if not chunks:
            logger.warning("⚠️  No chunks created from document")
            return {"success": False, "error": "No content extracted", "chunks": 0}
        
        # Initialize embeddings model
        logger.info("🔄 Initializing embeddings model...")
        embeddings = HuggingFaceEmbeddings(
            model_name="all-MiniLM-L6-v2",
            model_kwargs={'device': 'cpu'},
            encode_kwargs={'normalize_embeddings': True}
        )
        
        # Create or update based on FILE existence, not directory
        if faiss_exists:
            logger.info("📂 Loading existing vector store...")
            try:
                db = FAISS.load_local(
                    VECTOR_PATH, 
                    embeddings, 
                    allow_dangerous_deserialization=True
                )
                logger.info("✅ Existing vector store loaded")
                
                # Add new chunks to existing store
                db.add_documents(chunks)
                logger.info(f"➕ Added {len(chunks)} new chunks to existing store")
                
            except Exception as load_error:
                logger.error(f"❌ Failed to load existing store: {load_error}")
                logger.info("🆕 Creating new vector store instead...")
                db = FAISS.from_documents(chunks, embeddings)
                logger.info(f"✅ Created new store with {len(chunks)} chunks")
        else:
            logger.info("🆕 Creating new vector store (first document)...")
            db = FAISS.from_documents(chunks, embeddings)
            logger.info(f"✅ Created new store with {len(chunks)} chunks")
        
        # Save vector store
        logger.info("💾 Saving vector store...")
        db.save_local(VECTOR_PATH)
        logger.info(f"✅ Vector store saved to {VECTOR_PATH}")
        
        # Verify the store was created
        if os.path.exists(faiss_index_path):
            files = os.listdir(VECTOR_PATH)
            logger.info(f"📋 Vector store files: {files}")
            
            # Get file sizes
            for f in files:
                fpath = os.path.join(VECTOR_PATH, f)
                if os.path.isfile(fpath):
                    size = os.path.getsize(fpath)
                    logger.info(f"   📄 {f}: {size/1024:.2f} KB")
        else:
            logger.error(f"❌ FAISS index not found after save!")
        
        return {
            "success": True,
            "chunks": len(chunks),
            "vector_store": VECTOR_PATH,
            "session_id": clean_session_id  # Return clean session ID
        }
        
    except Exception as e:
        logger.error(f"❌ Error processing document: {e}")
        import traceback
        traceback.print_exc()
        return {
            "success": False,
            "error": str(e),
            "chunks": 0
        }


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
    db = get_vector_store(user_id, session_id)
    
    if db is None:
        logger.warning(f"⚠️  No vector store available for user {user_id}, session {session_id}")
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
    
    if os.path.exists(VECTOR_PATH):
        import shutil
        try:
            shutil.rmtree(VECTOR_PATH)
            logger.info(f"🗑️  Deleted vector store: {VECTOR_PATH}")
            return True
        except Exception as e:
            logger.error(f"❌ Failed to delete vector store: {e}")
            return False
    else:
        logger.warning(f"⚠️  Vector store not found: {VECTOR_PATH}")
        return False