import fs from 'node:fs';
import path from 'node:path';
import vm from 'node:vm';
import assert from 'node:assert/strict';
const root='dist/';
class Node {
 constructor(){this.children=[];this.handlers={};this.value='';this.textContent='';this.classList={add(){},toggle(){}};}
 append(...items){this.children.push(...items)} replaceChildren(...items){this.children=items}
 addEventListener(type,fn){this.handlers[type]=fn} setAttribute(){} insertBefore(){}
}
async function checkPage(near,userAgent='Android'){
 const html=fs.readFileSync(root+(near?'nearby.html':'index.html'),'utf8');
 const ids=Object.fromEntries([...html.matchAll(/id="([^"]+)"/g)].map(m=>[m[1],new Node()]));
 const choices=[...html.matchAll(/<input[^>]*name="([^"]+)"[^>]*value="([^"]+)"[^>]*>/g)].map(m=>Object.assign(new Node(),{name:m[1],value:m[2],checked:m[0].includes('checked')}));
 const documentHandlers={};
 assert.equal(Boolean(ids.search),!near);assert.equal(Boolean(ids.locate),near);
 assert(html.includes(near?'href="./">Rutesøk':'href="./nearby.html">Nær meg'));
 ids.types.value='hotel';
 if(near)assert(!html.includes('near-radius'));else{ids.from.value='Oslo';ids.to.value='Moss';ids.radius.value='0.3';}
 let gps=0,requests=0,reads=0,writes=0,deny=false,many=false,registryFailure='',otherRegistryRequests=0;
 const registryEndpoints=[];
 const searchRadii=[];
 const coords=[[10.7389701,59.9133301],[10.6619753,59.4347974]];
 const area=new Node(),caption=new Node();caption.firstChild=new Node();
 const context=vm.createContext({console,URL,URLSearchParams,AbortController,setTimeout,clearTimeout,Date,Intl,Promise,
 document:{addEventListener:(type,fn)=>documentHandlers[type]=fn,body:{dataset:{page:near?'nearby':'route'}},getElementById:id=>ids[id]??null,createElement:()=>new Node(),querySelector:s=>s==='.map-area'?area:s==='.map-caption'?caption:s.startsWith('input[name=')?choices.find(i=>s.includes('"'+i.name+'"')&&s.includes('"'+i.value+'"')):new Node(),querySelectorAll:s=>s.startsWith('input[name=')?choices.filter(i=>s.includes('"'+i.name+'"')):Object.values(ids)},
 window:{addEventListener(){}},navigator:{userAgent,onLine:true,geolocation:{getCurrentPosition(ok,fail){gps++;deny?fail({code:1}):ok({coords:{longitude:coords[0][0],latitude:coords[0][1],accuracy:10}})}}},
 localStorage:{getItem(){reads++;return null},setItem(){writes++}},sessionStorage:{getItem:()=>null,setItem(){}},matchMedia:()=>({matches:false,addEventListener(){}}),innerWidth:1200,
 fetch:async(url,options)=>{
  requests++;let data;
  if(url==='./hotels.json')data={updatedAt:'2026-10-04T22:17:05Z',elements:[{type:'node',id:999,lon:coords[near?0:1][0],lat:coords[near?0:1][1],tags:{tourism:'hotel',name:'Reservehotell'}}]};
  else if(url==='./places.json')data=JSON.parse(fs.readFileSync(root+'places.json'));
  else if(String(url).includes('photon')){const name=new URL(url).searchParams.get('q');data={features:[{properties:{name,countrycode:'NO',osm_value:'city'},geometry:{coordinates:name==='Oslo'?coords[0]:coords[1]}}]};}
  else if(String(url).includes('osrm'))data={code:'Ok',routes:[{distance:60000,duration:3600,geometry:{coordinates:coords}}]};
  else if(String(url).includes('overpass')){
   registryEndpoints.push(url);
   const query=options.body.get('data');
   if(registryFailure==='rest-partial'&&(query.includes('["tourism"="hotel"]')||++otherRegistryRequests>1))throw new TypeError('Network unavailable');
   if(registryFailure==='all'||(registryFailure==='hotel'&&query.includes('["tourism"="hotel"]'))||(registryFailure==='two'&&registryEndpoints.length<=2)||(registryFailure==='network'&&registryEndpoints.length===1))throw new TypeError('Network unavailable');
   if(registryEndpoints.length===1&&registryFailure==='partial')return {ok:true,json:async()=>({remark:'runtime timeout',elements:[]})};
   if(registryEndpoints.length===1&&registryFailure==='invalid')return {ok:true,json:async()=>({})};
   const around=query.match(/around:(\d+)/);if(around)searchRadii.push(Number(around[1]));data={elements:[
   ...(query.includes('"tourism"')?[{type:'node',id:1,lon:coords[0][0],lat:coords[0][1],tags:{tourism:'hotel',name:'Start-hotell'}}]:[]),
   ...(query.includes('"fuel"')?[{type:'node',id:2,lon:coords[0][0],lat:coords[0][1],tags:{amenity:'fuel',name:'Start-stasjon'}}]:[]),
   ...(query.includes('"charging_station"')?[{type:'node',id:3,lon:coords[0][0],lat:coords[0][1],tags:{amenity:'charging_station',name:'Start-lader',operator:'Recharge','socket:type2_combo':'2','socket:type2_combo:output':'150 kW'}}]:[]),
   ...(query.includes('museum')?[{type:'node',id:4,lon:coords[0][0],lat:coords[0][1],tags:{tourism:'museum',name:'Start-museum',opening_hours:'24/7',website:'example.org'}}]:[])]};
   if(many)data.elements=Array.from({length:15},(_,i)=>({type:'node',id:100+i,lon:coords[0][0],lat:coords[0][1]+(15-i)*.002,tags:{tourism:'hotel',name:'Test '+(15-i)}}));
  }
  else throw Error('Unexpected request');return {ok:true,json:async()=>data};
 }});
 const modules=new Map();
 async function load(filename){const full=path.resolve(filename);if(modules.has(full))return modules.get(full);const m=new vm.SourceTextModule(fs.readFileSync(full,'utf8'),{context,identifier:full});modules.set(full,m);await m.link(spec=>load(path.join(path.dirname(full),spec.split('?')[0])));return m;}
 const app=await load(root+'app.js');await app.evaluate();
 for(let i=0;i<20&&!near&&writes===0;i++)await new Promise(r=>setTimeout(r,0));
 assert.equal(gps,0);
 if(near){
  assert.equal(requests,0);assert.equal(reads,0);assert.equal(writes,0);
  deny=true;await ids.locate.handlers.click();assert(ids.status.textContent.includes('avslått'));
  deny=false;ids.types.value='both';ids.types.handlers.change();await ids.locate.handlers.click();
  assert.equal(ids.count.textContent,'2');assert.equal(ids.summary.children[0].textContent,'Hoteller og bensinstasjoner nær deg');assert.equal(writes,0);
  ids.types.value='charging';ids.types.handlers.change();await ids.locate.handlers.click();
  assert.equal(ids.count.textContent,'1');assert.equal(ids['charging-legend'].hidden,false);assert(ids['results-title'].textContent.includes('Ladestasjoner'));
  assert(ids.results.children[0].children[1].children.some(n=>n.textContent.includes('CCS (150 kW)')));
  ids.types.value='all';ids.types.handlers.change();await ids.locate.handlers.click();assert.equal(ids.count.textContent,'3');assert.equal(writes,0);
 }else{
  assert.equal(writes,1);assert.equal(ids.count.textContent,'0');assert.equal(ids['category-counts'].textContent,'Hoteller: 0');
  ids.types.value='both';ids.types.handlers.change();await ids.search.handlers.submit({preventDefault(){}});
  assert.equal(ids.count.textContent,'1');assert.equal(ids.results.children[0].children[1].children[0].textContent,'Start-stasjon');assert(ids.status.textContent.includes('300 m'));assert.equal(gps,0);
  ids.types.value='charging';ids.types.handlers.change();await ids.search.handlers.submit({preventDefault(){}});assert.equal(ids.count.textContent,'1');assert.equal(ids.results.children[0].children[1].children[0].textContent,'Start-lader');assert.equal(ids['charging-legend'].hidden,false);
  ids.types.value='all';ids.types.handlers.change();await ids.search.handlers.submit({preventDefault(){}});assert.equal(ids.count.textContent,'2');assert.equal(ids['category-counts'].textContent,'Hoteller: 0 · Bensin: 1 · Elbil-lading: 1');assert.equal(gps,0);
 }
 for(const values of [['hotel','charging'],['fuel','charging'],['culture'],['hotel','fuel','charging','culture'],[]]){
  const inputs=choices.filter(i=>i.name==='poi-type');inputs.forEach(i=>i.checked=values.includes(i.value));documentHandlers.change({target:inputs[0]});
  assert.equal(ids.types.value,values.join(','));const before=requests;
  if(near)await ids.locate.handlers.click();else await ids.search.handlers.submit({preventDefault(){}});
  if(!values.length){assert.equal(requests,before);assert(ids.status.textContent.includes('Velg minst én'));}else assert.equal(ids.count.textContent,String(values.length-(near?0:values.includes('hotel')?1:0)));
 }
 if(near){
  many=true;ids.types.value='hotel';ids.types.handlers.change();const before=requests;await ids.locate.handlers.click();
  assert.equal(requests-before,1);assert.equal(searchRadii.at(-1),10000);assert.equal(ids.count.textContent,'10');assert.equal(ids.results.children.length,10);
  assert.deepEqual(ids.results.children.map(card=>card.children[1].children[0].textContent),Array.from({length:10},(_,i)=>'Test '+(i+1)));
  assert.equal(writes,0);assert(searchRadii.includes(25000));assert(searchRadii.includes(50000));
 }
 for(const card of ids.results.children){
  const a=card.children[1].children.find(n=>n.className==='hotel-links').children[0];assert.equal(a.textContent,'Naviger hit');
  const u=new URL(a.href);assert.equal(u.searchParams.has('origin'),false);assert.equal(u.searchParams.has('saddr'),false);
  if(userAgent.includes('iPhone')){assert.equal(u.hostname,'maps.apple.com');assert.equal(u.searchParams.get('dirflg'),'d');assert(u.searchParams.get('daddr'));}
  else{assert.equal(u.hostname,'www.google.com');assert.equal(u.searchParams.get('dir_action'),'navigate');assert.equal(u.searchParams.get('travelmode'),'driving');assert(u.searchParams.get('destination'));}
 }
 ids.types.value='charging';
 const runSearch=()=>near?ids.locate.handlers.click():ids.search.handlers.submit({preventDefault(){}});
 for(const failure of ['network','partial','invalid','two']){
  registryFailure=failure;registryEndpoints.length=0;await runSearch();
  const attempts=failure==='two'?3:2;
  const attempted=registryEndpoints.slice(0,attempts);assert.equal(new Set(attempted).size,attempts);
  assert(attempted.every(url=>['https://overpass.openstreetmap.fr/api/interpreter','https://overpass.private.coffee/api/interpreter','https://overpass-api.de/api/interpreter'].includes(url)));
  if(!near)assert(registryEndpoints.slice(attempts).every(url=>url===attempted.at(-1)));
  assert(!ids.status.textContent.includes('Ingen av kartregisterets'));
 }
 registryFailure='all';const previousCount=ids.count.textContent;await runSearch();
 assert(ids.status.textContent.includes('Ingen av kartregisterets servere'));
 assert(ids.status.textContent.includes('Viser fortsatt forrige'));
 assert.equal(ids.count.textContent,previousCount);assert.equal(ids[near?'locate':'submit'].disabled,false);assert(ids['category-counts'].textContent.includes('ikke fullført'));
 many=false;
 {ids.types.value='hotel';await runSearch();assert.equal(ids.count.textContent,'1');assert(ids.status.textContent.includes('Viser hotelloversikten fra'));assert(ids['category-counts'].textContent.includes('Hoteller: 1'));assert(ids['category-counts'].textContent.includes('Hotellopplysninger fra'));assert.equal(ids['category-counts'].hidden,false);}
 {
  const beforeWrites=writes;
  ids.types.value='all';ids.types.handlers.change();await runSearch();
  assert.equal(ids.count.textContent,'1');assert.equal(ids.results.children.length,1);
  assert.equal(ids.results.children[0].children[1].children[0].textContent,'Reservehotell');
  assert(ids['category-counts'].textContent.includes('Hoteller: 1'));
  assert(ids['category-counts'].textContent.includes('Bensin: utilgjengelig'));
  assert(ids['category-counts'].textContent.includes('Elbil-lading: utilgjengelig'));
  assert(ids.status.textContent.includes('Søket er delvis'));
  assert(ids.status.textContent.includes('Viser hotelloversikten fra'));
  assert.equal(ids['category-counts'].hidden,false);
  assert.equal(writes,beforeWrites,'A partial hotel-reserve search must preserve the last complete saved search');
 }
 {
  registryFailure='hotel';registryEndpoints.length=0;const beforeWrites=writes;
  await runSearch();
  assert.equal(ids.count.textContent,'3');
  assert(ids['category-counts'].textContent.includes('Hoteller: 1'));
  assert(ids['category-counts'].textContent.includes('Bensin: 1'));
  assert(ids['category-counts'].textContent.includes('Elbil-lading: 1'));
  assert(!ids['category-counts'].textContent.includes('utilgjengelig'));
  assert(ids.status.textContent.includes('Viser hotelloversikten fra'));
  assert(!ids.status.textContent.includes('Søket er delvis'));
  assert.equal(writes,beforeWrites+(near?0:1),'Complete reserve-plus-live route results may be saved; GPS results stay private');
 }
 {
  registryFailure='rest-partial';otherRegistryRequests=0;const beforeWrites=writes;
  await runSearch();
  assert(otherRegistryRequests>1,'Exercise a successful live response followed by failure in a later route piece or larger GPS radius');
  assert.equal(ids.count.textContent,'1');assert.equal(ids.results.children.length,1);
  assert.equal(ids.results.children[0].children[1].children[0].textContent,'Reservehotell');
  assert(ids['category-counts'].textContent.includes('Bensin: utilgjengelig'));
  assert(ids['category-counts'].textContent.includes('Elbil-lading: utilgjengelig'));
  assert(ids.status.textContent.includes('Søket er delvis'));
  assert.equal(writes,beforeWrites,'Incomplete live category responses must not be merged into the hotel reserve or saved');
 }
}
await checkPage(false);await checkPage(true);await checkPage(false,'iPhone');await checkPage(true,'iPhone');
const handlers={},matched=[],assets=[];
const sw=vm.createContext({URL,fetch:async()=>{throw Error('offline')},self:{registration:{scope:'https://example.test/'},location:{origin:'https://example.test'},addEventListener:(type,fn)=>handlers[type]=fn,skipWaiting(){}},caches:{open:async()=>({addAll:async items=>assets.push(...items)}),match:async key=>{matched.push(key);return key}}});
vm.runInContext(fs.readFileSync(root+'sw.js','utf8'),sw);
let install;handlers.install({waitUntil:p=>install=p});await install;assert(assets.includes('./nearby.html'));
for(const [url,expected] of [['https://example.test/nearby.html','./nearby.html'],['https://example.test/','./index.html']]){
 let response;handlers.fetch({request:{method:'GET',mode:'navigate',url},respondWith:p=>response=p});assert.equal(await response,expected);
}
console.log('PASS: route home has no nearby controls; nearby page has no route controls; mutual navigation; no GPS or route/cache access on nearby opening; permission error and combined GPS results; main route filter and Ved vei preserved; correct offline fallback; mixed hotel reserve searches show unavailable categories without overwriting complete route cache, and recover when other categories respond.');
