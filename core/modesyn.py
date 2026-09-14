# core/modesyn.py

from pathlib import Path


def get_script_tags(project_dir: Path) -> str:
    modes_dir = project_dir / "Modes"
    tags = ""
    if modes_dir.exists():
        for mode_dir in sorted(modes_dir.iterdir()):
            mode_js = mode_dir / "mode.js"
            if mode_js.exists():
                tags += f'<script src="../projects-static/{project_dir.name}/Modes/{mode_dir.name}/mode.js"></script>\n'
    return tags


def create_mode(project_dir: Path, name: str) -> dict:
    mode_dir = project_dir / "Modes" / name
    if mode_dir.exists():
        return {"ok": False, "error": f"Mode '{name}' already exists"}

    mode_dir.mkdir(parents=True)

    # write mode.js with correct paths baked in
    mode_js = f"""\
// {name}/mode.js

FORGE.registerMode({{
  id:   '{name.lower()}',
  name: '{name}',

  onEnter(scene) {{
    const el = FORGE.getContent();
    fetch('../projects-static/' + FORGE_PROJECT_ID + '/Modes/{name}/index.html')
      .then(r => r.text())
      .then(html => {{ el.innerHTML = html; }});
  }},

  onExit(scene) {{
    FORGE.getContent().innerHTML = '';
  }},
}});
"""

    index_html = f"""\
<!-- {name}/index.html -->
<link rel="stylesheet" href="../projects-static/{project_dir.name}/Modes/{name}/style.css">

<!-- write your mode UI here -->
"""

    style_css = f"""\
/* {name}/style.css */
/* write your mode styles here */

* {{ box-sizing: border-box; margin: 0; padding: 0; }}
body {{ background: #1a1a1a; color: #e0e0e0; font-family: monospace; }}
"""

    (mode_dir / "mode.js").write_text(mode_js, encoding="utf-8")
    (mode_dir / "index.html").write_text(index_html, encoding="utf-8")
    (mode_dir / "style.css").write_text(style_css, encoding="utf-8")

    return {"ok": True, "name": name}


def delete_mode(project_dir: Path, name: str) -> dict:
    import shutil
    mode_dir = project_dir / "Modes" / name
    if name == "Workspace":
        return {"ok": False, "error": "Cannot delete Workspace mode"}
    if not mode_dir.exists():
        return {"ok": False, "error": "Mode not found"}
    shutil.rmtree(mode_dir)
    return {"ok": True}
