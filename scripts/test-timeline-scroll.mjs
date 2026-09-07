import fs from 'node:fs';
import vm from 'node:vm';
import assert from 'node:assert/strict';
const events=new Map(),frames=new Map();let next=0,loads=0,active=true,top=1200;
const ctx=vm.createContext({
 document:{addEventListener:(key,fn)=>events.set(key,fn),removeEventListener:key=>events.delete(key)},
 window:{innerHeight:600,addEventListener:(key,fn)=>events.set(key,fn),removeEventListener:key=>events.delete(key)},
 requestAnimationFrame:fn=>{frames.set(++next,fn);return next;},cancelAnimationFrame:id=>frames.delete(id),
});
vm.runInContext(fs.readFileSync('src/js/timeline-scroll.js','utf8').replace(/^export /gm,''),ctx);
const sentinel={isConnected:true,hidden:false,getBoundingClientRect:()=>({top,bottom:top+1})};
const flush=()=>{const callbacks=[...frames.values()];frames.clear();callbacks.forEach(fn=>fn());};
const watcher=ctx.watchTimelineEnd(sentinel,{active:()=>active,load:()=>loads++});
flush();assert.equal(loads,0);
top=850;events.get('scroll')();events.get('scroll')();assert.equal(frames.size,1);flush();assert.equal(loads,1);
watcher.check();flush();assert.equal(loads,2); // short page: bottom still visible
sentinel.hidden=true;watcher.check();flush();assert.equal(loads,2);
sentinel.hidden=false;active=false;watcher.check();flush();assert.equal(loads,2);assert.equal(events.size,0);
watcher.check();assert.equal(frames.size,0);
console.log('PASS automatic near-bottom loading without IntersectionObserver, short-page continuation, coalescing, end-of-feed and navigation cleanup');
