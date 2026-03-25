from fastapi import FastAPI, File, UploadFile
from fastapi.middleware.cors import CORSMiddleware
from mangum import Mangum
import pdfplumber
import io

# Import the pre-built, working LangGraph logic
from src.agent_graph import build_graph

app = FastAPI(title="AutoBid AI", description="Serverless RFP Evaluator")

# Allow CORS for local dev and frontend communication
app.add_middleware(
    CORSMiddleware,
    allow_origins=["*"], # Restrict this to your domain in production
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)

# Initialize LangGraph once at startup
print("Initializing LangGraph Pipeline...")
graph = build_graph()

def extract_text_from_pdf_bytes(file_bytes: bytes) -> str:
    """Helper to extract text from a raw PDF byte stream."""
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

import json
from fastapi.responses import StreamingResponse

@app.post("/api/evaluate-rfp")
async def evaluate_rfp(file: UploadFile = File(...)):
    print(f"\n--- API REQUEST RECEIVED (STREAMING) ---")
    print(f"File Name: {file.filename}")
    
    # 1. Read file bytes
    file_bytes = await file.read()
    
    # 2. Extract Text
    rfp_text = extract_text_from_pdf_bytes(file_bytes)
    
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
        "document_type": "",
        "is_valid_rfp": False,
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

# --- AWS LAMBDA ADAPTER ---
# This single line converts the FastAPI application into a form 
# that AWS API Gateway and Lambda understand natively.
handler = Mangum(app)
