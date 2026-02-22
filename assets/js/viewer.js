// three.js imports
import * as THREE from './libs/three.module.js';
import { FirstPersonControls } from './modules/firstPersonControls.js';
import { LightsSetup } from './modules/lightsSetup.js';


// utility imports
import { preventSpaceOnFocusedButtons } from './modules/utility/preventSpacebarButtonPress.js';




// Scene setup
const scene = new THREE.Scene();
const camera = new THREE.PerspectiveCamera(75, window.innerWidth / window.innerHeight, 0.1, 1000);
const renderer = new THREE.WebGLRenderer({ canvas: document.getElementById('threejs-canvas') });
renderer.setSize(window.innerWidth, window.innerHeight);
renderer.shadowMap.enabled = true;
renderer.shadowMap.type = THREE.PCFSoftShadowMap;
renderer.setPixelRatio(window.devicePixelRatio);
LightsSetup(scene);

// Create a cube
const geometry = new THREE.BoxGeometry();
const material = new THREE.MeshStandardMaterial({ color: 0x0077ff });
const cube = new THREE.Mesh(geometry, material);
scene.add(cube);

//constrols setup
const controls = new FirstPersonControls(camera, renderer.domElement, scene, {
  speed: .1
});
window.controls = controls;

// Position the camera
camera.position.z = 5;







// utility ------------------------------------------------------------------------------

preventSpaceOnFocusedButtons();

window.addEventListener('resize', () => {
  const width = window.innerWidth;
  const height = window.innerHeight;
  renderer.setSize(width, height);
  camera.aspect = width / height;
  camera.updateProjectionMatrix();
});

function animate() {
    requestAnimationFrame(animate);
    renderer.render(scene, camera);
    controls.update();
}

animate();