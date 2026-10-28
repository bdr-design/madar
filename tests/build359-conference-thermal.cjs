'use strict';
const assert=require('node:assert/strict');
const fs=require('node:fs');
const path=require('node:path');

const web=path.resolve(__dirname,'../WebApp');
const controller=fs.readFileSync(path.join(web,'conference-3d.js'),'utf8');
const keynote=fs.readFileSync(path.join(web,'conference-keynote.js'),'utf8');
const css=fs.readFileSync(path.join(web,'conference-3d.css'),'utf8');

// The conference is an HTML presentation in one photograph of the owner's hall. Preserve the legacy API identifier for
// saved-session compatibility while asserting the runtime is 2D and does no work between slides.
for(const source of [controller,keynote]){
  assert.doesNotMatch(source,/\brequestAnimationFrame\s*\(/,'a static conference must not schedule animation frames');
  assert.doesNotMatch(source,/\bWebGLRenderer\b|\bGH_THREE\b|\bCanvasTexture\b|\bInstancedMesh\b/,'conference runtime must not load or create Three/WebGL resources');
  assert.doesNotMatch(source,/\bsetInterval\s*\(|\bMutationObserver\b|\bResizeObserver\b/,'no polling or observers while a slide is shown');
}
assert.match(controller,/engine:'GH-CONFERENCE-2D'/);
assert.match(controller,/webglFrames:0,scheduledFrame:false/);
assert.match(controller,/drawCalls:0,triangles:0,geometries:0,textures:0/);
// Autoplay is one timer per slide; closing removes every listener and the stage.
assert.equal((controller.match(/setTimeout\(/g)||[]).length,1,'one autoplay timer');
assert.match(controller,/for\(const remove of this\.events\)remove\(\);this\.events=\[\];this\.root\?\.remove\(\)/,'closing releases listeners and the stage DOM');
// Slide motion runs once per slide and animates transform and opacity only.
const keyframes=[...css.matchAll(/@keyframes ([\w-]+)\{([^@]*?\})\}/g)];assert(keyframes.length>=5,'the slide animations are declared');
for(const [,name,body] of keyframes){const props=[...body.matchAll(/([a-z-]+):/g)].map(m=>m[1]);assert(props.every(prop=>['opacity','transform'].includes(prop)),`${name} animates ${props}`);}
assert.match(css,/@media \(prefers-reduced-motion:reduce\)\{\.ghc3 \*\{animation:none!important;transition:none!important\}\}/,'reduced motion turns the animations off');
// One hall photograph, drawn at its own proportions; the frame is placed once at mount and again only when the screen
// turns (the one resize listener calls frame(), and show() never does); the floating controls are drawn once, without
// a blur behind them.
assert.match(css,/\.ghc3-viewport\{[^}]*url\("assets\/conference\/hall-dark\.webp"\) var\(--x\) var\(--y\)\/calc\(var\(--hall-w\)\*1px\*var\(--k\)\) calc\(var\(--hall-h\)\*1px\*var\(--k\)\)/,'one hall photograph, drawn at its own proportions');
assert.equal((controller.match(/'resize'/g)||[]).length,1,'one resize listener');assert.match(controller,/this\.listen\(globalThis,'resize',\(\)=>this\.frame\(\)\)/,'the screen turning only reframes the hall');
{const show=controller.slice(controller.indexOf(' show(persist=true){'),controller.indexOf(' persistProgress(){'));assert(show.length>100&&!/frame\(|getBoundingClientRect|clientWidth/.test(show),'showing a slide measures and reframes nothing');}
assert.doesNotMatch(css,/backdrop-filter|filter:\s*blur/,'no blur behind the controls');

console.log(JSON.stringify({suite:'build359-conference-thermal',runtime:'static-2d',scheduledFrames:0,webglResources:0,keyframes:keyframes.length,timers:1}));
