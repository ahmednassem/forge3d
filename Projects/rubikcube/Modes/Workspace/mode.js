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
