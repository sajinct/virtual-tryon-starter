import {FilesetResolver, HandLandmarker, FaceLandmarker, PoseLandmarker} from '@mediapipe/tasks-vision';
import simdLoader from '@mediapipe/tasks-vision/vision_wasm_internal.js?url';
import simdBinary from '@mediapipe/tasks-vision/vision_wasm_internal.wasm?url';
import plainLoader from '@mediapipe/tasks-vision/vision_wasm_nosimd_internal.js?url';
import plainBinary from '@mediapipe/tasks-vision/vision_wasm_nosimd_internal.wasm?url';
import {describeError} from './errors.js';

const BASE='https://storage.googleapis.com/mediapipe-models';
const MODELS={
 hand:`${BASE}/hand_landmarker/hand_landmarker/float16/1/hand_landmarker.task`,
 face:`${BASE}/face_landmarker/face_landmarker/float16/1/face_landmarker.task`,
 pose:`${BASE}/pose_landmarker/pose_landmarker_lite/float16/1/pose_landmarker_lite.task`
};
const trackerFor={watch:'hand',bracelet:'hand',ring:'hand',earrings:'face',necklace:'pose',shirt:'pose',dress:'pose'};
const point=(p,w,h)=>({x:p.x*w,y:p.y*h});
const between=(a,b,t=.5)=>({x:a.x+(b.x-a.x)*t,y:a.y+(b.y-a.y)*t});
const distance=(a,b)=>Math.hypot(a.x-b.x,a.y-b.y);

export class VirtualTryOn {
 constructor({video,canvas,onStatus=()=>{}}){this.video=video;this.canvas=canvas;this.ctx=canvas.getContext('2d');this.onStatus=onStatus;this.trackers={};this.product=null;this.running=false;this.stream=null;this.raf=null;this.generation=0;this.lastTimestamp=-1;}
 async setProduct(product){
   if(!trackerFor[product.category])throw Error('Unsupported category: '+product.category);
   this.product={...product}; const img=new Image(); img.crossOrigin='anonymous';
   await new Promise((resolve,reject)=>{img.onload=resolve;img.onerror=()=>reject(Error('Could not load product asset'));img.src=product.asset;});
   this.product.image=img;
   if(this.running)await this.ensureTracker(trackerFor[product.category]);
 }
 async ensureTracker(type){
  if(this.trackers[type])return this.trackers[type];
  this.onStatus('Loading '+type+' tracking model...');
  // Bundle the WASM and loader from the same installed package as the JS SDK.
  // A separate CDN version can be missing or incompatible with that SDK.
  if(!this.vision){
    const simd=await FilesetResolver.isSimdSupported();
    this.vision={wasmLoaderPath:simd?simdLoader:plainLoader,wasmBinaryPath:simd?simdBinary:plainBinary};
  }
  const options={baseOptions:{modelAssetPath:MODELS[type],delegate:'CPU'},runningMode:'VIDEO'};
  const tracker=type==='hand' ? await HandLandmarker.createFromOptions(this.vision,{...options,numHands:1})
   :type==='face'?await FaceLandmarker.createFromOptions(this.vision,{...options,numFaces:1})
   :await PoseLandmarker.createFromOptions(this.vision,{...options,numPoses:1});
  this.trackers[type]=tracker;return tracker;
 }
 async start(facingMode='user'){
  await this.stop();if(!this.product)throw Error('Select a product first');
  if(!navigator.mediaDevices?.getUserMedia)throw Error('Camera access requires HTTPS and a browser with camera support. Open this site directly in Chrome, Edge, Firefox, or Safari.');
  const gen=++this.generation;
  this.onStatus('Requesting camera...');
  const stream=await navigator.mediaDevices.getUserMedia({audio:false,video:{facingMode:{ideal:facingMode},width:{ideal:960},height:{ideal:720}}});
  if(gen!==this.generation){stream.getTracks().forEach(t=>t.stop());return;}
  this.stream=stream;this.video.srcObject=stream;
  await this.video.play();
  if(gen!==this.generation)return;
  this.canvas.width=this.video.videoWidth;this.canvas.height=this.video.videoHeight;
  this.running=true;this.lastTimestamp=-1;
  this.loop();
  try{
    await this.ensureTracker(trackerFor[this.product.category]);
    if(gen!==this.generation)return;
    this.onStatus('Tracking — move into camera view');
  }catch(error){
    if(gen!==this.generation)return;
    this.onStatus('Camera is on; tracking unavailable. '+describeError(error,'The tracking model could not load. Check your connection, then select the product again to retry.'));
  }
 }
 loop(){
  if(!this.running)return;
  const {width:w,height:h}=this.canvas,ctx=this.ctx;
  ctx.clearRect(0,0,w,h);
  // Draw video in the canvas so the snapshot contains both background and product.
  ctx.drawImage(this.video,0,0,w,h);
  const product=this.product;
  if(product){
    const type=trackerFor[product.category],tracker=this.trackers[type];
    const now=performance.now();
    if(tracker&&this.video.readyState>=2&&now>this.lastTimestamp){
      this.lastTimestamp=now;
      try{
        const result=tracker.detectForVideo(this.video,now);
        if(type==='hand')this.drawHand(result.landmarks?.[0],product,w,h);
        else if(type==='face')this.drawFace(result.faceLandmarks?.[0],product,w,h);
        else this.drawPose(result.landmarks?.[0],product,w,h);
      }catch(error){
        delete this.trackers[type];
        tracker.close();
        this.onStatus('Camera is on; tracking stopped. '+describeError(error,'Select the product again to retry.'));
      }
    }
  }
  this.raf=requestAnimationFrame(()=>this.loop());
 }
 drawAsset(product,center,width,angle=0){
  if(!center||width<4)return;
  const img=product.image,ratio=img.naturalHeight/img.naturalWidth,height=width*ratio;
  const ctx=this.ctx;ctx.save();ctx.translate(center.x+product.offsetX*width,center.y+product.offsetY*width);ctx.rotate(angle);
  ctx.drawImage(img,-width/2,-height/2,width,height);ctx.restore();
 }
 drawHand(p,product,w,h){
  if(!p)return;const pt=i=>point(p[i],w,h);
  const wrist=pt(0),index=pt(5),middle=pt(9),pinky=pt(17);
  const palmWidth=distance(index,pinky),axis=Math.atan2(middle.y-wrist.y,middle.x-wrist.x);
  if(product.category==='ring'){
    // Position on ring finger between MCP (13) and PIP (14); orientation follows finger.
    const base=pt(13),joint=pt(14),center=between(base,joint,.52);
    this.drawAsset(product,center,Math.max(12,distance(base,joint)*product.scale),Math.atan2(joint.y-base.y,joint.x-base.x)-Math.PI/2);
  }else{
    // Offset from wrist toward elbow using palm direction; wrist is the only detected joint here.
    const center={x:wrist.x-(middle.x-wrist.x)*.23,y:wrist.y-(middle.y-wrist.y)*.23};
    // The watch artwork has a vertical strap, which must run across the wrist.
    const angle=product.category==='watch'?axis:axis-Math.PI/2;
    this.drawAsset(product,center,palmWidth*product.scale,angle);
  }
 }
 drawFace(p,product,w,h){
  if(!p)return;const pt=i=>point(p[i],w,h);
  const left=pt(234),right=pt(454),faceWidth=distance(left,right);
  if(product.category==='earrings'){
    // Face contour anchors. Jewellery is approximate and may not follow obscured ears.
    for(const side of [left,right])this.drawAsset(product,{x:side.x,y:side.y+faceWidth*.16},faceWidth*product.scale,0);
  }
 }
 drawPose(p,product,w,h){
  if(!p)return;const pt=i=>point(p[i],w,h),s1=pt(11),s2=pt(12),hip1=pt(23),hip2=pt(24);
  const centerShoulders=between(s1,s2),centerHips=between(hip1,hip2),sw=distance(s1,s2);
  if(product.category==='necklace'){
    this.drawAsset(product,{x:centerShoulders.x,y:centerShoulders.y+sw*.12},sw*product.scale,0);
  } else {
    const chest=between(centerShoulders,centerHips,product.category==='dress'?.68:.36);
    const torsoHeight=distance(centerShoulders,centerHips);
    const imageRatio=product.image.naturalHeight/product.image.naturalWidth;
    const width=Math.max(sw*product.scale,(product.category==='dress'?torsoHeight*1.9:torsoHeight*1.15)/imageRatio);
    // Point the artwork's downward axis from shoulders toward hips. Anatomical
    // shoulder order reverses in a front view and would flip the garment.
    const angle=Math.atan2(centerHips.y-centerShoulders.y,centerHips.x-centerShoulders.x)-Math.PI/2;
    this.drawAsset(product,chest,width,angle);
  }
 }
 capture(){if(!this.running)throw Error('Camera is not running');return this.canvas.toDataURL('image/png');}
 async stop(){this.generation++;this.running=false;if(this.raf)cancelAnimationFrame(this.raf);this.raf=null;this.stream?.getTracks().forEach(t=>t.stop());this.stream=null;this.video.pause();this.video.srcObject=null;this.ctx.clearRect(0,0,this.canvas.width,this.canvas.height);this.onStatus('Camera is off');}
 async destroy(){await this.stop();Object.values(this.trackers).forEach(t=>t.close());this.trackers={};}
}
