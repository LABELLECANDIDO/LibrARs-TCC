from fastapi import APIRouter, Depends, HTTPException
from pydantic import BaseModel
from .. import database as db
from ..auth.deps import get_current_admin

router = APIRouter()


class UpdateRoleRequest(BaseModel):
    role: str


class ResetRequest(BaseModel):
    scope: str        # "gestures" | "all"
    confirm: str      # precisa ser exatamente "ZERAR"


# ── Users ─────────────────────────────────────────────────────────────────────

@router.get("/users")
async def list_users(_: dict = Depends(get_current_admin)):
    users = await db.fetch(
        "SELECT id, email, name, role, is_student, has_disability,"
        " sexo, faixa_etaria, nivel_surdez, sabe_libras, created_at"
        " FROM users ORDER BY created_at DESC"
    )
    return {
        "total": len(users),
        "users": [
            {
                "id": str(u["id"]),
                "email": u["email"],
                "name": u["name"],
                "role": u["role"],
                "is_student": u["is_student"],
                "has_disability": u["has_disability"],
                "sexo": u["sexo"],
                "faixa_etaria": u["faixa_etaria"],
                "nivel_surdez": u["nivel_surdez"],
                "sabe_libras": u["sabe_libras"],
                "created_at": u["created_at"].isoformat() if u["created_at"] else None,
            }
            for u in users
        ],
    }


@router.get("/stats")
async def get_stats(_: dict = Depends(get_current_admin)):
    row = await db.fetchrow(
        "SELECT (SELECT COUNT(*) FROM users) as users_count,"
        "       (SELECT COUNT(DISTINCT gesture_name) FROM gesture_recordings) as gestures_count,"
        "       (SELECT COUNT(*) FROM gesture_recordings) as recordings_count,"
        "       (SELECT COALESCE(SUM(jsonb_array_length(frames)), 0) FROM gesture_recordings) as frames_count"
    )
    return {
        "total_users": row["users_count"] or 0,
        "total_gestures": row["gestures_count"] or 0,
        "total_recordings": row["recordings_count"] or 0,
        "total_samples": row["frames_count"] or 0,
    }


@router.patch("/users/{user_id}/role")
async def update_user_role(
    user_id: str,
    request: UpdateRoleRequest,
    admin: dict = Depends(get_current_admin),
):
    if request.role not in ("user", "admin"):
        raise HTTPException(400, "Role deve ser 'user' ou 'admin'")

    if str(admin["user_id"]) == user_id and request.role != "admin":
        raise HTTPException(400, "Você não pode remover suas próprias permissões de administrador")

    user = await db.fetchrow("SELECT id FROM users WHERE id = $1", user_id)
    if not user:
        raise HTTPException(404, "Usuário não encontrado")

    await db.execute("UPDATE users SET role = $1 WHERE id = $2", request.role, user_id)
    return {"message": f"Role do usuário atualizado para '{request.role}'"}


@router.delete("/users/{user_id}")
async def delete_user(user_id: str, admin: dict = Depends(get_current_admin)):
    if str(admin["user_id"]) == user_id:
        raise HTTPException(400, "Você não pode deletar sua própria conta")

    user = await db.fetchrow("SELECT id FROM users WHERE id = $1", user_id)
    if not user:
        raise HTTPException(404, "Usuário não encontrado")

    await db.execute("DELETE FROM users WHERE id = $1", user_id)
    return {"message": "Usuário deletado com sucesso"}


# ── Invites ───────────────────────────────────────────────────────────────────

@router.post("/invites")
async def create_invite(admin: dict = Depends(get_current_admin)):
    # Grava a expiração explicitamente (não depende do default da coluna, que em
    # bancos antigos pode estar incorreto e fazer o convite nascer já expirado).
    row = await db.fetchrow(
        "INSERT INTO invite_tokens (created_by, expires_at)"
        " VALUES ($1, now() + INTERVAL '7 days') RETURNING token, expires_at",
        admin["user_id"],
    )
    return {"token": row["token"], "expires_at": row["expires_at"].isoformat()}


@router.get("/invites")
async def list_invites(_: dict = Depends(get_current_admin)):
    rows = await db.fetch("""
        SELECT it.token, it.created_at, it.expires_at, it.used_at,
               u.name  AS used_by_name,
               u.email AS used_by_email
        FROM invite_tokens it
        LEFT JOIN users u ON u.id = it.used_by
        ORDER BY it.created_at DESC
    """)
    return [
        {
            "token": r["token"],
            "created_at": r["created_at"].isoformat(),
            "expires_at": r["expires_at"].isoformat(),
            "used_at": r["used_at"].isoformat() if r["used_at"] else None,
            "used_by_name": r["used_by_name"],
            "used_by_email": r["used_by_email"],
        }
        for r in rows
    ]


@router.delete("/invites/{token}")
async def revoke_invite(token: str, _: dict = Depends(get_current_admin)):
    result = await db.execute(
        "DELETE FROM invite_tokens WHERE token = $1 AND used_at IS NULL", token
    )
    if result == "DELETE 0":
        raise HTTPException(404, "Convite não encontrado ou já utilizado")
    return {"ok": True}


# ── Reset links ───────────────────────────────────────────────────────────────

@router.post("/users/{user_id}/reset-link")
async def create_reset_link(user_id: str, _: dict = Depends(get_current_admin)):
    user = await db.fetchrow("SELECT id, name, email FROM users WHERE id = $1", user_id)
    if not user:
        raise HTTPException(404, "Usuário não encontrado")

    # Invalida tokens anteriores não usados
    await db.execute(
        "DELETE FROM reset_tokens WHERE user_id = $1 AND used_at IS NULL", user_id
    )

    row = await db.fetchrow(
        "INSERT INTO reset_tokens (user_id) VALUES ($1) RETURNING token, expires_at",
        user_id,
    )
    return {
        "token": row["token"],
        "expires_at": row["expires_at"].isoformat(),
        "user_name": user["name"],
        "user_email": user["email"],
    }


# ── Reset da base (zona de perigo) ────────────────────────────────────────────

@router.post("/reset")
async def reset_database(request: ResetRequest, admin: dict = Depends(get_current_admin)):
    """
    Zera a base para uma nova coleta limpa. Protegido: só admin, e exige confirm="ZERAR".
      - scope="gestures": apaga apenas os gestos/amostras (mantém todas as contas)
      - scope="all":      apaga gestos, convites, tokens e TODOS os usuários
                          exceto o próprio admin que fez a chamada (mantém só o seu login)
    """
    if request.confirm != "ZERAR":
        raise HTTPException(400, "Confirmação inválida. Digite ZERAR para confirmar.")

    gestures_count = await db.fetchval("SELECT COUNT(*) FROM gestures") or 0

    if request.scope == "gestures":
        await db.execute_tx([
            ("DELETE FROM gesture_recordings", ()),
            ("DELETE FROM gestures", ()),
        ])
        return {"ok": True, "scope": "gestures", "gestures_deleted": gestures_count, "users_deleted": 0}

    if request.scope == "all":
        users_count = await db.fetchval(
            "SELECT COUNT(*) FROM users WHERE id <> $1", admin["user_id"]
        ) or 0
        await db.execute_tx([
            ("DELETE FROM gesture_recordings", ()),
            ("DELETE FROM gestures", ()),
            ("DELETE FROM session_metrics", ()),
            ("DELETE FROM feedback", ()),
            ("DELETE FROM evaluation_attempts", ()),
            ("DELETE FROM invite_tokens", ()),
            ("DELETE FROM reset_tokens", ()),
            ("DELETE FROM users WHERE id <> $1", (admin["user_id"],)),
        ])
        return {"ok": True, "scope": "all", "gestures_deleted": gestures_count, "users_deleted": users_count}

    raise HTTPException(400, "scope deve ser 'gestures' ou 'all'")


# ── Exportação dos dados brutos de pesquisa ───────────────────────────────────

@router.get("/export/raw")
async def export_raw_data(_: dict = Depends(get_current_admin)):
    """
    Exporta todas as amostras brutas de todos os participantes.
    Formato: lista de objetos com metadados do participante + amostras originais.
    Uso: download para treinamento de modelos de ML.
    """
    rows = await db.fetch("""
        SELECT r.id, r.gesture_name, r.frames, r.body, r.sampled, r.temporal,
               r.hand_ratio, r.pose_ratio, r.source, r.app_version, r.created_at,
               u.id          AS user_id,
               u.name        AS user_name,
               u.is_student, u.has_disability,
               u.sexo, u.faixa_etaria, u.nivel_surdez, u.sabe_libras,
               u.consent_at, u.consent_version
        FROM gesture_recordings r
        JOIN users u ON u.id = r.user_id
        ORDER BY u.name, r.gesture_name, r.created_at
    """)

    def _arr(v):
        return v if isinstance(v, list) else []

    return [
        {
            "recording_id": str(r["id"]),
            "gesture_name": r["gesture_name"],
            "collected_at": r["created_at"].isoformat(),
            "source": r["source"],
            "app_version": r["app_version"],
            "hand_ratio": r["hand_ratio"],
            "pose_ratio": r["pose_ratio"],
            "participant": {
                "id": str(r["user_id"]),
                "name": r["user_name"],
                "is_student": r["is_student"],
                "has_disability": r["has_disability"],
                "sexo": r["sexo"],
                "faixa_etaria": r["faixa_etaria"],
                "nivel_surdez": r["nivel_surdez"],
                "sabe_libras": r["sabe_libras"],
                "consent_at": r["consent_at"].isoformat() if r["consent_at"] else None,
                "consent_version": r["consent_version"],
            },
            # frames brutos (63 valores da mão por quadro); body = pose+features (item 2) ou null
            "frames": _arr(r["frames"]),
            "frame_count": len(_arr(r["frames"])),
            "body": r["body"] if isinstance(r["body"], list) else None,
            "temporal": _arr(r["temporal"]),
        }
        for r in rows
    ]


# ── Dados de validação (métricas + feedback cruzados com demografia) ──────────

@router.get("/research")
async def get_research_data(_: dict = Depends(get_current_admin)):
    """Métricas de sessão e feedback, já cruzados com a demografia do participante,
    para as análises/gráficos das seções de resultados do TCC."""
    metrics = await db.fetch("""
        SELECT m.mode, m.gestures_recognized, m.avg_confidence, m.duration_seconds, m.created_at,
               u.nivel_surdez, u.sabe_libras, u.sexo, u.faixa_etaria
        FROM session_metrics m JOIN users u ON u.id = m.user_id
        ORDER BY m.created_at DESC
    """)
    feedback = await db.fetch("""
        SELECT f.recognized_well, f.easy_to_use, f.would_use_again, f.comment, f.created_at,
               f.session_id, f.user_id,
               u.nivel_surdez, u.sabe_libras, u.sexo, u.faixa_etaria
        FROM feedback f JOIN users u ON u.id = f.user_id
        ORDER BY f.created_at DESC
    """)
    # Item 4: uma linha por tentativa do modo avaliação (gesto pedido × reconhecido)
    attempts = await db.fetch("""
        SELECT a.user_id, a.session_id, a.expected, a.predicted, a.confidence, a.latency_ms,
               a.segment_frames, a.pose_ok_ratio, a.config, a.w, a.app_version, a.created_at,
               u.nivel_surdez, u.sabe_libras, u.sexo, u.faixa_etaria
        FROM evaluation_attempts a JOIN users u ON u.id = a.user_id
        ORDER BY a.created_at ASC
    """)

    def _attempt(r):
        return {
            "participant_id": str(r["user_id"]),
            "session_id": r["session_id"],
            "expected": r["expected"],
            "predicted": r["predicted"],
            "outcome": (
                "rejeitado" if r["predicted"] is None
                else "acerto" if r["predicted"] == r["expected"]
                else "erro"
            ),
            "confidence": r["confidence"],
            "latency_ms": r["latency_ms"],
            "segment_frames": r["segment_frames"],
            "pose_ok_ratio": r["pose_ok_ratio"],
            "config": r["config"],
            "w": r["w"],
            "app_version": r["app_version"],
            "created_at": r["created_at"].isoformat(),
            "nivel_surdez": r["nivel_surdez"],
            "sabe_libras": r["sabe_libras"],
            "sexo": r["sexo"],
            "faixa_etaria": r["faixa_etaria"],
        }

    def _metric(r):
        return {
            "mode": r["mode"],
            "gestures_recognized": r["gestures_recognized"],
            "avg_confidence": round(r["avg_confidence"], 4),
            "duration_seconds": r["duration_seconds"],
            "created_at": r["created_at"].isoformat(),
            "nivel_surdez": r["nivel_surdez"],
            "sabe_libras": r["sabe_libras"],
            "sexo": r["sexo"],
            "faixa_etaria": r["faixa_etaria"],
        }

    def _fb(r):
        return {
            "recognized_well": r["recognized_well"],
            "easy_to_use": r["easy_to_use"],
            "would_use_again": r["would_use_again"],
            "comment": r["comment"],
            "created_at": r["created_at"].isoformat(),
            "session_id": r["session_id"],
            "participant_id": str(r["user_id"]),
            "nivel_surdez": r["nivel_surdez"],
            "sabe_libras": r["sabe_libras"],
            "sexo": r["sexo"],
            "faixa_etaria": r["faixa_etaria"],
        }

    return {
        "total_sessions": len(metrics),
        "total_feedback": len(feedback),
        "total_attempts": len(attempts),
        "metrics": [_metric(r) for r in metrics],
        "feedback": [_fb(r) for r in feedback],
        "attempts": [_attempt(r) for r in attempts],
    }


# ── Analytics (dados da pesquisa) ─────────────────────────────────────────────

@router.get("/analytics")
async def get_analytics(_: dict = Depends(get_current_admin)):
    # Estatísticas por usuário
    user_stats = await db.fetch("""
        SELECT u.id, u.name, u.email, u.created_at,
               u.is_student, u.has_disability,
               COUNT(g.id)                        AS gesture_count,
               COALESCE(SUM(g.sample_count), 0)   AS total_samples
        FROM users u
        LEFT JOIN gestures g ON g.user_id = u.id
        GROUP BY u.id, u.name, u.email, u.created_at, u.is_student, u.has_disability
        ORDER BY total_samples DESC
    """)

    # Top gestos por nome (mais coletados)
    top_gestures = await db.fetch("""
        SELECT name,
               COUNT(DISTINCT user_id)         AS contributor_count,
               SUM(sample_count)               AS total_samples,
               AVG(sample_count)::INT          AS avg_samples_per_user
        FROM gestures
        GROUP BY name
        ORDER BY total_samples DESC
        LIMIT 30
    """)

    # Timeline semanal de coleta
    timeline = await db.fetch("""
        SELECT DATE_TRUNC('week', created_at)::DATE  AS week,
               COUNT(DISTINCT user_id)               AS active_users,
               COUNT(*)                              AS gestures_added,
               SUM(sample_count)                     AS samples_added
        FROM gestures
        GROUP BY week
        ORDER BY week
    """)

    # Todos os gestos para a visão detalhada
    all_gestures = await db.fetch("""
        SELECT g.id, g.name, g.sample_count, g.created_at, g.updated_at,
               u.name AS user_name, u.email AS user_email
        FROM gestures g
        JOIN users u ON u.id = g.user_id
        ORDER BY g.updated_at DESC
    """)

    return {
        "user_stats": [
            {
                "id": str(r["id"]),
                "name": r["name"],
                "email": r["email"],
                "created_at": r["created_at"].isoformat(),
                "is_student": r["is_student"],
                "has_disability": r["has_disability"],
                "gesture_count": r["gesture_count"],
                "total_samples": r["total_samples"],
            }
            for r in user_stats
        ],
        "top_gestures": [
            {
                "name": r["name"],
                "contributor_count": r["contributor_count"],
                "total_samples": r["total_samples"],
                "avg_samples_per_user": r["avg_samples_per_user"],
            }
            for r in top_gestures
        ],
        "timeline": [
            {
                "week": str(r["week"]),
                "active_users": r["active_users"],
                "gestures_added": r["gestures_added"],
                "samples_added": r["samples_added"],
            }
            for r in timeline
        ],
        "all_gestures": [
            {
                "id": str(r["id"]),
                "name": r["name"],
                "sample_count": r["sample_count"],
                "created_at": r["created_at"].isoformat(),
                "updated_at": r["updated_at"].isoformat(),
                "user_name": r["user_name"],
                "user_email": r["user_email"],
            }
            for r in all_gestures
        ],
    }
