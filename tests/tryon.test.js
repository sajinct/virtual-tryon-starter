import test from 'node:test';
import assert from 'node:assert/strict';
import {readFile} from 'node:fs/promises';
import vm from 'node:vm';
import {describeError} from '../src/errors.js';

// Exercise the real SDK with browser and MediaPipe boundaries mocked. No webcam
// or downloaded model is needed to reproduce runtime failures and cancellation.
async function setup({simd = true, createTracker = async () => ({detectForVideo: () => ({landmarks: []}), close() {}}), getUserMedia} = {}) {
  const calls = {draws: 0, stopped: 0, frames: 0, status: [], filesets: []};
  const stream = {getTracks: () => [{stop: () => calls.stopped++}]};
  const context = vm.createContext({
    navigator: {mediaDevices: {getUserMedia: getUserMedia ?? (async () => stream)}},
    performance: {now: () => 1},
    requestAnimationFrame: callback => {calls.frame = callback; return ++calls.frames;},
    cancelAnimationFrame() {}
  });
  const source = await readFile(new URL('../src/tryon.js', import.meta.url), 'utf8');
  const errors = new vm.SourceTextModule(await readFile(new URL('../src/errors.js', import.meta.url), 'utf8'), {context});
  const trackerFactory = {createFromOptions: async fileset => {calls.filesets.push(fileset); return createTracker();}};
  const mediapipe = new vm.SyntheticModule(['FilesetResolver', 'HandLandmarker', 'FaceLandmarker', 'PoseLandmarker'], function () {
    this.setExport('FilesetResolver', {isSimdSupported: async () => simd});
    for (const name of ['HandLandmarker', 'FaceLandmarker', 'PoseLandmarker']) this.setExport(name, trackerFactory);
  }, {context});
  const module = new vm.SourceTextModule(source, {context});
  await module.link(specifier => {
    if (specifier === '@mediapipe/tasks-vision') return mediapipe;
    if (specifier === './errors.js') return errors;
    if (specifier.endsWith('?url')) return new vm.SyntheticModule(['default'], function () {this.setExport('default', '/project/assets/' + specifier.split('/').at(-1).replace('?url', ''));}, {context});
    throw Error('Unexpected import: ' + specifier);
  });
  await module.evaluate();
  const video = {videoWidth: 640, videoHeight: 480, readyState: 2, play: async () => {}, pause() {}};
  const canvas = {getContext: () => ({clearRect() {}, drawImage() {calls.draws++;}}), toDataURL: () => 'data:image/png;base64,test'};
  const sdk = new module.namespace.VirtualTryOn({video, canvas, onStatus: message => calls.status.push(message)});
  sdk.product = {category: 'watch', scale: 1.65, offsetX: 0, offsetY: 0};
  return {sdk, calls, video};
}

test('camera renders before tracking finishes and can stop during model loading', async () => {
  let resolveModel;
  const model = new Promise(resolve => {resolveModel = resolve;});
  const {sdk, calls, video} = await setup({createTracker: () => model});
  const startup = sdk.start();
  await new Promise(resolve => setImmediate(resolve));
  assert.equal(sdk.running, true);
  assert.equal(calls.draws, 1);
  assert.equal(sdk.capture(), 'data:image/png;base64,test');
  await sdk.stop();
  resolveModel({close() {}});
  await startup;
  assert.equal(sdk.running, false);
  assert.equal(video.srcObject, null);
  assert.equal(calls.stopped, 1);
  assert.equal(calls.status.at(-1), 'Camera is off');
});

for (const simd of [true, false]) test(`loads packaged matching WASM files (SIMD: ${simd})`, async () => {
  const {sdk, calls} = await setup({simd});
  await sdk.start();
  const expected = simd ? 'vision_wasm_internal' : 'vision_wasm_nosimd_internal';
  assert.equal(calls.filesets[0].wasmLoaderPath, `/project/assets/${expected}.js`);
  assert.equal(calls.filesets[0].wasmBinaryPath, `/project/assets/${expected}.wasm`);
});

test('runtime load failure preserves preview and produces a useful error', async () => {
  const {sdk, calls} = await setup({createTracker: async () => {throw {type: 'error'};}});
  await sdk.start();
  assert.equal(sdk.running, true);
  assert.match(calls.status.at(-1), /Camera is on; tracking unavailable/);
  assert.match(calls.status.at(-1), /could not load/);
  assert.doesNotMatch(calls.status.at(-1), /undefined/);
  calls.frame();
  assert.equal(calls.draws, 2);
});

test('permission denial remains identifiable and does not start rendering', async () => {
  const denied = Object.assign(new Error('Permission denied'), {name: 'NotAllowedError'});
  const {sdk, calls} = await setup({getUserMedia: async () => {throw denied;}});
  await assert.rejects(sdk.start(), error => error === denied);
  assert.equal(sdk.running, false);
  assert.equal(calls.draws, 0);
  assert.match(describeError(denied), /Allow camera access/);
});

test('hand tracking handles missing landmarks and draws detected hands', async () => {
  const {sdk} = await setup();
  const draws = [];
  sdk.drawAsset = (...args) => draws.push(args);
  sdk.drawHand(undefined, sdk.product, 640, 480);
  assert.equal(draws.length, 0);
  const landmarks = Array.from({length: 21}, (_, index) => ({x: index / 22, y: index / 23}));
  sdk.drawHand(landmarks, sdk.product, 640, 480);
  assert.equal(draws.length, 1);
  assert.ok(Number.isFinite(draws[0][1].x));
  assert.ok(Number.isFinite(draws[0][2]));
});

test('tracking detection failure keeps the preview rendering', async () => {
  const {sdk, calls} = await setup({createTracker: async () => ({detectForVideo() {throw Error('Detection failed');}, close() {}})});
  await sdk.start();
  calls.frame();
  assert.equal(sdk.running, true);
  assert.match(calls.status.at(-1), /tracking stopped/);
  assert.equal(calls.draws, 2);
});

test('error formatting accepts string rejections and errors without messages', () => {
  assert.equal(describeError('Runtime unavailable'), 'Runtime unavailable');
  assert.equal(describeError(undefined, 'Retry camera'), 'Retry camera');
  assert.match(describeError({name: 'NotReadableError'}), /Close other apps/);
});

function rotateLandmarks(points, angle, mirrored = false) {
  // Rotate in camera pixels before normalizing so non-square frames are covered.
  return points.map(({x, y}) => {
    const dx = (mirrored ? -1 : 1) * (x - 320), dy = y - 240;
    return {x: (320 + dx * Math.cos(angle) - dy * Math.sin(angle)) / 640,
      y: (240 + dx * Math.sin(angle) + dy * Math.cos(angle)) / 480};
  });
}

test('watch strap lies across the wrist for either hand and rotated arms', async () => {
  const {sdk} = await setup();
  const points = Array.from({length: 21}, () => ({x: 320, y: 220}));
  points[0] = {x: 320, y: 300};
  points[9] = {x: 320, y: 180};
  points[5] = {x: 280, y: 190};
  points[17] = {x: 370, y: 205};
  let drawing;
  sdk.drawAsset = (product, center, width, angle) => {drawing = {center, width, angle};};
  for (const rotation of [0, Math.PI / 6, -Math.PI / 3, Math.PI / 2, Math.PI, -Math.PI / 2]) {
    for (const mirrored of [false, true]) {
      const p = rotateLandmarks(points, rotation, mirrored);
      sdk.drawHand(p, sdk.product, 640, 480);
      const arm = {x: (p[9].x - p[0].x) * 640, y: (p[9].y - p[0].y) * 480};
      // The SVG strap runs vertically in the source image.
      const strap = {x: -Math.sin(drawing.angle), y: Math.cos(drawing.angle)};
      const alignment = (strap.x * arm.x + strap.y * arm.y) / Math.hypot(arm.x, arm.y);
      assert.ok(Math.abs(alignment) < 1e-10, `Strap must cross the arm (rotation ${rotation}, mirrored ${mirrored})`);
      assert.ok(drawing.width > 0);
      const offset = {x: drawing.center.x - p[0].x * 640, y: drawing.center.y - p[0].y * 480};
      assert.ok(offset.x * arm.x + offset.y * arm.y < 0, 'Watch stays on the forearm side of the wrist');
    }
  }
});

test('dress and shirt hems point toward the hips regardless of shoulder order or body tilt', async () => {
  const {sdk} = await setup();
  const points = Array.from({length: 33}, () => ({x: 320, y: 240}));
  // Anatomical left appears on the right in an unmirrored front-facing image.
  points[11] = {x: 380, y: 140};
  points[12] = {x: 260, y: 140};
  points[23] = {x: 370, y: 360};
  points[24] = {x: 270, y: 360};
  let angle;
  sdk.drawAsset = (product, center, width, rotation) => {angle = rotation;};
  for (const category of ['dress', 'shirt']) {
    const product = {...sdk.product, category, image: {naturalHeight: 100, naturalWidth: 100}};
    for (const rotation of [0, Math.PI / 6, -Math.PI / 4, Math.PI / 2, Math.PI]) {
      for (const mirrored of [false, true]) {
        const p = rotateLandmarks(points, rotation, mirrored);
        sdk.drawPose(p, product, 640, 480);
        const torso = {x: ((p[23].x + p[24].x - p[11].x - p[12].x) / 2) * 640,
          y: ((p[23].y + p[24].y - p[11].y - p[12].y) / 2) * 480};
        const alignment = (-Math.sin(angle) * torso.x + Math.cos(angle) * torso.y) / Math.hypot(torso.x, torso.y);
        assert.ok(Math.abs(alignment - 1) < 1e-10, `${category} hem must face hips (rotation ${rotation}, mirrored ${mirrored})`);
      }
    }
  }
});
