// WheelBL.js :  back-left wheel

const WheelBL = (() => {

    const group = new THREE.Group();

    function init(scene) {
        scene.add(group);

        const geo = new THREE.BoxGeometry(0.5, 0.6, 0.5);
        const mat = new THREE.MeshStandardMaterial({ color: 0x181818, roughness: 0.95, metalness: 0.1 });
        const wheel = new THREE.Mesh(geo, mat);
        wheel.castShadow = true;
        wheel.receiveShadow = true;
        group.add(wheel);

        group.position.set(-1.05, 0.3, -0.75);

        FORGE.registerObject({ id: 'wheelbl', name: 'WheelBL', group, color: '#181818' });
    }

    return { init };
})();

FORGE.addObject(scene => WheelBL.init(scene));
