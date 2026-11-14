import json
from fastapi import APIRouter, HTTPException, Depends
from .. import database as db
from ..auth.deps import get_current_user
from ..ml.classifier import weighted_knn
from ..ml.compressor import compress_samples
from ..ml.quality import filter_outliers
from ..ml.temporal import extract_temporal_features
from .schemas import GestureCreate, ClassifyRequest, CompressRequest, RecordingCreate

router = APIRouter()
# Item 1 — DELETE /api/recordings/{id} (prefixo /api, montado no main)
recordings_router = APIRouter()


def _parse_jsonb(value) -> list:
    if isinstance(value, list):
        return value
    if value:
        return json.loads(value)
    return []


def _row_to_out(row: dict) -> dict:
    ca = row["created_at"]
    ua = row["updated_at"]
    return {
        "id": str(row["id"]),
        "name": row["name"],
        "samples": _parse_jsonb(row["samples"]),
        "temporal_features": _parse_jsonb(row.get("samples_temporal") or []),
        "sample_count": row["sample_count"],
        "created_at": ca.isoformat() if hasattr(ca, "isoformat") else str(ca),
        "updated_at": ua.isoformat() if hasattr(ua, "isoformat") else str(ua),
    }


@router.get("")
async def list_gestures(current_user: dict = Depends(get_current_user)):
    rows = await db.fetch(
        "SELECT id, name, samples, samples_temporal, sample_count, created_at, updated_at"
        " FROM gestures WHERE user_id = $1 ORDER BY created_at ASC",
        current_user["user_id"],
    )
    return [_row_to_out(r) for r in rows]


@router.get("/dataset")
async def collective_dataset(_: dict = Depends(get_current_user)):
    """
    Base coletiva: amostras de TODOS os participantes agregadas por nome de gesto.
    Retorna amostras comprimidas (compatibilidade) + vetor temporal de cada gravação
    (para o classificador temporal no navegador).
    """
    CAP_PER_NAME = 120

    # Item 1: a base coletiva agora vem das gravações (uma por repetição).
    rows = await db.fetch(
        "SELECT gesture_name, sampled, temporal FROM gesture_recordings ORDER BY created_at DESC"
    )

    agg: dict[str, dict] = {}
    for r in rows:
        name = r["gesture_name"]
        samples = _parse_jsonb(r["sampled"])
        temporal = _parse_jsonb(r["temporal"])

        bucket = agg.setdefault(name, {"samples": [], "temporal_vectors": []})
        if len(bucket["samples"]) < CAP_PER_NAME:
            bucket["samples"].extend(samples[:CAP_PER_NAME - len(bucket["samples"])])
        if temporal:
            bucket["temporal_vectors"].append(temporal)

    return [
        {
            "name": name,
            "samples": data["samples"][:CAP_PER_NAME],
            "temporal_vectors": data["temporal_vectors"],
        }
        for name, data in agg.items()
    ]


@router.get("/user/{user_id}")
async def list_user_gestures(user_id: str, current_user: dict = Depends(get_current_user)):
    if str(current_user["user_id"]) != user_id:
        raise HTTPException(403, "Acesso negado")

    rows = await db.fetch(
        "SELECT id, name, samples, sample_count FROM gestures"
        " WHERE user_id = $1 ORDER BY created_at ASC",
        user_id,
    )
    return [
        {
            "id": str(r["id"]),
            "name": r["name"],
            "samples": _parse_jsonb(r["samples"]),
            "sample_count": r["sample_count"],
        }
        for r in rows
    ]


@router.post("", status_code=201)
async def upsert_gesture(
    body: GestureCreate,
    current_user: dict = Depends(get_current_user),
):
    raw_samples = body.samples

    clean, _ = filter_outliers(body.samples)
    compressed = compress_samples(clean, n_clusters=20)

    # Extrai vetor temporal 252-dim a partir da sequência bruta de frames
    temporal_features = extract_temporal_features(raw_samples)

    gesture_name = body.name.strip().upper()

    row = await db.fetchrow(
        """
        INSERT INTO gestures (id, user_id, name, samples, samples_raw, samples_temporal, sample_count)
        VALUES (COALESCE($1::uuid, gen_random_uuid()), $2, $3, $4::jsonb, $5::jsonb, $6::jsonb, $7)
        ON CONFLICT (user_id, name) DO UPDATE
          SET samples          = EXCLUDED.samples,
              samples_raw      = EXCLUDED.samples_raw,
              samples_temporal = EXCLUDED.samples_temporal,
              sample_count     = EXCLUDED.sample_count,
              updated_at       = now()
        RETURNING id, name, samples, samples_temporal, sample_count, created_at, updated_at
        """,
        body.id if body.id else None,
        current_user["user_id"],
        gesture_name,
        compressed,
        raw_samples,
        temporal_features,
        len(compressed),
    )
    return _row_to_out(row)


@router.delete("/{gesture_id}")
async def delete_gesture(gesture_id: str, current_user: dict = Depends(get_current_user)):
    rows = await db.fetch(
        "DELETE FROM gestures WHERE id = $1 AND user_id = $2 RETURNING id",
        gesture_id,
        current_user["user_id"],
    )
    if not rows:
        raise HTTPException(404, "Gesto não encontrado")
    return {"ok": True}


@router.post("/classify")
async def classify_gesture(
    body: ClassifyRequest,
    current_user: dict = Depends(get_current_user),
):
    result = weighted_knn(body.vector, body.gestures)
    if result is None:
        return {"name": None, "confidence": 0.0}
    return result


@router.post("/compress")
async def compress_gesture_samples(
    body: CompressRequest,
    current_user: dict = Depends(get_current_user),
):
    compressed = compress_samples(body.samples)
    return {
        "samples": compressed,
        "original_count": len(body.samples),
        "compressed_count": len(compressed),
    }


# ── Item 1: gravações (uma por repetição) ─────────────────────────────────────

@router.post("/{name}/recordings", status_code=201)
async def create_recording(
    name: str,
    body: RecordingCreate,
    current_user: dict = Depends(get_current_user),
):
    """Cria uma gravação. Nunca sobrescreve as anteriores (append-only)."""
    gesture_name = name.strip().upper()
    if not gesture_name:
        raise HTTPException(400, "Nome do gesto inválido")

    # Item 4: sem aceite do termo de consentimento, nenhuma gravação é guardada.
    consent_at = await db.fetchval(
        "SELECT consent_at FROM users WHERE id = $1", current_user["user_id"]
    )
    if consent_at is None:
        raise HTTPException(
            403, "É preciso aceitar o termo de consentimento antes de gravar."
        )

    clean, _ = filter_outliers(body.frames)
    sampled = compress_samples(clean, n_clusters=20)
    temporal = extract_temporal_features(body.frames)

    row = await db.fetchrow(
        """
        INSERT INTO gesture_recordings
            (user_id, gesture_name, frames, body, sampled, temporal,
             hand_ratio, pose_ratio, source, app_version)
        VALUES ($1, $2, $3::jsonb, $4::jsonb, $5::jsonb, $6::jsonb, $7, $8, $9, $10)
        RETURNING id, created_at
        """,
        current_user["user_id"], gesture_name,
        body.frames, body.body, sampled, temporal,
        body.hand_ratio, body.pose_ratio, body.source, body.app_version,
    )
    return {
        "id": str(row["id"]),
        "gesture_name": gesture_name,
        "created_at": row["created_at"].isoformat(),
        "sampled_count": len(sampled),
        "frame_count": len(body.frames),
        # devolvidos para o classificador local reconhecer o gesto imediatamente
        "sampled": sampled,
        "temporal": temporal,
    }


@router.get("/my-recordings")
async def my_recordings(current_user: dict = Depends(get_current_user)):
    """Todas as gravações do participante, para a Biblioteca agrupar por gesto."""
    rows = await db.fetch(
        """
        SELECT id, gesture_name, created_at, hand_ratio, pose_ratio, source,
               jsonb_array_length(frames) AS n_frames
        FROM gesture_recordings
        WHERE user_id = $1
        ORDER BY gesture_name ASC, created_at DESC
        """,
        current_user["user_id"],
    )
    return [
        {
            "id": str(r["id"]),
            "gesture_name": r["gesture_name"],
            "created_at": r["created_at"].isoformat(),
            "hand_ratio": r["hand_ratio"],
            "pose_ratio": r["pose_ratio"],
            "source": r["source"],
            "n_frames": r["n_frames"],
        }
        for r in rows
    ]


@router.get("/{name}/recordings")
async def list_recordings(name: str, current_user: dict = Depends(get_current_user)):
    """Lista as gravações do próprio participante para um gesto (para a Biblioteca)."""
    gesture_name = name.strip().upper()
    rows = await db.fetch(
        """
        SELECT id, created_at, hand_ratio, pose_ratio, source,
               jsonb_array_length(frames) AS n_frames
        FROM gesture_recordings
        WHERE user_id = $1 AND gesture_name = $2
        ORDER BY created_at DESC
        """,
        current_user["user_id"], gesture_name,
    )
    return [
        {
            "id": str(r["id"]),
            "created_at": r["created_at"].isoformat(),
            "hand_ratio": r["hand_ratio"],
            "pose_ratio": r["pose_ratio"],
            "source": r["source"],
            "n_frames": r["n_frames"],
        }
        for r in rows
    ]


@recordings_router.delete("/recordings/{rec_id}")
async def delete_recording(rec_id: str, current_user: dict = Depends(get_current_user)):
    """Apaga uma única gravação, apenas a do próprio participante."""
    rows = await db.fetch(
        "DELETE FROM gesture_recordings WHERE id = $1 AND user_id = $2 RETURNING id",
        rec_id, current_user["user_id"],
    )
    if not rows:
        raise HTTPException(404, "Gravação não encontrada")
    return {"ok": True}
