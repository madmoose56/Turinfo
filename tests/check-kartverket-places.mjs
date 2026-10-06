import assert from 'node:assert/strict';
import {createKartverketSearch} from '../dist/kartverket-places.js';

const spelling=(name,status='godkjent og prioritert',navnestatus='hovednavn',language='Norsk')=>({skrivemåte:name,skrivemåtestatus:status,navnestatus,språk:language,stedsnavnnummer:1});
const record=(id,name,type='By',coords=[10.75,59.91],municipality='Oslo',number='0301')=>({stedsnummer:id,stedstatus:'aktiv',navneobjekttype:type,
  representasjonspunkt:{koordsys:4326,øst:coords[0],nord:coords[1]},
  kommuner:[{kommunenavn:municipality,kommunenummer:number}],stedsnavn:[spelling(name)]});
const response=rows=>({ok:true,status:200,json:async()=>({metadata:{side:1,treffPerSide:20},navn:rows})});
const localPlace=(id,name,coords,region='Oslo',aliases=[])=>({id,name,region,aliases,population:1500,
  bbox:[coords[0]-.01,coords[1]-.01,coords[0]+.01,coords[1]+.01],
  rings:[[[coords[0]-.01,coords[1]-.01],[coords[0]+.01,coords[1]-.01],[coords[0]+.01,coords[1]+.01],[coords[0]-.01,coords[1]+.01],[coords[0]-.01,coords[1]-.01]]]});
const factory=({priority=[],broad=[],places=[],failure=null}={})=>{
  const requests=[];
  const search=createKartverketSearch({getPlaces:()=>places,fetchImpl:async(raw,options)=>{
    const url=new URL(raw),isPriority=url.searchParams.has('navneobjekttype');requests.push({url,options});
    if(failure?.(isPriority))throw new Error('Endpoint unavailable');
    return response(isPriority?priority:broad);
  }});
  return {search,requests};
};

// Actual /sted response shape; one-letter prefix keeps the query small and local
// prefix filtering chooses the matching alias rather than blindly taking row0.
const arendal=record(667594,'Arendal','By',[8.76695,58.46121],'Arendal','4203');
const ask=record(126555,'Ask','Tettsted',[11.03469,60.07163],'Gjerdrum','3230');
const alias=record(138042,'Sørmoøya','Øy i sjø',[14.56711,67.71811],'Steigen','1848');
alias.stedsnavn.push(spelling('Moøya','godkjent og prioritert','sidenavn'),spelling('Mo gammel','historisk','sidenavn'));
const initial=factory({priority:[arendal,ask],broad:[{...arendal,navneobjekttype:'Gard'},record(3,'Arendal gård','Gard',[8.77,58.46],'Arendal','4203')]});
const first=await initial.search('a');
assert.equal(initial.requests.length,2);
assert.deepEqual(first.map(place=>[place.name,place.priority]),[['Arendal',0],['Ask',0],['Arendal gård',1]]);
assert.deepEqual(first[0].coords,[8.76695,58.46121],'EPSG4326 order is longitude, latitude');
assert.deepEqual(first[0].municipalityIds,['4203']);
assert.equal(first[0].id,'kartverket:667594');assert.equal(first[0].kartverketId,'667594');assert.equal(first[0].source,'kartverket');assert.equal(first[0].kindLabel,'By');
for(const {url,options} of initial.requests){
  assert.equal(url.origin,'https://api.kartverket.no');assert.equal(url.pathname,'/stedsnavn/v1/sted');
  assert.equal(url.searchParams.get('sok'),'a*');assert.equal(url.searchParams.get('side'),'1');
  assert.equal(url.searchParams.get('treffPerSide'),'20');assert.equal(url.searchParams.get('utkoordsys'),'4326');
  assert(url.searchParams.get('filtrer').includes('navn.kommuner'));assert(url.searchParams.get('filtrer').includes('navn.representasjonspunkt'));
  assert.equal(options.credentials,'omit');assert(options.signal instanceof AbortSignal);
}
assert.deepEqual(initial.requests[0].url.searchParams.getAll('navneobjekttype'),['by','tettsted','statistiskTettsted','tettbebyggelse','tettsteddel','grend','bygdelagBygd','bydel','boligfelt','poststed']);
assert.equal(initial.requests[1].url.searchParams.has('navneobjekttype'),false);
const aliases=await factory({broad:[alias]}).search('mo');assert.equal(aliases[0].name,'Moøya');assert.deepEqual(aliases[0].aliases,['Sørmoøya']);

// No foreign/non-current/broken records or variants unrelated to this prefix.
const valid=record(100,'Bergen','By',[5.3251,60.3943],'Bergen','4601');
const broken=[{...valid,stedsnummer:'none'},{...valid,stedsnummer:0},{...valid,stedstatus:'relikt'},
  {...valid,kommuner:null},{...valid,kommuner:'Bergen'},{...valid,kommuner:[{kommunenavn:'Bergen',kommunenummer:'x601'}]},
  {...valid,kommuner:[{kommunenavn:'',kommunenummer:'4601'}]},
  {...valid,kommuner:[{kommunenavn:'Bergen',kommunenummer:4601}]},
  {...valid,representasjonspunkt:{koordsys:4258,øst:5.3251,nord:60.3943}},
  {...valid,representasjonspunkt:{koordsys:4326,øst:'5.3251',nord:60.3943}},
  {...valid,representasjonspunkt:{koordsys:4326,øst:181,nord:60.3943}},
  {...valid,representasjonspunkt:{koordsys:4326,øst:5.3251,nord:Infinity}},
  {...valid,stedsnavn:[spelling('Bergen','historisk')]},{...valid,stedsnavn:[spelling('Bergen','utgått')]},
  {...valid,stedsnavn:[spelling('Bergen','slettet')]},{...valid,stedsnavn:[spelling('Bergen','avslått')]},
  {...valid,stedsnavn:[spelling('Bergen','foreslått')]},{...valid,stedsnavn:[spelling('Oslo')]},
  {...valid,stedsnavn:[spelling('Bergen','')]},
  {...valid,stedsnavn:null}];
assert.deepEqual((await factory({broad:broken}).search('b')),[]);
const multiple=record(101,'Bjørnafjorden','Fjord',[5.5,60]);multiple.kommuner=[{kommunenavn:'Bergen',kommunenummer:'4601'},{kommunenavn:'Bjørnafjorden',kommunenummer:'4624'},{kommunenavn:'Bergen',kommunenummer:'4601'}];
const municipalityResult=(await factory({broad:[multiple]}).search('bj'))[0];
assert.equal(municipalityResult.region,'Bergen, Bjørnafjorden');assert.deepEqual(municipalityResult.municipalityIds,['4601','4624']);

// Prefix matching accepts case/diacritics, but the outbound query preserves them
// and cannot become an all-register wildcard or contain user wildcards.
const norwegian=factory({broad:[record(200,'Ålesund','By',[6.15,62.47],'Ålesund','1508')]});
assert.equal((await norwegian.search('å*?'))[0].name,'Ålesund');assert.equal(norwegian.requests[0].url.searchParams.get('sok'),'å*');
assert.equal((await norwegian.search('Alesund'))[0].name,'Ålesund');
const empty=factory();assert.deepEqual(await empty.search(' *? '),[]);assert.equal(empty.requests.length,0);

// Preserve SSB geometry for a true exact-name/alias AND point-inside match.
// Same names outside the settlement, or combined names, remain distinct places.
const oslo=localPlace('0801','Oslo',[10.75,59.91]);
const mergedSSR=record(307915,'Oslo');mergedSSR.stedsnavn.push(spelling('Oslove','vedtatt','hovednavn','Sørsamisk'));
const statistical=record(901,'Oslo','Statistisk tettsted');
const merged=await factory({priority:[mergedSSR,statistical],places:[oslo]}).search('os');
assert.equal(merged.length,1);assert.equal(merged[0].id,'0801');assert.equal(merged[0].ssbId,'0801');
assert.equal(merged[0].name,'Oslo');assert.equal(merged[0].population,1500);assert.equal(merged[0].bbox,oslo.bbox);assert.equal(merged[0].rings,oslo.rings);assert(merged[0].aliases.includes('Oslove'));
const remoteAlias=record(902,'Aker','Tettsted');remoteAlias.stedsnavn.push(spelling('Oslo','vedtatt','sidenavn'));
assert.equal((await factory({broad:[remoteAlias],places:[oslo]}).search('ak'))[0].ssbId,'0801');
const outside=record(903,'Oslo','Gard',[12,61]);
assert.equal((await factory({broad:[outside],places:[oslo]}).search('os'))[0].id,'kartverket:903');
const sameNameFarm=record(907,'Oslo','Gard'),sameNameIsland=record(908,'Oslo','Øy');
const distinctObjects=await factory({priority:[mergedSSR],broad:[mergedSSR,sameNameFarm,sameNameIsland],places:[oslo]}).search('os');
assert.deepEqual(distinctObjects.map(place=>[place.id,place.priority]),[['0801',0],['kartverket:907',1],['kartverket:908',1]],'non-settlement objects inside a town keep their own identities');
const broadOnly=await factory({broad:[sameNameFarm],places:[oslo],failure:priority=>priority}).search('os');
assert.equal(broadOnly[0].id,'kartverket:907');assert.equal(broadOnly[0].ssbId,undefined,'priority endpoint failure cannot downgrade a local SSB town to a farm');
const sameNameNeighborhood=record(909,'Oslo','Tettbebyggelse'),sameNamePost=record(910,'Oslo','Poststed');
const neighborhoods=await factory({priority:[mergedSSR,sameNameNeighborhood,sameNamePost],places:[oslo]}).search('os');
assert.deepEqual(neighborhoods.map(place=>[place.id,place.priority]),[['0801',0],['kartverket:909',.5],['kartverket:910',.5]],'neighborhoods and post places retain separate SSR identities inside SSB towns');
const kjelsaas=record(920,'Kjelsås','Tettbebyggelse',[10.789,59.962]),kjelsaasFarm=record(921,'Kjelsås','Navnegard',[10.78,59.96]);
const populated=await factory({priority:[kjelsaas],broad:[kjelsaasFarm,kjelsaas]}).search('kjelsås');
assert.deepEqual(populated.map(place=>[place.id,place.priority]),[['kartverket:920',.5],['kartverket:921',1]],'populated Kjelsås comes before the identically named farm');
const joined=localPlace('0022','Fredrikstad/Sarpsborg',[10.94,59.22]);
assert.equal((await factory({priority:[record(904,'Fredrikstad','By',[10.94,59.22],'Fredrikstad','3107')],places:[joined]}).search('fr'))[0].ssbId,undefined);
const boSouth=localPlace('bo-south','Bø',[9.073,59.411],'Midt-Telemark'),boNorth=localPlace('bo-north','Bø',[14.619,68.69],'Bø');
const namesakes=await factory({broad:[record(905,'Bø','Tettsted',[9.073,59.411],'Midt-Telemark','4020'),record(906,'Bø','Tettsted',[14.619,68.69],'Bø','1867')],places:[boSouth,boNorth]}).search('bø');
assert.deepEqual(new Set(namesakes.map(place=>place.id)),new Set(['bo-south','bo-north']));

// The two endpoints start together, partial results survive an endpoint error,
// and errors/abort/timeout never silently look like a successful empty search.
let releases=[],parallelStarts=0;
const parallel=createKartverketSearch({fetchImpl:async()=>{parallelStarts++;await new Promise(resolve=>releases.push(resolve));return response([valid]);}});
const pending=parallel('b');assert.equal(parallelStarts,2);releases.forEach(resolve=>resolve());assert.equal((await pending).length,1);
assert.equal((await factory({priority:[valid],failure:priority=>!priority}).search('b')).length,1);
assert.equal((await factory({broad:[valid],failure:priority=>priority}).search('b')).length,1);
await assert.rejects(factory({failure:()=>true}).search('b'),/Endpoint unavailable/);
await assert.rejects(createKartverketSearch({fetchImpl:async()=>({ok:false,status:503})})('b'),/503/);
await assert.rejects(createKartverketSearch({fetchImpl:async()=>({ok:true,json:async()=>({})})})('b'),/uten stedsnavn/);
assert.equal((await createKartverketSearch({getPlaces:()=>{throw new Error('Local unavailable');},fetchImpl:async()=>response([valid])})('b')).length,1);
const stopped=new AbortController();stopped.abort();const noFetch=factory();await assert.rejects(noFetch.search('b',{signal:stopped.signal}),{name:'AbortError'});assert.equal(noFetch.requests.length,0);
let aborts=0;
const heldFetch=(url,{signal})=>new Promise((resolve,reject)=>{signal.addEventListener('abort',()=>{aborts++;reject(signal.reason);},{once:true});});
const caller=new AbortController(),abortPending=createKartverketSearch({fetchImpl:heldFetch})('b',{signal:caller.signal});caller.abort();
await assert.rejects(abortPending,{name:'AbortError'});assert.equal(aborts,2,'caller abort cancels both pending endpoints');
aborts=0;await assert.rejects(createKartverketSearch({fetchImpl:heldFetch,timeoutMs:15})('b'),{name:'TimeoutError'});assert.equal(aborts,2,'timeout cancels both pending endpoints');
const finishedSignals=[],finishedCaller=new AbortController();
await createKartverketSearch({timeoutMs:15,fetchImpl:async(url,{signal})=>{finishedSignals.push(signal);return response([valid]);}})('b',{signal:finishedCaller.signal});
finishedCaller.abort();await new Promise(resolve=>setTimeout(resolve,25));
assert(finishedSignals.every(signal=>!signal.aborted),'successful calls remove the caller listener and clear the timeout');

console.log('PASS: limited live Kartverket prefix requests, matching current Norwegian variants, towns-first deduplication, exact SSB geometry merges, namesakes, partial errors and abort/timeout handling.');
