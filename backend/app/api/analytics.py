"""Analytics API router for SpendHound."""

from fastapi import APIRouter, Depends, Query
from sqlalchemy.ext.asyncio import AsyncSession

from app.database import get_db
from app.middleware.auth import get_current_user
from app.models.user import User
from app.services.analytics import build_dashboard_analytics
from app.services.cache import get_cached_analytics, set_cached_analytics

router = APIRouter()


@router.get("/dashboard")
async def dashboard_analytics(
    month: str | None = Query(default=None),
    current_user: User = Depends(get_current_user),
    db: AsyncSession = Depends(get_db),
) -> dict:
    cached = await get_cached_analytics(current_user.id, month)
    if cached is not None:
        return cached

    data = await build_dashboard_analytics(db, current_user.id, month=month)
    await set_cached_analytics(current_user.id, month, data)
    return data
