# main.py :  FORGE3D entry point
#
# Local dev :  python main.py           -> http://127.0.0.1:8000, shared Projects/
# Demo mode :  FORGE_DEMO=1 uvicorn ... -> per-visitor sandbox sessions (cookie),
#                                          each visitor gets a private copy of the
#                                          sample projects; idle sessions expire.

import asyncio
import json
import os
import re
import shutil
import uuid
import importlib.util
import webbrowser
import threading
import socket
import time
from pathlib import Path

import uvicorn
from fastapi import FastAPI, Request, WebSocket, WebSocketDisconnect
from fastapi.responses import HTMLResponse, JSONResponse, FileResponse
from fastapi.staticfiles import StaticFiles
from fastapi.middleware.cors import CORSMiddleware

BASE_DIR     = Path(__file__).parent
PROJECTS_DIR = BASE_DIR / "Projects"
UI_DIR       = BASE_DIR / "UI"
CORE_DIR     = BASE_DIR / "core"
SESSIONS_DIR = BASE_DIR / "sessions"

DEMO_MODE = os.environ.get("FORGE_DEMO", "") == "1"

SESSION_TTL_SECONDS = 6 * 3600   # idle sessions are deleted after 6 hours
SESSION_MAX_COUNT   = 500        # hard cap; oldest sessions are dropped first

# Sample projects that can never be deleted from the welcome page.
PROTECTED_PROJECTS = {"rubikcube", "carv1"}

PROJECTS_DIR.mkdir(exist_ok=True)
if DEMO_MODE:
    SESSIONS_DIR.mkdir(exist_ok=True)

# load core helpers
def _load(name, path):
    spec = importlib.util.spec_from_file_location(name, path)
    mod  = importlib.util.module_from_spec(spec)
    spec.loader.exec_module(mod)
    return mod

projectsyn = _load("projectsyn", CORE_DIR / "projectsyn.py")
objectsyn  = _load("objectsyn",  CORE_DIR / "objectsyn.py")
modesyn    = _load("modesyn",    CORE_DIR / "modesyn.py")

app = FastAPI(title="FORGE3D")
app.add_middleware(CORSMiddleware, allow_origins=["*"], allow_methods=["*"], allow_headers=["*"])

class NoCacheStaticFiles(StaticFiles):
    async def get_response(self, path, scope):
        r = await super().get_response(path, scope)
        r.headers["Cache-Control"] = "no-store"
        return r

app.mount("/static", NoCacheStaticFiles(directory=UI_DIR), name="static")


# ── PER-VISITOR SESSIONS (demo mode) ──────────────────────────────

_SID_RE = re.compile(r"^[0-9a-f]{32}$")


def _session_dir(sid: str) -> Path:
    return SESSIONS_DIR / sid


def projects_dir_for(request: Request) -> Path:
    """The Projects directory this request should operate on."""
    if DEMO_MODE:
        return _session_dir(request.state.forge_sid)
    return PROJECTS_DIR


if DEMO_MODE:

    @app.middleware("http")
    async def session_middleware(request: Request, call_next):
        sid = request.cookies.get("forge_sid", "")
        is_new = not (_SID_RE.match(sid) and _session_dir(sid).is_dir())
        if is_new:
            sid = uuid.uuid4().hex
            shutil.copytree(PROJECTS_DIR, _session_dir(sid))
        request.state.forge_sid = sid
        # touch the session dir so the cleaner sees it as active
        os.utime(_session_dir(sid))

        response = await call_next(request)
        if is_new:
            response.set_cookie(
                "forge_sid", sid,
                max_age=SESSION_TTL_SECONDS,
                httponly=True, samesite="lax",
            )
        return response

    @app.get("/projects-static/{path:path}")
    def session_projects_static(path: str, request: Request):
        base = projects_dir_for(request).resolve()
        target = (base / path).resolve()
        if not target.is_file() or not str(target).startswith(str(base) + os.sep):
            return JSONResponse({"ok": False, "error": "Not found"}, status_code=404)
        return FileResponse(target, headers={"Cache-Control": "no-store"})

    async def _session_cleaner():
        while True:
            try:
                now = time.time()
                dirs = [d for d in SESSIONS_DIR.iterdir() if d.is_dir()]
                # expire idle sessions
                for d in dirs:
                    if now - d.stat().st_mtime > SESSION_TTL_SECONDS:
                        shutil.rmtree(d, ignore_errors=True)
                # enforce hard cap (oldest first)
                dirs = sorted(
                    (d for d in SESSIONS_DIR.iterdir() if d.is_dir()),
                    key=lambda d: d.stat().st_mtime,
                )
                for d in dirs[: max(0, len(dirs) - SESSION_MAX_COUNT)]:
                    shutil.rmtree(d, ignore_errors=True)
            except Exception:
                pass
            await asyncio.sleep(15 * 60)

    @app.on_event("startup")
    async def _start_cleaner():
        asyncio.get_event_loop().create_task(_session_cleaner())

else:
    app.mount("/projects-static", NoCacheStaticFiles(directory=PROJECTS_DIR), name="projects-static")


# ── UI ROUTES ─────────────────────────────────────────────────────

@app.get("/", response_class=HTMLResponse)
def welcome():
    return HTMLResponse(content=(BASE_DIR / "templates" / "welcome.html").read_text(encoding="utf-8"), media_type="text/html; charset=utf-8")


@app.get("/project/{project_id}", response_class=HTMLResponse)
def open_project(project_id: str, request: Request):
    project_dir = projects_dir_for(request) / project_id
    if not project_dir.exists():
        return HTMLResponse("Project not found", status_code=404)

    html  = (BASE_DIR / "templates" / "forge.html").read_text(encoding="utf-8")
    proj  = json.loads((project_dir / "project.json").read_text(encoding="utf-8"))

    # inject project info
    html = html.replace("__PROJECT_ID__",   project_id)
    html = html.replace("__PROJECT_NAME__", proj["name"])

    # inject object scripts
    html = html.replace("<!-- __OBJECTS__ -->",
        objectsyn.get_script_tags(project_dir))

    # inject mode scripts
    html = html.replace("<!-- __MODES__ -->",
        modesyn.get_script_tags(project_dir))

    return HTMLResponse(content=html)


# ── PROJECT API ───────────────────────────────────────────────────

@app.get("/api/projects")
def list_projects(request: Request):
    result = projectsyn.list_projects(projects_dir_for(request))
    for p in result.get("projects", []):
        p["protected"] = p.get("id") in PROTECTED_PROJECTS
    return result


@app.post("/api/projects/create")
def create_project(data: dict, request: Request):
    name = data.get("name", "").strip()
    if not name:
        return JSONResponse({"ok": False, "error": "Name required"}, status_code=400)
    try:
        result = projectsyn.create_project(projects_dir_for(request), name)
        return JSONResponse(result)
    except Exception as e:
        import traceback
        traceback.print_exc()
        return JSONResponse({"ok": False, "error": str(e)}, status_code=500)


@app.delete("/api/projects/{project_id}")
def delete_project(project_id: str, request: Request):
    if project_id in PROTECTED_PROJECTS:
        return JSONResponse(
            {"ok": False, "error": "Sample projects can't be deleted"},
            status_code=403)
    result = projectsyn.delete_project(projects_dir_for(request), project_id)
    return JSONResponse(result)


# ── SCENE PERSISTENCE ─────────────────────────────────────────────
# Saves object transforms/colors and animation keyframes to scene.json,
# loaded automatically when the project opens.

@app.post("/api/{project_id}/scene")
def save_scene(project_id: str, data: dict, request: Request):
    project_dir = projects_dir_for(request) / project_id
    if not project_dir.exists():
        return JSONResponse({"ok": False, "error": "Project not found"}, status_code=404)
    raw = json.dumps(data)
    if len(raw) > 2_000_000:
        return JSONResponse({"ok": False, "error": "Scene too large"}, status_code=400)
    (project_dir / "scene.json").write_text(raw, encoding="utf-8")
    return JSONResponse({"ok": True})


# ── OBJECT API ────────────────────────────────────────────────────

@app.post("/api/{project_id}/objects/create")
def create_object(project_id: str, data: dict, request: Request):
    project_dir = projects_dir_for(request) / project_id
    name = data.get("name", "").strip()
    if not name or not name.isidentifier():
        return JSONResponse({"ok": False, "error": "Invalid name"}, status_code=400)
    primitive = data.get("primitive", "box")
    color = data.get("color")
    return JSONResponse(objectsyn.create_object(project_dir, name, primitive, color))


@app.post("/api/{project_id}/objects/upload")
def upload_object(project_id: str, data: dict, request: Request):
    # Uploading arbitrary script files is a local-version feature.
    if DEMO_MODE:
        return JSONResponse(
            {"ok": False, "error": "Uploading script files works in the local version."},
            status_code=403)
    project_dir = projects_dir_for(request) / project_id
    name = data.get("name", "").strip()
    code = data.get("code", "")
    if not name or not name.isidentifier():
        return JSONResponse({"ok": False, "error": "Invalid name"}, status_code=400)
    if not code or len(code) > 500_000:
        return JSONResponse({"ok": False, "error": "Invalid or too large file"}, status_code=400)
    return JSONResponse(objectsyn.upload_object(project_dir, name, code))


@app.delete("/api/{project_id}/objects/{name}")
def delete_object(project_id: str, name: str, request: Request):
    project_dir = projects_dir_for(request) / project_id
    return JSONResponse(objectsyn.delete_object(project_dir, name))


# ── MODE API ──────────────────────────────────────────────────────

@app.post("/api/{project_id}/modes/create")
def create_mode(project_id: str, data: dict, request: Request):
    project_dir = projects_dir_for(request) / project_id
    name = data.get("name", "").strip()
    if not name or not name.isidentifier():
        return JSONResponse({"ok": False, "error": "Invalid name"}, status_code=400)
    return JSONResponse(modesyn.create_mode(project_dir, name))


@app.delete("/api/{project_id}/modes/{name}")
def delete_mode(project_id: str, name: str, request: Request):
    project_dir = projects_dir_for(request) / project_id
    return JSONResponse(modesyn.delete_mode(project_dir, name))


# ── WEBSOCKET ─────────────────────────────────────────────────────

@app.websocket("/ws/{project_id}")
async def websocket_endpoint(websocket: WebSocket, project_id: str):
    await websocket.accept()
    try:
        while True:
            data = await websocket.receive_text()
            msg  = json.loads(data)
            # TODO: route to project-specific handlers
            await websocket.send_text(json.dumps({"ok": True, "echo": msg}))
    except WebSocketDisconnect:
        pass


# ── ENTRY POINT ───────────────────────────────────────────────────

def _open_when_ready(host: str, port: int, url: str, timeout: float = 15.0):
    deadline = time.time() + timeout
    while time.time() < deadline:
        try:
            with socket.create_connection((host, port), timeout=0.5):
                webbrowser.open(url)
                return
        except OSError:
            time.sleep(0.2)


def start(host: str = None, port: int = None, open_browser: bool = None):
    host = host or os.environ.get("FORGE_HOST", "127.0.0.1")
    port = port or int(os.environ.get("FORGE_PORT", "8001" if DEMO_MODE else "8000"))
    if open_browser is None:
        open_browser = not DEMO_MODE
    url = f"http://{host}:{port}/"
    if open_browser:
        threading.Thread(target=_open_when_ready, args=(host, port, url), daemon=True).start()
    print(f"\n FORGE3D running at {url}" + ("  [demo mode]" if DEMO_MODE else "") + "\n")
    uvicorn.run("main:app", host=host, port=port, reload=not DEMO_MODE)


if __name__ == "__main__":
    start()
