// Forge.js :  FORGE3D core engine

// Repo link shown in hosted-demo notices (updated after the repo is published).
const FORGE_GITHUB_URL = 'https://github.com/';

const FORGE = (() => {

  let renderer, scene, camera, orthoCamera;
  let gridGroup, axisGroup;
  let ambientLight, sunLight;
  let isOrtho = false, isWire = false;
  let isDragging = false, lastX = 0, lastY = 0;
  let gridSize = 10, gridOpacity = 4;
  let customBg = null, panelOpen = true;
  let sph = { theta: Math.PI/4, phi: Math.PI/4, r: 9 };
  let frames = 0, fpsLast = performance.now();
  let objects = [], selectedIds = [];
  let _editBaseline = null;
  let modes = [], currentModeId = null;
  const _queue = [];

  // viewport editing (Blender-style)
  let _tool = null;                       // active G/R/S tool state
  let _lastMouse = { clientX: 0, clientY: 0 };
  let _pickedPrimitive = 'box';           // shape chosen in the Add Object popup
  const _selHelpers = new Map();          // object id -> THREE.BoxHelper
  const _ray = new THREE.Raycaster(), _ndc = new THREE.Vector2();
  const AXIS_VEC = { x: new THREE.Vector3(1,0,0), y: new THREE.Vector3(0,1,0), z: new THREE.Vector3(0,0,1) };

  // ── init ──────────────────────────────────────────
  function init() {
    const canvas = document.getElementById('cv');
    renderer = new THREE.WebGLRenderer({ canvas, antialias: true });
    renderer.setPixelRatio(window.devicePixelRatio);

    scene       = new THREE.Scene();
    camera      = new THREE.PerspectiveCamera(45, 1, 0.1, 500);
    orthoCamera = new THREE.OrthographicCamera(-8, 8, 8, -8, 0.1, 500);

    ambientLight = new THREE.AmbientLight(0xffffff, 0.5);
    scene.add(ambientLight);
    sunLight = new THREE.DirectionalLight(0xffffff, 0.9);
    sunLight.position.set(6, 10, 6);
    scene.add(sunLight);

    gridGroup = new THREE.Group(); scene.add(gridGroup);
    axisGroup = new THREE.Group(); scene.add(axisGroup);

    buildGrid(); buildAxis();
    updateCamera(); onResize();

    window.addEventListener('resize', onResize);
    const vp = document.getElementById('viewport');
    let downX = 0, downY = 0, maybeClick = false;
    vp.addEventListener('mousedown', e => {
      if (e.target.closest && e.target.closest('#sel-toolbar')) return;  // toolbar clicks
      if (_tool) {  // click confirms, right-click cancels the active tool
        if (e.button === 2) _toolCancel(); else _toolConfirm();
        e.preventDefault(); return;
      }
      if (e.button===0||e.button===1) {
        isDragging=true; lastX=e.clientX; lastY=e.clientY;
        downX=e.clientX; downY=e.clientY;
        maybeClick = e.button===0 && e.target && e.target.id === 'cv';
      }
    });
    window.addEventListener('mouseup', e => {
      isDragging=false;
      if (maybeClick && Math.abs(e.clientX-downX)<5 && Math.abs(e.clientY-downY)<5 && _isEditableMode()) {
        const hit = _pickObject(e);
        if (hit) selectObject(hit.id, e.shiftKey||e.ctrlKey||e.metaKey);
        else if (!e.shiftKey) _clearSelection();
      }
      maybeClick=false;
    });
    window.addEventListener('mousemove', onMouseMove);
    window.addEventListener('keydown', onKeyDown);
    const fileInput = document.getElementById('obj-file-input');
    if (fileInput) fileInput.addEventListener('change', e => {
      const f = e.target.files[0];
      if (f) _handleObjectFile(f);
      e.target.value = '';
    });
    vp.addEventListener('wheel', onWheel, { passive:false });
    vp.addEventListener('contextmenu', e => { e.preventDefault(); if (_tool) _toolCancel(); });
    loop();
  }

  function _isEditableMode() {
    if (currentModeId === 'workspace') return true;
    const m = modes.find(x => x.id === currentModeId);
    return !!(m && m.viewport);
  }

  // ── queue ──────────────────────────────────────────
  let _sceneReady = false;

  function addObject(fn) {
    if (_sceneReady) {
      fn(scene);  // scene already ready :  run immediately
    } else {
      _queue.push(fn);
    }
  }

  function _runQueue() {
    _sceneReady = true;
    _queue.forEach(fn => fn(scene));
  }

  // ── mode system ────────────────────────────────────
  function registerMode({ id, name, panel, onEnter, onExit, viewport }) {
    modes.push({ id, name, panel: panel||'', onEnter, onExit, viewport: !!viewport });
    _rebuildModeTabs();
    if (modes.length === 1) setMode(id);
  }

  function _rebuildModeTabs() {
    const tabs = document.getElementById('mode-tabs');
    if (!tabs) return;
    tabs.innerHTML = modes.map(m => `
      <button class="mb-tab ${currentModeId===m.id?'active':''}"
        draggable="true"
        ondragstart="FORGE._dragStart(event,'${m.id}')"
        ondragover="FORGE._dragOver(event)"
        ondrop="FORGE._dragDrop(event,'${m.id}')"
        onclick="FORGE.setMode('${m.id}')">${m.name}</button>
    `).join('');
  }

  // ── drag to reorder ────────────────────────────
  let _draggedId = null;

  function _dragStart(e, id) {
    _draggedId = id;
    e.dataTransfer.effectAllowed = 'move';
  }

  function _dragOver(e) {
    e.preventDefault();
    e.dataTransfer.dropEffect = 'move';
  }

  function _dragDrop(e, targetId) {
    e.preventDefault();
    if (!_draggedId || _draggedId === targetId) return;
    const ai = modes.findIndex(m => m.id === _draggedId);
    const bi = modes.findIndex(m => m.id === targetId);
    const [moved] = modes.splice(ai, 1);
    modes.splice(bi, 0, moved);
    _draggedId = null;
    _rebuildModeTabs();
  }

  function setMode(id) {
    const prev = modes.find(m => m.id===currentModeId);
    if (prev && prev.onExit) prev.onExit(scene);
    currentModeId = id;
    _rebuildModeTabs();

    const mode = modes.find(m => m.id===id);
    const isWS = id === 'workspace';
    const keepViewport = isWS || (mode && mode.viewport);

    if (keepViewport) {
      document.getElementById('main').style.display = '';
      document.getElementById('left-panel').style.display = '';
      document.querySelectorAll('.ws-only').forEach(el => el.style.display = isWS ? '' : 'none');
      document.querySelector('.panel-footer').style.display = '';
      document.querySelector('.panel-spacer').style.display = '';
      document.getElementById('mode-panel').innerHTML = mode ? mode.panel||'' : '';
      document.getElementById('mode-content').style.display = 'none';
    } else {
      document.getElementById('main').style.display = 'none';
      document.getElementById('mode-content').style.display = '';
      document.getElementById('mode-content').innerHTML = '';
    }

    if (mode && mode.onEnter) mode.onEnter(scene);
    _syncSelToolbar();
    setTimeout(onResize, 10);
  }

  function showOverlays(visible) {
    if (gridGroup) gridGroup.visible = visible;
    if (axisGroup) axisGroup.visible = visible;
    const gizmo = document.getElementById('gizmo');
    const info  = document.getElementById('vp-info');
    if (gizmo) gizmo.style.display = visible ? 'block' : 'none';
    if (info)  info.style.display  = visible ? 'block' : 'none';
    objects.forEach(o => {
      o.group.visible = visible ? o.visible : selectedIds.includes(o.id);
    });
  }

  // ── mode popup ─────────────────────────────────────
  function promptNewMode() {
    const popup = document.getElementById('mode-popup');
    const input = document.getElementById('mode-name-input');
    document.getElementById('mode-popup-error').textContent = '';
    input.value = ''; popup.style.display = 'flex'; input.focus();
    input.onkeydown = e => { if(e.key==='Enter') createMode(); if(e.key==='Escape') closeModePopup(); };
  }

  function closeModePopup() { document.getElementById('mode-popup').style.display = 'none'; }

  async function createMode() {
    const name = document.getElementById('mode-name-input').value.trim();
    const err  = document.getElementById('mode-popup-error');
    if (!name) { err.textContent='Enter a name'; return; }
    const res  = await fetch(`../api/${FORGE_PROJECT_ID}/modes/create`, {
      method:'POST', headers:{'Content-Type':'application/json'},
      body: JSON.stringify({ name }),
    });
    const data = await res.json();
    if (!data.ok) { err.textContent=data.error; return; }
    // reload to pick up new mode.js, then switch to it
    sessionStorage.setItem('forge_goto_mode', name.toLowerCase());
    // On the hosted demo, explain that developing a mode needs the local version
    // (its HTML/CSS/JS files can only be edited with the code on your machine).
    const hosted = location.pathname.split('/').filter(Boolean).length > 2;
    if (hosted) { _showModeNotice(name); return; }
    location.reload();
  }

  function _showModeNotice(name) {
    const inner = document.querySelector('#mode-popup .mode-popup-inner');
    if (!inner) { location.reload(); return; }
    inner.innerHTML = `
      <div class="mode-popup-title">Mode "${name}" created!</div>
      <p class="mode-notice-text">
        Custom modes are built by editing their HTML / CSS / JS files.
        The online demo can't edit files, so to develop your mode you'll want
        to run FORGE3D locally &mdash; grab the code from
        <a href="${FORGE_GITHUB_URL}" target="_blank" rel="noopener">GitHub</a>.
        The empty mode tab will still show up here so you can see how it fits.
      </p>
      <div style="display:flex;gap:8px;margin-top:12px">
        <button class="forge-btn" onclick="location.reload()">Got it</button>
      </div>`;
  }

  // ── outliner ───────────────────────────────────────
  function registerObject({ id, name, group, color }) {
    group.visible = true;
    objects.push({ id, name, group, color: color||'#888', visible: true });
    _redrawOutliner();
  }

  function _redrawOutliner() {
    const list  = document.getElementById('outliner-list');
    const count = document.getElementById('outliner-count');
    if (!list) return;
    count.textContent = objects.length;
    if (!objects.length) {
      list.innerHTML = '<div class="obj-empty">No objects</div>';
      _updateObjPanel(null); return;
    }
    list.innerHTML = objects.map(o => `
      <div class="obj-row ${selectedIds.includes(o.id)?'selected':''}" onclick="FORGE.selectObject('${o.id}', event.ctrlKey||event.metaKey||event.shiftKey)">
        <div class="obj-row-icon" style="background:${o.color}22;border:1px solid ${o.color}55;color:${o.color}">&#10696;</div>
        <span class="obj-row-name">${o.name}</span>
        <button class="obj-row-eye ${o.visible?'':'hidden'}"
          onclick="event.stopPropagation();FORGE.toggleVisible('${o.id}',this)">
          ${o.visible?'&#9673;':'&#9675;'}
        </button>
      </div>`).join('');
  }

  function selectObject(id, additive) {
    const o = objects.find(x => x.id === id);
    if (!o) return;
    const idx = selectedIds.indexOf(id);

    if (additive) {
      if (idx >= 0) selectedIds.splice(idx, 1);
      else selectedIds.push(id);
    } else {
      selectedIds = (idx >= 0 && selectedIds.length === 1) ? [] : [id];
    }

    _snapEditBaseline();
    _redrawOutliner();
    _updateObjPanel(_primary());
    _syncSelectionHelpers();
  }

  function _clearSelection() {
    if (_tool) _toolCancel();
    selectedIds = [];
    _editBaseline = null;
    _redrawOutliner();
    _updateObjPanel(null);
    _syncSelectionHelpers();
  }

  function _primary() {
    if (!selectedIds.length) return null;
    return objects.find(o => o.id === selectedIds[selectedIds.length - 1]) || null;
  }

  function _selected() {
    return selectedIds.map(id => objects.find(o => o.id === id)).filter(Boolean);
  }

  function _snapEditBaseline() {
    _editBaseline = { primary: null, each: {} };
    _selected().forEach(o => {
      const g = o.group;
      _editBaseline.each[o.id] = {
        p: [g.position.x, g.position.y, g.position.z],
        r: [g.rotation.x, g.rotation.y, g.rotation.z],
        s: [g.scale.x, g.scale.y, g.scale.z],
      };
    });
    const p = _primary();
    if (p) _editBaseline.primary = _editBaseline.each[p.id];
  }

  function toggleVisible(id, btn) {
    const o = objects.find(o=>o.id===id); if (!o) return;
    o.visible = !o.visible; o.group.visible = o.visible;
    btn.innerHTML = o.visible ? '&#9673;' : '&#9675;';
    btn.classList.toggle('hidden', !o.visible);
  }

  function _updateObjPanel(obj) {
    const el = id => document.getElementById(id);
    if (el('obj-selected-name')) el('obj-selected-name').textContent = obj ? obj.name : ': ';
    if (!obj) return;
    const g = obj.group;
    const sv = (id,v) => { if(el(id)) el(id).value=v; };
    sv('px', g.position.x.toFixed(2)); sv('py', g.position.y.toFixed(2)); sv('pz', g.position.z.toFixed(2));
    sv('rx', THREE.MathUtils.radToDeg(g.rotation.x).toFixed(1));
    sv('ry', THREE.MathUtils.radToDeg(g.rotation.y).toFixed(1));
    sv('rz', THREE.MathUtils.radToDeg(g.rotation.z).toFixed(1));
    sv('sx', g.scale.x.toFixed(2)); sv('sy', g.scale.y.toFixed(2)); sv('sz', g.scale.z.toFixed(2));
  }

  function _getSel() { return _primary(); }

  // ── object popup ───────────────────────────────────
  const PALETTE = ['#4d9fff','#e05050','#50c050','#e0a030','#b070e0','#40c0b0','#e070a8','#c8c8c8'];

  function promptNewObject() {
    const popup = document.getElementById('obj-popup');
    const input = document.getElementById('obj-name-input');
    document.getElementById('obj-popup-error').textContent = '';
    // suggest a random palette color; the user can change it
    const colorInput = document.getElementById('obj-color-input');
    if (colorInput) colorInput.value = PALETTE[Math.floor(Math.random()*PALETTE.length)];
    input.value = ''; popup.style.display = 'block'; input.focus();
    input.onkeydown = e => { if(e.key==='Enter') createObject(); if(e.key==='Escape') closeObjPopup(); };
  }

  function closeObjPopup() { document.getElementById('obj-popup').style.display = 'none'; }

  function pickPrimitive(btn) {
    _pickedPrimitive = btn.dataset.prim;
    document.querySelectorAll('#obj-prim-grid .obj-prim')
      .forEach(b => b.classList.toggle('active', b === btn));
    // "Empty" also offers uploading your own Three.js script
    const up = document.getElementById('obj-upload-row');
    if (up) up.style.display = _pickedPrimitive === 'empty' ? '' : 'none';
  }

  function _isHosted() {
    return location.pathname.split('/').filter(Boolean).length > 2;
  }

  function showLocalNotice(title, html) {
    document.getElementById('local-notice-title').textContent = title;
    document.getElementById('local-notice-text').innerHTML = html;
    document.getElementById('local-notice').style.display = 'flex';
  }

  function closeLocalNotice() {
    document.getElementById('local-notice').style.display = 'none';
  }

  function uploadObjectFile() {
    if (_isHosted()) {
      closeObjPopup();
      showLocalNotice('Local version feature',
        `Uploading your own Three.js object scripts works in the local version of ` +
        `FORGE3D &mdash; grab the code from ` +
        `<a href="${FORGE_GITHUB_URL}" target="_blank" rel="noopener">GitHub</a> ` +
        `and run <b>python main.py</b>.`);
      return;
    }
    document.getElementById('obj-file-input').click();
  }

  async function _handleObjectFile(file) {
    const err = document.getElementById('obj-popup-error');
    // name: use the typed name if valid, otherwise derive it from the filename
    let name = document.getElementById('obj-name-input').value.trim();
    if (!name) {
      name = file.name.replace(/\.js$/i, '').replace(/[^A-Za-z0-9_$]/g, '_');
      if (/^[0-9]/.test(name)) name = '_' + name;
    }
    const code = await file.text();
    const res  = await fetch(`../api/${FORGE_PROJECT_ID}/objects/upload`, {
      method:'POST', headers:{'Content-Type':'application/json'},
      body: JSON.stringify({ name, code }),
    });
    const data = await res.json();
    if (!data.ok) { err.textContent = data.error; return; }
    closeObjPopup();
    const s = document.createElement('script');
    s.src = `../projects-static/${FORGE_PROJECT_ID}/Objects/${data.file}`;
    s.onload = () => {
      const o = objects.find(x => x.id === data.id);
      if (o) selectObject(o.id, false);
    };
    document.body.appendChild(s);
  }

  async function createObject() {
    const name = document.getElementById('obj-name-input').value.trim();
    const err  = document.getElementById('obj-popup-error');
    if (!name) { err.textContent='Enter a name'; return; }
    const color = document.getElementById('obj-color-input')?.value;
    const res  = await fetch(`../api/${FORGE_PROJECT_ID}/objects/create`, {
      method:'POST', headers:{'Content-Type':'application/json'},
      body:JSON.stringify({ name, primitive: _pickedPrimitive, color }),
    });
    const data = await res.json();
    if (!data.ok) { err.textContent=data.error; return; }
    closeObjPopup();
    // Inject the new object's script live :  no page reload, so the camera,
    // your edits, and any keyframes all stay exactly as they are.
    const s = document.createElement('script');
    s.src = `../projects-static/${FORGE_PROJECT_ID}/Objects/${data.file}`;
    s.onload = () => {
      const o = objects.find(x => x.id === (data.id || name.toLowerCase()));
      if (o) selectObject(o.id, false);  // auto-select, ready to edit
    };
    document.body.appendChild(s);
  }

  async function deleteSelected() {
    const sel = _selected(); if (!sel.length) return;
    const msg = sel.length === 1 ? `Delete "${sel[0].name}"?` : `Delete ${sel.length} objects?`;
    if (!confirm(msg)) return;
    sel.forEach(obj => {
      scene.remove(obj.group);
      objects = objects.filter(o => o.id !== obj.id);
    });
    selectedIds = []; _editBaseline = null;
    _redrawOutliner(); _updateObjPanel(null); _syncSelectionHelpers();
    // delete the files server-side; the scene is already updated :  no reload
    try {
      for (const obj of sel) {
        // files are named after the original identifier, not the lowercase id
        await fetch(`../api/${FORGE_PROJECT_ID}/objects/${encodeURIComponent(obj.name)}`, {method:'DELETE'});
      }
    } catch(e) {}
  }

  // ── transform ──────────────────────────────────────
  function applyTransform() {
    if (!selectedIds.length) return;
    if (!_editBaseline || !_editBaseline.primary) _snapEditBaseline();
    const nx = parseFloat(document.getElementById('px')?.value)||0;
    const ny = parseFloat(document.getElementById('py')?.value)||0;
    const nz = parseFloat(document.getElementById('pz')?.value)||0;
    const bp = _editBaseline.primary.p;
    const dx = nx - bp[0], dy = ny - bp[1], dz = nz - bp[2];
    _selected().forEach(o => {
      const bb = _editBaseline.each[o.id].p;
      o.group.position.set(bb[0]+dx, bb[1]+dy, bb[2]+dz);
    });
  }

  function applyRotation() {
    if (!selectedIds.length) return;
    if (!_editBaseline || !_editBaseline.primary) _snapEditBaseline();
    const nx = THREE.MathUtils.degToRad(parseFloat(document.getElementById('rx')?.value)||0);
    const ny = THREE.MathUtils.degToRad(parseFloat(document.getElementById('ry')?.value)||0);
    const nz = THREE.MathUtils.degToRad(parseFloat(document.getElementById('rz')?.value)||0);
    const br = _editBaseline.primary.r;
    const dx = nx - br[0], dy = ny - br[1], dz = nz - br[2];
    _selected().forEach(o => {
      const bb = _editBaseline.each[o.id].r;
      o.group.rotation.set(bb[0]+dx, bb[1]+dy, bb[2]+dz);
    });
  }

  function applyScale() {
    if (!selectedIds.length) return;
    if (!_editBaseline || !_editBaseline.primary) _snapEditBaseline();
    const nx = parseFloat(document.getElementById('sx')?.value)||1;
    const ny = parseFloat(document.getElementById('sy')?.value)||1;
    const nz = parseFloat(document.getElementById('sz')?.value)||1;
    const bs = _editBaseline.primary.s;
    const fx = bs[0]!==0 ? nx/bs[0] : 1;
    const fy = bs[1]!==0 ? ny/bs[1] : 1;
    const fz = bs[2]!==0 ? nz/bs[2] : 1;
    _selected().forEach(o => {
      const bb = _editBaseline.each[o.id].s;
      o.group.scale.set(bb[0]*fx, bb[1]*fy, bb[2]*fz);
    });
  }

  function resetTransform() {
    const sel = _selected(); if (!sel.length) return;
    sel.forEach(o => {
      o.group.position.set(0,0,0);
      o.group.rotation.set(0,0,0);
      o.group.scale.set(1,1,1);
    });
    _snapEditBaseline();
    _updateObjPanel(_primary());
  }

  function focusSelected() {
    const sel = _selected(); if (!sel.length) return;
    const c = new THREE.Vector3();
    sel.forEach(o => c.add(o.group.position));
    c.multiplyScalar(1/sel.length);
    sph.r = 9; camera.lookAt(c); updateCamera();
  }

  function _dupName(name) {
    // strip " Copy" chains / trailing numbers to get the base, then number it
    const base = name.replace(/(?: Copy| \d+)+$/, '') || name;
    let n = 2;
    const names = new Set(objects.map(o => o.name));
    while (names.has(`${base} ${n}`)) n++;
    return `${base} ${n}`;
  }

  function duplicateSelected() {
    const sel = _selected(); if (!sel.length) return;
    const newIds = [];
    sel.forEach(obj => {
      const ng = obj.group.clone(); ng.visible = true; scene.add(ng);
      const newName = _dupName(obj.name);
      let nid = newName.toLowerCase().replace(/\s+/g, '_');
      while (objects.some(o => o.id === nid)) nid += '_';
      objects.push({ id: nid, name: newName, group:ng, color:obj.color, visible:true });
      newIds.push(nid);
    });
    // Blender-style: the copies become the new selection
    selectedIds = newIds;
    _snapEditBaseline();
    _redrawOutliner();
    _updateObjPanel(_primary());
    _syncSelectionHelpers();
  }

  // ── viewport editing (Blender-style) ───────────────
  function _activeCam() { return isOrtho ? orthoCamera : camera; }

  function _setNdc(e) {
    const r = renderer.domElement.getBoundingClientRect();
    _ndc.x =  ((e.clientX - r.left) / r.width)  * 2 - 1;
    _ndc.y = -((e.clientY - r.top)  / r.height) * 2 + 1;
  }

  function _pickObject(e) {
    _setNdc(e);
    _ray.setFromCamera(_ndc, _activeCam());
    const groups = objects.filter(o => o.group.visible).map(o => o.group);
    const hits = _ray.intersectObjects(groups, true);
    if (!hits.length) return null;
    let node = hits[0].object;
    while (node) {
      const owner = objects.find(o => o.group === node);
      if (owner) return owner;
      node = node.parent;
    }
    return null;
  }

  // selection outlines (BoxHelper per selected object)
  function _syncSelectionHelpers() {
    for (const [id, h] of _selHelpers) {
      if (!selectedIds.includes(id)) { scene.remove(h); _selHelpers.delete(id); }
    }
    selectedIds.forEach(id => {
      if (_selHelpers.has(id)) return;
      const o = objects.find(x => x.id === id); if (!o) return;
      let hasMesh = false;
      o.group.traverse(c => { if (c.isMesh) hasMesh = true; });
      if (!hasMesh) return;  // empty script objects have nothing to outline
      const h = new THREE.BoxHelper(o.group, 0xffa028);
      h.material.depthTest = false;
      scene.add(h);
      _selHelpers.set(id, h);
    });
    _syncSelToolbar();
  }

  // ── selection toolbar (mouse-only editing) ─────────
  const GEOMETRIES = {
    box:      () => new THREE.BoxGeometry(1, 1, 1),
    sphere:   () => new THREE.SphereGeometry(0.6, 32, 16),
    cylinder: () => new THREE.CylinderGeometry(0.5, 0.5, 1.2, 32),
    cone:     () => new THREE.ConeGeometry(0.6, 1.2, 32),
    plane:    () => new THREE.PlaneGeometry(1.5, 1.5),
    torus:    () => new THREE.TorusGeometry(0.6, 0.22, 16, 48),
  };

  function _syncSelToolbar() {
    const tb = document.getElementById('sel-toolbar'); if (!tb) return;
    const show = selectedIds.length && _isEditableMode();
    tb.style.display = show ? 'flex' : 'none';
    if (!show) return;
    const p = _primary();
    const size = document.getElementById('selt-size');
    if (size) size.value = Math.min(5, Math.max(0.1, p.group.scale.x));
    const col = document.getElementById('selt-color');
    if (col && /^#[0-9a-fA-F]{6}$/.test(p.color)) col.value = p.color;
    const shape = document.getElementById('selt-shape');
    if (shape) shape.value = '';
  }

  function startTool(type) { _toolStart(type, _lastMouse); }

  function setSelSize(v) {
    const f = Math.max(0.01, parseFloat(v) || 1);
    _selected().forEach(o => o.group.scale.set(f, f, f));
    _snapEditBaseline();
    _updateObjPanel(_primary());
  }

  function setSelColor(v) {
    _selected().forEach(o => {
      o.color = v;
      o.group.traverse(c => {
        if (c.isMesh && c.material && c.material.color) c.material.color.set(v);
      });
    });
    _redrawOutliner();
  }

  function setSelShape(v) {
    const make = GEOMETRIES[v]; if (!make) return;
    _selected().forEach(o => {
      const meshes = [];
      o.group.traverse(c => { if (c.isMesh) meshes.push(c); });
      if (meshes.length !== 1) return;  // only simple one-mesh objects can swap shape
      const mesh = meshes[0];
      mesh.geometry.dispose();
      mesh.geometry = make();
      if (v === 'plane') { mesh.rotation.x = -Math.PI / 2; mesh.material.side = THREE.DoubleSide; }
      else mesh.rotation.x = 0;
    });
  }

  // G / R / S tools :  move / rotate / scale the selection with the mouse,
  // X/Y/Z constrains to an axis, click or Enter confirms, Esc / right-click cancels.
  function _toolStart(type, e) {
    if (!selectedIds.length || !_isEditableMode()) return;
    _snapEditBaseline();
    const cam = _activeCam();
    const center = _primary().group.position.clone();
    const cs = center.clone().project(cam);
    const rect = renderer.domElement.getBoundingClientRect();
    const centerScreen = {
      x: ( cs.x + 1) / 2 * rect.width  + rect.left,
      y: (-cs.y + 1) / 2 * rect.height + rect.top,
    };
    const camDir = new THREE.Vector3(); cam.getWorldDirection(camDir);
    const plane = new THREE.Plane().setFromNormalAndCoplanarPoint(camDir, center);
    _tool = {
      type, axis: null, center, centerScreen, plane,
      startMouse: { x: e.clientX, y: e.clientY },
      startHit: _planeHit(e, plane) || center.clone(),
      lastEvent: { clientX: e.clientX, clientY: e.clientY },
    };
  }

  function _planeHit(e, plane) {
    _setNdc(e);
    _ray.setFromCamera(_ndc, _activeCam());
    const out = new THREE.Vector3();
    return _ray.ray.intersectPlane(plane, out) ? out : null;
  }

  function _toolApply(e) {
    if (!_tool || !_editBaseline) return;
    _tool.lastEvent = { clientX: e.clientX, clientY: e.clientY };
    const t = _tool, base = _editBaseline;

    if (t.type === 'g') {
      const hit = _planeHit(e, t.plane); if (!hit) return;
      let delta = hit.clone().sub(t.startHit);
      if (t.axis) { const a = AXIS_VEC[t.axis]; delta = a.clone().multiplyScalar(delta.dot(a)); }
      _selected().forEach(o => {
        const bp = base.each[o.id].p;
        o.group.position.set(bp[0]+delta.x, bp[1]+delta.y, bp[2]+delta.z);
      });

    } else if (t.type === 'r') {
      const cs = t.centerScreen;
      const a0 = Math.atan2(t.startMouse.y - cs.y, t.startMouse.x - cs.x);
      const a1 = Math.atan2(e.clientY - cs.y, e.clientX - cs.x);
      let axisVec;
      if (t.axis) axisVec = AXIS_VEC[t.axis].clone();
      else { axisVec = new THREE.Vector3(); _activeCam().getWorldDirection(axisVec); axisVec.negate(); }
      const q = new THREE.Quaternion().setFromAxisAngle(axisVec, -(a1 - a0));
      const bq = new THREE.Quaternion(), be = new THREE.Euler();
      _selected().forEach(o => {
        const br = base.each[o.id].r;
        be.set(br[0], br[1], br[2]);
        bq.setFromEuler(be);
        o.group.quaternion.copy(q).multiply(bq);
      });

    } else if (t.type === 's') {
      const cs = t.centerScreen;
      const d0 = Math.max(4, Math.hypot(t.startMouse.x - cs.x, t.startMouse.y - cs.y));
      const d1 = Math.hypot(e.clientX - cs.x, e.clientY - cs.y);
      const f = d1 / d0;
      const ai = t.axis ? { x:0, y:1, z:2 }[t.axis] : -1;
      _selected().forEach(o => {
        const bs = base.each[o.id].s;
        if (ai >= 0) {
          const s = [bs[0], bs[1], bs[2]]; s[ai] = bs[ai] * f;
          o.group.scale.set(s[0], s[1], s[2]);
        } else {
          o.group.scale.set(bs[0]*f, bs[1]*f, bs[2]*f);
        }
      });
    }
    _updateObjPanel(_primary());
  }

  function _toolConfirm() {
    if (!_tool) return;
    _tool = null;
    _snapEditBaseline();
    _updateObjPanel(_primary());
  }

  function _toolCancel() {
    if (!_tool) return;
    _selected().forEach(o => {
      const b = _editBaseline.each[o.id];
      o.group.position.set(b.p[0], b.p[1], b.p[2]);
      o.group.rotation.set(b.r[0], b.r[1], b.r[2]);
      o.group.scale.set(b.s[0], b.s[1], b.s[2]);
    });
    _tool = null;
    _updateObjPanel(_primary());
  }

  function onKeyDown(e) {
    const tag = document.activeElement && document.activeElement.tagName;
    if (tag === 'INPUT' || tag === 'TEXTAREA' || tag === 'SELECT') return;
    if (!_isEditableMode()) return;
    const k = e.key.toLowerCase();

    if (_tool) {
      if (k === 'x' || k === 'y' || k === 'z') {
        _tool.axis = _tool.axis === k ? null : k;
        _toolApply(_tool.lastEvent);
        e.preventDefault();
      } else if (k === 'enter') {
        _toolConfirm(); e.preventDefault();
      } else if (k === 'escape') {
        _toolCancel(); e.preventDefault();
      }
      return;
    }

    if (!selectedIds.length) return;
    if ((k === 'g' || k === 'r' || k === 's') && !e.ctrlKey && !e.metaKey && !e.altKey) {
      _toolStart(k, _lastMouse);
      e.preventDefault();
    } else if (k === 'd' && e.shiftKey) {
      duplicateSelected();
      e.preventDefault();
    } else if (e.key === 'Delete') {
      deleteSelected();
    }
  }

  // ── render ─────────────────────────────────────────
  function toggleWire(btn) {
    btn.classList.toggle('on'); isWire = btn.classList.contains('on');
    scene.traverse(o => {
      if (o.isMesh && o.material) {
        const m = Array.isArray(o.material) ? o.material : [o.material];
        m.forEach(mat => { if(mat.type!=='MeshBasicMaterial') mat.wireframe=isWire; });
      }
    });
  }

  function toggleShadow(btn) {
    btn.classList.toggle('on');
    renderer.shadowMap.enabled = btn.classList.contains('on');
  }

  function setBgColor(hex)  { customBg = hex; }
  function setAmbient(v)    { ambientLight.intensity = parseFloat(v)/10*1.5; }
  function setSun(v)        { sunLight.intensity     = parseFloat(v)/10*1.5; }
  function setSunPos() {
    sunLight.position.set(
      parseFloat(document.getElementById('sl-sun-x')?.value||6),
      parseFloat(document.getElementById('sl-sun-y')?.value||10), 6
    );
  }
  function setFov(v) { camera.fov = parseFloat(v); camera.updateProjectionMatrix(); }

  function resetRender() {
    const wire = document.getElementById('tog-wire');
    if (wire && wire.classList.contains('on')) { wire.classList.remove('on'); toggleWire(wire); }
    const shadow = document.getElementById('tog-shadow');
    if (shadow && shadow.classList.contains('on')) { shadow.classList.remove('on'); toggleShadow(shadow); }
    customBg = null;
    const bg = document.getElementById('bg-color');
    if (bg) bg.value = document.body.classList.contains('light') ? '#b8b8b8' : '#1a1a1a';
  }

  function resetLights() {
    ambientLight.intensity = 0.5; sunLight.intensity = 0.9; sunLight.position.set(6,10,6);
    const sv = (id,v) => { const el=document.getElementById(id); if(el) el.value=v; };
    sv('sl-ambient',5); sv('sl-sun',9); sv('sl-sun-x',6); sv('sl-sun-y',10);
  }

  // ── overlays ───────────────────────────────────────
  function toggleOverlay(name, btn) {
    btn.classList.toggle('on');
    const on = btn.classList.contains('on');
    if (name==='grid')  gridGroup.visible = on;
    if (name==='axis')  axisGroup.visible = on;
    if (name==='gizmo') document.getElementById('gizmo').style.display = on?'block':'none';
  }

  function setGridSize(v)    { gridSize    = parseInt(v); buildGrid(); }
  function setGridOpacity(v) { gridOpacity = parseInt(v); buildGrid(); }

  // ── camera ─────────────────────────────────────────
  function setCamMode(mode) {
    isOrtho = mode==='ortho';
    document.getElementById('btn-persp')?.classList.toggle('active', !isOrtho);
    document.getElementById('btn-ortho')?.classList.toggle('active',  isOrtho);
    onResize();
  }

  const VIEWS = {
    front:[0,Math.PI/2], back:[Math.PI,Math.PI/2],
    top:[0,0.01], right:[Math.PI/2,Math.PI/2], iso:[Math.PI/4,Math.PI/4],
  };

  function setView(name) {
    if (VIEWS[name]) { sph.theta=VIEWS[name][0]; sph.phi=VIEWS[name][1]; }
    updateCamera();
  }

  function resetCamera() { sph={theta:Math.PI/4,phi:Math.PI/4,r:9}; updateCamera(); }

  function togglePanel() {
    panelOpen = !panelOpen;
    document.getElementById('left-panel').classList.toggle('collapsed', !panelOpen);
    setTimeout(onResize, 230);
  }

  function toggleTheme() {
    document.body.classList.toggle('light');
    localStorage.setItem('forge-theme',
      document.body.classList.contains('light') ? 'light' : 'dark');
    buildGrid();
  }

  function toggleBlock(header) {
    header.classList.toggle('closed');
    const body = header.nextElementSibling;
    if (body) body.style.display = header.classList.contains('closed') ? 'none' : '';
  }

  // ── Three.js internals ─────────────────────────────
  function buildGrid() {
    gridGroup.clear();
    const half=gridSize, light=document.body.classList.contains('light');
    const col=light?0x000000:0xffffff, base=gridOpacity/10;
    const mat  = new THREE.LineBasicMaterial({color:col,transparent:true,opacity:base*0.5});
    const matC = new THREE.LineBasicMaterial({color:col,transparent:true,opacity:base*1.1});
    for (let i=-half;i<=half;i++) {
      const m=i===0?matC:mat;
      _ln([-half,0,i],[half,0,i],m); _ln([i,0,-half],[i,0,half],m);
    }
  }

  function _ln(a,b,mat) {
    const geo = new THREE.BufferGeometry().setFromPoints([new THREE.Vector3(...a),new THREE.Vector3(...b)]);
    gridGroup.add(new THREE.Line(geo,mat));
  }

  function buildAxis() {
    axisGroup.clear();
    [[2,0,0,0xe05050],[0,2,0,0x50c050],[0,0,2,0x5080e0]].forEach(([x,y,z,c]) => {
      const geo = new THREE.BufferGeometry().setFromPoints([new THREE.Vector3(0,0,0),new THREE.Vector3(x,y,z)]);
      axisGroup.add(new THREE.Line(geo,new THREE.LineBasicMaterial({color:c})));
    });
  }

  function updateCamera() {
    const {theta,phi,r} = sph;
    const x=r*Math.sin(phi)*Math.sin(theta), y=r*Math.cos(phi), z=r*Math.sin(phi)*Math.cos(theta);
    camera.position.set(x,y,z);      camera.lookAt(0,0,0);
    orthoCamera.position.set(x,y,z); orthoCamera.lookAt(0,0,0);
    updateGizmo();
    const f = v => v.toFixed(1);
    const vp = document.getElementById('vp-pos'); if(vp) vp.textContent=`pos (${f(x)}, ${f(y)}, ${f(z)})`;
    const bb = document.getElementById('bb-pos'); if(bb) bb.textContent=`pos (${f(x)}, ${f(y)}, ${f(z)})`;
  }

  function updateGizmo() {
    const C=38, ARM=26, mat=camera.matrixWorldInverse;
    [['gz-x','gz-xc','gz-xt',new THREE.Vector3(1,0,0)],
     ['gz-y','gz-yc','gz-yt',new THREE.Vector3(0,1,0)],
     ['gz-z','gz-zc','gz-zt',new THREE.Vector3(0,0,1)]
    ].forEach(([l,c,t,v]) => {
      v.applyMatrix4(mat);
      const sx=(C+v.x*ARM).toFixed(1), sy=(C-v.y*ARM).toFixed(1);
      document.getElementById(l)?.setAttribute('x2',sx);
      document.getElementById(l)?.setAttribute('y2',sy);
      document.getElementById(c)?.setAttribute('cx',sx);
      document.getElementById(c)?.setAttribute('cy',sy);
      document.getElementById(t)?.setAttribute('x', sx);
      document.getElementById(t)?.setAttribute('y', (parseFloat(sy)+4).toFixed(1));
    });
  }

  function onResize() {
    const vp = document.getElementById('viewport');
    const w=vp.clientWidth, h=vp.clientHeight;
    renderer.setSize(w,h,false);
    camera.aspect = w/h; camera.updateProjectionMatrix();
    const a = w/h;
    orthoCamera.left=-8*a; orthoCamera.right=8*a; orthoCamera.top=8; orthoCamera.bottom=-8;
    orthoCamera.updateProjectionMatrix();
  }

  function onMouseMove(e) {
    _lastMouse = { clientX: e.clientX, clientY: e.clientY };
    if (_tool) { _toolApply(e); return; }
    if (!isDragging) return;
    const dx=e.clientX-lastX, dy=e.clientY-lastY;
    lastX=e.clientX; lastY=e.clientY;
    sph.theta -= dx*0.007;
    sph.phi = Math.max(0.06, Math.min(Math.PI-0.06, sph.phi+dy*0.007));
    updateCamera();
  }

  function onWheel(e) {
    e.preventDefault();
    sph.r = Math.max(2, Math.min(40, sph.r+e.deltaY*0.012));
    updateCamera();
  }

  function loop() {
    requestAnimationFrame(loop);
    const bg = customBg
      ? new THREE.Color(customBg)
      : document.body.classList.contains('light')
        ? new THREE.Color(0xb8b8b8) : new THREE.Color(0x1a1a1a);
    renderer.setClearColor(bg,1);
    _selHelpers.forEach(h => h.update());
    renderer.render(scene, isOrtho ? orthoCamera : camera);
    frames++;
    const now = performance.now();
    if (now-fpsLast >= 1000) {
      const el = document.getElementById('fps'); if(el) el.textContent=frames+' fps';
      frames=0; fpsLast=now;
    }
  }

  // ── animation (keyframe) engine ────────────────────
  let keyframes = [];
  let segDuration = 1.0;
  let isPlaying = false, playStartT = 0, playStartOffset = 0, animRAF = null;
  let currentTime = 0;
  let loopEnabled = false, loopRepeats = 0, _loopsDone = 0;

  function _snapObj(obj) {
    const g = obj.group;
    const meshes = [];
    g.traverse(child => {
      if (child === g) return;
      const m = {
        uuid: child.uuid,
        p: [child.position.x, child.position.y, child.position.z],
        q: [child.quaternion.x, child.quaternion.y, child.quaternion.z, child.quaternion.w],
        s: [child.scale.x, child.scale.y, child.scale.z],
        vis: child.visible,
      };
      if (child.material && child.material.color) m.color = child.material.color.getHex();
      if (child.isMesh && child.geometry && child.geometry.attributes && child.geometry.attributes.position) {
        m.verts = new Float32Array(child.geometry.attributes.position.array);
      }
      meshes.push(m);
    });
    return {
      id: obj.id,
      p: [g.position.x, g.position.y, g.position.z],
      q: [g.quaternion.x, g.quaternion.y, g.quaternion.z, g.quaternion.w],
      s: [g.scale.x, g.scale.y, g.scale.z],
      meshes,
    };
  }

  function captureKeyframe() {
    const k = {
      label: 'K' + (keyframes.length + 1),
      objects: objects.map(_snapObj),
    };
    keyframes.push(k);
    _redrawKfList();
    _updateTimeline();
  }

  function _lerp(a, b, t) { return a + (b - a) * t; }
  function _lerpV3(target, a, b, t) { target.set(_lerp(a[0],b[0],t), _lerp(a[1],b[1],t), _lerp(a[2],b[2],t)); }
  const _qa = new THREE.Quaternion(), _qb = new THREE.Quaternion();
  function _lerpQ(target, a, b, t) {
    _qa.set(a[0],a[1],a[2],a[3]); _qb.set(b[0],b[1],b[2],b[3]);
    target.copy(_qa).slerp(_qb, t);
  }
  const _ca = new THREE.Color(), _cb = new THREE.Color();

  function _applySnap(kfA, kfB, t) {
    const mapA = new Map(), mapB = new Map();
    kfA.objects.forEach(o => mapA.set(o.id, o));
    if (kfB) kfB.objects.forEach(o => mapB.set(o.id, o));
    objects.forEach(obj => {
      const oa = mapA.get(obj.id), ob = kfB ? mapB.get(obj.id) : null;
      if (!oa) return;
      const g = obj.group;
      if (ob) {
        _lerpV3(g.position, oa.p, ob.p, t);
        _lerpQ(g.quaternion, oa.q, ob.q, t);
        _lerpV3(g.scale, oa.s, ob.s, t);
      } else {
        g.position.set(oa.p[0],oa.p[1],oa.p[2]);
        g.quaternion.set(oa.q[0],oa.q[1],oa.q[2],oa.q[3]);
        g.scale.set(oa.s[0],oa.s[1],oa.s[2]);
      }
      const mmA = new Map(), mmB = new Map();
      (oa.meshes || []).forEach(m => mmA.set(m.uuid, m));
      if (ob) (ob.meshes || []).forEach(m => mmB.set(m.uuid, m));
      g.traverse(ch => {
        if (ch === g) return;
        const ma = mmA.get(ch.uuid); if (!ma) return;
        const mb = mmB.get(ch.uuid);
        if (mb) {
          _lerpV3(ch.position, ma.p, mb.p, t);
          _lerpQ(ch.quaternion, ma.q, mb.q, t);
          _lerpV3(ch.scale, ma.s, mb.s, t);
          if (ma.color !== undefined && mb.color !== undefined && ch.material && ch.material.color) {
            _ca.setHex(ma.color); _cb.setHex(mb.color);
            ch.material.color.copy(_ca).lerp(_cb, t);
          }
          if (ma.verts && mb.verts && ma.verts.length === mb.verts.length && ch.geometry && ch.geometry.attributes.position) {
            const pa = ch.geometry.attributes.position;
            if (pa.array.length === ma.verts.length) {
              for (let j = 0; j < ma.verts.length; j++) pa.array[j] = ma.verts[j] + (mb.verts[j] - ma.verts[j]) * t;
              pa.needsUpdate = true;
              if (ch.geometry.computeVertexNormals) ch.geometry.computeVertexNormals();
            }
          }
        } else {
          ch.position.set(ma.p[0],ma.p[1],ma.p[2]);
          ch.quaternion.set(ma.q[0],ma.q[1],ma.q[2],ma.q[3]);
          ch.scale.set(ma.s[0],ma.s[1],ma.s[2]);
          if (ma.color !== undefined && ch.material && ch.material.color) ch.material.color.setHex(ma.color);
          if (ma.verts && ch.geometry && ch.geometry.attributes.position) {
            const pa = ch.geometry.attributes.position;
            if (pa.array.length === ma.verts.length) { pa.array.set(ma.verts); pa.needsUpdate = true; }
          }
        }
      });
    });
  }

  function _applyAtTime(t) {
    if (!keyframes.length) return;
    if (keyframes.length === 1) { _applySnap(keyframes[0], null, 0); return; }
    const total = segDuration * (keyframes.length - 1);
    t = Math.max(0, Math.min(total, t));
    const segF = t / segDuration;
    let i = Math.floor(segF);
    if (i >= keyframes.length - 1) i = keyframes.length - 2;
    const localT = Math.max(0, Math.min(1, segF - i));
    _applySnap(keyframes[i], keyframes[i+1], localT);
    currentTime = t;
  }

  function playAnim() {
    if (keyframes.length < 2) return;
    const total = segDuration * (keyframes.length - 1);
    if (currentTime >= total) currentTime = 0;
    _loopsDone = 0;
    isPlaying = true;
    playStartT = performance.now();
    playStartOffset = currentTime;
    _animTick();
  }
  function _animTick() {
    if (!isPlaying) return;
    const total = segDuration * (keyframes.length - 1);
    let t = playStartOffset + (performance.now() - playStartT) / 1000;
    if (t >= total) {
      if (loopEnabled) {
        _loopsDone++;
        if (loopRepeats > 0 && _loopsDone >= loopRepeats) {
          t = total;
          isPlaying = false;
        } else {
          playStartT = performance.now();
          playStartOffset = 0;
          t = 0;
        }
      } else {
        t = total;
        isPlaying = false;
      }
    }
    _applyAtTime(t);
    _updateTimelineUI();
    if (isPlaying) animRAF = requestAnimationFrame(_animTick);
  }

  function toggleLoop(btn) {
    loopEnabled = !loopEnabled;
    if (btn) btn.classList.toggle('on', loopEnabled);
  }
  function setLoopRepeats(v) {
    loopRepeats = Math.max(0, parseInt(v) || 0);
  }
  function pauseAnim() { isPlaying = false; if (animRAF) cancelAnimationFrame(animRAF); }
  function stopAnim() { pauseAnim(); currentTime = 0; if (keyframes.length) _applySnap(keyframes[0], null, 0); _updateTimelineUI(); }
  function scrubAnim(v) { pauseAnim(); _applyAtTime(parseFloat(v)); _updateTimelineUI(); }
  function deleteKeyframe(i) { keyframes.splice(i, 1); _redrawKfList(); _updateTimeline(); }
  function jumpKeyframe(i) { pauseAnim(); currentTime = i * segDuration; _applySnap(keyframes[i], null, 0); _updateTimelineUI(); }
  function setSegDuration(v) { segDuration = Math.max(0.05, parseFloat(v) || 1); _updateTimeline(); }

  function _redrawKfList() {
    const list = document.getElementById('kf-list'); if (!list) return;
    if (!keyframes.length) { list.innerHTML = '<div class="obj-empty">No keyframes</div>'; return; }
    list.innerHTML = keyframes.map((k,i) => `
      <div class="obj-row" onclick="FORGE.jumpKeyframe(${i})">
        <div class="obj-row-icon" style="background:#4d9fff22;border:1px solid #4d9fff55;color:#4d9fff">${i+1}</div>
        <span class="obj-row-name">${k.label}</span>
        <button class="obj-row-eye" onclick="event.stopPropagation();FORGE.deleteKeyframe(${i})" title="Delete">&#10005;</button>
      </div>`).join('');
  }
  function _updateTimeline() {
    const total = segDuration * Math.max(0, keyframes.length - 1);
    const slider = document.getElementById('kf-scrub');
    if (slider) { slider.max = total; slider.step = Math.max(0.01, total/500 || 0.01); if (parseFloat(slider.value) > total) slider.value = total; }
    const lbl = document.getElementById('kf-total'); if (lbl) lbl.textContent = total.toFixed(2) + 's';
    _updateTimelineUI();
  }
  function _updateTimelineUI() {
    const slider = document.getElementById('kf-scrub'); if (slider) slider.value = currentTime;
    const lbl = document.getElementById('kf-cur'); if (lbl) lbl.textContent = currentTime.toFixed(2) + 's';
  }

  const ANIMATE_PANEL = `
    <div class="pblock">
      <div class="phead" onclick="FORGE.toggleBlock(this)"><span>Keyframes</span><span class="parrow">&#9662;</span></div>
      <div class="pbody">
        <button class="sbtn" onclick="FORGE.captureKeyframe()"><span class="sicon">+</span>Add Keyframe</button>
        <div id="kf-list" style="margin-top:6px"><div class="obj-empty">No keyframes</div></div>
      </div>
    </div>
    <div class="pblock">
      <div class="phead" onclick="FORGE.toggleBlock(this)"><span>Timing</span><span class="parrow">&#9662;</span></div>
      <div class="pbody">
        <div class="prow"><span>Seg (s)</span><input type="number" class="xyz-input" id="kf-segdur" value="1" min="0.1" step="0.1" oninput="FORGE.setSegDuration(this.value)"></div>
        <div class="prow"><span>Total</span><span class="val" id="kf-total">0.00s</span></div>
        <div class="prow"><span>Time</span><span class="val" id="kf-cur">0.00s</span></div>
      </div>
    </div>
    <div class="pblock">
      <div class="phead" onclick="FORGE.toggleBlock(this)"><span>Playback</span><span class="parrow">&#9662;</span></div>
      <div class="pbody">
        <div style="display:flex;gap:4px;margin-bottom:6px">
          <button class="sbtn" style="flex:1" onclick="FORGE.playAnim()"><span class="sicon">&#9654;</span>Play</button>
          <button class="sbtn" style="flex:1" onclick="FORGE.pauseAnim()"><span class="sicon">&#10073;</span>Pause</button>
          <button class="sbtn" style="flex:1" onclick="FORGE.stopAnim()"><span class="sicon">&#9632;</span>Stop</button>
        </div>
        <div class="prow"><span>Scrub</span><input type="range" id="kf-scrub" min="0" max="0" step="0.01" value="0" oninput="FORGE.scrubAnim(this.value)"></div>
        <div class="trow" style="margin-top:6px"><span class="tlabel">Loop</span><button class="tpill" id="kf-loop" onclick="FORGE.toggleLoop(this)"></button></div>
        <div class="prow"><span title="0 = infinite">Repeats</span><input type="number" class="xyz-input" id="kf-repeats" value="0" min="0" step="1" oninput="FORGE.setLoopRepeats(this.value)"></div>
      </div>
    </div>`;

  function _registerAnimateMode() {
    registerMode({
      id: 'animate',
      name: 'Animate',
      viewport: true,
      panel: ANIMATE_PANEL,
      onEnter(sc) {
        gridGroup.visible = true; axisGroup.visible = true;
        const gizmo = document.getElementById('gizmo'); if (gizmo) gizmo.style.display = 'block';
        const info  = document.getElementById('vp-info'); if (info) info.style.display = 'block';
        objects.forEach(o => { o.group.visible = true; });
        _redrawKfList(); _updateTimeline();
      },
      onExit(sc) {
        pauseAnim();
      },
    });
  }

  // ── scene persistence ──────────────────────────────
  // SAVE stores object transforms/colors + animation keyframes in scene.json;
  // it's loaded automatically when the project opens.
  async function saveScene() {
    const btn = document.getElementById('mb-save');
    const sceneData = {
      objects: objects.map(o => ({
        id: o.id, color: o.color,
        p: [o.group.position.x, o.group.position.y, o.group.position.z],
        r: [o.group.rotation.x, o.group.rotation.y, o.group.rotation.z],
        s: [o.group.scale.x,    o.group.scale.y,    o.group.scale.z],
      })),
      // keyframes are saved at group level (uuid-based mesh data doesn't
      // survive a reload, and the editor tools all act on the group)
      keyframes: keyframes.map(k => ({
        label: k.label,
        objects: k.objects.map(o => ({ id: o.id, p: o.p, q: o.q, s: o.s })),
      })),
      segDuration,
    };
    let ok = false;
    try {
      const res = await fetch(`../api/${FORGE_PROJECT_ID}/scene`, {
        method:'POST', headers:{'Content-Type':'application/json'},
        body: JSON.stringify(sceneData),
      });
      ok = (await res.json()).ok;
    } catch(e) {}
    if (btn) {
      btn.textContent = ok ? 'SAVED \u2713' : 'FAILED';
      btn.classList.toggle('saved', ok);
      setTimeout(() => { btn.textContent = 'SAVE'; btn.classList.remove('saved'); }, 1500);
    }
  }

  async function _loadScene() {
    try {
      const res = await fetch(`../projects-static/${FORGE_PROJECT_ID}/scene.json`);
      if (!res.ok) return;
      const d = await res.json();
      (d.objects || []).forEach(so => {
        const o = objects.find(x => x.id === so.id); if (!o) return;
        if (so.p) o.group.position.set(so.p[0], so.p[1], so.p[2]);
        if (so.r) o.group.rotation.set(so.r[0], so.r[1], so.r[2]);
        if (so.s) o.group.scale.set(so.s[0], so.s[1], so.s[2]);
        if (so.color) {
          o.color = so.color;
          o.group.traverse(c => {
            if (c.isMesh && c.material && c.material.color) c.material.color.set(so.color);
          });
        }
      });
      if (Array.isArray(d.keyframes) && d.keyframes.length) {
        keyframes = d.keyframes.map(k => ({ label: k.label, objects: k.objects || [] }));
      }
      if (d.segDuration) segDuration = d.segDuration;
      _redrawOutliner(); _redrawKfList(); _updateTimeline();
    } catch(e) {}
  }

  // post-load hooks: jump to a freshly created mode / select a new object
  function _afterLoad() {
    _loadScene();
    const gotoMode = sessionStorage.getItem('forge_goto_mode');
    if (gotoMode) {
      sessionStorage.removeItem('forge_goto_mode');
      setTimeout(() => {
        const mode = modes.find(m => m.id === gotoMode);
        if (mode) setMode(mode.id);
      }, 100);
    }
    const selObj = sessionStorage.getItem('forge_select_obj');
    if (selObj) {
      sessionStorage.removeItem('forge_select_obj');
      setTimeout(() => {
        const o = objects.find(x => x.id === selObj);
        if (o) selectObject(o.id, false);
      }, 100);
    }
  }

  return {
    init, addObject, _runQueue, _afterLoad,
    registerMode, setMode, showOverlays,
    promptNewMode, closeModePopup, createMode,
    registerObject, selectObject, toggleVisible, deleteSelected,
    promptNewObject, closeObjPopup, createObject, pickPrimitive,
    startTool, setSelSize, setSelColor, setSelShape,
    uploadObjectFile, closeLocalNotice, saveScene,
    applyTransform, applyRotation, applyScale,
    resetTransform, focusSelected, duplicateSelected,
    toggleWire, toggleShadow, setBgColor,
    setAmbient, setSun, setSunPos, setFov,
    resetRender, resetLights,
    toggleOverlay, setGridSize, setGridOpacity,
    setCamMode, setView, resetCamera,
    togglePanel, toggleTheme, toggleBlock,
    captureKeyframe, deleteKeyframe, jumpKeyframe,
    playAnim, pauseAnim, stopAnim, scrubAnim, setSegDuration,
    toggleLoop, setLoopRepeats,
    _registerAnimateMode,
    getContent: () => document.getElementById('mode-content'),
    _dragStart, _dragOver, _dragDrop,
    getScene: () => scene,
  };

})();

window.addEventListener('DOMContentLoaded', () => {
  FORGE.init();
  FORGE._runQueue();
  FORGE._registerAnimateMode();
  FORGE._afterLoad();
});