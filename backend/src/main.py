from fastapi import FastAPI, File, UploadFile, Form, HTTPException
from fastapi.middleware.cors import CORSMiddleware
from fastapi.responses import JSONResponse, StreamingResponse
from mangum import Mangum
import pdfplumber
import io
import json
import asyncio
import jwt
import hashlib
import os
from decimal import Decimal
from typing import List
import boto3
from datetime import datetime, timezone, timedelta
from boto3.dynamodb.conditions import Key

from src.agent_graph import build_graph
from src.cv_processor import extract_text_from_pdf_bytes, parse_cv_to_json, upsert_cv_to_qdrant, classify_cv_document

app = FastAPI(title="AutoBid AI", description="Serverless RFP Evaluator")

app.add_middleware(
    CORSMiddleware,
    allow_origins=["*"],
    allow_credentials=False,
    allow_methods=["*"],
    allow_headers=["*"],
)

print("Initializing LangGraph Pipeline...")
graph = build_graph()

print("Connecting to DynamoDB...")
dynamodb = boto3.resource('dynamodb', region_name='eu-north-1')
history_table = dynamodb.Table('Quill_History')
analytics_table = dynamodb.Table('Quill_Analytics')

# ── ADMIN AUTH ──────────────────────────────────────────────────────────────
ADMIN_JWT_SECRET = os.getenv("ADMIN_JWT_SECRET", "quill-admin-secret-change-in-production")
def _create_token(username: str) -> str:
    payload = {
        "sub": username,
        "iat": datetime.now(timezone.utc),
        "exp": datetime.now(timezone.utc) + timedelta(hours=24),
    }
    return jwt.encode(payload, ADMIN_JWT_SECRET, algorithm="HS256")


def _validate_token(token: str) -> str:
    try:
        data = jwt.decode(token, ADMIN_JWT_SECRET, algorithms=["HS256"])
        return data["sub"]
    except jwt.ExpiredSignatureError:
        raise HTTPException(status_code=401, detail="Token expired")
    except jwt.InvalidTokenError:
        raise HTTPException(status_code=401, detail="Invalid token")


def _to_json_safe(obj):
    """Recursively convert DynamoDB Decimal types to native Python for JSON."""
    if isinstance(obj, list):
        return [_to_json_safe(i) for i in obj]
    if isinstance(obj, dict):
        return {k: _to_json_safe(v) for k, v in obj.items()}
    if isinstance(obj, Decimal):
        return int(obj) if obj % 1 == 0 else float(obj)
    return obj


def _scan_history():
    """Paginated full scan of Quill_History."""
    items: list = []
    resp = history_table.scan()
    items.extend(resp.get('Items', []))
    while 'LastEvaluatedKey' in resp:
        resp = history_table.scan(ExclusiveStartKey=resp['LastEvaluatedKey'])
        items.extend(resp.get('Items', []))
    return items


# ── CORE HELPERS ─────────────────────────────────────────────────────────────
def save_to_history(user_id: str, filename: str, is_match: bool, reasoning: str, final_draft: str | None):
    try:
        status = "Drafted" if is_match and final_draft else "Rejected"
        timestamp = datetime.now(timezone.utc).isoformat()
        history_table.put_item(Item={
            "user_id": user_id,
            "timestamp": timestamp,
            "filename": filename,
            "status": status,
            "is_match": is_match,
            "gatekeeper_reasoning": reasoning or "",
            "final_draft": final_draft or "",
        })
        print(f"[DynamoDB] Saved history for user {user_id}: {filename} ({status})")
    except Exception as e:
        print(f"[DynamoDB] Error saving history: {e}")


def extract_text(file_bytes: bytes) -> str:
    return extract_text_from_pdf_bytes(file_bytes)


BATCH_SEMAPHORE = asyncio.Semaphore(3)

# ── ADMIN ENDPOINTS ───────────────────────────────────────────────────────────

@app.post("/api/admin/login")
async def admin_login(username: str = Form(...), password: str = Form(...)):
    try:
        resp = history_table.get_item(
            Key={"user_id": f"ADMIN#{username}", "timestamp": "CREDENTIAL"}
        )
        item = resp.get("Item")
        if not item:
            raise HTTPException(status_code=401, detail="Invalid credentials")
        pw_hash = hashlib.sha256(password.encode()).hexdigest()
        if item.get("password_hash") != pw_hash:
            raise HTTPException(status_code=401, detail="Invalid credentials")
        return {"token": _create_token(username), "username": username}
    except HTTPException:
        raise
    except Exception as e:
        raise HTTPException(status_code=500, detail=str(e))


@app.post("/api/admin/stats")
async def admin_stats(token: str = Form(...)):
    _validate_token(token)
    all_items = _scan_history()
    evals = [
        item for item in all_items
        if not item.get('user_id', '').startswith('ADMIN#')
        and item.get('timestamp') != 'CREDENTIAL'
    ]

    total = len(evals)
    unique_users = len(set(item['user_id'] for item in evals)) if evals else 0
    drafted = sum(1 for item in evals if item.get('status') == 'Drafted')
    rejected = total - drafted
    success_rate = round(drafted / total * 100, 1) if total > 0 else 0

    today_str = datetime.now(timezone.utc).strftime('%Y-%m-%d')
    today_count = sum(1 for item in evals if item.get('timestamp', '').startswith(today_str))

    daily: dict = {}
    for item in evals:
        date = item.get('timestamp', '')[:10]
        if date:
            daily[date] = daily.get(date, 0) + 1

    total_visits = unique_users
    try:
        visit_resp = analytics_table.query(
            KeyConditionExpression=Key('event_type').eq('VISIT')
        )
        total_visits = len(visit_resp.get('Items', []))
    except Exception:
        pass

    return {
        "total_evaluations": total,
        "unique_users": unique_users,
        "total_visits": total_visits,
        "drafted": drafted,
        "rejected": rejected,
        "success_rate": success_rate,
        "today_evaluations": today_count,
        "daily_breakdown": daily,
    }


@app.post("/api/admin/logs")
async def admin_logs(token: str = Form(...), limit: int = Form(100)):
    _validate_token(token)
    all_items = _scan_history()
    evals = [
        item for item in all_items
        if not item.get('user_id', '').startswith('ADMIN#')
        and item.get('timestamp') != 'CREDENTIAL'
    ]
    evals.sort(key=lambda x: x.get('timestamp', ''), reverse=True)
    return JSONResponse(content=_to_json_safe(evals[:limit]))


@app.post("/api/track-visit")
async def track_visit(user_id: str = Form(...)):
    try:
        ts = datetime.now(timezone.utc).isoformat()
        analytics_table.put_item(Item={
            "event_type": "VISIT",
            "sk": f"{ts}#{user_id}",
            "user_id": user_id,
            "date": ts[:10],
        })
    except Exception as e:
        print(f"[Analytics] Visit tracking error: {e}")
    return {"status": "ok"}


# ── RFP EVALUATION ───────────────────────────────────────────────────────────

@app.post("/api/evaluate-rfp")
async def evaluate_rfp(
    file: UploadFile = File(...),
    user_id: str = Form(...)
):
    print(f"\n--- API REQUEST RECEIVED (STREAMING) ---")
    print(f"File Name: {file.filename}")

    file_bytes = await file.read()
    rfp_text = extract_text(file_bytes)

    if len(rfp_text.strip()) < 10:
        return {
            "status": "error",
            "is_match": False,
            "gatekeeper_reasoning": "Failed to extract readable text from PDF.",
            "final_draft": None
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
        "revision_count": 0
    }

    async def event_generator():
        yield json.dumps({"event": "init", "rfp_text": rfp_text}) + "\n"

        final_is_match = False
        final_reasoning = ""
        final_draft = ""

        try:
            async for event in graph.astream(initial_state):
                for node_name, updates in event.items():
                    payload = {
                        "event": "node_update",
                        "node": node_name,
                        "updates": updates
                    }
                    yield json.dumps(payload) + "\n"

                    if node_name == "evaluator":
                        final_is_match = updates.get("is_match", False)
                        final_reasoning = updates.get("evaluator_reasoning", "")
                    if node_name == "drafter":
                        final_draft = updates.get("current_draft", "")

            save_to_history(user_id, file.filename, final_is_match, final_reasoning, final_draft)
            yield json.dumps({"event": "done"}) + "\n"
        except Exception as e:
            print(f"Streaming Error: {e}")
            yield json.dumps({"event": "error", "message": str(e)}) + "\n"

    return StreamingResponse(event_generator(), media_type="application/x-ndjson")


# ── BATCH ─────────────────────────────────────────────────────────────────────

async def _process_single_file(file: UploadFile, user_id: str) -> dict:
    async with BATCH_SEMAPHORE:
        filename = file.filename
        print(f"\n[BATCH] Starting: {filename}")

        file_bytes = await file.read()
        rfp_text = extract_text(file_bytes)

        if len(rfp_text.strip()) < 10:
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
    print(f"\n--- BATCH REQUEST RECEIVED: {len(files)} file(s) for user {user_id} ---")
    results = await asyncio.gather(*[_process_single_file(f, user_id) for f in files])
    print(f"\n[BATCH] All {len(files)} job(s) complete.")
    return JSONResponse(content=list(results))


# ── CV INGESTION ──────────────────────────────────────────────────────────────

@app.post("/api/upload-cv")
async def upload_cv(
    file: UploadFile = File(...),
    user_id: str = Form(...)
):
    print(f"\n--- CV UPLOAD REQUEST RECEIVED ---")
    print(f"File Name: {file.filename} | User: {user_id}")

    file_bytes = await file.read()
    raw_text = extract_text(file_bytes)

    if len(raw_text.strip()) < 50:
        return JSONResponse(status_code=400, content={"error": "PDF is empty or unreadable."})

    try:
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

        chunks = parse_cv_to_json(raw_text)
        if not chunks:
            return JSONResponse(status_code=500, content={"error": "LLM failed to generate semantic chunks."})

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


# ── HISTORY ───────────────────────────────────────────────────────────────────

@app.get("/api/history/{user_id}")
async def get_history(user_id: str):
    print(f"\n--- HISTORY REQUEST for user: {user_id} ---")
    try:
        response = history_table.query(
            KeyConditionExpression=Key('user_id').eq(user_id),
            ScanIndexForward=False
        )
        items = response.get('Items', [])
        print(f"[DynamoDB] Found {len(items)} history items for user {user_id}")
        return JSONResponse(content=_to_json_safe(items))
    except Exception as e:
        print(f"[DynamoDB] Error fetching history: {e}")
        return JSONResponse(status_code=500, content={"error": str(e)})


# ── LAMBDA HANDLER ────────────────────────────────────────────────────────────
handler = Mangum(app)
