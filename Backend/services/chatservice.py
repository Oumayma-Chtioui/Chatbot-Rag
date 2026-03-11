
import os
import logging
import traceback
from pathlib import Path
from langchain_community.vectorstores import FAISS
from langchain_ollama import OllamaLLM
from langchain_community.embeddings import HuggingFaceEmbeddings
from langchain_core.prompts import ChatPromptTemplate
from langchain_core.output_parsers import StrOutputParser
from sentence_transformers import SentenceTransformer

# Set up logging
logging.basicConfig(level=logging.INFO)
logger = logging.getLogger(__name__)

BACKEND_DIR = Path(__file__).parent.parent.absolute()
def get_vector_path(user_id: str, session_id: str):
    return os.path.join(
        os.getcwd(),
        "vector_store",
        f"user_{user_id}",
        f"session_{session_id}"
    )


def generate_answer(question: str, user_id: str, session_id: str):
    logger.info(f"🔍 Generating answer for: {question[:50]}...")
    VECTOR_PATH = get_vector_path(user_id=user_id, session_id=session_id)  # Default session_id for debugging

    # Check if vector store exists
    if not os.path.exists(VECTOR_PATH):
        logger.warning("❌ No documents indexed yet")
        return {"answer": "No documents indexed yet. Please upload documents first.", "sources": []}

    try:
        # Check if directory is empty
        VECTOR_PATH = get_vector_path(user_id, session_id)

        if not os.path.exists(VECTOR_PATH):
            raise Exception("No documents indexed for this session")
        logger.info(f"✅ Vector store found at: {VECTOR_PATH}")
        logger.info(f"📁 Files: {os.listdir(VECTOR_PATH)}")
        
        # Initialize embeddings
        logger.info("🔄 Initializing embeddings...")
        embeddings = HuggingFaceEmbeddings(model_name="all-MiniLM-L6-v2")

        
        # Load vector store
        logger.info("🔄 Loading FAISS index...")
        db = FAISS.load_local(
            VECTOR_PATH,
            embeddings,
            allow_dangerous_deserialization=True
        )
        logger.info("✅ FAISS index loaded successfully")
        
        # Create retriever
        retriever = db.as_retriever(search_kwargs={"k": 3})
        
        # Retrieve documents
        logger.info("🔄 Retrieving relevant documents...")
        docs = retriever.invoke(question)
        logger.info(f"✅ Retrieved {len(docs)} documents")
        
        if not docs:
            logger.warning("⚠️ No relevant documents found")
            return {
                "answer": "I couldn't find any relevant information in the documents.",
                "sources": []
            }
        
        # Format context
        context = "\n\n".join(doc.page_content for doc in docs)
        logger.info(f"📝 Context length: {len(context)} characters")
        
        # Initialize LLM
        logger.info("🔄 Initializing Ollama LLM...")
        try:
            
            llm = OllamaLLM(model="tinyllama:latest",base_url="http://host.docker.internal:11434")
            logger.info("✅ Ollama LLM initialized")
        except Exception as e:
            logger.error(f"❌ Failed to initialize Ollama: {e}")
            return {
                "answer": "The language model is not available. Please make sure Ollama is running with: ollama run llama3.2:1b",
                "sources": []
            }
        
        # Create prompt
        prompt = ChatPromptTemplate.from_template("""
Answer the question based only on the context below. If the answer cannot be found in the context, say "I cannot find this information in the documents."

Context:
{context}

Question:
{question}

Answer:""")
        
        # Generate response
        logger.info("🔄 Generating response...")
        chain = prompt | llm | StrOutputParser()
        response = chain.invoke({
            "context": context,
            "question": question
        })
        logger.info("✅ Response generated")
        
        # Format sources
        sources = []
        for doc in docs:
            source_info = {
                "source": doc.metadata.get("source", "Unknown"),
                "content_preview": doc.page_content[:100] + "..." if len(doc.page_content) > 100 else doc.page_content
            }
            sources.append(source_info)
        
        
        return {
            "answer": response,
            "sources": sources
        }

        
        
    except Exception as e:
        logger.error(f"❌ Error generating answer: {e}")
        logger.error(traceback.format_exc())  # This will print the full traceback
        return {
            "answer": f"An error occurred: {str(e)}",
            "sources": []
        }
