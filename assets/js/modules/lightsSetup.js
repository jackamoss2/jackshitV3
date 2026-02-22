import * as THREE from './three.module.js';

export function LightsSetup(scene) {
    const directionalLight = new THREE.DirectionalLight(0xffffff, 1.5);
    directionalLight.position.set(5, 10, 7);
    directionalLight.castShadow = true;
    directionalLight.shadow.mapSize.width = 1024;
    directionalLight.shadow.mapSize.height = 1024;
    directionalLight.shadow.camera.near = 1;
    directionalLight.shadow.camera.far = 20;
    scene.add(directionalLight);

    const directionalLight2 = new THREE.DirectionalLight(0xffffff, 0.5);
    directionalLight2.position.set(-5, -10, -7);
    directionalLight2.castShadow = true;
    directionalLight2.shadow.mapSize.width = 1024;
    directionalLight2.shadow.mapSize.height = 1024;
    directionalLight2.shadow.camera.near = 1;
    directionalLight2.shadow.camera.far = 20;
    scene.add(directionalLight2);

    const ambientLight = new THREE.AmbientLight(0xffffff, 0.6);
    scene.add(ambientLight);
};