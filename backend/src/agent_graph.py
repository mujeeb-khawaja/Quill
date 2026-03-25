import os
import json
import pdfplumber
from typing import TypedDict, List
from dotenv import load_dotenv

# LangGraph
from langgraph.graph import StateGraph, END

# LangChain LLMs
from langchain_groq import ChatGroq
from langchain_google_genai import ChatGoogleGenerativeAI
from langchain_openai import ChatOpenAI

# Qdrant (for Researcher Node)
from langchain_huggingface import HuggingFaceEmbeddings
from langchain_qdrant import QdrantVectorStore
from qdrant_client import QdrantClient

# Load Environment Variables
load_dotenv()

# --- STATE DEFINITION ---
class AgentState(TypedDict):
    rfp_text: str
    document_type: str       # Classifier: e.g. 'Job RFP', 'Motivation Letter', 'Resume'
    is_valid_rfp: bool       # Classifier: True only if document is a valid RFP/Job Description
    requirements: List[str]
    cv_context: str
    is_match: bool           # Evaluator decision
    evaluator_reasoning: str # Evaluator reasoning
    current_draft: str
    review_feedback: str
    revision_count: int

# --- API INITIALIZATION ---
def get_llm():
    """
    Returns an LLM instance with built-in fallback routing.
    Primary: Groq (Llama 3.3 70B)
    Secondary: Gemini (Flash 1.5)
    Fallback: OpenRouter (Meta Llama 3.3 70B)
    """
    print("      [SYSTEM] Initializing LLM Engines with Fallback logic...")
    groq_llm = ChatGroq(
        model="llama-3.3-70b-versatile", 
        api_key=os.getenv("GROQ_API_KEY"),
        temperature=0.2
    )
    
    gemini_llm = ChatGoogleGenerativeAI(
        model="gemini-1.5-flash",
        api_key=os.getenv("GEMINI_API_KEY"),
        temperature=0.2
    )

    openrouter_llm = ChatOpenAI(
        model="meta-llama/llama-3.3-70b-instruct:free",
        api_key=os.getenv("META_LLM_KEY"),
        base_url="https://openrouter.ai/api/v1",
        temperature=0.2
    )
    
    fallback_llm = gemini_llm.with_fallbacks([groq_llm, openrouter_llm])
    return fallback_llm

llm = get_llm()

def _init_retriever():
    print("      [SYSTEM] Initializing Qdrant Retriever and Embedding Model...")
    embeddings = HuggingFaceEmbeddings(
        model_name="BAAI/bge-small-en-v1.5",
        model_kwargs={'device': 'cpu'},
        encode_kwargs={'normalize_embeddings': True}
    )
    qdrant = QdrantVectorStore.from_existing_collection(
        embedding=embeddings,
        url=os.getenv("QDRANT_URL"),
        api_key=os.getenv("QDRANT_API_KEY"),
        collection_name="cv_portfolio"
    )
    return qdrant.as_retriever(search_kwargs={"k": 3})

# Initialize globally so it's not reloaded on every request
global_retriever = None

def get_retriever():
    global global_retriever
    if global_retriever is None:
        global_retriever = _init_retriever()
    return global_retriever

# --- NODE 1: EXTRACTOR + DOCUMENT CLASSIFIER ---
def extractor_node(state: AgentState):
    print("\n" + "="*50)
    print("🛠️  [NODE: EXTRACTOR] - Classifying document & extracting requirements")
    print("="*50)
    print(f"   -> Received RFP Text ({len(state.get('rfp_text', ''))} characters)")

    prompt = f"""
    You are an expert document classifier and technical AI architect.
    
    STEP 1 — CLASSIFY THE DOCUMENT:
    Determine the true nature of the provided document text.
    - If it is a Request for Proposal (RFP), Job Description, Freelance Gig Posting, or any document
      soliciting a professional bid or application FOR A SERVICE/ROLE, set "is_valid_rfp" to true.
    - If it is a personal letter (cover letter, motivation letter), resume/CV, receipt, invoice,
      or any other document that is NOT asking for a proposal, set "is_valid_rfp" to false.
    
    STEP 2 — CLASSIFY THE DOCUMENT TYPE:
    Identify a short, human-readable label for the document type.
    Examples: "Job RFP", "Freelance Gig", "Motivation Letter", "Resume", "Invoice", "Unknown Document".

    STEP 3 — EXTRACT REQUIREMENTS (only if is_valid_rfp is true):
    If it IS a valid RFP, extract the core technical and business requirements as a JSON array of strings.
    If it is NOT a valid RFP, leave "extracted_requirements" as an empty array [].
    
    Output ONLY a valid JSON object in exactly this format. No other text:
    {{"is_valid_rfp": true, "document_type": "Job RFP", "extracted_requirements": ["Requirement 1", "Requirement 2"]}}
    
    DOCUMENT TEXT:
    {state['rfp_text']}
    """

    print("   -> Sending document to LLM for classification and extraction...")
    response = llm.invoke(prompt)

    try:
        content = response.content
        if "```json" in content:
            content = content.split("```json")[1].split("```")[0].strip()
        elif "```" in content:
            content = content.split("```")[1].strip()
        result = json.loads(content)

        is_valid_rfp = bool(result.get("is_valid_rfp", False))
        document_type = str(result.get("document_type", "Unknown Document"))
        requirements = result.get("extracted_requirements", [])
        if not isinstance(requirements, list):
            requirements = []

        print(f"   -> Document Type: {document_type}")
        print(f"   -> Is Valid RFP: {'✅ YES' if is_valid_rfp else '❌ NO'}")
        if is_valid_rfp:
            print(f"   ✅ Successfully Extracted {len(requirements)} Requirements:")
            for r in requirements:
                print(f"      - {r}")
        else:
            print(f"   ⛔ Halting pipeline — document is not a valid RFP.")

    except Exception as e:
        print(f"   ⚠️ Warning: Extractor/Classifier failed clean JSON. Error: {e}")
        is_valid_rfp = False
        document_type = "Unknown Document"
        requirements = []

    return {
        "is_valid_rfp": is_valid_rfp,
        "document_type": document_type,
        "requirements": requirements
    }

# --- NODE 2: RESEARCHER ---
def researcher_node(state: AgentState):
    print("\n" + "="*50)
    print("🔎 [NODE: RESEARCHER] - Finding CV matches in Qdrant")
    print("="*50)
    
    retriever = get_retriever()
    requirements = state.get("requirements", [])
    
    query = " ".join(requirements)
    print(f"   -> Converting requirements to Embeddings to search Qdrant...")
    
    docs = retriever.invoke(query)
    print(f"   ✅ Retrieved {len(docs)} matching context chunks from CV Database:")
    for i, d in enumerate(docs):
        print(f"      [Match {i+1}] Category: {d.metadata.get('category')} | Skills: {d.metadata.get('skills')}")
        
    cv_context = "\n\n".join([f"Content: {d.page_content}\nMetadata: {d.metadata}" for d in docs])
    return {"cv_context": cv_context}

# --- NODE 3: EVALUATOR (NEW) ---
def evaluator_node(state: AgentState):
    print("\n" + "="*50)
    print("⚖️  [NODE: EVALUATOR] - The Gatekeeper")
    print("="*50)
    
    prompt = f"""
    You are a strict Gatekeeper for an auto-bidding system.
    Evaluate if the user's CV Context strongly aligns with the core requirements of the RFP.
    
    CORE REQUIREMENTS:
    {state['requirements']}
    
    USER CV CONTEXT:
    {state['cv_context']}
    
    Determine if this is a suitable match to submit a proposal.
    Output ONLY a valid JSON object in exactly this format:
    {{"is_match": true, "reasoning": "Brief 1-sentence explanation"}}
    OR
    {{"is_match": false, "reasoning": "Brief 1-sentence explanation"}}
    No other text.
    """
    
    print("   -> Evaluating Match against CV Context...")
    response = llm.invoke(prompt)
    
    try:
        content = response.content
        if "```json" in content:
            content = content.split("```json")[1].split("```")[0].strip()
        elif "```" in content:
            content = content.split("```")[1].strip()
        result = json.loads(content)
        
        is_match = bool(result.get("is_match", False))
        reasoning = str(result.get("reasoning", "No reasoning provided."))
        print(f"   -> Match Result: {'✅ YES' if is_match else '❌ NO'} | Reasoning: {reasoning}")
        
    except Exception as e:
        print(f"   ⚠️ Warning: Evaluator failed clean JSON. Assuming NO MATCH. Error: {e}")
        is_match = False
        reasoning = "Failed to parse JSON evaluation."
        
    return {"is_match": is_match, "evaluator_reasoning": reasoning}

# --- NODE 4: DRAFTER ---
def drafter_node(state: AgentState):
    print("\n" + "="*50)
    print("✍️  [NODE: DRAFTER] - Writing the Proposal")
    print("="*50)
    
    revision_count = state.get("revision_count", 0) + 1
    print(f"   -> Draft Iteration: {revision_count}")
    
    review_feedback = state.get("review_feedback", "")
    feedback_prompt = ""
    if review_feedback:
        print(f"   -> Adapting to previous feedback: {review_feedback}")
        feedback_prompt = f"\nPrevious Reviewer Feedback to address: {review_feedback}"
    
    prompt = f"""
    You are an expert software proposal writer. Draft a professional, personalized 
    response to the client's RFP.

    WARNING: You are strictly forbidden from claiming any skill, software, or experience that is 
    not explicitly written in the provided CV Context. If the RFP asks for a skill you do not have, 
    ignore it or pivot to a related skill you DO have. Do not hallucinate.
    
    CLIENT REQUIREMENTS:
    {state['requirements']}
    
    YOUR CV CONTEXT (Use this to prove you have the skills):
    {state['cv_context']}
    {feedback_prompt}
    
    Draft the letter directly. Do not include placeholders like [Your Name]. Use 'Mujeeb Khawaja'.
    Conclude the letter professionally and stop generating. Do not repeat sentences.
    """
    
    print("   -> Sending Draft request to LLM...")
    response = llm.invoke(prompt)
    
    raw_draft = response.content
    print("   ✅ Draft completely generated.")
    print(f"   -> Draft Snippet: {raw_draft[:100]}...\n")
    
    return {"current_draft": raw_draft, "revision_count": revision_count}

# --- NODE 5: REVIEWER ---
def reviewer_node(state: AgentState):
    print("\n" + "="*50)
    print("👮 [NODE: REVIEWER] - Quality Control & Fact Checking")
    print("="*50)
    
    print("   -> Reviewing Draft against CV Context to prevent Hallucinations...")
    prompt = f"""
    You are a strict Quality Control Agent. Compare the proposed draft against the user's REAL CV context.
    If the draft claims skills or experience NOT found in the CV Context, you MUST reject it to prevent hallucinations.
    
    CV CONTEXT:
    {state['cv_context']}
    
    PROPOSED DRAFT:
    {state['current_draft']}
    
    Output exactly in this format:
    STATUS: [PASS or FAIL]
    FEEDBACK: [Your feedback here]
    """
    response = llm.invoke(prompt)
    content = response.content.strip()
    
    if "STATUS: PASS" in content.upper():
        print("   ✅ DECISION: PASS - No hallucinations detected.")
        return {"review_feedback": "PASS"}
    else:
        print("   ❌ DECISION: FAIL - Hallucinations or gaps found.")
        feedback = content.split("FEEDBACK:")[-1].strip() if "FEEDBACK:" in content else content
        print(f"   -> FEEDBACK PROVIDED: {feedback}")
        return {"review_feedback": feedback}

# --- ROUTING LOGIC ---
def route_after_classifier(state: AgentState):
    """Routes to researcher if valid RFP, otherwise halts immediately with a clear message."""
    print("\n" + "-"*40)
    print("🔀 [ROUTER] - Document Classifier Decision")
    if state.get("is_valid_rfp", False):
        print("   -> Path: Valid RFP detected. Routing to RESEARCHER.")
        print("-"*40)
        return "researcher"
    else:
        doc_type = state.get("document_type", "Unknown Document")
        rejection_message = (
            f"Document Error: This appears to be a '{doc_type}', not a valid Job RFP or "
            f"Freelance Gig description. Please upload a proper RFP or job posting for evaluation."
        )
        print(f"   -> Path: Invalid document type ('{doc_type}'). Halting pipeline.")
        print("-"*40)
        # Inject the rejection message into state so the frontend Gatekeeper UI displays it
        state["evaluator_reasoning"] = rejection_message
        state["is_match"] = False
        return END

def evaluate_match(state: AgentState):
    print("\n" + "-"*40)
    print("🔀 [ROUTER] - Gatekeeper Decision")
    if state.get("is_match", False):
        print("   -> Path: Match Confirmed. Routing to DRAFTER.")
        print("-"*40)
        return "drafter"
    else:
        print(f"   -> Path: RFP Rejected. Skipping Draft. ({state.get('evaluator_reasoning', 'No Match')})")
        print("-"*40)
        return END

def should_continue_revision(state: AgentState):
    print("\n" + "-"*40)
    print("🔀 [ROUTER] - Evaluating Reviewer loop")
    if state.get("review_feedback") == "PASS":
        print("   -> Path: Proposal Approved. Routing to END.")
        print("-"*40)
        return END
    if state.get("revision_count", 0) >= 3:
        print("   -> Path: Max Revisions Reached (3). Forcing END.")
        print("-"*40)
        return END

    print("   -> Path: Proposal Failed. Routing back to DRAFTER for a rewrite.")
    print("-"*40)
    return "drafter"

# --- COMPILE GRAPH ---
def build_graph():
    print("\n[SYSTEM] Compiling LangGraph State Machine with Document Classifier + Evaluator Filter...")
    graph = StateGraph(AgentState)

    graph.add_node("extractor", extractor_node)
    graph.add_node("researcher", researcher_node)
    graph.add_node("evaluator", evaluator_node)
    graph.add_node("drafter", drafter_node)
    graph.add_node("reviewer", reviewer_node)

    graph.set_entry_point("extractor")
    # After extractor: classify first — only proceed to researcher if it's a valid RFP
    graph.add_conditional_edges("extractor", route_after_classifier)
    graph.add_edge("researcher", "evaluator")
    graph.add_conditional_edges("evaluator", evaluate_match)
    graph.add_edge("drafter", "reviewer")
    graph.add_conditional_edges("reviewer", should_continue_revision)

    return graph.compile()

# --- LOCAL BATCH TESTING ---
def extract_text_from_pdf(pdf_path):
    text = ""
    try:
        with pdfplumber.open(pdf_path) as pdf:
            for page in pdf.pages:
                page_text = page.extract_text()
                if page_text:
                    text += page_text + "\\n"
    except Exception as e:
        print(f"   [Error reading PDF {pdf_path}: {e}]")
    return text

if __name__ == "__main__":
    app = build_graph()
    
    test_dir = "./test_rfps/"
    if not os.path.exists(test_dir):
        print(f"\\nDirectory {test_dir} does not exist. Please create it and add test PDF files.")
    else:
        pdf_files = [f for f in os.listdir(test_dir) if f.lower().endswith(".pdf")]
        
        if not pdf_files:
            print(f"\\nNo PDF files found inside {test_dir}. Skipping batch processing.")
        else:
            for i, filename in enumerate(pdf_files):
                file_path = os.path.join(test_dir, filename)
                print("\\n" + "#"*70)
                print(f"🚀 BATCH PROCESSING FILE {i+1}/{len(pdf_files)}: {filename}")
                print("#"*70)
                
                print(f"Extracting text from {filename}...")
                rfp_text = extract_text_from_pdf(file_path)
                
                if len(rfp_text.strip()) < 10:
                    print(f"   ⚠️ Skipping {filename}: Not enough readable text extracted.")
                    continue
                
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
                
                final_state = app.invoke(initial_state)
                
                print("\\n" + "="*70)
                print(f"          🏁 FINAL OUTCOME FOR {filename} 🏁")
                print("="*70)
                if final_state.get("is_match", False) and final_state.get("review_feedback") == "PASS":
                    print(final_state["current_draft"])
                elif not final_state.get("is_match", False):
                    print(f"❌ REJECTED BY GATEKEEPER: {final_state.get('evaluator_reasoning')}")
                else:
                    print("⚠️ Reached max revisions or failed final review without resolving errors.")
                print("="*70 + "\\n")