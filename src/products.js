// Use assets with transparent backgrounds. Width is a multiplier of tracked anchor-to-anchor distance.
const assetBase = `${import.meta.env.BASE_URL}assets/`;
export const products = [
 {id:'watch',name:'Demo Watch',category:'watch',asset:`${assetBase}watch.svg`,scale:1.65,offsetX:0,offsetY:0},
 {id:'bracelet',name:'Demo Bracelet',category:'bracelet',asset:`${assetBase}bracelet.svg`,scale:1.2,offsetX:0,offsetY:0},
 {id:'ring',name:'Demo Ring',category:'ring',asset:`${assetBase}ring.svg`,scale:1.25,offsetX:0,offsetY:0},
 {id:'earrings',name:'Demo Earrings',category:'earrings',asset:`${assetBase}earring.svg`,scale:0.28,offsetX:0,offsetY:0},
 {id:'necklace',name:'Demo Necklace',category:'necklace',asset:`${assetBase}necklace.svg`,scale:0.9,offsetX:0,offsetY:0},
 {id:'shirt',name:'Demo Shirt (approximate overlay)',category:'shirt',asset:`${assetBase}shirt.svg`,scale:1.6,offsetX:0,offsetY:0},
 {id:'dress',name:'Demo Dress (approximate overlay)',category:'dress',asset:`${assetBase}dress.svg`,scale:1.5,offsetX:0,offsetY:0}
];
