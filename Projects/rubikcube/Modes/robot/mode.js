// robot/mode.js

FORGE.registerMode({
  id:   'robot',
  name: 'robot',

  onEnter(scene) {
    const el = FORGE.getContent();
    fetch('../projects-static/' + FORGE_PROJECT_ID + '/Modes/robot/index.html')
      .then(r => r.text())
      .then(html => { el.innerHTML = html; });
  },

  onExit(scene) {
    FORGE.getContent().innerHTML = '';
  },
});
