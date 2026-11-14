from uuid import UUID
from fastapi import APIRouter, Depends, HTTPException
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
    session_id: str | None = None       # sessão de validação (modo avaliação), se houver
    user_id: str | None = None          # participante avaliado, quando um admin/mediador opera


class AttemptBody(BaseModel):
    """Item 4 — uma tentativa no modo avaliação: gesto pedido × gesto reconhecido."""
    session_id: str
    expected: str
    predicted: str | None = None        # None = rejeitada (sem reconhecimento no tempo limite)
    confidence: float | None = None
    latency_ms: int | None = None       # do início da tentativa até o resultado
    segment_frames: int | None = None   # duração do trecho, em quadros (item 3)
    pose_ok_ratio: float | None = None  # fração do trecho com pose válida (item 2)
    config: str = "A"                   # configuração do classificador: A, B ou C
    w: float | None = None              # peso do corpo na distância (configs B e C)
    app_version: str | None = None
    user_id: str | None = None          # participante avaliado, quando um admin/mediador opera


async def _resolve_participant(requested: str | None, current_user: dict) -> str:
    """Quem é o participante do registro. Só admin pode registrar em nome de outra pessoa."""
    own = str(current_user["user_id"])
    if not requested or requested == own:
        return own
    if current_user.get("role") != "admin":
        raise HTTPException(403, "Apenas administradores registram dados de outro participante")
    try:
        UUID(requested)
    except ValueError:
        raise HTTPException(400, "Identificador de participante inválido")
    exists = await db.fetchval("SELECT 1 FROM users WHERE id = $1", requested)
    if not exists:
        raise HTTPException(404, "Participante não encontrado")
    return requested


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


@router.post("/metrics/attempt", status_code=201)
async def log_attempt(body: AttemptBody, current_user: dict = Depends(get_current_user)):
    session_id = body.session_id.strip()
    expected = body.expected.strip().upper()
    if not session_id or not expected:
        raise HTTPException(400, "session_id e expected são obrigatórios")

    participant = await _resolve_participant(body.user_id, current_user)
    predicted = (body.predicted or "").strip().upper() or None

    row = await db.fetchrow(
        """
        INSERT INTO evaluation_attempts
            (user_id, recorded_by, session_id, expected, predicted, confidence,
             latency_ms, segment_frames, pose_ok_ratio, config, w, app_version)
        VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12)
        RETURNING id
        """,
        participant, current_user["user_id"], session_id, expected, predicted,
        body.confidence, body.latency_ms, body.segment_frames, body.pose_ok_ratio,
        (body.config or "A").strip().upper()[:8], body.w, body.app_version,
    )
    return {"ok": True, "id": str(row["id"])}


@router.post("/feedback", status_code=201)
async def submit_feedback(body: FeedbackBody, current_user: dict = Depends(get_current_user)):
    participant = await _resolve_participant(body.user_id, current_user)
    comment = (body.comment or "").strip()[:1000] or None
    session_id = (body.session_id or "").strip() or None
    row = await db.fetchrow(
        "INSERT INTO feedback"
        " (user_id, recognized_well, easy_to_use, would_use_again, comment, session_id)"
        " VALUES ($1, $2, $3, $4, $5, $6) RETURNING id",
        participant,
        body.recognized_well,
        body.easy_to_use,
        body.would_use_again,
        comment,
        session_id,
    )
    return {"ok": True, "id": str(row["id"])}
