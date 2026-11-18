"""Login, JWT sessions and role checks (NFR-6)."""
from datetime import datetime, timedelta, timezone
from uuid import UUID

import bcrypt
import jwt
from fastapi import APIRouter, Depends, HTTPException, Request, status
from pydantic import BaseModel, EmailStr, Field

from .context import AppContext, get_ctx

STAFF = ("operator", "supervisor")


class CurrentUser(BaseModel):
    user_id: UUID
    email: str
    full_name: str
    role: str
    crew_id: int | None = None
    crew_name: str | None = None

    @property
    def is_staff(self) -> bool:
        return self.role in STAFF


def hash_password(password: str) -> str:
    return bcrypt.hashpw(password.encode(), bcrypt.gensalt()).decode()


def verify_password(password: str, hashed: str) -> bool:
    try:
        return bcrypt.checkpw(password.encode(), hashed.encode())
    except ValueError:
        return False


def create_token(ctx: AppContext, user_id: UUID, role: str) -> str:
    now = datetime.now(timezone.utc)
    claims = {"sub": str(user_id), "role": role, "iat": now,
              "exp": now + timedelta(hours=ctx.settings.jwt_expiry_hours)}
    return jwt.encode(claims, ctx.settings.jwt_secret, algorithm="HS256")


async def load_user(ctx: AppContext, user_id: UUID) -> CurrentUser | None:
    row = await ctx.db.fetchrow(
        """SELECT u.user_id, u.email, u.full_name, u.role::text AS role, cm.crew_id, c.name AS crew_name
           FROM users u
           LEFT JOIN crew_members cm ON cm.user_id = u.user_id
           LEFT JOIN crews c ON c.crew_id = cm.crew_id
           WHERE u.user_id = $1 AND u.is_active""", user_id)
    return CurrentUser(**dict(row)) if row else None


async def user_from_token(ctx: AppContext, token: str) -> CurrentUser | None:
    try:
        claims = jwt.decode(token, ctx.settings.jwt_secret, algorithms=["HS256"])
        return await load_user(ctx, UUID(claims["sub"]))
    except (jwt.PyJWTError, KeyError, ValueError):
        return None


async def current_user(request: Request, ctx: AppContext = Depends(get_ctx)) -> CurrentUser:
    header = request.headers.get("authorization", "")
    # Query token lets <img src> and WebSocket URLs authenticate too.
    token = header[7:] if header.lower().startswith("bearer ") else request.query_params.get("token")
    user = await user_from_token(ctx, token) if token else None
    if not user:
        raise HTTPException(status.HTTP_401_UNAUTHORIZED, "Not signed in")
    return user


def require(*roles: str):
    async def dependency(user: CurrentUser = Depends(current_user)) -> CurrentUser:
        if user.role not in roles:
            raise HTTPException(status.HTTP_403_FORBIDDEN, "Your role cannot do this")
        return user
    return dependency


# ---------------------------------------------------------------- routes
router = APIRouter(prefix="/auth", tags=["auth"])


class LoginRequest(BaseModel):
    email: EmailStr
    password: str


class RegisterRequest(BaseModel):
    email: EmailStr
    password: str = Field(min_length=8)
    full_name: str = Field(min_length=2, max_length=100)


class Session(BaseModel):
    access_token: str
    user: CurrentUser


@router.post("/login", response_model=Session)
async def login(body: LoginRequest, ctx: AppContext = Depends(get_ctx)):
    row = await ctx.db.fetchrow(
        "SELECT user_id, password_hash, role::text AS role FROM users WHERE lower(email) = lower($1) AND is_active",
        body.email)
    if not row or not verify_password(body.password, row["password_hash"]):
        raise HTTPException(status.HTTP_401_UNAUTHORIZED, "Email or password is incorrect")
    return Session(access_token=create_token(ctx, row["user_id"], row["role"]),
                   user=await load_user(ctx, row["user_id"]))


@router.post("/register", response_model=Session, status_code=201)
async def register(body: RegisterRequest, ctx: AppContext = Depends(get_ctx)):
    """Residents sign themselves up. Staff accounts are created by the city."""
    exists = await ctx.db.fetchval("SELECT 1 FROM users WHERE lower(email) = lower($1)", body.email)
    if exists:
        raise HTTPException(status.HTTP_409_CONFLICT, "An account with this email already exists")
    user_id = await ctx.db.fetchval(
        "INSERT INTO users (email, password_hash, full_name, role) VALUES ($1, $2, $3, 'resident') RETURNING user_id",
        body.email.lower(), hash_password(body.password), body.full_name.strip())
    return Session(access_token=create_token(ctx, user_id, "resident"), user=await load_user(ctx, user_id))


@router.get("/me", response_model=CurrentUser)
async def me(user: CurrentUser = Depends(current_user)):
    return user
