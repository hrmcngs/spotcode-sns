import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import vm from 'node:vm';
import assert from 'node:assert/strict';
import {execFileSync} from 'node:child_process';
const context=vm.createContext({t:x=>x,URL});
vm.runInContext(fs.readFileSync('src/js/business-cards.js','utf8').replace(/^import .*;\n/gm,'').replace(/^export /gm,''),context);
const card=vm.runInContext(`normalizeCard({name:'Layer test',title:'Engineer',design:{layers:defaultCardLayers({})}})`,context);
card.owner_id='00000000-0000-0000-0000-000000000001';
card.design.layers[1]={...card.design.layers[1],x:12.5,y:22,width:60,height:24,rotation:15,locked:true};
const dir=fs.mkdtempSync(path.join(os.tmpdir(),'spotcode-layer-data-'));
try {
 const source=fs.readFileSync('ios/App/App/SupabaseService.swift','utf8');
 const models=source.slice(source.indexOf('struct BusinessCardLayer:'),source.indexOf('struct CollectedBusinessCard:'));
 const input=path.join(dir,'card.json'); fs.writeFileSync(input,JSON.stringify(card));
 const swift=`import Foundation\n${models}\nlet card = try JSONDecoder().decode(BusinessCard.self, from: Data(contentsOf: URL(fileURLWithPath: CommandLine.arguments[1])))
 precondition(card.design!.layers!.count == 8)
 let name = card.design!.layers!.first { $0.kind == "name" }!
 precondition(name.x == 12.5 && name.y == 22 && name.rotation == 15 && name.locked)
 let roundtrip = try JSONDecoder().decode(BusinessCard.self, from: JSONEncoder().encode(card))
 precondition(roundtrip == card)
 let invalid = BusinessCardLayer(kind:"name", x:999, y:999, width:999, height:-1, rotation:999)
 precondition(invalid.normalized.x == 0 && invalid.normalized.width == 100 && invalid.normalized.height == 5 && invalid.normalized.rotation == 180)
 var design = BusinessCardDesign(); design.layers = [name,name]
 precondition(design.resolved(theme:"midnight", layout:"classic").layers!.count == 1)
 precondition(BusinessCardDesign().resolved(theme:"midnight", layout:"classic").layers == nil)
 print("PASS native/Web layer JSON round-trip, geometry bounds, duplicate filtering, legacy layout")`;
 const file=path.join(dir,'Checks.swift');fs.writeFileSync(file,swift);
 execFileSync('swift',['-module-cache-path',path.join(dir,'cache'),file,input],{stdio:'inherit'});
} finally {fs.rmSync(dir,{recursive:true,force:true});}
const {PGlite}=await import(process.env.PGLITE_MODULE||'@electric-sql/pglite');
const db=new PGlite();
await db.exec("create table business_cards(design jsonb constraint business_cards_design_check check(jsonb_typeof(design)='object' and octet_length(design::text)<=2048));");
await db.exec(fs.readFileSync('docs/migrations/051-business-card-layers.sql','utf8'));
await db.query('insert into business_cards values($1)',[card.design]);
await assert.rejects(db.query('insert into business_cards values($1)',[{layers:'x'.repeat(17000)}]));
await assert.rejects(db.query('insert into business_cards values($1)',[[]]));
await db.close();
console.log('PASS layer persistence schema and bounded JSON');
