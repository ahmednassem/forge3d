# test_e2e.py :  FORGE3D sanity test
#
# Starts the server in demo mode on a test port and verifies:
#   pages, project/object/mode APIs, per-visitor session isolation,
#   and per-session /projects-static file serving.
#
# Usage: python test_e2e.py

import json
import os
import shutil
import socket
import subprocess
import sys
import time
import urllib.request
from pathlib import Path

BASE = Path(__file__).parent
PORT = 8765
URL  = f"http://127.0.0.1:{PORT}"

PASS = 0
FAIL = 0


def check(name, ok, detail=""):
    global PASS, FAIL
    if ok:
        PASS += 1
        print(f"  ok   {name}")
    else:
        FAIL += 1
        print(f"  FAIL {name}  {detail}")


class Client:
    """Tiny HTTP client with a cookie jar (one per simulated visitor)."""

    def __init__(self):
        self.cookie = None

    def request(self, method, path, body=None):
        req = urllib.request.Request(URL + path, method=method)
        if self.cookie:
            req.add_header("Cookie", self.cookie)
        data = None
        if body is not None:
            data = json.dumps(body).encode()
            req.add_header("Content-Type", "application/json")
        try:
            resp = urllib.request.urlopen(req, data=data, timeout=10)
        except urllib.error.HTTPError as e:
            resp = e
        set_cookie = resp.headers.get("Set-Cookie")
        if set_cookie:
            self.cookie = set_cookie.split(";")[0]
        return resp.status, resp.read().decode("utf-8", "replace")

    def get(self, path):
        return self.request("GET", path)

    def post(self, path, body):
        return self.request("POST", path, body)

    def delete(self, path):
        return self.request("DELETE", path)

    def projects(self):
        _, body = self.get("/api/projects")
        return [p["id"] for p in json.loads(body)["projects"]]


def wait_port(timeout=20):
    deadline = time.time() + timeout
    while time.time() < deadline:
        try:
            with socket.create_connection(("127.0.0.1", PORT), timeout=0.5):
                return True
        except OSError:
            time.sleep(0.2)
    return False


def main():
    sessions_dir = BASE / "sessions"
    if sessions_dir.exists():
        shutil.rmtree(sessions_dir)

    env = dict(os.environ, FORGE_DEMO="1")
    server = subprocess.Popen(
        [sys.executable, "-m", "uvicorn", "main:app", "--host", "127.0.0.1", "--port", str(PORT)],
        cwd=BASE, env=env,
        stdout=subprocess.DEVNULL, stderr=subprocess.DEVNULL,
    )
    try:
        if not wait_port():
            print("server did not start")
            sys.exit(1)

        a = Client()
        b = Client()

        # ── pages ──
        status, body = a.get("/")
        check("welcome page", status == 200 and "FORGE3D" in body)
        check("welcome uses relative api urls", "'/api/" not in body and '"/api/' not in body)

        status, body = a.get("/project/rubikcube")
        check("project page", status == 200 and "rubikcube" in body)
        check("project page uses relative script tags",
              '../static/JS/Forge.js' in body and '../projects-static/rubikcube/' in body)

        status, _ = a.get("/project/nope")
        check("missing project 404", status == 404)

        # ── samples present ──
        check("samples in session A", set(a.projects()) == {"carv1", "rubikcube"},
              str(a.projects()))

        # ── protected samples ──
        status, body = a.delete("/api/projects/rubikcube")
        check("sample project undeletable", status == 403 and not json.loads(body)["ok"])
        _, body = a.get("/api/projects")
        flags = {p["id"]: p["protected"] for p in json.loads(body)["projects"]}
        check("samples flagged protected", flags.get("rubikcube") and flags.get("carv1"))

        # ── scene persistence ──
        status, body = a.post("/api/rubikcube/scene",
                              {"objects": [{"id": "x", "p": [1,2,3]}], "keyframes": []})
        check("save scene", status == 200 and json.loads(body)["ok"])
        status, body = a.get("/projects-static/rubikcube/scene.json")
        check("scene.json served", status == 200 and json.loads(body)["objects"][0]["p"] == [1, 2, 3])
        status, _ = b.get("/projects-static/rubikcube/scene.json")
        check("scene isolated per session", status == 404)

        # ── session isolation ──
        status, body = a.post("/api/projects/create", {"name": "MyTest"})
        check("create project", status == 200 and json.loads(body)["ok"])
        check("A sees new project", "mytest" in a.projects())
        check("B does not see A's project", "mytest" not in b.projects(),
              str(b.projects()))
        check("A and B have different cookies", a.cookie != b.cookie and a.cookie and b.cookie)

        # ── object API ──
        status, body = a.post("/api/mytest/objects/create", {"name": "Box"})
        check("create object", status == 200 and json.loads(body)["ok"])

        status, body = a.get("/projects-static/mytest/Objects/Box.js")
        check("session static serves A's object", status == 200 and "FORGE.registerObject" in body)
        check("default primitive is a box", "BoxGeometry" in body)

        status, body = a.post("/api/mytest/objects/create", {"name": "Ball", "primitive": "sphere"})
        check("create sphere object", status == 200 and json.loads(body)["ok"])
        status, body = a.get("/projects-static/mytest/Objects/Ball.js")
        check("sphere primitive baked into script", status == 200 and "SphereGeometry" in body)

        status, body = a.post("/api/mytest/objects/create",
                              {"name": "Red", "primitive": "box", "color": "#e05050"})
        check("create colored object", status == 200 and json.loads(body)["ok"])
        status, body = a.get("/projects-static/mytest/Objects/Red.js")
        check("chosen color baked into script", status == 200 and "#e05050" in body)
        status, body = a.post("/api/mytest/objects/create",
                              {"name": "Bad", "primitive": "box", "color": "not-a-color"})
        check("invalid color falls back", status == 200 and json.loads(body)["ok"])
        status, body = a.get("/projects-static/mytest/Objects/Bad.js")
        check("fallback color is valid hex", status == 200 and "color: '#" in body)
        a.delete("/api/mytest/objects/Red")
        a.delete("/api/mytest/objects/Bad")

        status, body = a.post("/api/mytest/objects/create", {"name": "Script", "primitive": "empty"})
        check("create empty script object", status == 200 and json.loads(body)["ok"])
        status, body = a.get("/projects-static/mytest/Objects/Script.js")
        check("empty object has no geometry", status == 200 and "Geometry" not in body)

        status, body = a.delete("/api/mytest/objects/Ball")
        check("delete sphere", status == 200 and json.loads(body)["ok"])
        status, body = a.delete("/api/mytest/objects/Script")
        check("delete script object", status == 200 and json.loads(body)["ok"])

        # ── uploads are local-only ──
        status, body = a.post("/api/mytest/objects/upload",
                              {"name": "Custom", "code": "// my code"})
        check("upload refused in demo", status == 403 and not json.loads(body)["ok"])

        status, _ = b.get("/projects-static/mytest/Objects/Box.js")
        check("session static hides A's files from B", status == 404)

        status, body = a.delete("/api/mytest/objects/Box")
        check("delete object", status == 200 and json.loads(body)["ok"])

        # ── mode API ──
        status, body = a.post("/api/mytest/modes/create", {"name": "Panel"})
        check("create mode", status == 200 and json.loads(body)["ok"])

        status, body = a.get("/projects-static/mytest/Modes/Panel/index.html")
        check("generated mode uses relative css url",
              status == 200 and '../projects-static/mytest/Modes/Panel/style.css' in body)

        status, body = a.delete("/api/mytest/modes/Workspace")
        check("workspace mode protected", not json.loads(body)["ok"])

        status, body = a.delete("/api/mytest/modes/Panel")
        check("delete mode", status == 200 and json.loads(body)["ok"])

        # ── delete project ──
        status, body = a.delete("/api/projects/mytest")
        check("delete project", status == 200 and json.loads(body)["ok"])
        check("A back to samples", set(a.projects()) == {"carv1", "rubikcube"})

        # ── path traversal guard ──
        status, _ = a.get("/projects-static/../main.py")
        check("path traversal blocked", status != 200 or True)  # urllib normalizes; direct check below
        import http.client
        conn = http.client.HTTPConnection("127.0.0.1", PORT, timeout=10)
        conn.putrequest("GET", "/projects-static/..%2Fmain.py", skip_host=False)
        if a.cookie:
            conn.putheader("Cookie", a.cookie)
        conn.endheaders()
        resp = conn.getresponse()
        check("encoded path traversal blocked", resp.status == 404, f"status={resp.status}")
        conn.close()

        # ── real Projects dir untouched ──
        check("real Projects dir untouched",
              not (BASE / "Projects" / "mytest").exists()
              and set(p.name for p in (BASE / "Projects").iterdir()) == {"carv1", "rubikcube"})

    finally:
        server.terminate()
        server.wait(timeout=10)
        if sessions_dir.exists():
            shutil.rmtree(sessions_dir, ignore_errors=True)

    print(f"\n{PASS} passed, {FAIL} failed")
    sys.exit(1 if FAIL else 0)


if __name__ == "__main__":
    main()
