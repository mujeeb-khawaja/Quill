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

@app.post("/api/evaluate-rfp")
async def evaluate_rfp(file: UploadFile = File(...)):
    print(f"\n--- API REQUEST RECEIVED ---")
    print(f"File Name: {file.filename}")
    
    # 1. Read file bytes
    file_bytes = await file.read()
    
    # 2. Extract Text
    rfp_text = extract_text_from_pdf_bytes(file_bytes)
    
    if len(rfp_text.strip()) < 10:
        print("Error: Not enough readable text extracted.")
        return {
            "status": "error",
            "is_match": False,
            "gatekeeper_reasoning": "Failed to extract readable text from PDF.",
            "final_draft": None
        }

    # 3. Setup Initial State for LangGraph
    initial_state = {
        "rfp_text": rfp_text,
        "requirements": [],
        "cv_context": "",
        "is_match": False,
        "evaluator_reasoning": "",
        "current_draft": "",
        "review_feedback": "",
        "revision_count": 0
    }
    
    print("\nInvoking Agentic Workflow...")
    # 4. Invoke LangGraph (Synchronous run for API simplicity)
    final_state = graph.invoke(initial_state)
    
    # 5. Build Final Payload for React UI
    is_match = final_state.get("is_match", False)
    reasoning = final_state.get("evaluator_reasoning", "")
    
    if is_match and final_state.get("review_feedback") == "PASS":
        draft = final_state.get("current_draft", "")
    else:
        draft = None
        
    print(f"--- API REQUEST FINISHED: {'MATCH' if is_match else 'REJECTED'} ---")

    return {
        "status": "success",
        "rfp_text": rfp_text,
        "is_match": is_match,
        "gatekeeper_reasoning": reasoning,
        "final_draft": draft
    }

# --- AWS LAMBDA ADAPTER ---
# This single line converts the FastAPI application into a form 
# that AWS API Gateway and Lambda understand natively.
handler = Mangum(app)
