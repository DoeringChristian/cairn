"""Browser login uses the server's single configured token."""
from typing import Any
from fastapi import APIRouter, HTTPException, Request, Response
from pydantic import BaseModel, Field
from .. import auth
router = APIRouter(prefix='/api/auth', tags=['auth'])
class LoginRequest(BaseModel):
    token: str = Field(min_length=1, max_length=4096)

@router.post('/login')
def login(body: LoginRequest, request: Request, response: Response):
    expected = request.app.state.token
    if not expected or not auth.tokens_equal(body.token, expected):
        raise HTTPException(401, 'invalid token')
    response.set_cookie(auth.auth_cookie_name(request.app.state.server_id), body.token,
                        httponly=True, samesite='strict', secure=request.url.scheme == 'https',
                        max_age=auth.DEFAULT_COOKIE_MAX_AGE, path='/')
    return {'name': 'Server access', 'role': 'admin'}

@router.post('/logout')
def logout(request: Request, response: Response):
    response.delete_cookie(auth.auth_cookie_name(request.app.state.server_id), path='/')
    return {'ok': True}

@router.get('/session')
def session_info(request: Request) -> dict[str, Any]:
    enabled = request.app.state.auth_enabled
    valid = not enabled or auth.authenticated(request)
    return {'authenticated': valid, 'auth_enabled': enabled,
            'name': 'Server access' if enabled and valid else None,
            'role': 'admin' if valid else None}
