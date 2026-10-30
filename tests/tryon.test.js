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
