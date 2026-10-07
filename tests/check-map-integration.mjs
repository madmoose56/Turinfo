import fs from 'node:fs';
import path from 'node:path';
import vm from 'node:vm';
import assert from 'node:assert/strict';

// Use the real app modules with a small DOM/Leaflet implementation. These
// checks exercise the rendering boundary where GeoJSON [lon,lat], GPS and
// Leaflet [lat,lon] meet, rather than duplicating the viewport implementation.
const root=path.resolve('dist');
const routeCoords=[[10.7389701,59.9133301],[10.77,59.82],[10.80,59.70],[10.6619753,59.4347974]];
const gpsCoords=[10.781234,59.812345];
const samePoint=(actual,expected,message)=>assert.deepEqual(Array.from(actual),expected,message);
class Node {
  constructor(){this.children=[];this.handlers={};this.value='';this.textContent='';this.hidden=false;this.classList={add(){},remove(){},toggle(){}};this.style={};this.dataset={};}
  append(...items){this.children.push(...items);}
  replaceChildren(...items){this.children=items;}
  addEventListener(type,fn){this.handlers[type]=fn;}
  setAttribute(name,value){this[name]=value;}
  removeAttribute(name){delete this[name];}
  insertBefore(){} focus(){} scrollIntoView(){}
  showModal(){this.open=true;}
  close(){this.open=false;this.handlers.close?.();}
  getBoundingClientRect(){return {width:600,height:600};}
}
function storedRoute(){
  return {from:{name:'Oslo',coords:routeCoords[0]},to:{name:'Moss',coords:routeCoords.at(-1)},types:['hotel','fuel','charging'],radius:1,filterVersion:3,startAreaName:'Oslo',savedAt:Date.now(),route:{distance:60000,duration:3600,geometry:{coordinates:routeCoords}},hotels:[
    {id:'node/901',kind:'hotel',name:'Kart-hotell',coords:[10.795,59.70],tags:{tourism:'hotel'},distance:300,along:25000},
    {id:'node/902',kind:'fuel',name:'Kart-bensin',coords:[10.80,59.7005],tags:{amenity:'fuel'},distance:50,along:25000},
    {id:'node/903',kind:'charging',name:'Kart-lading',coords:[10.8004,59.70],tags:{amenity:'charging_station'},distance:25,along:25000}
  ]};
}
async function harness(near,{restored=false,gpsStart=false}={}){
  const html=fs.readFileSync(path.join(root,near?'nearby.html':'index.html'),'utf8');
  const ids=Object.fromEntries([...html.matchAll(/id="([^"]+)"/g)].map(m=>[m[1],new Node()]));
  assert(ids['map-location'],'Both maps provide an explicit GPS button');
  const choices=[...html.matchAll(/<input[^>]*name="([^"]+)"[^>]*value="([^"]+)"[^>]*>/g)].map(m=>Object.assign(new Node(),{name:m[1],value:m[2],checked:m[0].includes('checked')}));
  ids.types.value='hotel';
  if(!near){ids.from.value='Oslo';ids.to.value='Moss';ids.radius.value='1';}
  const area=new Node(),overview=new Node(),caption=new Node();caption.firstChild=new Node();
  const windowHandlers={},documentHandlers={},resizeObservers=[],writes=[],mapRecords=[],allLayers=[];
  let gpsCalls=0,denied=false,networkCalls=0;
  let mapSize={x:600,y:600};
  const leaflet={
    map(id,options){
      const record={id,options,views:[],invalidations:0,layers:[],handlers:{}};
      const instance={
        setView(center,zoom){record.views.push({center:Array.isArray(center)?Array.from(center):[center.lat,center.lng],zoom});return this;},
        getSize:()=>mapSize,
        invalidateSize(){record.invalidations++;return this;},
        on(type,fn){record.handlers[type]=fn;return this;},
        removeLayer(layer){record.layers=record.layers.filter(item=>item!==layer);layer.removed=true;return this;},
        addLayer(layer){record.layers.push(layer);return this;},
        fitBounds(){throw Error('The 20 km map must not fit the whole route or search radius');}
      };
      record.instance=instance;mapRecords.push(record);return instance;
    },
    control:{zoom:()=>({addTo(){}})},
    tileLayer:()=>({addTo(){}}),
    divIcon:options=>options,
    layerGroup(){return {layers:[],addTo(){return this;},addLayer(layer){this.layers.push(layer);return this;},clearLayers(){for(const layer of this.layers)layer.removed=true;this.layers=[];return this;}};}
  };
  for(const kind of ['marker','circleMarker','circle','polyline'])leaflet[kind]=(coords,options={})=>{
    const layer={kind,coords:JSON.parse(JSON.stringify(coords)),options,removed:false,popup:null,
      addTo(target){target.addLayer?.(this);return this;},
      bindPopup(node){this.popup=node;return this;},
      openPopup(){this.opened=true;return this;},
      getLatLng(){return {lat:this.coords[0],lng:this.coords[1]};},
      remove(){this.removed=true;return this;}
    };allLayers.push(layer);return layer;
  };
  const document={
    body:{dataset:{page:near?'nearby':'route'},classList:{add(){},remove(){}}},
    addEventListener:(type,fn)=>documentHandlers[type]=fn,
    getElementById:id=>ids[id]??null,
    createElement:()=>new Node(),
    querySelector:s=>s==='.map-area'?area:s==='.overview'?overview:s==='.map-caption'?caption:s.startsWith('input[name=')?choices.find(i=>s.includes('"'+i.name+'"')&&s.includes('"'+i.value+'"')):new Node(),
    querySelectorAll:s=>s.startsWith('input[name=')?choices.filter(i=>s.includes('"'+i.name+'"')):Object.values(ids)
  };
  const context=vm.createContext({console,URL,URLSearchParams,AbortController,setTimeout,clearTimeout,Date,Intl,Promise,
    L:leaflet,document,
    window:{L:leaflet,location:{search:gpsStart?'?from=gps':''},addEventListener:(type,fn)=>windowHandlers[type]=fn},
    navigator:{userAgent:'iPhone',onLine:true,geolocation:{getCurrentPosition(ok,fail){gpsCalls++;denied?fail({code:1}):ok({coords:{longitude:gpsCoords[0],latitude:gpsCoords[1],accuracy:12,heading:180}});}}},
    localStorage:{getItem:()=>restored?JSON.stringify(storedRoute()):null,setItem:(key,value)=>writes.push({key,value})},
    sessionStorage:{getItem:()=>null,setItem(){}},matchMedia:()=>({matches:false,addEventListener(){}}),innerWidth:1200,
    requestAnimationFrame:fn=>{fn();return 1;},cancelAnimationFrame(){},
    ResizeObserver:class{constructor(fn){this.fn=fn;resizeObservers.push(this);}observe(){}disconnect(){}},
    fetch:async(url,options)=>{
      networkCalls++;let data;
      if(url==='./places.json')data=JSON.parse(fs.readFileSync(path.join(root,'places.json')));
      else if(String(url).includes('photon')){const name=new URL(url).searchParams.get('q');data={features:[{properties:{name,countrycode:'NO',osm_value:'city'},geometry:{coordinates:name==='Oslo'?routeCoords[0]:routeCoords.at(-1)}}]};}
      else if(String(url).includes('osrm'))data={code:'Ok',routes:[storedRoute().route]};
      else if(String(url).includes('overpass')){
        const query=options.body.get('data');
        data={elements:[
          {type:'node',id:901,lon:near?gpsCoords[0]+.003:10.795,lat:near?gpsCoords[1]+.003:59.70,tags:{tourism:'hotel',name:'Kart-hotell'}},
          {type:'node',id:902,center:{lon:near?gpsCoords[0]+.001:10.80,lat:near?gpsCoords[1]+.001:59.7005},tags:{amenity:'fuel',name:'Kart-bensin'}},
          {type:'node',id:903,lon:near?gpsCoords[0]+.002:10.8004,lat:near?gpsCoords[1]+.002:59.70,tags:{amenity:'charging_station',name:'Kart-lading'}}
        ].filter(e=>query.includes('"tourism"')&&e.tags.tourism||query.includes('"fuel"')&&e.tags.amenity==='fuel'||query.includes('"charging_station"')&&e.tags.amenity==='charging_station')};
      }else throw Error('Unexpected request: '+url);
      return {ok:true,json:async()=>data};
    }
  });
  const modules=new Map();
  async function load(filename){
    const full=path.resolve(filename);if(modules.has(full))return modules.get(full);
    const module=new vm.SourceTextModule(fs.readFileSync(full,'utf8'),{context,identifier:full});modules.set(full,module);
    await module.link(spec=>load(path.join(path.dirname(full),spec.split('?')[0])));return module;
  }
  await (await load(path.join(root,'app.js'))).evaluate();
  if(!near&&!gpsStart&&!restored)await ids.search.handlers.submit({preventDefault(){}});
  for(let i=0;i<(gpsStart?2:50)&&!near&&writes.length===0;i++)await new Promise(resolve=>setTimeout(resolve,0));
  return {ids,leaflet,writes,map:mapRecords[0],allLayers,windowHandlers,resizeObservers,
    get gpsCalls(){return gpsCalls;},get networkCalls(){return networkCalls;},
    setDenied:value=>denied=value,setSize:value=>mapSize=value};
}
function checkTwentyKm(fixture,size=600){
  const view=fixture.map.views.at(-1);
  assert(view&&Number.isFinite(view.zoom),'A numeric fixed viewport is applied');
  const span=size*2*Math.PI*6378137*Math.cos(view.center[0]*Math.PI/180)/(256*2**view.zoom);
  assert(Math.abs(span-(fixture.ids.from?10000:20000))<30,'The viewport uses 10 km for routes and 20 km nearby: '+span);
}
function checkResultCoordinates(fixture){
  const pins=fixture.allLayers.filter(layer=>layer.kind==='marker'&&!layer.removed&&layer.options.icon?.className&&!layer.options.icon.className.includes('city-pin'));
  const cards=fixture.ids.results.children.filter(card=>card.className==='hotel');
  assert.equal(pins.length,cards.length,'Each result has exactly one numbered map pin');
  for(const [i,card] of cards.entries()){
    const links=card.children[1].children.find(child=>child.className==='hotel-links');
    const navigation=links.children.find(child=>child.textContent==='Naviger hit');
    const destination=new URL(navigation.href).searchParams.get('daddr').split(',').map(Number);
    samePoint(pins[i].coords,destination,'Map pins and navigation links use the same latitude and longitude');
    assert.equal(card.children[0].textContent,String(i+1));
    assert(String(pins[i].options.icon.html).includes(String(i+1)),'Card numbering matches the map pin');
  }
  return {pins,cards};
}
function checkGps(fixture){
  const gps=fixture.allLayers.filter(layer=>layer.kind==='circleMarker'&&!layer.removed);
  assert.equal(gps.length,1,'GPS has one distinct current-position marker');
  samePoint(gps[0].coords,[gpsCoords[1],gpsCoords[0]],'GPS pin is at the actual device position, not route start A');
}
function checkGpsEdge(fixture,size=600){
  const view=fixture.map.views.at(-1),rad=Math.PI/180,earth=6378137;
  const project=([lon,lat])=>[earth*lon*rad,earth*Math.log(Math.tan(Math.PI/4+lat*rad/2))];
  const anchor=project(gpsCoords),centre=project([view.center[1],view.center[0]]),scale=256*2**view.zoom/(2*Math.PI*earth);
  const x=size/2+(anchor[0]-centre[0])*scale,y=size/2-(anchor[1]-centre[1])*scale;
  assert(Math.abs(x-size/2)<.01&&Math.abs(y-18)<.01,'The southbound route/heading places real GPS at the midpoint of the top edge');
}
function checkGpsCenter(fixture,size=600){
  const view=fixture.map.views.at(-1),rad=Math.PI/180,earth=6378137;
  const project=([lon,lat])=>[earth*lon*rad,earth*Math.log(Math.tan(Math.PI/4+lat*rad/2))];
  const anchor=project(gpsCoords),centre=project([view.center[1],view.center[0]]),scale=256*2**view.zoom/(2*Math.PI*earth);
  const x=size/2+(anchor[0]-centre[0])*scale,y=size/2-(anchor[1]-centre[1])*scale;
  assert(Math.abs(x-size/2)<.01&&Math.abs(y-size/2)<.01,'Nearby centers the real GPS position so all four directions are visible');
}
for(const restored of [false,true]){
  const route=await harness(false,{restored});
  assert.equal(route.gpsCalls,0,'Opening the route page must not request GPS permission');
  assert.equal(route.map.options.zoomSnap,0,'Fractional Leaflet zoom is required for the fixed ground span');
  checkTwentyKm(route);checkResultCoordinates(route);
  const polyline=route.allLayers.find(layer=>layer.kind==='polyline'&&!layer.removed);
  assert.deepEqual(polyline.coords,routeCoords.map(([lon,lat])=>[lat,lon]),'GeoJSON line is translated once to Leaflet coordinate order');
  route.setDenied(true);await route.ids['map-location'].handlers.click();
  assert(route.ids['map-location-status']?.textContent.includes('avslått')||route.ids.status.textContent.includes('avslått'),'Permission failure is reported');
  assert(!route.allLayers.some(layer=>layer.kind==='circleMarker'&&!layer.removed),'Denied GPS must not produce a guessed GPS pin');
  const writesBefore=route.writes.length;
  route.setDenied(false);await route.ids['map-location'].handlers.click();
  assert.equal(route.gpsCalls,2);checkGps(route);checkTwentyKm(route);checkGpsEdge(route);
  assert.equal(route.writes.length,writesBefore,'Manual GPS display must not write device position to localStorage');
  assert(route.writes.every(write=>!write.value.includes(String(gpsCoords[0]))&&!write.value.includes(String(gpsCoords[1]))),'Saved route contains no device GPS coordinates');
  const {pins,cards}=checkResultCoordinates(route);
  if(cards.length){await cards[0].children[0].handlers.click();checkTwentyKm(route);assert(pins[0].opened,'The result index opens that result popup');}
  await route.ids['map-reset'].handlers.click();checkTwentyKm(route);checkGpsEdge(route);
  route.setSize({x:1000,y:1000});await route.ids['map-open'].handlers.click();checkTwentyKm(route,1000);
  checkGpsEdge(route,1000);
  assert(route.map.invalidations>0,'Moving a Leaflet map to the fullscreen dialog recalculates its pixels');
  route.setSize({x:600,y:600});await route.ids['map-back'].handlers.click();checkTwentyKm(route);
}
const gpsReturn=await harness(false,{restored:true,gpsStart:true});
assert.equal(gpsReturn.ids['from-mode'].value,'gps','The nearby GPS-route return link selects the GPS origin mode');
assert.equal(gpsReturn.gpsCalls,0,'Opening ?from=gps never requests location');
assert.equal(gpsReturn.writes.length,0,'A GPS-mode return does not restore or rewrite a previous city route');
assert.equal(gpsReturn.networkCalls,1,'GPS-mode opening only loads the place suggestions, without querying a route');
assert.equal(gpsReturn.ids.from.disabled,true);assert.equal(gpsReturn.ids.from.required,false);
assert.equal(gpsReturn.ids['from-gps-note'].hidden,true);
checkTwentyKm(gpsReturn);
await gpsReturn.ids.search.handlers.submit({preventDefault(){}});
assert.equal(gpsReturn.gpsCalls,1,'The returned GPS-mode route obtains location only when the user submits');
assert.equal(gpsReturn.writes.length,0,'The returned GPS-mode search does not save location');
const near=await harness(true);
assert.equal(near.gpsCalls,0,'Opening nearby does not trigger GPS');
assert.equal(near.networkCalls,0,'Opening nearby does not perform a search');
checkTwentyKm(near);
near.ids.types.value='all';near.ids.types.handlers.change();await near.ids.locate.handlers.click();
assert.equal(near.gpsCalls,1);assert.equal(near.ids.count.textContent,'3');
checkGps(near);checkTwentyKm(near);checkResultCoordinates(near);checkGpsCenter(near);
assert.equal(near.writes.length,0,'Nearby search never saves a GPS position');
const area=near.allLayers.find(layer=>layer.kind==='circle'&&!layer.removed&&layer.options.radius>=10000);
samePoint(area.coords,[gpsCoords[1],gpsCoords[0]],'Nearby search circle shares the GPS marker coordinates');
near.setSize({x:1000,y:1000});await near.ids['map-open'].handlers.click();checkTwentyKm(near,1000);
checkGpsCenter(near,1000);
near.setSize({x:600,y:600});await near.ids['map-back'].handlers.click();checkTwentyKm(near);
checkGpsCenter(near);
console.log('PASS: route maps use a 10 km square and nearby maps use 20 km on initial render, search, restored route, result focus and fullscreen resize; numbered pins match navigation GPS coordinates; nearby centers GPS while the southbound route retains top-edge positioning; GPS-mode return link waits for explicit search; denied GPS creates no guessed pin; device position has a distinct accurate marker and is never persisted.');
