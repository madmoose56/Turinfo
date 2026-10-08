import assert from 'node:assert/strict';
import fs from 'node:fs';
import {extractPlaces,routeQuery,routeQueries} from '../dist/poi.js';
const route=[[10,60],[10.1,60]],rad=Math.PI/180;
const elements=[299.9,300,300.1,450].flatMap((meters,i)=>['hotel','fuel'].map((kind,j)=>({
 type:'node',id:i*2+j,lon:10.05,lat:60+meters/(6371000*rad),
 tags:{...(kind==='hotel'?{tourism:'hotel'}:{amenity:'fuel'}),name:kind+' '+meters}
})));
const result=extractPlaces(elements,route,300,['hotel','fuel']);
assert.equal(result.length,4);
assert(result.every(p=>p.name.endsWith('299.9')||p.name.endsWith('300')));
assert(!result.some(p=>p.name.endsWith('300.1')||p.name.endsWith('450')));
const query=routeQuery(route,300,['hotel','fuel']);
const box=query.match(/\((-?\d+\.\d+),(-?\d+\.\d+),(-?\d+\.\d+),(-?\d+\.\d+)\)/).slice(1).map(Number);
assert(box[0]<60&&box[1]<10&&box[2]>60&&box[3]>10.1);
assert(!query.includes('around:'));
assert(query.includes('"amenity"="fuel"'));
assert.equal(extractPlaces([{type:'node',id:900,lon:10.05,lat:60.003,tags:{amenity:'fuel',name:'Outside corridor'}}],route,300,['fuel']).length,0);
const html=fs.readFileSync('dist/index.html','utf8');
assert(html.includes('name="radius-choice" value="0.3" checked'));assert(html.includes('<span>Ved vei</span>'));
assert(html.includes('maks 300 meter i luftlinje fra den valgte kjøreruten'));
const app=fs.readFileSync('dist/app.js','utf8');
assert(app.includes("nearQuery(location.coords,3000,types)"));assert(app.includes("radiusText(data.radius)"));
assert(app.includes('#search select'));assert(app.includes("$('radius')?.addEventListener('change'"));
console.log('PASS: bounding box encloses route; off-route box candidates excluded; exact 300m boundary and original route preserved.');

const sparse=[[10,60],[10.6,60],[10.6,60.25]];
const chunks=routeQueries(sparse,1000,['fuel','charging']);
assert(chunks.length>=6);
const bounds=chunks.map(q=>q.match(/\((-?\d+\.\d+),(-?\d+\.\d+),(-?\d+\.\d+),(-?\d+\.\d+)\)/).slice(1).map(Number));
for(const [i,b] of bounds.entries()){
 assert(b[2]-b[0]<.12);assert(b[3]-b[1]<.23);
 assert(chunks[i].includes('"amenity"="fuel"'));assert(chunks[i].includes('"amenity"="charging_station"'));
}
for(const [lon,lat] of sparse)assert(bounds.some(b=>lat>=b[0]&&lat<=b[2]&&lon>=b[1]&&lon<=b[3]));
console.log('PASS: sparse route split into bounded 10 km requests covering endpoints and bend, with both station types.');
