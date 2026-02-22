export function resizeRendererToDisplaySize(height, width, renderer, camera) {
    const canvas = renderer.domElement;

    renderer.setPixelRatio(window.devicePixelRatio);
    renderer.setSize(width, height, false);

    camera.aspect = width / height;
    camera.updateProjectionMatrix();
}