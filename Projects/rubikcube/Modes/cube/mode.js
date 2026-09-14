// cube/mode.js

FORGE.registerMode({
  id:   'cube',
  name: 'cube',

  onEnter(scene) {
    const el = FORGE.getContent();
    fetch('../projects-static/' + FORGE_PROJECT_ID + '/Modes/cube/index.html')
      .then(r => r.text())
      .then(html => { el.innerHTML = html; });
  },

  onExit(scene) {
    FORGE.getContent().innerHTML = '';
  },
});
