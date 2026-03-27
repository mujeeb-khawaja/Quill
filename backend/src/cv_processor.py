import os
import json
import io
import pdfplumber
from typing import List, Dict, Any
from dotenv import load_dotenv

# LangChain LLMs
from langchain_groq import ChatGroq
from langchain_google_genai import ChatGoogleGenerativeAI
from langchain_openai import ChatOpenAI

# Qdrant & Embeddings
from langchain_huggingface import HuggingFaceEmbeddings
from langchain_qdrant import QdrantVectorStore
from qdrant_client import QdrantClient
from qdrant_client.http import models as rest
from langchain_core.documents import Document

load_dotenv()

# --- 1. RAW TEXT EXTRACTION ---
def extract_text_from_pdf_bytes(file_bytes: bytes) -> str:
    """Extract raw text from a PDF file byte stream."""
    text = ""
    try:
        with pdfplumber.open(io.BytesIO(file_bytes)) as pdf:
            for page in pdf.pages:
                page_text = page.extract_text()
                if page_text:
                    text += page_text + "\n"
    except Exception as e:
        print(f"Error reading PDF bytes: {e}")
    return text

# --- 2. LLM SEMANTIC CHUNKING ---
def get_parser_llm():
    """Returns an LLM instance optimized for structured JSON output."""
    groq_llm = ChatGroq(
        model="llama-3.3-70b-versatile",
        api_key=os.getenv("GROQ_API_KEY"),
        temperature=0.1
    )
    gemini_llm = ChatGoogleGenerativeAI(
        model="gemini-1.5-flash",
        api_key=os.getenv("GEMINI_API_KEY"),
        temperature=0.1
    )
    # Primary Groq -> Fallback Gemini
    return groq_llm.with_fallbacks([gemini_llm])

def classify_cv_document(raw_text: str) -> Dict[str, Any]:
    """
    Very fast, cheap classifier to determine if a document is actually a CV/Resume.
    Look at the first 1000 chars and return structured JSON.
    """
    print("      [CV PROCESSOR] Classifying uploaded document (Pre-Flight)...")
    
    # Use Groq Llama-3.1-8b (Very Fast/Cheap) for this check
    llm = ChatGroq(
        model="llama-3.1-8b-instant",
        api_key=os.getenv("GROQ_API_KEY"),
        temperature=0.1
    )
    
    # Only take the first 1000 characters to save tokens as per architecture
    text_excerpt = raw_text[:1000]
    
    prompt = f"""
    You are a STRICT Document Classifier protecting a database. Look at the text excerpt and determine if it is a standard, bulleted Resume/Curriculum Vitae.
    
    CRITICAL RULES:
    1. Cover Letters, Motivation Letters, Reference Letters, and Biographies are NOT Resumes. 
    2. If the text consists of conversational paragraphs, starts with "Dear...", or explains *why* the person wants an opportunity, set "is_valid_resume" to false and "document_type" to "Motivation/Cover Letter".
    3. A valid Resume/CV is highly structured, mostly bullet points, lists strict dates, and uses clear headers (Experience, Education, Skills).
    
    TEXT EXCERPT:
    {text_excerpt}
    
    Output ONLY valid JSON.
    {{
      "is_valid_resume": boolean,
      "document_type": "string",
      "confidence_score": integer
    }}
    """
    
    response = llm.invoke(prompt)
    try:
        content = response.content
        if "```json" in content:
            content = content.split("```json")[1].split("```")[0].strip()
        elif "```" in content:
            content = content.split("```")[1].strip()
        result = json.loads(content)
        print(f"      [CV PROCESSOR] Result: {result.get('document_type')} (Valid: {result.get('is_valid_resume')})")
        return result
    except Exception as e:
        print(f"      ⚠️ Warning: Classifier failed. Defaulting to failure for safety. {e}")
        return {"is_valid_resume": False, "document_type": "Unknown", "confidence_score": 0}

def parse_cv_to_json(raw_text: str) -> List[Dict[str, Any]]:
    """Uses LLM to chunk raw resume text into distinct semantic JSON objects."""
    print("      [CV PROCESSOR] Sending raw text to LLM for semantic chunking...")
    llm = get_parser_llm()
    
    prompt = f"""
    You are an expert Resume Parser. Your job is to break the provided raw resume text into distinct, logical chunks.
    You MUST extract the following categories if present:
    1. personal_logistics (Name, location, nationality, remote availability, visa/clearance status, languages)
    2. experience_level (Total years of experience, seniority level e.g. Junior/Senior)
    3. work_experience (One chunk per job role)
    4. education (Degrees, university names)
    5. project (One chunk per major project)
    6. skills (Summary of technical skills)
    7. certifications

    Output EXACTLY a JSON array of objects. No markdown formatting, no explanations. 
    Format:
    [
      {{
        "text": "Full detailed description...",
        "metadata": {{
          "category": "one of the categories above",
          "skills": ["extracted", "keywords", "relevant", "to", "chunk"]
        }}
      }}
    ]

    RESUME TEXT:
    {raw_text}
    """

    response = llm.invoke(prompt)
    
    try:
        content = response.content
        if "```json" in content:
            content = content.split("```json")[1].split("```")[0].strip()
        elif "```" in content:
            content = content.split("```")[1].strip()
        chunks = json.loads(content)
        
        if not isinstance(chunks, list):
            raise ValueError("LLM did not return a JSON array.")
            
        print(f"      [CV PROCESSOR] Successfully generated {len(chunks)} semantic chunks.")
        return chunks
    except Exception as e:
        print(f"      ⚠️ Warning: Failed to parse LLM chunking response. Error: {e}")
        return []

# --- 3. QDRANT MULTI-TENANT UPSERT ---
def upsert_cv_to_qdrant(chunks: List[Dict[str, Any]], user_id: str) -> int:
    """Deletes old vectors for this user, then upserts the new chunks into Qdrant."""
    print(f"      [CV PROCESSOR] Upserting {len(chunks)} chunks for User: {user_id}")
    
    url = os.getenv("QDRANT_URL")
    api_key = os.getenv("QDRANT_API_KEY")
    collection_name = "cv_portfolio"

    client = QdrantClient(url=url, api_key=api_key)
    
    # 0. Ensure Payload Index exists for metadata.user_id (fixes 400 Bad Request)
    try:
        client.create_payload_index(
            collection_name=collection_name,
            field_name="metadata.user_id",
            field_schema=rest.PayloadSchemaType.KEYWORD,
        )
        print(f"      [CV PROCESSOR] Payload index ensured for metadata.user_id")
    except Exception as e:
        # Index might already exist
        pass

    # 1. DELETE existing vectors for this user_id to prevent duplication
    try:
        print(f"      [CV PROCESSOR] Deleting old vectors for {user_id}...")
        client.delete(
            collection_name=collection_name,
            points_selector=rest.Filter(
                must=[
                    rest.FieldCondition(
                        key="metadata.user_id",
                        match=rest.MatchValue(value=user_id)
                    )
                ]
            )
        )
    except Exception as e:
        print(f"      ⚠️ Note: Delete old vectors failed (perhaps collection or index missing). Proceeding... {e}")

    # 2. Prepare new documents with user_id injected into metadata
    documents = []
    for chunk in chunks:
        meta = chunk.get("metadata", {})
        meta["user_id"] = user_id  # Inject tenancy ID
        
        doc = Document(
            page_content=chunk.get("text", ""),
            metadata=meta
        )
        documents.append(doc)
        
    if not documents:
        return 0

    # 3. Upsert using Langchain Qdrant wrapper
    embeddings = HuggingFaceEmbeddings(
        model_name="BAAI/bge-small-en-v1.5",
        model_kwargs={'device': 'cpu'},
        encode_kwargs={'normalize_embeddings': True}
    )
    
    QdrantVectorStore.from_documents(
        documents,
        embeddings,
        url=url,
        api_key=api_key,
        collection_name=collection_name,
        force_recreate=False  # CRITICAL: Append, do not destroy collection
    )
    
    print(f"      [CV PROCESSOR] ✅ Upsert complete. Added {len(documents)} chunks.")
    return len(documents)
