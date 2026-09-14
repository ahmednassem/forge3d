# FORGE3D

![banner](.github/social-preview.png)


A browser-based 3D workspace editor built from scratch with **FastAPI** and **Three.js**.

**Live demo:** https://ahmednassem.com/projects/forge3d/app/

FORGE3D lets you create projects and build 3D scenes directly in the browser:

- **Objects** :  JavaScript files that construct Three.js meshes and register
  them with the engine. Create one from the outliner and it becomes a script
  you can edit; the scene picks it up on reload.
- **Modes** :  custom UI tabs per project. The default **Workspace** mode is a
  full 3D viewport (perspective/ortho cameras, view presets, grid/axis/gizmo
  overlays, transform/rotation/scale editing, lights, wireframe and shadow
  toggles). Custom modes load their own HTML panel, so a project can ship its
  own tooling UI.

## Running locally

```bash
pip install -r requirements.txt
python main.py
```

Opens `http://127.0.0.1:8000` with the sample projects (a car and a Rubik's
cube). Local mode shares a single `Projects/` directory across the host; you
can upload object scripts freely.

## Demo mode (how the live demo works)

```bash
FORGE_DEMO=1 uvicorn main:app --host 127.0.0.1 --port 8001
```

In demo mode every visitor gets a **private sandbox session**: on first visit
the server copies the sample projects into a per-session folder
(cookie-identified), so anyone can create, edit, and delete projects freely
without affecting other visitors. Idle sessions are cleaned up automatically
after 6 hours and a hard cap keeps disk usage bounded.

## Structure

```
main.py           FastAPI app: routes, demo sessions, entry point
core/             project / object / mode file scaffolding
templates/        welcome page + editor shell
UI/               editor stylesheet and engine (Forge.js), vendored Three.js
Projects/         sample projects (each: project.json, Objects/, Modes/)
```

`Projects/<id>/project.json` describes the project. `Projects/<id>/Objects/`
contains JavaScript files that export a function returning a Three.js
`Object3D`. `Projects/<id>/Modes/<mode>/index.html` is the panel HTML for that
custom mode.

## Typical usage

1. **Open a sample project** (the welcome page lists two: a small car, and a
   Rubik's cube) :  you get straight into the Workspace.
2. **Tweak** transforms, rotate, scale, toggle wireframe and shadows, change
   camera presets. Edits auto-save to `scene.json` per project.
3. **Add an Object** from the outliner (Box, Sphere, Cylinder, Cone, Torus,
   Plane, custom JS). The new object's script appears in the file tree and is
   loaded into the scene on reload.
4. **Add a Mode** from the modes list. The new tab loads your custom HTML, so
   a project can ship its own UI (a graph editor, a node tree, a shader
   inspector, anything).
5. **Save & share**: scene state is in `scene.json` next to `project.json`;
   objects and modes are plain files in their subfolders. The whole project is
   just files on disk.

## Demo session safety

The `Protected projects` set (`rubikcube`, `carv1`) cannot be deleted even in
demo sessions. Uploading of arbitrary `.js` object files is only enabled in
local mode :  the live demo refuses it so per-visitor sandboxes stay safe.

## Tech stack

- Python 3.10+, FastAPI + uvicorn
- Three.js, vendored into `UI/JS/` (no CDN dependency at runtime)
- vanilla JavaScript :  no build step, no bundler
- Static-file serving via FastAPI with `no-store` cache headers

For the full technical write-up (object-script pipeline, picking,
transform tools, modes system, demo sandboxing, and architecture
diagrams), see [EXPLANATION.md](EXPLANATION.md).

## License

MIT :  see `LICENSE`.
