import assert from 'node:assert/strict';
import fs from 'node:fs';
const file = process.argv[2] ?? 'build/ui/webvst_ui_fixture.wasm';
assert.ok(fs.existsSync(file), 'the real C++ UI fixture must be compiled before conformance');
const module = new WebAssembly.Module(fs.readFileSync(file));
assert.deepEqual(WebAssembly.Module.imports(module).map(i => `${i.module}.${i.name}`).sort(),
  ['webvst_ui.invalidate', 'webvst_ui.parameter', 'webvst_ui.submit']);
const batches = [], gestures = [];
let invalidations = 0, instance;
instance = new WebAssembly.Instance(module, {webvst_ui: {
  submit(kind, ptr, size) { batches.push([kind, JSON.parse(new TextDecoder().decode(new Uint8Array(instance.exports.memory.buffer, ptr, size)))]); return 0; },
  parameter(op, id, value) { gestures.push([op,id,value]); return 0; },
  invalidate() { invalidations++; }
}});
const e = instance.exports;
e._initialize?.();
assert.equal(e.wvui_version(), 1);
const h = e.wvui_create(); assert.ok(h);
e.wvui_resize(h, 400, 240, 2);
e.wvui_parameter(h, 7, .25);
e.wvui_frame(h, 0);
assert.equal(batches.length, 2);
assert.equal(batches[0][1].version, 1);
assert.ok(batches[0][1].commands.some(c => c.op === 'text'));
const slider = () => batches.filter(b => b[0] === 2).at(-1)[1].nodes.find(n => n.id === 'gain');
assert.equal(slider().value, .25);
assert.equal(slider().parameter, '7');
function event(data) {
  const bytes = new TextEncoder().encode(typeof data === 'string' ? data : JSON.stringify(data));
  const ptr = e.wvui_alloc(bytes.length); assert.ok(ptr);
  new Uint8Array(e.memory.buffer, ptr, bytes.length).set(bytes);
  e.wvui_event(h, ptr, bytes.length); e.wvui_free(ptr, bytes.length);
}
event({type:'pointerdown', x:100, y:70, pointerId:1});
event({type:'pointermove', x:250, y:70, pointerId:1});
e.wvui_frame(h, 1);
assert.equal(slider().value, .25, 'requested values never override canonical publication');
assert.deepEqual(gestures.map(g => g[0]), [0,1,1]);
event({type:'pointercancel', pointerId:1});
event({type:'blur'});
assert.equal(gestures.filter(g => g[0] === 2).length, 1, 'cancel ends exactly once');
e.wvui_parameter(h, 7, .75); e.wvui_frame(h, 2); assert.equal(slider().value, .75);
const before = gestures.length;
event('{broken json'); event({type:'pointerdown', x:'invalid', y:70});
assert.equal(gestures.length, before);
event({type:'keydown', targetId:'gain', key:'ArrowRight'});
assert.deepEqual(gestures.slice(-3).map(g => g[0]), [0,1,2]);
event({type:'parameters',parameters:[{id:'7',name:'Gain',defaultValue:0,stepCount:4}]});
event({type:'change',targetId:'gain',value:.38});
assert.equal(gestures.at(-2)[2],.5,'metadata quantizes requested values');
e.wvui_frame(h,2.1); assert.equal(slider().value,.75,'accessibility edits also wait for canonical values');
event({type:'parameters',parameters:[{id:'7',name:'Gain',defaultValue:0,stepCount:4,readOnly:true}]});
const readOnlyCount=gestures.length;
event({type:'change',targetId:'gain',value:.1});
assert.equal(gestures.length,readOnlyCount,'read-only parameters reject gestures');
event({type:'parameters',parameters:[{id:'7',name:'Gain',defaultValue:0,stepCount:4}]});
event('{"type":"change","type":"pointerdown","targetId":"gain","value":0}');
assert.equal(gestures.length,readOnlyCount,'duplicate JSON keys are rejected');
assert.equal(e.wvui_alloc(65537),0);
e.wvui_event(h,0xffffff00,100);
event({type:'pointerdown', x:100,y:70,pointerId:2});
e.wvui_destroy(h);
assert.equal(gestures.at(-1)[0], 2, 'destroy closes active gestures');
const staleBatches = batches.length;
e.wvui_frame(h,3); assert.equal(batches.length,staleBatches);
const second = e.wvui_create(); assert.notEqual(second,h,'stale handles cannot address new editors');
e.wvui_resize(second,400,240,1); e.wvui_frame(second,4); assert.equal(slider().value,0);
e.wvui_destroy(second);
assert.ok(invalidations > 0);
console.log('C++ UI compiled WASM conformance passed');
