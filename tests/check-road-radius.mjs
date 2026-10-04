import assert from 'node:assert/strict';
import fs from 'node:fs';
import {extractPlaces,routeQuery} from '../dist/poi.js';
const route=[[10,60],[10.1,60]],rad=Math.PI/180;
const elements=[299.9,300,300.1,450].flatMap((meters,i)=>['hotel','fuel'].map((kind,j)=>({
 type:'node',id:i*2+j,lon:10.05,lat:60+meters/(6371000*rad),
 tags:{...(kind==='hotel'?{tourism:'hotel'}:{amenity:'fuel'}),name:kind+' '+meters}
})));
const result=extractPlaces(elements,route,300,['hotel','fuel']);
assert.equal(result.length,4);
assert(result.every(p=>p.name.endsWith('299.9')||p.name.endsWith('300')));
assert(!result.some(p=>p.name.endsWith('300.1')||p.name.endsWith('450')));
assert(routeQuery(route,300,['hotel','fuel']).includes('around:450,'));
const html=fs.readFileSync('dist/index.html','utf8');
assert(html.includes('name="radius-choice" value="0.3" checked'));assert(html.includes('<span>Ved vei</span>'));
assert(html.includes('maks 300 meter i luftlinje fra den valgte kjøreruten'));
const app=fs.readFileSync('dist/app.js','utf8');
assert(app.includes("radius*1000,types)"));assert(app.includes("radiusText(data.radius)"));
assert(app.includes('#search select'));assert(app.includes("$('radius')?.addEventListener('change'"));
console.log('PASS: hotel and fuel at 299.9m and 300m included; 300.1m and 450m excluded; first/default option Ved vei; route filter receives 300m; original full polyline used after widened Overpass query.');
