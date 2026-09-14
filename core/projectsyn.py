# core/projectsyn.py

import json
import shutil
from pathlib import Path
from datetime import datetime


def list_projects(projects_dir: Path) -> dict:
    projects = []
    for p in sorted(projects_dir.iterdir()):
        if p.is_dir() and (p / "project.json").exists():
            meta = json.loads((p / "project.json").read_text(encoding="utf-8"))
            projects.append({"id": p.name, **meta})
    return {"ok": True, "projects": projects}


def create_project(projects_dir: Path, name: str) -> dict:
    project_id  = name.lower().replace(" ", "_")
    project_dir = projects_dir / project_id

    if project_dir.exists():
        return {"ok": False, "error": f"Project '{name}' already exists"}

    (project_dir / "Objects").mkdir(parents=True)
    (project_dir / "Modes").mkdir(parents=True)
    (project_dir / "shared").mkdir(parents=True)

    meta = {
        "name":    name,
        "id":      project_id,
        "created": datetime.now().isoformat(),
        "modes":   ["Workspace"],
    }
    (project_dir / "project.json").write_text(json.dumps(meta, indent=2), encoding="utf-8")
    _create_workspace_mode(project_dir)
    return {"ok": True, "id": project_id, "name": name}


def delete_project(projects_dir: Path, project_id: str) -> dict:
    project_dir = projects_dir / project_id
    if not project_dir.exists():
        return {"ok": False, "error": "Project not found"}
    shutil.rmtree(project_dir)
    return {"ok": True}


def _create_workspace_mode(project_dir: Path):
    mode_dir = project_dir / "Modes" / "Workspace"
    mode_dir.mkdir(parents=True, exist_ok=True)
    (mode_dir / "mode.js").write_text(WORKSPACE_MODE_JS, encoding="utf-8")


WORKSPACE_MODE_JS = """\
// Workspace/mode.js

FORGE.registerMode({
  id:   'workspace',
  name: '3D Workspace',

  panel: `
    <div class="pblock">
      <div class="phead" onclick="FORGE.toggleBlock(this)"><span>Camera</span><span class="parrow">&#9662;</span></div>
      <div class="pbody">
        <div class="cam-switch" style="margin-bottom:8px">
          <button class="cam-btn active" id="btn-persp" onclick="FORGE.setCamMode('persp')">PERSP</button>
          <button class="cam-btn"        id="btn-ortho" onclick="FORGE.setCamMode('ortho')">ORTHO</button>
        </div>
        <div class="prow">
          <span>FOV</span>
          <input type="range" min="20" max="120" value="45" id="sl-fov" oninput="FORGE.setFov(this.value)">
        </div>
      </div>
    </div>

    <div class="pblock">
      <div class="phead" onclick="FORGE.toggleBlock(this)"><span>Presets</span><span class="parrow">&#9662;</span></div>
      <div class="pbody">
        <button class="sbtn" onclick="FORGE.setView('front')"><span class="sicon">&#9635;</span>Front</button>
        <button class="sbtn" onclick="FORGE.setView('top')"><span class="sicon">&#9635;</span>Top</button>
        <button class="sbtn" onclick="FORGE.setView('right')"><span class="sicon">&#9635;</span>Right</button>
        <button class="sbtn" onclick="FORGE.setView('iso')"><span class="sicon">&#10696;</span>Isometric</button>
        <button class="sbtn" onclick="FORGE.resetCamera()"><span class="sicon">&#8634;</span>Reset View</button>
      </div>
    </div>

    <div class="pblock">
      <div class="phead" onclick="FORGE.toggleBlock(this)"><span>Overlays</span><span class="parrow">&#9662;</span></div>
      <div class="pbody">
        <div class="trow"><span class="tlabel">Grid</span><button class="tpill on" id="tog-grid" onclick="FORGE.toggleOverlay('grid',this)"></button></div>
        <div class="trow"><span class="tlabel">Axis</span><button class="tpill on" id="tog-axis" onclick="FORGE.toggleOverlay('axis',this)"></button></div>
        <div class="trow"><span class="tlabel">Gizmo</span><button class="tpill on" id="tog-gizmo" onclick="FORGE.toggleOverlay('gizmo',this)"></button></div>
        <div class="prow" style="margin-top:6px"><span>Grid size</span><input type="range" min="2" max="20" value="10" id="sl-grid-size" oninput="FORGE.setGridSize(this.value)"></div>
        <div class="prow"><span>Opacity</span><input type="range" min="1" max="10" value="4" id="sl-grid-opacity" oninput="FORGE.setGridOpacity(this.value)"></div>
      </div>
    </div>
  `,

  onEnter(scene) { FORGE.showOverlays(true);  },
  onExit(scene)  { FORGE.showOverlays(false); },
});
"""