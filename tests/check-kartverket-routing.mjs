import fs from 'node:fs';
import path from 'node:path';
import vm from 'node:vm';
import assert from 'node:assert/strict';

// Isolate the real app's selection, routing and hotel filtering from the remote
// provider. Provider and combobox behavior have their own focused checks.
const root=path.resolve('dist');
const oslo=[10.75,59.90],moss=[10.66,59.43],rural=[10.812345,59.712345],gps=[10.779123,59.708456];
const rectangle=(id,name,bbox)=>({id,name,region:name,population:1000,bbox,rings:[[[bbox[0],bbox[1]],[bbox[2],bbox[1]],[bbox[2],bbox[3]],[bbox[0],bbox[3]],[bbox[0],bbox[1]]]]});
const places=[rectangle('oslo','Oslo',[10.70,59.85,10.80,59.95]),rectangle('moss','Moss',[10.60,59.40,10.70,59.50])];
const official=(id,name,coords,region='Testkommune')=>({id:'kartverket:'+id,name,coords,region,kartverketId:id,source:'kartverket',municipalityIds:['0301'],kindLabel:'Bygd'});
const destination=official('200','Moss',moss,'Moss');
const tick=()=>new Promise(resolve=>setTimeout(resolve,0));
const point=(actual,expected,message)=>assert(actual.length===expected.length&&actual.every((value,i)=>Math.abs(value-expected[i])<1e-8),message);

class Node {
  constructor(){this.children=[];this.handlers={};this.value='';this._text='';this.hidden=false;this.disabled=false;this.required=false;this.dataset={};this.style={setProperty(){}};this.classList={add(){},remove(){},toggle(){}};}
  append(...nodes){this.children.push(...nodes);} replaceChildren(...nodes){this._text='';this.children=nodes;}
  get textContent(){return this._text+this.children.map(node=>node.textContent).join('');}
  set textContent(value){this._text=String(value);this.children=[];}
  addEventListener(type,fn){this.handlers[type]=fn;} setAttribute(name,value){this[name]=String(value);}
  removeAttribute(name){delete this[name];} insertBefore(){} focus(){} scrollIntoView(){}
  getBoundingClientRect(){return {height:78,bottom:1000,width:600};}
  showModal(){this.open=true;} close(){this.open=false;this.handlers.close?.();}
}
function savedRoute(from={name:'Oslo',coords:oslo,ssbId:'oslo'},to={name:'Moss',coords:moss,ssbId:'moss'}){
  return {from,to,types:['hotel','fuel'],radius:1,filterVersion:3,savedAt:Date.now(),hotels:[],route:{distance:60000,duration:3600,geometry:{coordinates:[from.coords,to.coords]}}};
}
async function harness({stored=savedRoute()}={}){
  const html=fs.readFileSync(path.join(root,'index.html'),'utf8');
  const ids=Object.fromEntries([...html.matchAll(/id="([^"]+)"/g)].map(match=>[match[1],new Node()]));
  for(const match of html.matchAll(/<input\b[^>]*id="([^"]+)"[^>]*>/g)){
    const node=ids[match[1]];node.value=match[0].match(/value="([^"]*)"/)?.[1]??'';node.required=/\brequired\b/.test(match[0]);
  }
  const choices=[...html.matchAll(/<input[^>]*name="([^"]+)"[^>]*value="([^"]+)"[^>]*>/g)].map(match=>Object.assign(new Node(),{name:match[1],value:match[2],checked:match[0].includes('checked')}));
  const controls={},documentHandlers={},requests=[],routes=[],writes=[],sessionWrites=[],area=new Node(),overview=new Node(),caption=new Node();caption.firstChild=new Node();
  let gpsCalls=0;
  const context=vm.createContext({console,URL,URLSearchParams,AbortController,setTimeout,clearTimeout,Date,Intl,Promise,
    document:{body:{dataset:{page:'route'},classList:{add(){},remove(){}}},documentElement:{style:{setProperty(){}}},
      addEventListener:(type,fn)=>documentHandlers[type]=fn,getElementById:id=>ids[id]??null,createElement:()=>new Node(),
      querySelector:selector=>selector==='.map-area'?area:selector==='.overview'?overview:selector==='.map-caption'?caption:selector.startsWith('input[name=')?choices.find(node=>selector.includes('"'+node.name+'"')&&selector.includes('"'+node.value+'"')):new Node(),
      querySelectorAll:selector=>selector.startsWith('input[name=')?choices.filter(node=>selector.includes('"'+node.name+'"')):Object.values(ids).concat(choices)},
    window:{scrollY:0,innerHeight:800,addEventListener(){}},innerWidth:1200,matchMedia:()=>({matches:false,addEventListener(){}}),
    navigator:{userAgent:'iPhone',onLine:true,geolocation:{getCurrentPosition(ok){gpsCalls++;ok({coords:{longitude:gps[0],latitude:gps[1],accuracy:9,heading:180}});}}},
    localStorage:{getItem:()=>JSON.stringify(stored),setItem:(key,value)=>{if(key!=='turinfo-journey-v1')writes.push({key,value});}},
    sessionStorage:{getItem:()=>null,setItem:(key,value)=>sessionWrites.push({key,value})},
    fetch:async(url,options)=>{
      requests.push(String(url));let data;
      if(url==='./places.json')data={places};
      else if(String(url).includes('photon'))throw new Error('Photon must not replace a selected Kartverket point');
      else if(String(url).includes('osrm')){
        const coords=new URL(url).pathname.split('/').at(-1).split(';').map(pair=>pair.split(',').map(Number));routes.push(coords);
        data={code:'Ok',routes:[{distance:50000,duration:3000,geometry:{coordinates:coords}}]};
      }else if(String(url).includes('overpass')){
        const [from,to]=routes.at(-1),query=options.body.get('data');
        const addressPoint=from.map((value,i)=>value+(to[i]-value)*.18);
        data={elements:[
          {type:'node',id:1,lon:from[0],lat:from[1],tags:{tourism:'hotel',name:'Hotell ved start'}},
          {type:'node',id:2,lon:to[0],lat:to[1],tags:{tourism:'hotel',name:'Hotell ved mål'}},
          {type:'node',id:3,lon:from[0],lat:from[1],tags:{amenity:'fuel',name:'Bensin ved start'}},
          {type:'node',id:4,lon:addressPoint[0],lat:addressPoint[1],tags:{tourism:'hotel',name:'Hotell med Oslo-adresse','addr:city':'Oslo'}}
        ].filter(element=>element.tags.tourism?query.includes('["tourism"="hotel"]'):query.includes('["amenity"="fuel"]'))};
      }else throw new Error('Unexpected request: '+url);
      return {ok:true,json:async()=>data};
    }
  });
  const modules=new Map();
  async function load(filename){
    const full=path.resolve(filename);if(modules.has(full))return modules.get(full);
    if(path.basename(full)==='place-suggestions.js'){
      const module=new vm.SyntheticModule(['attachPlaceSuggestions'],function(){
        this.setExport('attachPlaceSuggestions',(input,options)=>{controls[input===ids.from?'from':'to']=options;return {close(){},clearSelection(){}};});
      },{context,identifier:full});modules.set(full,module);await module.link(()=>{});return module;
    }
    const module=new vm.SourceTextModule(fs.readFileSync(full,'utf8'),{context,identifier:full});modules.set(full,module);await module.link(spec=>load(path.join(path.dirname(full),spec.split('?')[0])));return module;
  }
  await (await load(path.join(root,'app.js'))).evaluate();
  for(let i=0;i<100&&!writes.length;i++)await tick();
  assert.equal(writes.length,1,'Bootstrap restores the stored route without making a new route request');
  const names=()=>ids.results.children.filter(node=>node.className==='hotel'&&!node.hidden).map(card=>card.children[1].children[0].textContent);
  return {ids,writes,sessionWrites,requests,routes,names,get gpsCalls(){return gpsCalls;},
    pick(id,place){ids[id].value=place.name;controls[id].onSelect(place);},
    edit(id,value){ids[id].value=value;controls[id].onEdit();},
    submit:()=>ids.search.handlers.submit({preventDefault(){}}),
    mode(value){const input=choices.find(node=>node.name==='from-mode-choice'&&node.value===value);input.checked=true;documentHandlers.change({target:input});}};
}

const outside=await harness();outside.pick('from',official('100','Bygda',rural));outside.pick('to',destination);await outside.submit();
assert.equal(outside.routes.length,1,'A verified rural SSR selection can route without an SSB polygon');
point(outside.routes[0][0],rural,'The router receives the selected SSR start point');point(outside.routes[0][1],moss,'The router receives the selected SSR destination point');
assert.deepEqual(outside.names().sort(),['Hotell med Oslo-adresse','Hotell ved mål'].sort(),'A rural SSR start also excludes all results within 3 km');
assert(!outside.requests.some(url=>url.includes('photon')),'Selected SSR points never require Photon');
let saved=JSON.parse(outside.writes.at(-1).value);assert.equal(saved.from.kartverketId,'100');assert.equal(saved.to.kartverketId,'200');assert.equal(saved.from.source,'kartverket');
assert.equal(saved.from.municipalityIds[0],'0301');assert.equal(saved.from.region,'Testkommune');

const inside=await harness();inside.pick('from',official('300','Sentrum',oslo,'Oslo'));inside.pick('to',destination);await inside.submit();
assert.equal(inside.routes.length,1);assert.deepEqual(inside.names().sort(),['Hotell med Oslo-adresse','Hotell ved mål'].sort(),'An SSR start excludes every category within 3 km and retains hotels beyond it');
saved=JSON.parse(inside.writes.at(-1).value);assert.equal(saved.filterVersion,4);assert.equal(saved.from.kartverketId,'300');assert.equal(saved.from.ssbId,'oslo');

const restored=await harness({stored:savedRoute(official('100','Bygda',rural),destination)});await restored.submit();
assert.equal(restored.routes.length,1,'Restored rural SSR metadata remains usable without an SSB polygon');point(restored.routes[0][0],rural,'Restored SSR identity keeps its official coordinates');
assert(!restored.requests.some(url=>url.includes('photon')),'Restoration must not cast an SSR point into a geocoded SSB name');
restored.ids.swap.handlers.click();await restored.submit();point(restored.routes.at(-1)[0],moss,'Swapping keeps the destination SSR identity');point(restored.routes.at(-1)[1],rural,'Swapping keeps the rural SSR identity');

const sameNames=await harness();sameNames.pick('from',official('401','Samme navn',rural));sameNames.pick('to',official('402','Samme navn',moss));await sameNames.submit();
assert.equal(sameNames.routes.length,1,'Equal SSR display names with distinct IDs and locations can route');point(sameNames.routes[0][0],rural,'Equal-name start keeps its own point');point(sameNames.routes[0][1],moss,'Equal-name destination keeps its own point');
sameNames.pick('to',official('401','Samme navn',rural));const routeCount=sameNames.routes.length;await sameNames.submit();
assert.equal(sameNames.routes.length,routeCount,'Actually identical SSR coordinates are rejected before routing');assert(sameNames.ids.status.textContent.includes('samme sted'));

for(const invalid of [[NaN,59],[200,59],[10,100]]){
  const fixture=await harness();fixture.pick('from',official('500','Ugyldig',invalid));fixture.pick('to',destination);await fixture.submit();
  assert.equal(fixture.routes.length,0,'Invalid selected SSR coordinates never reach the router');assert.equal(fixture.writes.length,1,'Invalid points preserve the previously saved route');
  assert(!fixture.requests.some(url=>url.includes('photon')),'Invalid SSR coordinates are rejected without substituting a geocoded namesake');
}

const edited=await harness();edited.pick('from',official('100','Bygda',rural));edited.pick('to',destination);edited.edit('from','Bygda');await edited.submit();
assert.equal(edited.routes.length,0,'Editing clears a previously selected SSR point even if the visible text is unchanged');assert(edited.requests.some(url=>url.includes('photon')),'After editing, the stale official identity is no longer used directly');

outside.mode('gps');const writesBefore=outside.writes.length,sessionBefore=outside.sessionWrites.length;await outside.submit();
assert.equal(outside.gpsCalls,1);point(outside.routes.at(-1)[0],gps,'GPS origin overrides the previously selected SSR start');point(outside.routes.at(-1)[1],moss,'The SSR destination remains usable with a GPS origin');
assert.equal(outside.writes.length,writesBefore,'A GPS-to-SSR route is never persisted');
assert(outside.sessionWrites.slice(sessionBefore).every(write=>!write.value.includes(String(gps[0]))&&!write.value.includes(String(gps[1]))),'Device coordinates never enter the city selection session cache');

console.log('PASS: selected and restored Kartverket points route directly without Photon; rural starts retain hotels; containing SSB boundaries and addresses still exclude start hotels; swaps and equal names retain SSR identity; invalid/stale selections cannot route; GPS remains private.');
