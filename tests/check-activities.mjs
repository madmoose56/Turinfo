import assert from 'node:assert/strict';
import {routeQuery,nearQuery,extractPlaces,selectedTypes,activityLabel} from '../dist/poi.js';
const route=[[10,60],[10.1,60]], origin=[10.05,60];
const tags=[{tourism:'museum'},{tourism:'attraction'},{tourism:'viewpoint'},{leisure:'bathing_place'},{natural:'beach'},{highway:'trailhead'},{leisure:'nature_reserve'}];
const elements=tags.map((tag,i)=>({type:'node',id:i,lon:10.05,lat:60,tags:{...tag,name:'Activity '+i}}));
for(const [i,access] of ['no','private'].entries())elements.push({type:'node',id:20+i,lon:10.05,lat:60,tags:{tourism:'museum',name:access,access}});
for(const [i,m] of [299.9,300,300.1].entries())elements.push({type:'node',id:30+i,lon:10.05,lat:60+m/(6371000*Math.PI/180),tags:{tourism:'viewpoint',name:'Boundary '+m}});
const results=extractPlaces(elements,route,300,['activity']);assert.equal(results.length,9);assert(!results.some(p=>p.name==='Boundary 300.1'));assert(results.every(p=>p.kind==='activity'));
const nearby=extractPlaces(elements,origin,1000,['activity'],true);assert.equal(nearby.length,10);assert(nearby.every((p,i)=>!i||p.distance>=nearby[i-1].distance));
assert.deepEqual(selectedTypes('hotel,activity'),['hotel','activity']);assert.equal(activityLabel({highway:'trailhead'}),'Turstart');
for(const query of [routeQuery(route,300,['activity']),nearQuery(origin,10000,['activity'])]){assert(query.includes('museum'));assert(query.includes('bathing_place'));assert(query.includes('trailhead'));assert(!query.includes('"tourism"="hotel"'));assert(query.includes('private|no'));}
console.log('PASS activities: supported kinds, private exclusion, route 300m boundary, GPS sort, and mixed selection.');
const four=[{tourism:'zoo'},{leisure:'sports_centre'},{tourism:'museum'},{amenity:'restaurant'}].map((tags,i)=>({type:'node',id:200+i,lon:10.05,lat:60,tags:{...tags,name:'Category '+i}}));
for(const [i,type] of ['family','outdoor','culture','food'].entries()){
 const found=extractPlaces(four,route,300,[type]);assert.deepEqual(found.map(p=>p.name),['Category '+i]);
 const query=nearQuery(origin,10000,[type]);assert(query.includes(i===0?'zoo':i===1?'sports_centre':i===2?'museum':'restaurant'));assert(!query.includes(i===3?'museum':'restaurant'));
}
assert.equal(extractPlaces(four,origin,10000,['family','food'],true).length,2);
assert.equal(extractPlaces([...four,{...four[3],id:999,tags:{amenity:'restaurant',access:'private'}}],origin,10000,['food'],true).length,1);
console.log('PASS all four activity filters, mixed selection and private food exclusion.');
