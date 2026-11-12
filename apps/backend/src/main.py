from contextlib import asynccontextmanager
from datetime import datetime, timezone
import socketio
from fastapi import FastAPI
from fastapi.middleware.cors import CORSMiddleware

from .config import settings
from . import database as db
from .auth.router import router as auth_router
from .gestures.router import router as gestures_router
from .admin.router import router as admin_router
from .collection.router import router as collection_router
from .socket_events import sio


async def run_migrations():
    """
    Cria o schema completo do zero se não existir, e aplica migrações incrementais.
    Necessário em produção: o banco é externo e o init.sql não roda automaticamente.
    Tudo usa IF NOT EXISTS — seguro para rodar a cada startup.
    """
    migrations = [
        # Extensão para gen_random_uuid() e gen_random_bytes()
        'CREATE EXTENSION IF NOT EXISTS "pgcrypto"',

        # Tabela de usuários (schema completo já com perfil)
        """
        CREATE TABLE IF NOT EXISTS users (
            id            UUID        PRIMARY KEY DEFAULT gen_random_uuid(),
            email         TEXT        UNIQUE NOT NULL,
            password_hash TEXT        NOT NULL,
            name          TEXT        NOT NULL DEFAULT '',
            role          TEXT        NOT NULL DEFAULT 'user' CHECK (role IN ('user', 'admin')),
            is_student    BOOLEAN     NOT NULL DEFAULT false,
            has_disability BOOLEAN    NOT NULL DEFAULT false,
            created_at    TIMESTAMPTZ NOT NULL DEFAULT now()
        )
        """,

        # Tabela de gestos
        """
        CREATE TABLE IF NOT EXISTS gestures (
            id           UUID        PRIMARY KEY DEFAULT gen_random_uuid(),
            user_id      UUID        NOT NULL REFERENCES users(id) ON DELETE CASCADE,
            name         TEXT        NOT NULL,
            samples      JSONB       NOT NULL DEFAULT '[]',
            samples_raw  JSONB       NOT NULL DEFAULT '[]',
            sample_count INT         NOT NULL DEFAULT 0,
            created_at   TIMESTAMPTZ NOT NULL DEFAULT now(),
            updated_at   TIMESTAMPTZ NOT NULL DEFAULT now(),
            UNIQUE (user_id, name)
        )
        """,

        # Migrações incrementais (para bancos que já tinham schema antigo)
        "ALTER TABLE users ADD COLUMN IF NOT EXISTS is_student BOOLEAN NOT NULL DEFAULT false",
        "ALTER TABLE users ADD COLUMN IF NOT EXISTS has_disability BOOLEAN NOT NULL DEFAULT false",
        # Dados demográficos (pesquisa) — nullable, preenchidos no cadastro por convite
        "ALTER TABLE users ADD COLUMN IF NOT EXISTS sexo TEXT",
        "ALTER TABLE users ADD COLUMN IF NOT EXISTS faixa_etaria TEXT",
        "ALTER TABLE users ADD COLUMN IF NOT EXISTS nivel_surdez TEXT",
        "ALTER TABLE users ADD COLUMN IF NOT EXISTS sabe_libras TEXT",
        "ALTER TABLE gestures ADD COLUMN IF NOT EXISTS samples_raw JSONB NOT NULL DEFAULT '[]'::jsonb",
        "ALTER TABLE gestures ADD COLUMN IF NOT EXISTS samples_temporal JSONB NOT NULL DEFAULT '[]'::jsonb",

        # Índices
        "CREATE INDEX IF NOT EXISTS idx_gestures_user_id ON gestures(user_id)",
        "CREATE INDEX IF NOT EXISTS idx_users_email ON users(email)",
        "CREATE INDEX IF NOT EXISTS idx_gestures_created_at ON gestures(created_at DESC)",

        # Tokens de convite
        """
        CREATE TABLE IF NOT EXISTS invite_tokens (
            id          UUID        PRIMARY KEY DEFAULT gen_random_uuid(),
            token       TEXT        UNIQUE NOT NULL DEFAULT encode(gen_random_bytes(32), 'hex'),
            created_by  UUID        NOT NULL REFERENCES users(id) ON DELETE CASCADE,
            used_by     UUID        REFERENCES users(id) ON DELETE SET NULL,
            used_at     TIMESTAMPTZ,
            expires_at  TIMESTAMPTZ NOT NULL DEFAULT now() + INTERVAL '7 days',
            created_at  TIMESTAMPTZ NOT NULL DEFAULT now()
        )
        """,

        # Tokens de reset de senha
        """
        CREATE TABLE IF NOT EXISTS reset_tokens (
            id          UUID        PRIMARY KEY DEFAULT gen_random_uuid(),
            token       TEXT        UNIQUE NOT NULL DEFAULT encode(gen_random_bytes(32), 'hex'),
            user_id     UUID        NOT NULL REFERENCES users(id) ON DELETE CASCADE,
            used_at     TIMESTAMPTZ,
            expires_at  TIMESTAMPTZ NOT NULL DEFAULT now() + INTERVAL '24 hours',
            created_at  TIMESTAMPTZ NOT NULL DEFAULT now()
        )
        """,

        # Métricas de sessão (pesquisa) — uma linha por sessão de chamada/tradução
        """
        CREATE TABLE IF NOT EXISTS session_metrics (
            id                  UUID        PRIMARY KEY DEFAULT gen_random_uuid(),
            user_id             UUID        NOT NULL REFERENCES users(id) ON DELETE CASCADE,
            mode                TEXT        NOT NULL DEFAULT 'call',
            gestures_recognized INT         NOT NULL DEFAULT 0,
            avg_confidence      REAL        NOT NULL DEFAULT 0,
            duration_seconds    INT         NOT NULL DEFAULT 0,
            created_at          TIMESTAMPTZ NOT NULL DEFAULT now()
        )
        """,

        # Feedback dos participantes (validação com usuários)
        """
        CREATE TABLE IF NOT EXISTS feedback (
            id               UUID        PRIMARY KEY DEFAULT gen_random_uuid(),
            user_id          UUID        NOT NULL REFERENCES users(id) ON DELETE CASCADE,
            recognized_well  INT,
            easy_to_use      INT,
            would_use_again  INT,
            comment          TEXT,
            created_at       TIMESTAMPTZ NOT NULL DEFAULT now()
        )
        """,
        "CREATE INDEX IF NOT EXISTS idx_session_metrics_user ON session_metrics(user_id)",
        "CREATE INDEX IF NOT EXISTS idx_feedback_user ON feedback(user_id)",

        # Conserta defaults de expiração em bancos antigos (convites nasciam já
        # expirados quando a coluna tinha um default incorreto).
        "ALTER TABLE invite_tokens ALTER COLUMN expires_at SET DEFAULT now() + INTERVAL '7 days'",
        "ALTER TABLE reset_tokens  ALTER COLUMN expires_at SET DEFAULT now() + INTERVAL '24 hours'",

        # Trigger: atualiza updated_at automaticamente
        """
        CREATE OR REPLACE FUNCTION set_updated_at()
        RETURNS TRIGGER AS $func$
        BEGIN
          NEW.updated_at = now();
          RETURN NEW;
        END;
        $func$ LANGUAGE plpgsql
        """,
        "DROP TRIGGER IF EXISTS gestures_set_updated_at ON gestures",
        """
        CREATE TRIGGER gestures_set_updated_at
          BEFORE UPDATE ON gestures
          FOR EACH ROW EXECUTE FUNCTION set_updated_at()
        """,

        # Trigger: primeiro usuário vira admin
        """
        CREATE OR REPLACE FUNCTION set_first_user_as_admin()
        RETURNS TRIGGER AS $func$
        BEGIN
          IF (SELECT COUNT(*) FROM users WHERE role = 'admin') = 0 THEN
            NEW.role := 'admin';
          END IF;
          RETURN NEW;
        END;
        $func$ LANGUAGE plpgsql
        """,
        "DROP TRIGGER IF EXISTS users_set_first_admin ON users",
        """
        CREATE TRIGGER users_set_first_admin
          BEFORE INSERT ON users
          FOR EACH ROW EXECUTE FUNCTION set_first_user_as_admin()
        """,
    ]
    for sql in migrations:
        try:
            await db.execute(sql.strip())
        except Exception as e:
            print(f"⚠️  Migration step failed: {e}")
    print("✅  Migrations OK")


@asynccontextmanager
async def lifespan(app: FastAPI):
    await db.create_pool()
    print("✅  DB pool created")
    await run_migrations()
    yield
    await db.close_pool()
    print("👋  DB pool closed")


app = FastAPI(title="LibrARs API", version="2.0.0", lifespan=lifespan, redirect_slashes=False)

_cors_origins = [o.strip() for o in settings.CORS_ORIGIN.split(",")]

app.add_middleware(
    CORSMiddleware,
    allow_origins=_cors_origins,
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)

app.include_router(auth_router, prefix="/api/auth", tags=["auth"])
app.include_router(gestures_router, prefix="/api/gestures", tags=["gestures"])
app.include_router(admin_router, prefix="/api/admin", tags=["admin"])
app.include_router(collection_router, prefix="/api", tags=["collection"])


@app.get("/health", tags=["health"])
async def health():
    return {"ok": True, "ts": datetime.now(timezone.utc).isoformat()}


# ── Socket.io ASGI wrapper ────────────────────────────────────────────────────
# uvicorn deve apontar para `src.main:socket_app`, NÃO para `app`,
# para que /socket.io/ seja tratado pelo python-socketio.
socket_app = socketio.ASGIApp(sio, other_asgi_app=app)
