import fs from 'node:fs';
import path from 'node:path';
import vm from 'node:vm';
import assert from 'node:assert/strict';

// Exercise the actual suggestion selection and route submit handlers together.
// The same display name intentionally has two different SSB IDs and locations.
const root=path.resolve('dist');
const oslo=[10.75,59.90],moss=[10.66,59.43],boSouth=[9.073,59.411],boNorth=[14.619,68.69],gps=[10.812345,59.712345];
function settlement(id,name,region,coords){
  const [x,y]=coords,bbox=[x-.005,y-.005,x+.005,y+.005];
  return {id,name,region,population:1000,bbox,rings:[[[bbox[0],bbox[1]],[bbox[2],bbox[1]],[bbox[2],bbox[3]],[bbox[0],bbox[3]],[bbox[0],bbox[1]]]]};
}
const places=[settlement('oslo','Oslo','Oslo',oslo),settlement('moss','Moss','Moss',moss),
  settlement('bo-south','Bø','Midt-Telemark',boSouth),settlement('bo-north','Bø','Bø',boNorth)];
const feature=(name,coords)=>({properties:{name,countrycode:'NO',osm_value:'town'},geometry:{coordinates:coords}});
const tick=()=>new Promise(resolve=>setTimeout(resolve,0));
const point=(actual,expected,message)=>assert(actual.length===expected.length&&actual.every((value,i)=>Math.abs(value-expected[i])<1e-8),message);

class Node {
  constructor(doc){this.ownerDocument=doc;this.children=[];this.handlers=new Map();this.attributes={};this.dataset={};this.style={setProperty(){}};this.classList={add(){},remove(){},toggle(){}};this.value='';this._text='';this.hidden=false;this.disabled=false;this.required=false;this.id='';}
  append(...nodes){for(const node of nodes){if(node.parent)node.parent.children=node.parent.children.filter(item=>item!==node);node.parent=this;this.children.push(node);}}
  replaceChildren(...nodes){for(const node of this.children)node.parent=null;this.children=[];this._text='';this.append(...nodes);}
  set textContent(value){this.replaceChildren();this._text=String(value);}
  get textContent(){return this._text+this.children.map(node=>node.textContent).join('');}
  get firstChild(){return this.children[0]??null;}
  addEventListener(type,fn,options={}){if(!this.handlers.has(type))this.handlers.set(type,[]);this.handlers.get(type).push({fn,once:options.once});}
  setAttribute(name,value){this.attributes[name]=String(value);} removeAttribute(name){delete this.attributes[name];}
  getAttribute(name){return this.attributes[name]??null;}
  contains(node){return this===node||this.children.some(child=>child.contains(node));}
  closest(selector){return selector==='[data-place-index]'&&this.dataset.placeIndex!==undefined?this:this.parent?.closest?.(selector)??null;}
  focus(){if(this.ownerDocument.activeElement===this)return;const old=this.ownerDocument.activeElement;old?.blur();this.ownerDocument.activeElement=this;this.fire('focus',{},false);}
  blur(){this.ownerDocument.activeElement=null;this.fire('blur',{},false);}
  scrollIntoView(){} insertBefore(){} getBoundingClientRect(){return {height:80,width:600};}
  showModal(){this.open=true;}close(){this.open=false;this.fire('close',{},false);}
  fire(type,data={},bubbles=true){
    const event={type,target:this,defaultPrevented:false,stopped:false,preventDefault(){this.defaultPrevented=true;},stopPropagation(){this.stopped=true;},...data},results=[];
    for(let node=this;node;node=bubbles&&!event.stopped?node.parent:null){
      for(const handler of [...(node.handlers.get(type)??[])]){results.push(handler.fn(event));if(handler.once)node.handlers.set(type,node.handlers.get(type).filter(item=>item!==handler));}
    }
    return {event,results};
  }
}
function savedRoute(from={name:'Oslo',coords:oslo,ssbId:'oslo'},to={name:'Moss',coords:moss,ssbId:'moss'}){
  return {from,to,types:['fuel'],radius:1,filterVersion:3,savedAt:Date.now(),hotels:[],route:{distance:60000,duration:3600,geometry:{coordinates:[from.coords,to.coords]}}};
}
async function harness({photon='both',stored=null,holdPlaces=false,journey=null}={}){
  const html=fs.readFileSync(path.join(root,'index.html'),'utf8'),doc=new Node();doc.ownerDocument=doc;doc.activeElement=null;
  const ids=Object.fromEntries([...html.matchAll(/id="([^"]+)"/g)].map(m=>[m[1],Object.assign(new Node(doc),{id:m[1]})]));
  for(const match of html.matchAll(/<input\b[^>]*id="([^"]+)"[^>]*>/g)){
    const node=ids[match[1]];node.value=match[0].match(/value="([^"]*)"/)?.[1]??'';node.required=/\brequired\b/.test(match[0]);
  }
  const choices=[...html.matchAll(/<input[^>]*name="([^"]+)"[^>]*value="([^"]+)"[^>]*>/g)]
    .map(m=>Object.assign(new Node(doc),{name:m[1],value:m[2],checked:m[0].includes('checked')}));
  assert(ids['from-suggestions']&&ids['to-suggestions'],'Both route fields have visible suggestion containers');
  const area=new Node(doc),overview=new Node(doc),caption=new Node(doc);caption.append(new Node(doc));
  doc.body=new Node(doc);doc.body.dataset.page='route';doc.documentElement=new Node(doc);doc.append(doc.body);doc.body.append(...Object.values(ids),...choices,area,overview,caption);
  doc.getElementById=id=>ids[id]??null;doc.createElement=()=>new Node(doc);
  doc.querySelector=selector=>selector==='.map-area'?area:selector==='.overview'?overview:selector==='.map-caption'?caption:selector.startsWith('input[name=')?choices.find(node=>selector.includes('"'+node.name+'"')&&selector.includes('"'+node.value+'"')):new Node(doc);
  doc.querySelectorAll=selector=>selector.startsWith('input[name=')?choices.filter(node=>selector.includes('"'+node.name+'"')):Object.values(ids).concat(choices);
  const preferences=[],writes=[],sessionWrites=[],requests=[],routes=[],cache=new Map();let gpsCalls=0,releasePlaces;
  const placesReady=holdPlaces?new Promise(resolve=>{releasePlaces=resolve;}):null;
  const context=vm.createContext({console,URL,URLSearchParams,AbortController,setTimeout,clearTimeout,Date,Intl,Promise,
    document:doc,window:{addEventListener(){}},innerWidth:1200,matchMedia:()=>({matches:false,addEventListener(){}}),
    navigator:{userAgent:'iPhone',onLine:true,geolocation:{getCurrentPosition(ok){gpsCalls++;ok({coords:{longitude:gps[0],latitude:gps[1],accuracy:9,heading:180}});}}},
    localStorage:{getItem:key=>key==='turinfo-journey-v1'?(journey?JSON.stringify(journey):null):(stored?JSON.stringify(stored):null),setItem:(key,value)=>{if(key==='turinfo-journey-v1')preferences.push(JSON.parse(value));else writes.push({key,value});}},
    sessionStorage:{getItem:key=>cache.get(key)??null,setItem:(key,value)=>{cache.set(key,value);sessionWrites.push({key,value});}},
    fetch:async(url)=>{
      requests.push(String(url));let data;
      if(url==='./places.json'){if(placesReady)await placesReady;data={places};}
      else if(String(url).includes('photon')){
        const query=new URL(url).searchParams.get('q');
        if(query==='Oslo')data={features:[feature('Oslo',oslo)]};
        else if(query==='Moss')data={features:[feature('Moss',moss)]};
        else if(query==='Bø'){
          if(photon==='failure')throw new Error('Photon unavailable');
          data={features:photon==='wrong'?[feature('Bø',oslo)]:[feature('Bø',boSouth),feature('Bø',boNorth)]};
        }else throw new Error('Unexpected geocoding query: '+query);
      }else if(String(url).includes('osrm')){
        const pairs=new URL(url).pathname.split('/').at(-1).split(';').map(value=>value.split(',').map(Number));routes.push(pairs);
        data={code:'Ok',routes:[{distance:50000,duration:3000,geometry:{coordinates:pairs}}]};
      }else if(String(url).includes('overpass'))data={elements:[]};
      else throw new Error('Unexpected request: '+url);
      return {ok:true,json:async()=>data};
    }
  });
  const modules=new Map();
  async function load(filename){const full=path.resolve(filename);if(modules.has(full))return modules.get(full);const module=new vm.SourceTextModule(fs.readFileSync(full,'utf8'),{context,identifier:full});modules.set(full,module);await module.link(spec=>load(path.join(path.dirname(full),spec.split('?')[0])));return module;}
  await (await load(path.join(root,'app.js'))).evaluate();
  if(!holdPlaces&&!journey){
    await tick();await tick();
    if(!stored){assert.equal(routes.length,0,'A fresh page waits for an explicit search');assert.equal(gpsCalls,0);await ids.search.fire('submit',{},false).results[0];}
    assert.equal(writes.length,1,'An explicit search or saved route restoration completes');
    // Fuel-only queries isolate place routing from hotel start-settlement filtering.
    ids.types.value='fuel';ids.types.fire('change');
  }
  async function select(id,placeId){
    const place=places.find(item=>item.id===placeId),input=ids[id];input.focus();input.value=place.name;input.fire('input');await tick();
    const options=ids[id+'-suggestions'].children,option=options.find(node=>node.children[0].textContent===place.name&&node.children[1]?.textContent===place.region);
    assert(option,'The dropdown offers '+place.name+' in '+place.region);option.children[0].fire('click');
    assert.equal(input.value,place.name,'Selecting fills the full place name');
  }
  const submit=()=>ids.search.fire('submit',{},false).results[0];
  return {ids,preferences,writes,sessionWrites,requests,routes,select,submit,releasePlaces,get gpsCalls(){return gpsCalls;},
    async chooseAmbiguous(index){for(let i=0;i<100&&!ids.choose.open;i++)await tick();assert(ids.choose.open,'Editing a same-named settlement clears its previous exact selection');ids.choose.returnValue=String(index);ids.choose.close();},
    mode(value){const choice=choices.find(node=>node.name==='from-mode-choice'&&node.value===value);choice.checked=true;choice.fire('change');}};
}

const sameNames=await harness();
await sameNames.select('from','bo-south');await sameNames.select('to','bo-north');await sameNames.submit();
const selectedRoute=sameNames.routes.at(-1);point(selectedRoute[0],boSouth,'The selected start uses its own SSB location');point(selectedRoute[1],boNorth,'The same-named destination uses the other SSB location');
assert(!sameNames.ids.choose.open,'Exact dropdown choices do not open the ambiguous-name dialog');
let saved=JSON.parse(sameNames.writes.at(-1).value);assert.equal(saved.from.ssbId,'bo-south');assert.equal(saved.to.ssbId,'bo-north');
sameNames.ids.swap.fire('click');await sameNames.submit();
point(sameNames.routes.at(-1)[0],boNorth,'Swapping identical display names retains the destination identity as start');point(sameNames.routes.at(-1)[1],boSouth,'Swapping retains the prior start identity as destination');

sameNames.ids.from.value='Bø';sameNames.ids.from.fire('input');await tick();
await sameNames.select('to','moss');
const editedSubmit=sameNames.submit();await sameNames.chooseAmbiguous(0);await editedSubmit;
point(sameNames.routes.at(-1)[0],boSouth,'Editing even the same visible name clears the old identity and uses the newly chosen location');

await sameNames.select('from','bo-south');await sameNames.select('to','bo-south');
const routeCount=sameNames.routes.length,writeCount=sameNames.writes.length;await sameNames.submit();
assert.equal(sameNames.routes.length,routeCount,'An actual identical start and destination never reaches the router');
assert.equal(sameNames.writes.length,writeCount,'Rejecting an identical place retains the previous saved route');
assert(sameNames.ids.status.textContent.includes('samme sted'));

for(const photon of ['failure','wrong']){
  const fallback=await harness({photon});await fallback.select('from','bo-south');await fallback.select('to','bo-north');await fallback.submit();
  assert.equal(fallback.routes.length,2,'The chosen SSB places still route after '+photon+' geocoding');
  point(fallback.routes.at(-1)[0],boSouth,'Fallback start is inside the selected southern settlement');
  point(fallback.routes.at(-1)[1],boNorth,'Fallback destination is inside the selected northern settlement');
  saved=JSON.parse(fallback.writes.at(-1).value);assert.equal(saved.from.ssbId,'bo-south');assert.equal(saved.to.ssbId,'bo-north');
  assert(!fallback.ids.choose.open,'A failing or mismatched geocoder cannot undo an exact SSB selection');
}

const restored=await harness({photon:'failure',stored:savedRoute({name:'Bø',coords:boSouth,ssbId:'bo-south'},{name:'Bø',coords:boNorth,ssbId:'bo-north'})});
assert.equal(restored.routes.length,0,'Restoring a saved route does not start a fresh route search');
await restored.submit();assert.equal(restored.routes.length,1);
point(restored.routes[0][0],boSouth,'Restored SSB ID disambiguates the same-named origin');point(restored.routes[0][1],boNorth,'Restored SSB ID disambiguates the same-named destination');

await sameNames.select('to','moss');sameNames.mode('gps');
const privateWrites=sameNames.writes.length;await sameNames.submit();
assert.equal(sameNames.gpsCalls,1);point(sameNames.routes.at(-1)[0],gps,'GPS origin still overrides a previously selected place');
point(sameNames.routes.at(-1)[1],moss,'The selected city destination remains usable in GPS mode');
assert.equal(sameNames.writes.length,privateWrites,'The GPS route is not persisted');
assert(sameNames.sessionWrites.every(write=>!write.value.includes(String(gps[0]))&&!write.value.includes(String(gps[1]))),'The suggestion integration does not leak device coordinates into city caches');

const startup=await harness({holdPlaces:true,stored:savedRoute({name:'Bø',coords:boSouth,ssbId:'bo-south'},{name:'Bø',coords:boNorth,ssbId:'bo-north'})});
startup.ids.from.focus();startup.ids.from.value='Os';startup.ids.from.fire('input');
startup.releasePlaces();await tick();await tick();
assert.equal(startup.ids.from.value,'Os','A delayed place index must not overwrite the first letters typed during startup');
assert.equal(startup.ids.to.value,'Moss','Typing during startup prevents an older saved route from replacing the form');
assert.equal(startup.routes.length,0,'Finishing the place index after a user edit does not start an automatic route request');
assert.equal(startup.writes.length,0,'The skipped bootstrap does not rewrite a saved route');
await startup.select('from','oslo');await startup.submit();assert.equal(startup.routes.length,1,'An explicit search still works after the deferred index finishes');
point(startup.routes[0][0],oslo,'The explicit search uses the place the user selected after startup');point(startup.routes[0][1],moss,'The original destination remains usable after startup');

console.log('PASS: exact same-name SSB place selection routes to distinct coordinates; swap preserves place identity; typing clears identity; identical coordinates are rejected; SSB fallback handles unavailable/wrong geocoding; saved IDs restore correctly; GPS still routes privately; deferred startup preserves typing and allows an explicit search.');

const lastChoice=await harness();await lastChoice.select('from','bo-south');await lastChoice.select('to','bo-north');
const journey=lastChoice.preferences.at(-1);assert.equal(journey.selections.from.id,'bo-south');assert.equal(journey.selections.to.id,'bo-north');
const remembered=await harness({journey,stored:savedRoute()});await tick();await tick();
assert.equal(remembered.ids.from.value,'Bø');assert.equal(remembered.ids.to.value,'Bø');
await remembered.submit();point(remembered.routes.at(-1)[0],boSouth,'Remembered start retains exact namesake');point(remembered.routes.at(-1)[1],boNorth,'Remembered target retains exact namesake');
remembered.ids['route-controls'].hidden=false;remembered.ids['route-toggle'].fire('click');assert.equal(remembered.ids['route-controls'].hidden,true);remembered.ids['route-toggle'].fire('click');assert.equal(remembered.ids['route-controls'].hidden,false);
assert(remembered.preferences.every(value=>!JSON.stringify(value).includes(String(gps[0]))),'Preferences never store device GPS');
console.log('PASS: last edited Fra/Til survive reload independently of old successful results, keep same-name place identities, and route controls toggle without losing fields.');
