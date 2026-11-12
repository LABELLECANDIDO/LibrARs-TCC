from fastapi import APIRouter, Depends
from pydantic import BaseModel
from .. import database as db
from ..auth.deps import get_current_user

router = APIRouter()


class SessionMetricBody(BaseModel):
    mode: str = "call"                 # "call" | "translate"
    gestures_recognized: int = 0
    avg_confidence: float = 0.0
    duration_seconds: int = 0


class FeedbackBody(BaseModel):
    recognized_well: int | None = None  # 1 (ruim) · 2 (mais ou menos) · 3 (bem)
    easy_to_use: int | None = None      # 1 · 2 · 3
    would_use_again: int | None = None  # 0 (não) · 1 (sim)
    comment: str | None = None


@router.post("/metrics/session", status_code=201)
async def log_session(body: SessionMetricBody, current_user: dict = Depends(get_current_user)):
    row = await db.fetchrow(
        "INSERT INTO session_metrics"
        " (user_id, mode, gestures_recognized, avg_confidence, duration_seconds)"
        " VALUES ($1, $2, $3, $4, $5) RETURNING id",
        current_user["user_id"],
        body.mode,
        max(body.gestures_recognized, 0),
        max(min(body.avg_confidence, 1.0), 0.0),
        max(body.duration_seconds, 0),
    )
    return {"ok": True, "id": str(row["id"])}


@router.post("/feedback", status_code=201)
async def submit_feedback(body: FeedbackBody, current_user: dict = Depends(get_current_user)):
    comment = (body.comment or "").strip()[:1000] or None
    row = await db.fetchrow(
        "INSERT INTO feedback"
        " (user_id, recognized_well, easy_to_use, would_use_again, comment)"
        " VALUES ($1, $2, $3, $4, $5) RETURNING id",
        current_user["user_id"],
        body.recognized_well,
        body.easy_to_use,
        body.would_use_again,
        comment,
    )
    return {"ok": True, "id": str(row["id"])}
