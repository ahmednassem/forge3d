// car.js

const car = (() => {

    const group = new THREE.Group();

    function init(scene) {
        scene.add(group);

        // ── body (red) ────────────────────────────────
        const bodyGeo = new THREE.BoxGeometry(3.0, 0.8, 1.4);
        const bodyMat = new THREE.MeshStandardMaterial({ color: 0xd62828, roughness: 0.85, metalness: 0.05 });
        const body = new THREE.Mesh(bodyGeo, bodyMat);
        body.position.y = 0.7;
        body.castShadow = true;
        body.receiveShadow = true;
        group.add(body);

        // ── cabin (white roof) ────────────────────────
        const cabinGeo = new THREE.BoxGeometry(1.5, 0.75, 1.2);
        const cabinMat = new THREE.MeshStandardMaterial({ color: 0xf2f2f2, roughness: 0.8, metalness: 0.05 });
        const cabin = new THREE.Mesh(cabinGeo, cabinMat);
        cabin.position.set(-0.25, 1.475, 0);
        cabin.castShadow = true;
        cabin.receiveShadow = true;
        group.add(cabin);

        FORGE.registerObject({ id: 'car', name: 'car', group, color: '#d62828' });
    }

    return { init };
})();

FORGE.addObject(scene => car.init(scene));
