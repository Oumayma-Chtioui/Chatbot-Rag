from datetime import datetime
import os
import logging
import traceback
from pathlib import Path
from google import genai
from langchain_community.vectorstores import FAISS
from langchain_community.embeddings import HuggingFaceEmbeddings
from database import messages_collection
from langchain_core.documents import Document
from langchain_ollama import OllamaLLM


os.environ["LANGCHAIN_TRACING_V2"] = os.environ.get("LANGCHAIN_TRACING_V2", "true")
os.environ["LANGCHAIN_API_KEY"] = os.environ.get("LANGCHAIN_API_KEY", "")
os.environ["LANGCHAIN_PROJECT"] = os.environ.get("LANGCHAIN_PROJECT", "novamind")



# Set up logging
logging.basicConfig(level=logging.INFO)
logger = logging.getLogger(__name__)

BACKEND_DIR = Path(__file__).parent.parent.absolute()

# ─────────────────────────────────────────────────────────────
# Paths
# ─────────────────────────────────────────────────────────────
def get_vector_path(user_id: str, session_id: str):
    # Clean session ID to match how rag_services stores it
    clean_session_id = session_id.replace("session_", "").replace("session-", "")
    return os.path.join(
        os.getcwd(),
        "vector_store",
        f"user_{user_id}",
        f"session_{clean_session_id}"
    )

def get_memory_path(user_id: str, session_id: str):
    """Separate FAISS index just for conversation memory"""
    clean = session_id.replace("session_", "").replace("session-", "")
    return os.path.join(os.getcwd(), "vector_store", f"user_{user_id}", f"session_{clean}_memory")

# ─────────────────────────────────────────────────────────────
# Embeddings (shared instance)
# ─────────────────────────────────────────────────────────────

def get_embeddings():
    return HuggingFaceEmbeddings(
        model_name="all-MiniLM-L6-v2",
        model_kwargs={"device": "cpu"},
        encode_kwargs={"normalize_embeddings": True}
    )

# ─────────────────────────────────────────────────────────────
# Conversation Vector Memory
# ─────────────────────────────────────────────────────────────

def save_exchange_to_memory(user_id: str, session_id: str, question: str, answer: str):
    """
    Embed and store a full exchange (question + answer) into the
    session memory FAISS index.
    """
    MEMORY_PATH = get_memory_path(user_id, session_id)
    os.makedirs(MEMORY_PATH, exist_ok=True)

    # Combine question and answer into one chunk so retrieval brings back full context
    exchange_text = f"User: {question}\nAssistant: {answer}"
    doc = Document(
        page_content=exchange_text,
        metadata={
            "session_id": session_id,
            "timestamp": str(datetime.now()),
            "type": "conversation_exchange"
        }
    )

    embeddings = get_embeddings()
    faiss_index_path = os.path.join(MEMORY_PATH, "index.faiss")

    try:
        if os.path.exists(faiss_index_path):
            # Load and add to existing memory index
            memory_db = FAISS.load_local(MEMORY_PATH, embeddings, allow_dangerous_deserialization=True)
            memory_db.add_documents([doc])
        else:
            # Create new memory index
            memory_db = FAISS.from_documents([doc], embeddings)

        memory_db.save_local(MEMORY_PATH)
        logger.info(f"✅ Exchange saved to memory index at {MEMORY_PATH}")

    except Exception as e:
        logger.error(f"❌ Failed to save exchange to memory: {e}")


def retrieve_relevant_history(user_id: str, session_id: str, question: str, k: int = 4):
    """
    Search the session memory FAISS index for the most semantically
    relevant past exchanges for the current question.
    """
    MEMORY_PATH = get_memory_path(user_id, session_id)
    faiss_index_path = os.path.join(MEMORY_PATH, "index.faiss")

    if not os.path.exists(faiss_index_path):
        logger.info("📭 No conversation memory yet for this session")
        return ""

    try:
        embeddings = get_embeddings()
        memory_db = FAISS.load_local(MEMORY_PATH, embeddings, allow_dangerous_deserialization=True)
        results = memory_db.similarity_search(question, k=k)
        
        if not results:
            return ""

        # Format retrieved exchanges as readable history
        history_text = "\n\n".join([doc.page_content for doc in results])
        logger.info(f"🧠 Retrieved {len(results)} relevant past exchanges from memory")
        return history_text

    except Exception as e:
        logger.error(f"❌ Failed to retrieve from memory: {e}")
        return ""

# ─────────────────────────────────────────────────────────────
# MongoDB message saving (for PostgreSQL persistence via chat.py)
# ─────────────────────────────────────────────────────────────

def save_message(session_id: str, user_id, role: str, content: str):
    messages_collection.insert_one({
        "session_id": session_id,
        "user_id": user_id,
        "role": role,
        "content": content,
        "timestamp": datetime.utcnow()
    })

# ─────────────────────────────────────────────────────────────
#LLM Loading
# ─────────────────────────────────────────────────────────────
def load_gemini():
    import google.generativeai  as genai
    logger.info("🔄 Initializing gemini-2.5-flash LLM...")
    genai.configure(api_key=os.getenv("GEMINI_API_KEY"))
    llm = genai.GenerativeModel('models/gemini-2.5-flash')
    logger.info("✅ gemini-2.5-flash initialized")
    return llm

def load_tinyllama():
    logger.info("🔄 Initializing tinyllama LLM...")
    llm = OllamaLLM(model="tinyllama:latest",base_url="http://host.docker.internal:11434")
    logger.info("✅ tinyllama initialized")
    return llm

def load_llama3_2():
    logger.info("🔄 Initializing llama3-2 LLM...")
    llm = OllamaLLM(model="llama3-2latest",base_url="http://host.docker.internal:11434")
    logger.info("✅ llama3-2 initialized")
    return llm

def load_openrouter_stepfun():
    from langchain_openai import ChatOpenAI
    logger.info("🔄 Initializing stepfun/step-3.5-flash LLM...")
    llm =ChatOpenAI(
        model="stepfun/step-3.5-flash:free",  
        openai_api_key=os.getenv("OPENROUTER_API_KEY"),
        openai_api_base="https://openrouter.ai/api/v1"
    )
    logger.info("✅ stepfun/step-3.5-flash initialized")
    return llm

def load_openrouter_free():
    from langchain_openai import ChatOpenAI
    logger.info("🔄 Initializing openrouter/free LLM...")
    llm = ChatOpenAI(
        model="openrouter/free",  
        openai_api_key=os.getenv("OPENROUTER_API_KEY"),
        openai_api_base="https://openrouter.ai/api/v1"
    )
    logger.info("✅ openrouter/free initialized")
    return llm

def load_nvidia_nemotron():
    from langchain_openai import ChatOpenAI
    logger.info("🔄 Initializing nvidia/nemotron-3-super-120b-a12b:free LLM...")
    llm = ChatOpenAI(model="nvidia/nemotron-3-super-120b-a12b:free",
                      openai_api_key=os.getenv("OPENROUTER_API_KEY"),
                        openai_api_base="https://openrouter.ai/api/v1")
    logger.info("✅ nvidia/nemotron-3-super-120b-a12b:free initialized")
    return llm

def load_arceeai_trinity():
    from langchain_openai import ChatOpenAI
    logger.info("🔄 Initializing arcee-ai/trinity-large-preview:free LLM...")
    llm = ChatOpenAI(model="arcee-ai/trinity-large-preview:free",
                      openai_api_key=os.getenv("OPENROUTER_API_KEY"),
                        openai_api_base="https://openrouter.ai/api/v1")
    logger.info("✅ arcee-ai/trinity-large-preview:free initialized")
    return llm

# ─────────────────────────────────────────────────────────────
# Generate Answer Function
# ─────────────────────────────────────────────────────────────
def ollama_generate_answer(system_prompt: str, question: str, context: str):
    llm = load_llama3_2()
    from langchain_core.prompts import ChatPromptTemplate
    prompt = ChatPromptTemplate.from_template("""
Answer the question based only on the context below. If the answer cannot be found in the context, say "I cannot find this information in the documents.""")

    from langchain_core.output_parsers import StrOutputParser
    chain = prompt | llm | StrOutputParser()
    answer = chain.invoke({
        "context": context,
        "question": question
    })

    return answer

def gemini_generate_answer(system_prompt: str, question: str, context: str):
    llm = load_gemini()
    full_prompt = f"{system_prompt}\n\nQuestion: {question}\n\nAnswer:"
    response = llm.generate_content(full_prompt).text
    return response.strip()

def openrouter_generate_answer(system_prompt: str, question: str, context: str):
    llm= load_openrouter_free()
    full_prompt = f"{system_prompt}\n\nQuestion: {question}\n\nAnswer:"
    logger.info("🔄 Generating response with Open Router...")
    response = llm.invoke(full_prompt)
    answer = response.content
    logger.info("✅ Response generated by Open Router")
    return answer.strip()

def openrouter_stepfun_generate_answer(system_prompt: str, question: str, context: str):
    llm = load_openrouter_stepfun()
    full_prompt = f"{system_prompt}\n\nQuestion: {question}\n\nAnswer:"
    logger.info("🔄 Generating response with StepFun...")
    response = llm.invoke(full_prompt)
    answer = response.content
    logger.info("✅ Response generated by StepFun")
    return answer.strip()
# ─────────────────────────────────────────────────────────────
# Main RAG + Memory answer generation
# ─────────────────────────────────────────────────────────────
def generate_answer(question: str, user_id: str, session_id: str):

    

    logger.info(f"🔍 Generating answer for: {question[:50]}...")

    clean_session_id = session_id.replace("session_", "").replace("session-", "")
    VECTOR_PATH = get_vector_path(user_id, clean_session_id)

    logger.warning(f"🔎 VECTOR_PATH looking for: '{VECTOR_PATH}'")
    logger.warning(f"🔎 Path exists: {os.path.exists(VECTOR_PATH)}")

    if not os.path.exists(VECTOR_PATH):
        logger.warning("❌ No documents indexed yet")
        return {"answer": "No documents indexed yet. Please upload documents first.", "sources": []}

    try:
        # 1. Retrieve relevant document chunks
        embeddings = get_embeddings()
        db = FAISS.load_local(VECTOR_PATH, embeddings, allow_dangerous_deserialization=True)
        retriever = db.as_retriever(search_kwargs={"k": 3})
        docs = retriever.invoke(question)

        if not docs:
            return {"answer": "I couldn't find any relevant information in the documents.", "sources": []}

        context = "\n\n".join(doc.page_content for doc in docs)
        logger.info(f"📄 Document context: {len(context)} characters")

        # 2. Retrieve relevant conversation history from vector memory
        relevant_history = retrieve_relevant_history(user_id, session_id, question, k=4)

        # 3. Build prompt with both document context and relevant history
        if relevant_history:
            system_prompt = f"""You are a helpful assistant that answers questions based on provided documents.
Use the document context below to answer questions accurately.
You also have access to relevant parts of the previous conversation to maintain continuity.
If the answer cannot be found in the context, say "I cannot find this information in the documents."

Document context:
{context}

Relevant conversation history:
{relevant_history}"""
        else:
            system_prompt = f"""You are a helpful assistant that answers questions based on provided documents.
Use the document context below to answer questions accurately.
If the answer cannot be found in the context, say "I cannot find this information in the documents."

Document context:
{context}"""

        # 4. Call Generate Answer
        answer = openrouter_stepfun_generate_answer(system_prompt, question, context)

        logger.info("✅ Response generated")

        # 5. Save exchange to vector memory AFTER answering
        save_exchange_to_memory(user_id, session_id, question, answer)

        # 6. Save to MongoDB for reference
        save_message(session_id, user_id, "user", question)
        save_message(session_id, user_id, "assistant", answer)

        sources = [{
            "source": doc.metadata.get("source", "Unknown"),
            "content_preview": doc.page_content[:100] + "..."
        } for doc in docs]

        return {"answer": answer, "sources": sources}

    except Exception as e:
        logger.error(f"❌ Error generating answer: {e}")
        logger.error(traceback.format_exc())
        return {"answer": f"An error occurred: {str(e)}", "sources": []}
