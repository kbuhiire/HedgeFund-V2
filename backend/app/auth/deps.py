from __future__ import annotations

from typing import Annotated

from fastapi import Depends, HTTPException, Query, Security, status
from fastapi.security import HTTPAuthorizationCredentials, HTTPBearer
from jose import JWTError
from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from app.auth.security import decode_access_token
from app.db.deps import get_session
from app.db.models import User

_bearer = HTTPBearer(auto_error=False)

_CREDENTIALS_EXCEPTION = HTTPException(
    status_code=status.HTTP_401_UNAUTHORIZED,
    detail="Could not validate credentials",
    headers={"WWW-Authenticate": "Bearer"},
)


async def get_current_user(
    credentials: Annotated[
        HTTPAuthorizationCredentials | None, Security(_bearer)
    ] = None,
    session: AsyncSession = Depends(get_session),
) -> User:
    token: str | None = credentials.credentials if credentials else None
    if not token:
        raise _CREDENTIALS_EXCEPTION
    try:
        user_id = decode_access_token(token)
    except JWTError:
        raise _CREDENTIALS_EXCEPTION

    result = await session.execute(select(User).where(User.id == int(user_id)))
    user = result.scalar_one_or_none()
    if user is None or not user.is_active:
        raise _CREDENTIALS_EXCEPTION
    return user


async def get_current_user_from_query(
    token: Annotated[str | None, Query(alias="token")] = None,
    session: AsyncSession = Depends(get_session),
) -> User:
    """Variant for SSE endpoints where EventSource cannot set headers."""
    if not token:
        raise _CREDENTIALS_EXCEPTION
    try:
        user_id = decode_access_token(token)
    except JWTError:
        raise _CREDENTIALS_EXCEPTION

    result = await session.execute(select(User).where(User.id == int(user_id)))
    user = result.scalar_one_or_none()
    if user is None or not user.is_active:
        raise _CREDENTIALS_EXCEPTION
    return user
