# core/objectsyn.py :  object file management

import random
import re
from pathlib import Path

_HEX_RE = re.compile(r"^#[0-9a-fA-F]{6}$")


def get_script_tags(project_dir: Path) -> str:
    objects_dir = project_dir / "Objects"
    tags = ""
    if objects_dir.exists():
        for js in sorted(objects_dir.glob("*.js")):
            tags += f'<script src="../projects-static/{project_dir.name}/Objects/{js.name}"></script>\n'
    return tags


def create_object(project_dir: Path, name: str, primitive: str = "empty",
                  color: str = None) -> dict:
    objects_dir = project_dir / "Objects"
    objects_dir.mkdir(exist_ok=True)
    filepath = objects_dir / f"{name}.js"

    if filepath.exists():
        return {"ok": False, "error": f"{name}.js already exists"}

    if not (color and _HEX_RE.match(color)):
        color = random.choice(COLORS)

    if primitive in PRIMITIVES:
        geometry, offset_y, extra = PRIMITIVES[primitive]
        code = PRIMITIVE_TEMPLATE.format(
            name=name, id=name.lower(), color=color,
            geometry=geometry, offset_y=offset_y, extra=extra,
        )
    else:
        code = OBJECT_TEMPLATE.format(name=name, id=name.lower(), color=color)

    filepath.write_text(code, encoding="utf-8")
    return {"ok": True, "file": f"{name}.js", "id": name.lower()}


def upload_object(project_dir: Path, name: str, code: str) -> dict:
    """Save a user-provided Three.js object script (local use)."""
    objects_dir = project_dir / "Objects"
    objects_dir.mkdir(exist_ok=True)
    filepath = objects_dir / f"{name}.js"

    if filepath.exists():
        return {"ok": False, "error": f"{name}.js already exists"}

    filepath.write_text(code, encoding="utf-8")
    return {"ok": True, "file": f"{name}.js", "id": name.lower()}


def delete_object(project_dir: Path, name: str) -> dict:
    filepath = project_dir / "Objects" / f"{name}.js"
    if not filepath.exists():
        return {"ok": False, "error": "File not found"}
    filepath.unlink()
    return {"ok": True}


# Pleasant material colors, picked at random for new primitives.
COLORS = [
    "#4d9fff", "#e05050", "#50c050", "#e0a030",
    "#b070e0", "#40c0b0", "#e070a8", "#c8c8c8",
]

# primitive -> (geometry constructor, group Y offset so it sits on the grid, extra mesh setup)
PRIMITIVES = {
    "box":      ("new THREE.BoxGeometry(1, 1, 1)",                 0.5, ""),
    "sphere":   ("new THREE.SphereGeometry(0.6, 32, 16)",          0.6, ""),
    "cylinder": ("new THREE.CylinderGeometry(0.5, 0.5, 1.2, 32)",  0.6, ""),
    "cone":     ("new THREE.ConeGeometry(0.6, 1.2, 32)",           0.6, ""),
    "plane":    ("new THREE.PlaneGeometry(1.5, 1.5)",              0.0,
                 "mesh.rotation.x = -Math.PI / 2;\n        mesh.material.side = THREE.DoubleSide;"),
    "torus":    ("new THREE.TorusGeometry(0.6, 0.22, 16, 48)",     0.82, ""),
}

PRIMITIVE_TEMPLATE = """\
// {name}.js

var {name} = (() => {{

    const group = new THREE.Group();

    function init(scene) {{
        scene.add(group);

        const geometry = {geometry};
        const material = new THREE.MeshStandardMaterial({{ color: '{color}' }});
        const mesh     = new THREE.Mesh(geometry, material);
        {extra}
        group.add(mesh);
        group.position.y = {offset_y};

        FORGE.registerObject({{ id: '{id}', name: '{name}', group, color: '{color}' }});
    }}

    return {{ init }};
}})();

FORGE.addObject(scene => {name}.init(scene));
"""

OBJECT_TEMPLATE = """\
// {name}.js

var {name} = (() => {{

    const group = new THREE.Group();

    function init(scene) {{
        scene.add(group);

        // ── write your Three.js code here ──────────────────


        // ───────────────────────────────────────────────────

        FORGE.registerObject({{ id: '{id}', name: '{name}', group, color: '{color}' }});
    }}

    return {{ init }};
}})();

FORGE.addObject(scene => {name}.init(scene));
"""
