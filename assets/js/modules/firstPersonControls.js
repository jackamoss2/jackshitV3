import * as THREE from './three.module.js';

export class FirstPersonControls {
  constructor(camera, domElement, scene = null, options = {}) {
    this.camera = camera;
    this.domElement = domElement;
    this.scene = scene;

    this.speed = options.speed || 4;
    this.sprintMultiplier = options.sprintMultiplier || 8;
    this.crawlMultiplier = options.crawlMultiplier || 0.25;
    this.sensitivity = options.sensitivity || 0.002;

    this.position = camera.position.clone();

    const euler = new THREE.Euler().copy(camera.rotation);
    this.yaw = euler.y;
    this.pitch = euler.x;

    this.keys = {
      w: false,
      a: false,
      s: false,
      d: false,
      space: false,
      shift: false,
      ctrl: false,
    };

    this.isPointerLocked = false;
    this.isRightMouseDown = false;
    this.enabled = false;
    this._ignoreFirstMouseMove = false;

    this.crosshair = this._createCrosshair();

    this.domElement.style.cursor = '';

    this._initKeyboard();
    this._initPointerLock();
    this._initMouseButtons();

    this.domElement.addEventListener('click', () => {
      if (!this.enabled) {
        this._enterControls();
      }
    });
  }

  frameObject(object3D) {
    if (!object3D) return;

    const box = new THREE.Box3().setFromObject(object3D);
    if (box.isEmpty()) return;

    const center = box.getCenter(new THREE.Vector3());
    const size = box.getSize(new THREE.Vector3());

    const distance = size.length() * .2;

    this.position.copy(center);
    this.position.x += distance;
    this.position.y += distance * 0.5;
    this.position.z += distance;

    this.camera.position.copy(this.position);
    this.camera.lookAt(center);

    const lookDir = new THREE.Vector3();
    this.camera.getWorldDirection(lookDir);

    this.yaw = Math.atan2(-lookDir.x, -lookDir.z);
    this.pitch = Math.asin(lookDir.y);
  }

  _createCrosshair() {
    const crosshair = document.createElement('div');
    crosshair.style.position = 'fixed';
    crosshair.style.top = '50%';
    crosshair.style.left = '50%';
    crosshair.style.width = '20px';
    crosshair.style.height = '20px';
    crosshair.style.marginLeft = '-10px';
    crosshair.style.marginTop = '-10px';
    crosshair.style.pointerEvents = 'none';
    crosshair.style.zIndex = '9999';
    crosshair.style.display = 'flex';
    crosshair.style.alignItems = 'center';
    crosshair.style.justifyContent = 'center';

    const hLine = document.createElement('div');
    hLine.style.position = 'absolute';
    hLine.style.width = '20px';
    hLine.style.height = '2px';
    hLine.style.backgroundColor = 'white';
    crosshair.appendChild(hLine);

    const vLine = document.createElement('div');
    vLine.style.position = 'absolute';
    vLine.style.width = '2px';
    vLine.style.height = '20px';
    vLine.style.backgroundColor = 'white';
    crosshair.appendChild(vLine);

    return crosshair;
  }

  _showCrosshair() {
    if (!document.body.contains(this.crosshair)) {
      document.body.appendChild(this.crosshair);
    }
  }

  _hideCrosshair() {
    if (document.body.contains(this.crosshair)) {
      document.body.removeChild(this.crosshair);
    }
  }

  _clearKeys() {
    for (const key in this.keys) {
      this.keys[key] = false;
    }
    this.isRightMouseDown = false;
  }

  _initKeyboard() {
    window.addEventListener('keydown', (e) => {
      if (this.enabled && e.code === 'Escape') {
        this._exitControls();
        return;
      }

      if (!this.enabled) return;

      switch (e.code) {
        case 'KeyW': this.keys.w = true; break;
        case 'KeyA': this.keys.a = true; break;
        case 'KeyS': this.keys.s = true; break;
        case 'KeyD': this.keys.d = true; break;
        case 'Space': this.keys.space = true; break;
        case 'ShiftLeft':
        case 'ShiftRight': this.keys.shift = true; break;
        case 'ControlLeft':
        case 'ControlRight': this.keys.ctrl = true; break;
      }
    });

    window.addEventListener('keyup', (e) => {
      if (!this.enabled) return;

      switch (e.code) {
        case 'KeyW': this.keys.w = false; break;
        case 'KeyA': this.keys.a = false; break;
        case 'KeyS': this.keys.s = false; break;
        case 'KeyD': this.keys.d = false; break;
        case 'Space': this.keys.space = false; break;
        case 'ShiftLeft':
        case 'ShiftRight': this.keys.shift = false; break;
        case 'ControlLeft':
        case 'ControlRight': this.keys.ctrl = false; break;
      }
    });
  }

  _enterControls() {
  // Sync internal state to camera's current position and orientation
  this.position.copy(this.camera.position);
  const lookDir = new THREE.Vector3();
  this.camera.getWorldDirection(lookDir);
  this.yaw = Math.atan2(-lookDir.x, -lookDir.z);
  this.pitch = Math.asin(lookDir.y);

  this.enabled = true;
  this._clearKeys();
  this._showCrosshair();
  this.domElement.style.cursor = 'none';
  this._ignoreFirstMouseMove = true;
  this.domElement.requestPointerLock();
  }

  _exitControls() {
    this.enabled = false;
    this._clearKeys();
    this._hideCrosshair();
    this.domElement.style.cursor = '';
    if (document.pointerLockElement === this.domElement) {
      document.exitPointerLock();
    }
  }

  _initPointerLock() {
    document.addEventListener('pointerlockchange', () => {
      this.isPointerLocked = document.pointerLockElement === this.domElement;

      if (this.enabled && !this.isPointerLocked) {
        this._exitControls();
      }
    });

    document.addEventListener('mousemove', (e) => {
      if (!this.enabled) return;
      if (!this.isPointerLocked) return;

      if (this._ignoreFirstMouseMove) {
        this._ignoreFirstMouseMove = false;
        return;
      }

      this.yaw -= e.movementX * this.sensitivity;
      this.pitch -= e.movementY * this.sensitivity;

      const piHalf = Math.PI / 2 - 0.1;
      this.pitch = Math.max(-piHalf, Math.min(piHalf, this.pitch));
    });
  }

  _initMouseButtons() {
    this.domElement.addEventListener('mousedown', (e) => {
      if (!this.enabled) return;
      if (e.button === 2) {
        this.isRightMouseDown = true;
      }
    });
    this.domElement.addEventListener('mouseup', (e) => {
      if (!this.enabled) return;
      if (e.button === 2) {
        this.isRightMouseDown = false;
      }
    });
    this.domElement.addEventListener('contextmenu', (e) => e.preventDefault());
  }

  update() {
    if (!this.enabled) return;

    let currentSpeed = this.speed;

    if (this.keys.ctrl) {
      currentSpeed *= this.crawlMultiplier;
    } else if (this.isRightMouseDown) {
      currentSpeed *= this.sprintMultiplier;
    }

    const forward = new THREE.Vector3(
      -Math.sin(this.yaw) * Math.cos(this.pitch),
      Math.sin(this.pitch),
      -Math.cos(this.yaw) * Math.cos(this.pitch)
    ).normalize();

    const right = new THREE.Vector3(
      Math.sin(this.yaw + Math.PI / 2),
      0,
      Math.cos(this.yaw + Math.PI / 2)
    ).normalize();

    const moveVector = new THREE.Vector3();

    if (this.keys.w) moveVector.add(forward);
    if (this.keys.s) moveVector.sub(forward);
    if (this.keys.a) moveVector.sub(right);
    if (this.keys.d) moveVector.add(right);

    if (moveVector.lengthSq() > 0) {
      moveVector.normalize().multiplyScalar(currentSpeed);
    }

    if (this.keys.space) moveVector.y += currentSpeed;
    if (this.keys.shift) moveVector.y -= currentSpeed;

    this.position.add(moveVector);

    this.camera.position.copy(this.position);
    this.camera.rotation.set(this.pitch, this.yaw, 0, 'YXZ');
  }
}
