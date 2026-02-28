import asyncio
import uuid
from enum import Enum
from typing import Any


class JobState(str, Enum):
    QUEUED = "QUEUED"
    RUNNING = "RUNNING"
    DONE = "DONE"
    FAILED = "FAILED"
    CANCELED = "CANCELED"


jobs: dict[str, dict[str, Any]] = {}


def create_job(input_text: str) -> str:
    job_id = str(uuid.uuid4())
    jobs[job_id] = {
        "id": job_id,
        "input_text": input_text,
        "state": JobState.QUEUED,
        "progress": 0,
        "result": None,
        "error": None,
        "cancel_flag": False,
    }
    return job_id


def cancel_job(job_id: str) -> bool:
    job = jobs.get(job_id)
    if job is None:
        return False
    if job["state"] in (JobState.DONE, JobState.FAILED, JobState.CANCELED):
        return False
    job["cancel_flag"] = True
    return True


def get_job(job_id: str) -> dict[str, Any] | None:
    return jobs.get(job_id)


def cleanup_job(job_id: str) -> None:
    """Remove a terminal-state job from memory."""
    job = jobs.get(job_id)
    if job and job["state"] in (JobState.DONE, JobState.FAILED, JobState.CANCELED):
        del jobs[job_id]


def _auto_purge_jobs() -> None:
    """Auto-purge oldest completed jobs when dict exceeds 100 entries."""
    if len(jobs) <= 100:
        return
    terminal = [
        jid
        for jid, j in jobs.items()
        if j["state"] in (JobState.DONE, JobState.FAILED, JobState.CANCELED)
    ]
    for jid in terminal:
        del jobs[jid]
        if len(jobs) <= 100:
            break


async def run_inference(job_id: str):
    """Generator that yields SSE events for a 10-step mock inference."""
    job = jobs.get(job_id)
    if job is None:
        yield {"type": "error", "job_id": job_id, "error": "Job not found"}
        return

    job["state"] = JobState.RUNNING
    yield {"type": "progress", "job_id": job_id, "progress": 0, "message": "Starting inference..."}

    total_steps = 10
    for step in range(1, total_steps + 1):
        if job["cancel_flag"]:
            job["state"] = JobState.CANCELED
            yield {"type": "cancelled", "job_id": job_id}
            cleanup_job(job_id)
            return

        await asyncio.sleep(1)
        progress = int((step / total_steps) * 100)
        job["progress"] = progress
        message = f"Processing step {step}/{total_steps}..."
        yield {"type": "progress", "job_id": job_id, "progress": progress, "message": message}

    # Produce result
    result = job["input_text"].upper()
    job["state"] = JobState.DONE
    job["result"] = result
    yield {"type": "done", "job_id": job_id, "result": result}

    cleanup_job(job_id)
    _auto_purge_jobs()
