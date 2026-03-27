from fastapi import FastAPI, File, UploadFile, Form, BackgroundTasks
from fastapi.middleware.cors import CORSMiddleware
from fastapi.responses import JSONResponse
from mangum import Mangum
import pdfplumber
import io
import json
import asyncio
from typing import List

# Import the pre-built, working LangGraph logic
from src.agent_graph import build_graph
from src.cv_processor import extract_text_from_pdf_bytes, parse_cv_to_json, upsert_cv_to_qdrant, classify_cv_document

app = FastAPI(title="AutoBid AI", description="Serverless RFP Evaluator")

# --- CORS CONFIGURATION ---
# In production, replace ["*"] with your actual frontend URL (e.g., Vercel)
app.add_middleware(
    CORSMiddleware,
    allow_origins=["*", "https://multi-agent-rfp-responder.onrender.com"], 
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)

# Initialize LangGraph once at startup
print("Initializing LangGraph Pipeline...")
graph = build_graph()

def extract_text(file_bytes: bytes) -> str:
    """Helper to extract text from a raw PDF byte stream."""
    return extract_text_from_pdf_bytes(file_bytes)

from fastapi.responses import StreamingResponse

# --- CONCURRENCY LIMITER ---
# Caps parallel LLM pipeline calls to 3 to prevent rate-limit (HTTP 429) errors
# on free-tier APIs (Groq, Gemini). Raise to 4-5 if on a paid tier.
BATCH_SEMAPHORE = asyncio.Semaphore(3)

@app.post("/api/evaluate-rfp")
async def evaluate_rfp(
    file: UploadFile = File(...),
    user_id: str = Form(...)
):
    print(f"\n--- API REQUEST RECEIVED (STREAMING) ---")
    print(f"File Name: {file.filename}")
    
    # 1. Read file bytes
    file_bytes = await file.read()
    
    # 2. Extract Text
    rfp_text = extract_text(file_bytes)
    
    if len(rfp_text.strip()) < 10:
        return {
            "status": "error",
            "is_match": False,
            "gatekeeper_reasoning": "Failed to extract readable text from PDF.",
            "final_draft": None
        }

    # 3. Setup Initial State for LangGraph
    initial_state = {
        "rfp_text": rfp_text,
        "user_id": user_id,
        "document_type": "",
        "is_valid_rfp": False,
        "hard_constraints": {},
        "requirements": [],
        "cv_context": "",
        "is_match": False,
        "evaluator_reasoning": "",
        "current_draft": "",
        "review_feedback": "",
        "revision_count": 0
    }
    
    async def event_generator():
        # First event: Send the extracted RFP text so UI can show it
        yield json.dumps({"event": "init", "rfp_text": rfp_text}) + "\n"
        
        try:
            # langgraph.astream yields events as a dictionary: {node_name: state_updates}
            async for event in graph.astream(initial_state):
                for node_name, updates in event.items():
                    # We send the node name and the specific updates it made
                    payload = {
                        "event": "node_update",
                        "node": node_name,
                        "updates": updates
                    }
                    yield json.dumps(payload) + "\n"
                    
            yield json.dumps({"event": "done"}) + "\n"
        except Exception as e:
            print(f"Streaming Error: {e}")
            yield json.dumps({"event": "error", "message": str(e)}) + "\n"

    return StreamingResponse(event_generator(), media_type="application/x-ndjson")


# --- BATCH ENDPOINT ---
async def _process_single_file(file: UploadFile, user_id: str) -> dict:
    """Processes one file through the full LangGraph pipeline (async, non-streaming).
    The BATCH_SEMAPHORE ensures at most 3 of these run concurrently."""
    async with BATCH_SEMAPHORE:
        filename = file.filename
        print(f"\n[BATCH] Starting: {filename}")

        file_bytes = await file.read()
        rfp_text = extract_text(file_bytes)

        if len(rfp_text.strip()) < 10:
            print(f"[BATCH] Skipping {filename}: not enough text.")
            return {
                "filename": filename,
                "is_match": False,
                "is_valid_rfp": False,
                "document_type": "Unreadable PDF",
                "evaluator_reasoning": "Failed to extract readable text from this PDF.",
                "current_draft": None,
            }

        initial_state = {
            "rfp_text": rfp_text,
            "user_id": user_id,
            "document_type": "",
            "is_valid_rfp": False,
            "hard_constraints": {},
            "requirements": [],
            "cv_context": "",
            "is_match": False,
            "evaluator_reasoning": "",
            "current_draft": "",
            "review_feedback": "",
            "revision_count": 0,
        }

        try:
            final_state = await graph.ainvoke(initial_state)
            print(f"[BATCH] Finished: {filename} | match={final_state.get('is_match')}")
            return {
                "filename": filename,
                "is_match": final_state.get("is_match", False),
                "is_valid_rfp": final_state.get("is_valid_rfp", False),
                "document_type": final_state.get("document_type", ""),
                "evaluator_reasoning": final_state.get("evaluator_reasoning", ""),
                "current_draft": final_state.get("current_draft") or None,
            }
        except Exception as e:
            print(f"[BATCH] Error on {filename}: {e}")
            return {
                "filename": filename,
                "is_match": False,
                "is_valid_rfp": False,
                "document_type": "Error",
                "evaluator_reasoning": f"Pipeline error: {str(e)}",
                "current_draft": None,
            }


@app.post("/api/evaluate-rfp-batch")
async def evaluate_rfp_batch(
    files: List[UploadFile] = File(...),
    user_id: str = Form(...)
):
    """Accepts multiple PDF files and processes them in parallel (max 3 at once).
    Returns a JSON array of results once all jobs are complete."""
    print(f"\n--- BATCH REQUEST RECEIVED: {len(files)} file(s) for user {user_id} ---")
    for f in files:
        print(f"  - {f.filename}")

    # asyncio.gather fires all tasks concurrently; BATCH_SEMAPHORE caps actual LLM calls to 3
    results = await asyncio.gather(*[_process_single_file(f, user_id) for f in files])

    print(f"\n[BATCH] All {len(files)} job(s) complete.")
    return JSONResponse(content=list(results))


# --- CV INGESTION ENDPOINT ---
@app.post("/api/upload-cv")
async def upload_cv(
    file: UploadFile = File(...),
    user_id: str = Form(...)
):
    """Parses a raw PDF resume via LLM, segments it, and pushes vectors to Qdrant."""
    print(f"\n--- CV UPLOAD REQUEST RECEIVED ---")
    print(f"File Name: {file.filename} | User: {user_id}")
    
    file_bytes = await file.read()
    raw_text = extract_text(file_bytes)
    
    if len(raw_text.strip()) < 50:
        return JSONResponse(status_code=400, content={"error": "PDF is empty or unreadable."})
        
    try:
        # 1. Pre-flight classification (Fail Fast)
        classification = classify_cv_document(raw_text)
        if not classification.get("is_valid_resume") or classification.get("confidence_score", 0) < 80:
            doc_type = classification.get("document_type", "Unknown")
            return JSONResponse(
                status_code=400, 
                content={
                    "status": "error",
                    "error": "Invalid Document", 
                    "message": f"This appears to be a {doc_type}. Please upload a valid Resume or CV."
                }
            )

        # 2. LLM parsing (Semantic Chunking - Expensive)
        chunks = parse_cv_to_json(raw_text)
        if not chunks:
            return JSONResponse(status_code=500, content={"error": "LLM failed to generate semantic chunks."})
            
        # Qdrant multi-tenant upsert
        upsert_count = upsert_cv_to_qdrant(chunks, user_id)
        
        return {
            "status": "success", 
            "message": f"Successfully parsed and vectorized {upsert_count} chunks.",
            "chunks_upserted": upsert_count,
            "user_id": user_id
        }
    except Exception as e:
        print(f"CV Upload Error: {e}")
        return JSONResponse(status_code=500, content={"error": str(e)})

# --- AWS LAMBDA ADAPTER ---
# --- AWS LAMBDA HANDLER ---
# This single line converts the FastAPI application into a form
# that AWS API Gateway and Lambda understand natively via Mangum.
handler = Mangum(app)
