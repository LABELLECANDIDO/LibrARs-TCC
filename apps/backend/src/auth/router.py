from fastapi import APIRouter, HTTPException, Depends
from pydantic import BaseModel
from .. import database as db
from .service import hash_password, verify_password, make_token
from .deps import get_current_user

router = APIRouter()


class RegisterBody(BaseModel):
    email: str
    password: str
    name: str | None = None


class RegisterInviteBody(BaseModel):
    token: str
    email: str
    password: str
    name: str | None = None
    is_student: bool = False
    has_disability: bool = False
    # Demografia (pesquisa)
    sexo: str | None = None
    faixa_etaria: str | None = None
    nivel_surdez: str | None = None
    sabe_libras: str | None = None
    # Consentimento (Item 4): aceite do termo no cadastro
    consent: bool = False
    consent_version: str | None = None


class ConsentBody(BaseModel):
    version: str


class LoginBody(BaseModel):
    email: str
    password: str


class ResetPasswordBody(BaseModel):
    token: str
    new_password: str


def _user_response(user: dict) -> dict:
    return {
        "id": str(user["id"]),
        "email": user["email"],
        "name": user["name"],
        "role": user["role"],
        "is_student": user.get("is_student", False),
        "has_disability": user.get("has_disability", False),
        # Consentimento: data/hora do aceite e versão do termo (None = ainda não aceitou)
        "consent_at": user["consent_at"].isoformat() if user.get("consent_at") else None,
        "consent_version": user.get("consent_version"),
    }


@router.post("/register", status_code=201)
async def register(body: RegisterBody):
    email = body.email.lower().strip()

    # Cadastro aberto só é permitido para o PRIMEIRO usuário (que vira admin).
    # A partir daí, novos cadastros só por link de convite.
    user_count = await db.fetchval("SELECT COUNT(*) FROM users")
    if user_count and user_count > 0:
        raise HTTPException(
            403,
            "O cadastro é feito por convite. Solicite seu link de acesso pelo email "
            "labelleecandido@gmail.com",
        )

    existing = await db.fetchrow("SELECT id FROM users WHERE email = $1", email)
    if existing:
        raise HTTPException(409, "Este email já está cadastrado")

    pw_hash = hash_password(body.password)
    display_name = (body.name or "").strip() or email.split("@")[0]

    user = await db.fetchrow(
        "INSERT INTO users (email, password_hash, name) VALUES ($1, $2, $3)"
        " RETURNING id, email, name, role, is_student, has_disability",
        email, pw_hash, display_name,
    )
    return {"token": make_token(str(user["id"]), user["email"], user["role"]), "user": _user_response(user)}


@router.post("/register-invite", status_code=201)
async def register_via_invite(body: RegisterInviteBody):
    invite = await db.fetchrow(
        "SELECT id FROM invite_tokens WHERE token = $1 AND used_at IS NULL AND expires_at > now()",
        body.token,
    )
    if not invite:
        raise HTTPException(400, "Link de convite inválido ou expirado")

    email = body.email.lower().strip()
    existing = await db.fetchrow("SELECT id FROM users WHERE email = $1", email)
    if existing:
        raise HTTPException(409, "Este email já está cadastrado")

    pw_hash = hash_password(body.password)
    display_name = (body.name or "").strip() or email.split("@")[0]

    user = await db.fetchrow(
        "INSERT INTO users (email, password_hash, name, is_student, has_disability,"
        " sexo, faixa_etaria, nivel_surdez, sabe_libras, consent_at, consent_version)"
        " VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9,"
        "         CASE WHEN $10::boolean THEN now() ELSE NULL END,"
        "         CASE WHEN $10::boolean THEN $11::text ELSE NULL END)"
        " RETURNING id, email, name, role, is_student, has_disability, consent_at, consent_version",
        email, pw_hash, display_name, body.is_student, body.has_disability,
        body.sexo, body.faixa_etaria, body.nivel_surdez, body.sabe_libras,
        body.consent, body.consent_version,
    )

    await db.execute(
        "UPDATE invite_tokens SET used_by = $1, used_at = now() WHERE id = $2",
        user["id"], invite["id"],
    )

    return {"token": make_token(str(user["id"]), user["email"], user["role"]), "user": _user_response(user)}


@router.post("/login")
async def login(body: LoginBody):
    email = body.email.lower().strip()

    user = await db.fetchrow(
        "SELECT id, email, name, password_hash, role, is_student, has_disability,"
        " consent_at, consent_version FROM users WHERE email = $1", email
    )
    if not user or not verify_password(body.password, user["password_hash"]):
        raise HTTPException(401, "Email ou senha incorretos")

    return {"token": make_token(str(user["id"]), user["email"], user["role"]), "user": _user_response(user)}


@router.post("/reset-password")
async def reset_password(body: ResetPasswordBody):
    reset = await db.fetchrow(
        "SELECT id, user_id FROM reset_tokens WHERE token = $1 AND used_at IS NULL AND expires_at > now()",
        body.token,
    )
    if not reset:
        raise HTTPException(400, "Link de reset inválido ou expirado")

    if len(body.new_password) < 6:
        raise HTTPException(400, "Senha deve ter pelo menos 6 caracteres")

    pw_hash = hash_password(body.new_password)
    await db.execute("UPDATE users SET password_hash = $1 WHERE id = $2", pw_hash, reset["user_id"])
    await db.execute("UPDATE reset_tokens SET used_at = now() WHERE id = $1", reset["id"])

    user = await db.fetchrow("SELECT id, email, name, role FROM users WHERE id = $1", reset["user_id"])
    return {"token": make_token(str(user["id"]), user["email"], user["role"]), "user": _user_response(user)}


@router.get("/validate-invite/{token}")
async def validate_invite(token: str):
    invite = await db.fetchrow(
        "SELECT id FROM invite_tokens WHERE token = $1 AND used_at IS NULL AND expires_at > now()",
        token,
    )
    if not invite:
        raise HTTPException(400, "Link de convite inválido ou expirado")
    return {"valid": True}


@router.get("/validate-reset/{token}")
async def validate_reset(token: str):
    reset = await db.fetchrow(
        "SELECT user_id FROM reset_tokens WHERE token = $1 AND used_at IS NULL AND expires_at > now()",
        token,
    )
    if not reset:
        raise HTTPException(400, "Link de reset inválido ou expirado")
    user = await db.fetchrow("SELECT name, email FROM users WHERE id = $1", reset["user_id"])
    return {"valid": True, "user_name": user["name"], "user_email": user["email"]}


@router.get("/me")
async def me(current_user: dict = Depends(get_current_user)):
    user = await db.fetchrow(
        "SELECT id, email, name, role, is_student, has_disability, consent_at, consent_version"
        " FROM users WHERE id = $1",
        current_user["user_id"],
    )
    if not user:
        raise HTTPException(404, "Usuário não encontrado")
    return _user_response(user)


@router.post("/consent")
async def give_consent(body: ConsentBody, current_user: dict = Depends(get_current_user)):
    """Registra o aceite do termo de consentimento: guarda a data/hora e a versão do termo."""
    version = body.version.strip()
    if not version:
        raise HTTPException(400, "Versão do termo não informada")
    user = await db.fetchrow(
        "UPDATE users SET consent_at = now(), consent_version = $1 WHERE id = $2"
        " RETURNING id, email, name, role, is_student, has_disability, consent_at, consent_version",
        version, current_user["user_id"],
    )
    if not user:
        raise HTTPException(404, "Usuário não encontrado")
    return _user_response(user)
