import {VirtualTryOn} from './tryon.js';
import {products} from './products.js';
import {describeError} from './errors.js';

const $ = id => document.getElementById(id);
const select = $('product'), start = $('start'), stop = $('stop'), capture = $('capture'), status = $('status');
let cameraRequest = 0;
const sdk = new VirtualTryOn({
  video: $('video'),
  canvas: $('overlay'),
  onStatus: message => {
    status.textContent = message;
    stop.disabled = !sdk.stream;
    capture.disabled = !sdk.running;
  }
});
products.forEach(product => select.add(new Option(product.name, product.id)));
async function choose() {
  await sdk.setProduct(products.find(product => product.id === select.value));
}
await choose();

select.addEventListener('change', async () => {
  select.disabled = true;
  try {
    await choose();
    if (sdk.running) status.textContent = 'Tracking — move into camera view';
  } catch (error) {
    status.textContent = describeError(error, 'The tracking model could not load. Check your connection, then select the product again.');
  } finally {
    select.disabled = false;
  }
});
start.onclick = async () => {
  const request = ++cameraRequest;
  start.disabled = true;
  select.disabled = true;
  try {
    await sdk.start($('camera').value);
  } catch (error) {
    if (request !== cameraRequest) return;
    await sdk.stop();
    status.textContent = describeError(error, 'The camera could not start. Please try again.');
  } finally {
    if (request === cameraRequest) {
      start.disabled = sdk.running;
      select.disabled = false;
      stop.disabled = !sdk.stream;
      capture.disabled = !sdk.running;
    }
  }
};
stop.onclick = async () => {
  cameraRequest++;
  await sdk.stop();
  start.disabled = false;
  select.disabled = false;
};
capture.onclick = () => {
  try {
    const link = document.createElement('a');
    link.download = `tryon-${Date.now()}.png`;
    link.href = sdk.capture();
    link.click();
  } catch (error) {
    status.textContent = describeError(error);
  }
};
window.addEventListener('pagehide', () => sdk.destroy());
