import fs from 'node:fs';
import path from 'node:path';
import vm from 'node:vm';
import assert from 'node:assert/strict';

// Exercise the real form change and submit handlers. The fixtures distinguish
// device coordinates from the previous typed city, so a geolocation result
// that is fetched but not used as the route origin cannot pass these checks.
const root=path.resolve('dist');
const oslo=[10.75,59.90],moss=[10.66,59.43],outside=[10.812345,59.712345];
const point=coords=>({coords:{longitude:coords[0],latitude:coords[1],accuracy:9,heading:180}});
const rectangle=(name,bbox)=>({name,population:1000,bbox,rings:[[[bbox[0],bbox[1]],[bbox[2],bbox[1]],[bbox[2],bbox[3]],[bbox[0],bbox[3]],[bbox[0],bbox[1]]]]});
const places=[rectangle('Oslo',[10.70,59.85,10.80,59.95]),rectangle('Moss',[10.60,59.40,10.70,59.50])];
class Node {
  constructor(){this.children=[];this.handlers={};this.value='';this.textContent='';this.hidden=false;this.disabled=false;this.required=false;this.classList={add(){},remove(){},toggle(){}};this.style={};this.dataset={};}
  append(...items){this.children.push(...items);} replaceChildren(...items){this.children=items;}
  addEventListener(type,fn){this.handlers[type]=fn;} setAttribute(name,value){this[name]=value;}
  removeAttribute(name){delete this[name];} insertBefore(){} focus(){} scrollIntoView(){}
  showModal(){this.open=true;} close(){this.open=false;this.handlers.close?.();}
}
const tick=()=>new Promise(resolve=>setTimeout(resolve,0));
async function harness({stored=null}={}){
  const html=fs.readFileSync(path.join(root,'index.html'),'utf8');
  assert(!html.includes('class="page-nav"'),'The main page has one route form without the former nearby tab');
  const ids=Object.fromEntries([...html.matchAll(/id="([^"]+)"/g)].map(m=>[m[1],new Node()]));
  for(const match of html.matchAll(/<input\b[^>]*id="([^"]+)"[^>]*>/g)){
    const node=ids[match[1]];node.value=match[0].match(/value="([^"]*)"/)?.[1]??'';node.required=/\brequired\b/.test(match[0]);
  }
  const choices=[...html.matchAll(/<input[^>]*name="([^"]+)"[^>]*value="([^"]+)"[^>]*>/g)].map(m=>Object.assign(new Node(),{name:m[1],value:m[2],checked:m[0].includes('checked')}));
  assert(ids['from-mode']&&ids['from-place']&&ids['from-gps-note'],'Both origin choices have dedicated form state');
  assert.deepEqual(choices.filter(n=>n.name==='from-mode-choice').map(n=>n.value),['place','gps']);
  assert(html.includes('Fra der jeg er'));
  const documentHandlers={},writes=[],sessionWrites=[],requests=[],area=new Node(),overview=new Node(),caption=new Node();caption.firstChild=new Node();
  let gpsCalls=0,gpsResult=point(outside),gpsError=null,holdGps=false,pendingGps,osrmFailure=false,lastRouteOrigin;
  const context=vm.createContext({console,URL,URLSearchParams,AbortController,setTimeout,clearTimeout,Date,Intl,Promise,
    document:{body:{dataset:{page:'route'},classList:{add(){},remove(){}}},
      addEventListener:(type,fn)=>documentHandlers[type]=fn,getElementById:id=>ids[id]??null,createElement:()=>new Node(),
      querySelector:s=>s==='.map-area'?area:s==='.overview'?overview:s==='.map-caption'?caption:s.startsWith('input[name=')?choices.find(n=>s.includes('"'+n.name+'"')&&s.includes('"'+n.value+'"')):new Node(),
      querySelectorAll:s=>s.startsWith('input[name=')?choices.filter(n=>s.includes('"'+n.name+'"')):Object.values(ids).concat(choices)},
    window:{addEventListener(){}},navigator:{userAgent:'iPhone',onLine:true,geolocation:{getCurrentPosition(ok,fail){gpsCalls++;if(holdGps){pendingGps={ok,fail};return;}gpsError?fail(gpsError):ok(gpsResult);}}},
    localStorage:{getItem:()=>stored,setItem:(key,value)=>writes.push({key,value})},
    sessionStorage:{getItem:()=>null,setItem:(key,value)=>sessionWrites.push({key,value})},
    matchMedia:()=>({matches:false,addEventListener(){}}),innerWidth:1200,
    fetch:async(url,options)=>{
      requests.push(String(url));let data;
      if(url==='./places.json')data={places};
      else if(String(url).includes('photon')){
        const name=new URL(url).searchParams.get('q');
        assert(['Oslo','Moss'].includes(name),'GPS must never be sent to city geocoding');
        data={features:[{properties:{name,countrycode:'NO',osm_value:'city'},geometry:{coordinates:name==='Oslo'?oslo:moss}}]};
      }else if(String(url).includes('osrm')){
        if(osrmFailure)throw new Error('Rutetjenesten svarer ikke');
        const pairs=new URL(url).pathname.split('/').at(-1).split(';').map(p=>p.split(',').map(Number));
        lastRouteOrigin=pairs[0];data={code:'Ok',routes:[{distance:50000,duration:3000,geometry:{coordinates:pairs}}]};
      }else if(String(url).includes('overpass')){
        const query=options.body.get('data'),start=lastRouteOrigin;
        data={elements:[
          {type:'node',id:1,lon:start[0],lat:start[1],tags:{tourism:'hotel',name:'Hotell ved start'}},
          {type:'node',id:2,lon:moss[0],lat:moss[1],tags:{tourism:'hotel',name:'Hotell ved mål'}},
          {type:'node',id:3,lon:start[0],lat:start[1],tags:{amenity:'fuel',name:'Bensin ved start'}}
        ].filter(e=>e.tags.tourism?query.includes('["tourism"="hotel"]'):query.includes('["amenity"="fuel"]'))};
      }else throw new Error('Unexpected request: '+url);
      return {ok:true,json:async()=>data};
    }
  });
  const modules=new Map();
  async function load(filename){const full=path.resolve(filename);if(modules.has(full))return modules.get(full);const module=new vm.SourceTextModule(fs.readFileSync(full,'utf8'),{context,identifier:full});modules.set(full,module);await module.link(spec=>load(path.join(path.dirname(full),spec.split('?')[0])));return module;}
  await (await load(path.join(root,'app.js'))).evaluate();
  for(let i=0;i<50&&writes.length===0;i++)await tick();
  assert.equal(writes.length,1,'The initial ordinary city search completes');
  const submit=()=>ids.search.handlers.submit({preventDefault(){}});
  const mode=value=>{const input=choices.find(n=>n.name==='from-mode-choice'&&n.value===value);input.checked=true;documentHandlers.change({target:input});};
  return {ids,choices,writes,sessionWrites,requests,submit,mode,
    get gpsCalls(){return gpsCalls;},get pendingGps(){return pendingGps;},
    setGps(coords){gpsResult=point(coords);gpsError=null;holdGps=false;},
    denyGps(code=1){gpsError={code};holdGps=false;},holdGps(){holdGps=true;},setInvalidGps(){gpsResult=point([NaN,59.7]);gpsError=null;holdGps=false;},
    failRoute(value){osrmFailure=value;}};
}
const fixture=await harness(),{ids}=fixture;
assert.equal(fixture.gpsCalls,0,'Opening the main page never asks for location');
assert.equal(ids['from-mode'].value,'place');assert.equal(ids.from.required,true);assert.equal(ids.from.disabled,false);
assert.equal(ids.count.textContent,'1','The normal start settlement still excludes its own hotel');
fixture.mode('gps');
assert.equal(fixture.gpsCalls,0,'Choosing Der jeg er does not ask for location yet');
assert.equal(ids['from-mode'].value,'gps');assert.equal(ids['from-place'].hidden,true);assert.equal(ids['from-gps-note'].hidden,false);
assert.equal(ids.from.required,false);assert.equal(ids.from.disabled,true);
assert(ids.swap.disabled||ids.swap.hidden,'A GPS origin cannot be swapped into the city destination');
ids.to.value='';await fixture.submit();assert.equal(fixture.gpsCalls,0,'A missing destination is rejected before asking for GPS');
ids.to.value='Moss';ids.types.value='';await fixture.submit();assert.equal(fixture.gpsCalls,0,'A missing category is rejected before asking for GPS');
ids.types.value='hotel';ids.types.handlers.change();
const writesBefore=fixture.writes.length,sessionBefore=fixture.sessionWrites.length;
ids.from.value='Moss'; // Same as destination, but irrelevant while GPS is chosen.
fixture.holdGps();
const pending=fixture.submit();for(let i=0;i<10&&!fixture.pendingGps;i++)await tick();
assert(fixture.pendingGps,'Submitting the GPS route requests a fresh device position');
assert.equal(ids.submit.disabled,true);await fixture.submit();assert.equal(fixture.gpsCalls,1,'The busy form cannot start two simultaneous GPS requests');
fixture.pendingGps.ok(point(outside));await pending;
assert.equal(ids.submit.disabled,false);assert.equal(ids.from.disabled,true,'The hidden city input stays disabled after GPS search');
assert.equal(ids.count.textContent,'2','GPS outside a known settlement does not falsely exclude nearby hotels');
assert.equal(ids.summary.children[0].textContent,'Der jeg er → Moss');
const routeURL=fixture.requests.filter(url=>url.includes('osrm')).at(-1);
assert(new URL(routeURL).pathname.endsWith(outside.join(',')+';'+moss.join(',')),'OSRM uses longitude,latitude from GPS as the route origin');
assert.equal(fixture.writes.length,writesBefore,'A GPS route is never written to localStorage');
assert(fixture.sessionWrites.slice(sessionBefore).every(write=>!write.value.includes(String(outside[0]))&&!write.value.includes(String(outside[1]))),'Device position is never written to the city session cache');
assert(!ids.summary.children.at(-1).textContent.includes('utelatt: '),'Unknown GPS settlement is not labelled as an excluded city');

for(const kind of ['denied','invalid','route']){
  const oldRequests=fixture.requests.length,oldGps=fixture.gpsCalls,oldWrites=fixture.writes.length;
  if(kind==='denied')fixture.denyGps();else if(kind==='invalid')fixture.setInvalidGps();else{fixture.setGps(outside);fixture.failRoute(true);}
  await fixture.submit();
  assert.equal(fixture.gpsCalls,oldGps+1);assert.equal(ids.submit.disabled,false);assert.equal(ids.from.disabled,true);assert.equal(ids.to.disabled,false);
  assert(ids.status.textContent.includes(kind==='denied'?'avslått':kind==='invalid'?'ugyldig':'Rutetjenesten svarer ikke'));
  assert.equal(fixture.writes.length,oldWrites);assert.equal(ids.count.textContent,'2','A failed request preserves the prior displayed search');
  if(kind!=='route')assert.equal(fixture.requests.length,oldRequests,'Invalid or denied location never starts routing or place queries');
}
fixture.failRoute(false);fixture.setGps(oslo);ids.types.value='both';ids.types.handlers.change();await fixture.submit();
assert.equal(ids.count.textContent,'2','Known GPS start settlement excludes its hotel while retaining fuel and destination hotel');
assert(ids.summary.children.at(-1).textContent.includes('Oslo'),'A containing settlement can be named even when origin is Der jeg er');
assert.equal(fixture.writes.length,writesBefore,'Successful GPS results remain memory-only');

fixture.mode('place');assert.equal(ids['from-mode'].value,'place');assert.equal(ids['from-place'].hidden,false);assert.equal(ids['from-gps-note'].hidden,true);
assert.equal(ids.from.required,true);assert.equal(ids.from.disabled,false);assert.equal(ids.swap.disabled,false);
ids.from.value='Oslo';ids.to.value='Moss';const gpsBefore=fixture.gpsCalls;await fixture.submit();
assert.equal(fixture.gpsCalls,gpsBefore,'Switching back to Sted performs ordinary city routing without GPS');
assert.equal(ids.summary.children[0].textContent,'Oslo → Moss');assert.equal(fixture.writes.length,writesBefore+1,'A complete ordinary route can still be saved');
assert(fixture.requests.filter(url=>url.includes('osrm')).at(-1).includes(oslo.join(',')+';'+moss.join(',')));
const privateCache=JSON.stringify({from:{name:'Der jeg er',coords:outside,gpsOrigin:true},to:{name:'Moss',coords:moss},radius:1,types:['hotel'],route:{distance:30000,duration:1800,geometry:{coordinates:[outside,moss]}},hotels:[],filterVersion:3,savedAt:Date.now()});
const restored=await harness({stored:privateCache});
assert.equal(restored.gpsCalls,0,'An obsolete GPS route cache must never trigger a location request');
assert.equal(restored.ids.summary.children[0].textContent,'Oslo → Moss','A device-origin route is not restored as a city route');
assert(restored.writes.every(write=>!write.value.includes(String(outside[0]))&&!write.value.includes(String(outside[1]))),'A private GPS route is not copied back into storage during bootstrap');
console.log('PASS: selectable Sted/GPS origin; no automatic permission prompt; fresh GPS route coordinates; duplicate-submit guard; no persisted GPS route or city-cache leakage; safe handling of denied/invalid GPS and route failure; settlement hotel filtering; switch back to ordinary saved city routing.');
