import asyncio
import json
import logging
import os
from pathlib import Path

import uvicorn
from fastapi import FastAPI, HTTPException
from sse_starlette.sse import EventSourceResponse

# ── Logging setup ─────────────────────────────────────────────────
# Enable debug logging: set LOCALSUB_DEBUG=1 environment variable
_debug_mode = os.environ.get("LOCALSUB_DEBUG", "0") == "1"
_log_dir = Path(os.environ.get("APPDATA", ".")) / "LocalSub" / "logs"
_log_dir.mkdir(parents=True, exist_ok=True)

_log_level = logging.DEBUG if _debug_mode else logging.INFO
logging.basicConfig(
    level=_log_level,
    format="%(asctime)s [%(name)s] %(levelname)s: %(message)s",
    handlers=[
        logging.StreamHandler(),
        logging.FileHandler(_log_dir / "server.log", encoding="utf-8"),
    ],
)
_main_log = logging.getLogger("main")
_main_log.info("Server starting (debug=%s, log_dir=%s)", _debug_mode, _log_dir)

from models import InferenceRequest, InferenceResponse
from inference import create_job, cancel_job, get_job, run_inference
from stt_router import router as stt_router
from translate_router import router as translate_router
from runtime_router import router as runtime_router
from diarization_router import router as diarization_router

app = FastAPI(title="AI Inference Server")
app.include_router(stt_router)
app.include_router(translate_router)
app.include_router(runtime_router)
app.include_router(diarization_router)


@app.get("/health")
async def health():
    return {"status": "ok"}


@app.post("/inference/start", response_model=InferenceResponse)
async def start_inference(request: InferenceRequest):
    job_id = create_job(request.input_text)
    return InferenceResponse(job_id=job_id)


@app.get("/inference/stream/{job_id}")
async def stream_inference(job_id: str):
    job = get_job(job_id)
    if job is None:
        raise HTTPException(status_code=404, detail="Job not found")

    async def event_generator():
        async for event in run_inference(job_id):
            yield {"event": event["type"], "data": json.dumps(event)}
            if event["type"] in ("done", "error", "cancelled"):
                return
            await asyncio.sleep(0)

    return EventSourceResponse(event_generator())


@app.post("/inference/cancel/{job_id}")
async def cancel(job_id: str):
    success = cancel_job(job_id)
    if not success:
        raise HTTPException(status_code=400, detail="Cannot cancel job")
    return {"status": "cancelled"}


if __name__ == "__main__":
    uvicorn.run(app, host="127.0.0.1", port=9111)
