import assert from 'node:assert/strict';
import fs from 'node:fs';
import {settlementPoint} from '../dist/settlement-point.js';
import {inRing,inSettlement,segmentDistance} from '../dist/geo.js';

const place=rings=>({rings,bbox:[Math.min(...rings.flat().map(p=>p[0])),Math.min(...rings.flat().map(p=>p[1])),Math.max(...rings.flat().map(p=>p[0])),Math.max(...rings.flat().map(p=>p[1]))]});
const square=[[10,60],[10.04,60],[10.04,60.04],[10,60.04],[10,60]];
const convex=place([square]);
assert.deepEqual(settlementPoint(convex),[10.02,60.019999999999996]);
assert.deepEqual(settlementPoint(place([[...square].reverse()])),settlementPoint(convex));
// Both the centroid and the bounding-box centre of this U fall in its opening.
const u=[[10,60],[10.06,60],[10.06,60.06],[10.04,60.06],[10.04,60.02],[10.02,60.02],[10.02,60.06],[10,60.06],[10,60]];
const concave=place([u]),concavePoint=settlementPoint(concave);
assert(!inRing([10.03,60.03],u));
assert(concavePoint&&inRing(concavePoint,u));
assert.deepEqual(settlementPoint(concave),concavePoint,'fallback must be deterministic');
// Small detached component appears first; location must prefer the larger ring.
const small=[[11,61],[11.001,61],[11.001,61.001],[11,61.001],[11,61]];
const multi=place([small,u]);
assert(inRing(settlementPoint(multi),u));
assert(!inRing(settlementPoint(multi),small));
assert.deepEqual(settlementPoint(place([u,small])),settlementPoint(multi));
assert.deepEqual(settlementPoint(place([square.slice(0,-1)])),settlementPoint(convex),'unclosed outer ring is supported');

for(const invalid of [null,{}, {bbox:[10,60,10,60],rings:[square]},
  {bbox:[10,60,11,61],rings:[]}, {bbox:[10,60,11,Infinity],rings:[square]},
  {bbox:[10,60,11,61],rings:[[[10,60],[10.1,60.1],[NaN,60.2]]]},
  {bbox:[10,60,11,61],rings:[[[10,60],[10.1,60.1],[10.2,60.2]]]},
  {bbox:[12,62,13,63],rings:[square]}])assert.equal(settlementPoint(invalid),null);

const places=JSON.parse(fs.readFileSync(new URL('../dist/places.json',import.meta.url),'utf8')).places;
assert.equal(places.length,1000);
for(const settlement of places){
  const point=settlementPoint(settlement);
  assert(point,`${settlement.id} ${settlement.name}: no representative point`);
  assert(point.every(Number.isFinite));
  assert(point[0]>=4&&point[0]<=32&&point[1]>=57&&point[1]<=72,`${settlement.name}: outside Norway`);
  assert(inSettlement(point,settlement),`${settlement.name}: outside settlement`);
  const insideRings=settlement.rings.filter(ring=>inRing(point,ring));
  assert(insideRings.length,`${settlement.name}: outside all rings`);
  const nearestBoundary=Math.min(...insideRings.flatMap(ring=>ring.map((p,i)=>segmentDistance(point,p,ring[(i+1)%ring.length]).distance)));
  assert(nearestBoundary>0.1,`${settlement.name}: representative point is on polygon boundary`);
  assert.deepEqual(settlementPoint(settlement),point,`${settlement.name}: nondeterministic`);
}
console.log('PASS: deterministic strictly interior fallback for all 1000 SSB settlements, concave rings, largest components and invalid geometry.');
