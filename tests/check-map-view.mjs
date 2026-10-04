import assert from 'node:assert/strict';
import {fixedMapView,routeAhead,headingTarget} from '../dist/map-view.js';
import {haversine} from '../dist/geo.js';

const R=6378137,RAD=Math.PI/180;
const project=([lon,lat])=>[R*lon*RAD,R*Math.log(Math.tan(Math.PI/4+lat*RAD/2))];
const unproject=([x,y])=>[x/R/RAD,Math.atan(Math.sinh(y/R))/RAD];
function inspect(anchor,target,pixels,edge){
  const view=fixedMapView(anchor,target,pixels),centre=project(view.center),scale=256*2**view.zoom/(2*Math.PI*R),half=pixels/(2*scale);
  assert.equal(view.edge,edge);
  const spanNS=haversine(unproject([centre[0],centre[1]-half]),unproject([centre[0],centre[1]+half]));
  const spanEW=haversine(unproject([centre[0]-half,centre[1]]),unproject([centre[0]+half,centre[1]]));
  assert(Math.abs(spanNS-20000)<.001,`north/south span ${spanNS}`);
  assert(Math.abs(spanEW-20000)<20,`east/west span ${spanEW}`);
  const p=project(anchor),screen=[pixels/2+(p[0]-centre[0])*scale,pixels/2-(p[1]-centre[1])*scale];
  const expected=edge==='top'?[pixels/2,18]:edge==='bottom'?[pixels/2,pixels-18]:edge==='left'?[18,pixels/2]:edge==='right'?[pixels-18,pixels/2]:[pixels/2,pixels/2];
  screen.forEach((value,i)=>assert(Math.abs(value-expected[i])<1e-6,`${edge} GPS pixel ${value} != ${expected[i]}`));
  return view;
}
for(const anchor of [[10.75,59.91],[18.96,69.65],[15.65,78]])for(const pixels of [190,600]){
  for(const [heading,edge] of [[0,'bottom'],[90,'left'],[180,'top'],[270,'right']])inspect(anchor,headingTarget(anchor,heading),pixels,edge);
  for(const target of [null,undefined,[...anchor]])inspect(anchor,target,pixels,null);
}
const origin=[10.75,59.91],small=fixedMapView(origin,null,190),large=fixedMapView(origin,null,600);
assert(Math.abs((large.zoom-small.zoom)-Math.log2(600/190))<1e-10);
const target=headingTarget(origin,0);
assert(target[1]>origin[1]);assert(Math.abs(target[0]-origin[0])<1e-9);
assert(Math.abs(haversine(origin,target)-5000)<1e-6);
for(const invalid of [[NaN,60],[60,100],[181,60],[10,85]])assert.throws(()=>fixedMapView(invalid,null,600),RangeError);
for(const invalid of [0,36,NaN,Infinity])assert.throws(()=>fixedMapView(origin,null,invalid),RangeError);
assert.throws(()=>headingTarget(origin,null),RangeError);
assert.throws(()=>headingTarget(origin,NaN),RangeError);
assert.throws(()=>headingTarget(origin,0,-1),RangeError);

// At the end of an eastbound leg, the local route goes south even though the
// overall origin-to-destination vector goes north: use the next route segment.
const turn=[10.75,60],east=headingTarget(turn,90,10000),south=headingTarget(east,180,10000),north=headingTarget(south,0,30000);
const route=[turn,east,south,north],copy=JSON.stringify(route),onRoute=headingTarget(east,270,1000);
const ahead=routeAhead(route,onRoute,5000);
assert(ahead[1]<east[1]);assert(haversine(ahead,south)>5000);
assert.equal(fixedMapView(onRoute,ahead,600).edge,'top');
assert.equal(JSON.stringify(route),copy,'Route coordinates must remain unchanged');
const last=routeAhead(route,north,5000);assert.deepEqual(last,north);assert.notEqual(last,north);
assert.deepEqual(routeAhead([turn],east),turn);
const zero=routeAhead([turn,turn,east],turn,0);assert(haversine(turn,zero)<1e-6);
assert.throws(()=>routeAhead([],origin),RangeError);
assert.throws(()=>routeAhead(route,origin,-1),RangeError);
console.log('PASS: north-up 20 km × 20 km at Oslo, Tromsø and 78°N; four GPS edges with 18px inset; fractional responsive zoom; centred focus view; route lookahead follows local bends without mutating coordinates; invalid inputs rejected.');
