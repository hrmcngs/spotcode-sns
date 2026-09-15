import fs from 'node:fs';
import vm from 'node:vm';
import assert from 'node:assert/strict';
const source = JSON.parse(fs.readFileSync('src/data/readme-themes.json', 'utf8'));
const context = vm.createContext({});
vm.runInContext(fs.readFileSync('src/js/color-themes.js', 'utf8').replace('export const COLOR_THEMES', 'globalThis.palettes'), context);
const palettes = context.palettes;
assert.deepEqual(Object.keys(palettes).sort(), Object.keys(source).sort());
const css = fs.readFileSync('src/css/color-themes.css', 'utf8');
const swift = fs.readFileSync('ios/App/App/NativeColorThemes.swift', 'utf8');
const luminance = h => [1,3,5].map(i=>parseInt(h.slice(i,i+2),16)/255).map(v=>v<=.04045?v/12.92:((v+.055)/1.055)**2.4).reduce((s,v,i)=>s+v*[.2126,.7152,.0722][i],0);
const contrast = (a,b) => (Math.max(luminance(a),luminance(b))+.05)/(Math.min(luminance(a),luminance(b))+.05);
for (const [name, variants] of Object.entries(palettes)) {
 assert.deepEqual(Object.keys(variants).sort(), ['dark', 'light']);
 const nativeBlock = swift.slice(swift.indexOf('\n        "'+name+'": ['));
 for (const [mode,palette] of Object.entries(variants)) {
  assert(css.includes('html[data-color-theme="'+name+'"][data-theme="'+mode+'"]'));
  const native = nativeBlock.split('\n').find(line=>line.startsWith('            "'+mode+'": ['));
  assert(native, name+': '+mode);
  assert.equal(palette.scheme,mode);
  assert(mode==='light' ? luminance(palette.bg)>=.179 : luminance(palette.bg)<.179);
  for (const [key,value] of Object.entries(palette)) {
   assert(native.includes(JSON.stringify(key)+': '+JSON.stringify(value)), name+': '+mode+': '+key);
   if(key!=='scheme') assert.match(value,/^#[\da-f]{6}$/);
  }
  for (const key of ['text','muted','accent']) assert(contrast(palette[key],palette.bg)>=4.5, name+': '+mode+': '+key);
  assert(contrast(palette['on-accent'],palette.accent)>=4.5, name+': '+mode+': button');
 }
 assert.notEqual(variants.light.bg,variants.dark.bg);
}
assert.equal(palettes.dracula.dark.bg, '#282a36');
assert.equal(palettes.nord.dark.bg, '#2e3440');
assert.equal(palettes.transparent.light.bg, '#ffffff');
assert.equal(palettes.ambient_gradient.dark.bg, '#4158d0');
assert(swift.includes('Copyright (c) 2020 Anurag Hazra'));
console.log('PASS all '+Object.keys(palettes).length+' themes × 2 modes, Web/native parity, contrast, alpha/gradient flattening, attribution');
