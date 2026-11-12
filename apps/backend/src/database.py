from typing import Any
import json
import asyncpg
from .config import settings

_pool: asyncpg.Pool | None = None


async def _init_connection(conn: asyncpg.Connection) -> None:
    # Decodifica JSONB automaticamente para list/dict (evita strings inconsistentes)
    await conn.set_type_codec(
        "jsonb",
        encoder=json.dumps,
        decoder=json.loads,
        schema="pg_catalog",
    )


async def create_pool() -> asyncpg.Pool:
    global _pool
    _pool = await asyncpg.create_pool(
        dsn=settings.DATABASE_URL,
        min_size=2,
        max_size=20,
        timeout=10,
        init=_init_connection,
    )
    return _pool


async def close_pool() -> None:
    global _pool
    if _pool:
        await _pool.close()
        _pool = None


async def fetch(sql: str, *args: Any) -> list[dict]:
    assert _pool is not None, "DB pool not initialized"
    async with _pool.acquire() as conn:
        rows = await conn.fetch(sql, *args)
        return [dict(r) for r in rows]


async def fetchrow(sql: str, *args: Any) -> dict | None:
    assert _pool is not None, "DB pool not initialized"
    async with _pool.acquire() as conn:
        row = await conn.fetchrow(sql, *args)
        return dict(row) if row else None


async def fetchval(sql: str, *args: Any) -> Any:
    """Fetch a single scalar value (e.g., COUNT(*), MAX(id))"""
    assert _pool is not None, "DB pool not initialized"
    async with _pool.acquire() as conn:
        return await conn.fetchval(sql, *args)


async def execute(sql: str, *args: Any) -> str:
    assert _pool is not None, "DB pool not initialized"
    async with _pool.acquire() as conn:
        return await conn.execute(sql, *args)


async def execute_tx(statements: list[tuple[str, tuple]]) -> None:
    """Executa vários comandos numa única transação (tudo ou nada)."""
    assert _pool is not None, "DB pool not initialized"
    async with _pool.acquire() as conn:
        async with conn.transaction():
            for sql, args in statements:
                await conn.execute(sql, *args)
