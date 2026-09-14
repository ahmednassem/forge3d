// rubikscube1.js

const rubikscube1 = (() => {

    const group = new THREE.Group();

    function init(scene) {
        scene.add(group);

        // ── write your Three.js code here ──────────────────

const geometry = new THREE.BoxGeometry( 1, 1, 1 );
const material = new THREE.MeshBasicMaterial( { color: 0x00ff00 } );
const cube = new THREE.Mesh( geometry, material );
group.add( cube );

        // ───────────────────────────────────────────────────

        FORGE.registerObject({ id: 'rubikscube1', name: 'rubikscube1', group, color: '#888888' });
    }

    return { init };
})();

FORGE.addObject(scene => rubikscube1.init(scene));
