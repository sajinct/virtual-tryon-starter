import {VirtualTryOn} from './tryon.js';
import {products} from './products.js';
const $=id=>document.getElementById(id);
const select=$('product'),start=$('start'),stop=$('stop'),capture=$('capture'),status=$('status');
const sdk=new VirtualTryOn({video:$('video'),canvas:$('overlay'),onStatus:s=>status.textContent=s});
products.forEach(p=>select.add(new Option(p.name,p.id)));
async function choose(){await sdk.setProduct(products.find(p=>p.id===select.value));}
await choose();
select.addEventListener('change',async()=>{try{await choose();}catch(e){status.textContent=e.message;}});
start.onclick=async()=>{start.disabled=true;try{await sdk.start($('camera').value);stop.disabled=false;capture.disabled=false;}catch(e){status.textContent='Error: '+e.message;start.disabled=false;await sdk.stop();status.textContent='Error: '+e.message;}};
stop.onclick=async()=>{await sdk.stop();start.disabled=false;stop.disabled=true;capture.disabled=true;};
capture.onclick=()=>{try{const a=document.createElement('a');a.download=`tryon-${Date.now()}.png`;a.href=sdk.capture();a.click();}catch(e){status.textContent=e.message;}};
window.addEventListener('pagehide',()=>sdk.destroy());
