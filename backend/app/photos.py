"""Photo download with per-role access checks (NFR-6)."""
from uuid import UUID

from fastapi import APIRouter, Depends, HTTPException
from fastapi.responses import FileResponse

from .auth import CurrentUser, current_user
from .context import AppContext, get_ctx

router = APIRouter(tags=["photos"])


@router.get("/photos/{photo_id}")
async def get_photo(photo_id: UUID, user: CurrentUser = Depends(current_user), ctx: AppContext = Depends(get_ctx)):
    photo = await ctx.db.fetchrow("SELECT storage_path, mime_type, uploaded_by FROM photos WHERE photo_id = $1",
                                  photo_id)
    if not photo:
        raise HTTPException(404, "Photo not found")
    allowed = user.is_staff or photo["uploaded_by"] == user.user_id
    if not allowed and user.role == "resident":
        # Before photo of the resident's own report, or the after photo of a repair on their issue.
        allowed = bool(await ctx.db.fetchval(
            """SELECT 1 FROM reports r WHERE r.reporter_id = $2 AND (r.photo_id = $1 OR EXISTS (
                   SELECT 1 FROM work_orders w WHERE w.issue_id = r.issue_id AND w.after_photo_id = $1))""",
            photo_id, user.user_id))
    if not allowed and user.crew_id is not None:
        allowed = bool(await ctx.db.fetchval(
            """SELECT 1 FROM work_orders w WHERE w.crew_id = $2 AND (w.after_photo_id = $1 OR EXISTS (
                   SELECT 1 FROM reports r WHERE r.issue_id = w.issue_id AND r.photo_id = $1))""",
            photo_id, user.crew_id))
    if not allowed:
        raise HTTPException(404, "Photo not found")
    try:
        path = ctx.storage.path(photo["storage_path"])
    except FileNotFoundError:
        raise HTTPException(404, "Photo file is missing")
    if not path.exists():
        raise HTTPException(404, "Photo file is missing")
    return FileResponse(path, media_type=photo["mime_type"], headers={"Cache-Control": "private, max-age=3600"})
