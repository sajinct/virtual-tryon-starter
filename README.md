# Free, browser-based multi-category virtual try-on MVP

## What is actually implemented
- Live camera video drawn into an HTML canvas
- MediaPipe hand (watch, bracelet, ring), face (earrings), pose (necklace, shirt, dress) tracking
- Transparent SVG/PNG product overlay with configurable size and offset
- Product switching, front/rear camera, snapshot export, explicit stop and camera cleanup
- No server-side images or camera processing; no accounts or paid API

**Limits:** all overlays are approximate 2D visualizations. Clothing is NOT photo-realistic AI garment replacement. Size/fit, occlusion, perspective, lighting, pose, and left/right earring precision are not production-accurate. Camera access requires localhost or HTTPS. Initial model/WASM loading needs internet access. SVG art is original placeholder art; replace before selling.

## Setup
Requires Node.js 20+.

```bash
npm install
npm run dev
```

Open the address printed by Vite (usually http://localhost:5173). Grant camera permission. Use `npm run build` to write the production static site into `dist/`.

## Usage in another HTML store
Import `VirtualTryOn` from `src/tryon.js` using your bundler and create a `<video playsinline muted>` and `<canvas>` pair, then:

```js
const tryon = new VirtualTryOn({video: document.querySelector('video'), canvas: document.querySelector('canvas')});
await tryon.setProduct({id:'my-watch',category:'watch',asset:'/products/watch.png',scale:1.5,offsetX:0,offsetY:0});
await tryon.start('user');
// Optional: const pngDataUrl = tryon.capture();
await tryon.stop();
```

A product record can be persisted in your catalog: `{id, category, asset, scale, offsetX, offsetY}`. Valid categories: `watch`, `bracelet`, `ring`, `earrings`, `necklace`, `shirt`, `dress`. Watch/ring positions are estimated from hand landmarks. Add a calibration UI and save settings per SKU.

## Assets
- Use transparent PNG/WebP or SVG images with a centered product and minimal blank margin.
- Suggested 1024×1024 resolution for wrist/ring items; 1024×1400 portrait for clothing; center main item in the image.
- For jewellery supply front-facing artwork, ideally one per orientation (left/right). The MVP uses one duplicated earring image.
- MediaPipe model files and WASM files are fetched from Google/CDN at runtime. For a self-contained commercial deployment, pin versions and self-host model assets and WASM after reviewing their licenses.
- Production requires HTTPS, explicit camera consent, a visible stop button, no analytics on raw frames, and privacy text.

## Commercial / license review
- The starter code and original SVG placeholders in this zip are supplied for modification and commercial use (MIT LICENSE).
- `@mediapipe/tasks-vision` is Apache-2.0; examine downloaded model terms and notice requirements before redistributing. See Google AI Edge documentation.
- Vite is MIT. Check all dependency notices as part of release preparation.
- Do not rely on unrelated, research-only, or noncommercial AI model weights in a production store.

## Hosting
Live site: https://sajinct.github.io/virtual-tryon-starter/

The GitHub Actions workflow in `.github/workflows/deploy-pages.yml` builds and deploys the site to GitHub Pages on every push to `main`. In repository Settings > Pages, the publishing source is GitHub Actions.

Vite uses a relative base URL, and product assets use that base, so the site works under a GitHub Pages repository path. The generated `dist/` can also be deployed to any static HTTPS web host. The production build targets modern browsers with ES2022 support.

## Optional AI garment try-on integration
For a separate backend, consider FASHN VTON v1.5 (`https://github.com/fashn-AI/fashn-vton-1.5`) after checking all dependency licenses. Build a private inference service accepting the person's photo, the garment photo, and the category (`tops`, `bottoms`, `one-pieces`). Require explicit user consent before uploading. Keep uploads ephemeral, limit size, authenticate/rate-limit API calls, and automatically delete photos. Model inference is not included in this free static starter; it requires a suitable GPU for acceptable speed.
