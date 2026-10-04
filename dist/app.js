import {findStartSettlement,excludeStartHotels,inSettlement,normalizePlace} from './geo.js?v=18';
import {getPosition} from './nearby.js?v=18';
import {selectedTypes,resultLabel,routeQuery,nearQuery,extractPlaces,fuelDetails,chargingDetails,typeValue,kindLabel,activityLabel,activityTypes,hasActivities} from './poi.js?v=18';
const isNearby=document.body?.dataset.page==='nearby';
const $=id=>document.getElementById(id),fmt=new Intl.NumberFormat('nb-NO',{maximumFractionDigits:1}),km=n=>fmt.format(n/1000)+' km';let map,routeLayer,markers,active,deferredInstall,placesPromise,busy=false;
async function loadPlaces(){if(!placesPromise)placesPromise=json('./places.json',{},30000).then(data=>{const list=$('cities');const names=[...new Set(data.places.map(p=>p.name))];list.replaceChildren(...names.map(name=>{const option=el('option');option.value=name;return option;}));return data.places;}).catch(error=>{placesPromise=null;throw error;});return placesPromise;}
function withoutStartHotels(data,places){
  const needsHotels=(data.types??['hotel']).includes('hotel'),startArea=needsHotels?findStartSettlement(data.from,places):null;
  if(needsHotels&&!startArea)throw new Error('Fant ikke tettstedsgrensen for '+data.from.name+'. Velg et startsted fra forslagene.');
  const hotels=data.hotels.filter(h=>(h.kind&&h.kind!=='hotel')||excludeStartHotels([h],data.from,startArea).length);
  return {...data,hotels,startAreaName:startArea?.name??'',excludedCount:data.hotels.length-hotels.length,filterVersion:3};
}
function updateSearchLabels(){const label=resultLabel(selectedTypes($('types').value));if($('submit'))$('submit').textContent='Finn '+label;if($('locate'))$('locate').textContent='Finn '+label+' nær meg';if($('nearby-title'))$('nearby-title').textContent=label[0].toUpperCase()+label.slice(1)+' nær deg';syncChoices();}
$('types').addEventListener('change',updateSearchLabels);
function syncChoices(){
  const types=selectedTypes($('types').value);
  document.querySelectorAll('input[name="poi-type"]').forEach(input=>{input.checked=types.includes(input.value)||(types.includes('activity')&&activityTypes.includes(input.value));});
  if(isNearby)return;
  const id='radius';
  if(!['0.3','1','2','3'].includes(String($(id).value)))$(id).value='3';
  const value=String($(id).value);
  document.querySelectorAll('input[name="'+id+'-choice"]').forEach(input=>{input.checked=input.value===value;});
}
document.addEventListener('change',event=>{
  const input=event.target;
  if(input.name==='poi-type'){
    $('types').value=[...document.querySelectorAll('input[name="poi-type"]')].filter(item=>item.checked).map(item=>item.value).join(',');updateSearchLabels();
  }else if(input.name==='radius-choice'){$('radius').value=input.value;syncChoices();}
});
function status(message,error=false){$('status').textContent=message;$('status').classList.toggle('error',error);}
function el(tag,text,className){const node=document.createElement(tag);if(text!==undefined)node.textContent=text;if(className)node.className=className;return node;}
function safeWebsite(raw){if(!raw)return null;try{const u=new URL(raw.match(/^https?:\/\//i)?raw:'https://'+raw);return ['https:','http:'].includes(u.protocol)?u.href:null;}catch{return null;}}
function link(label,url){const a=el('a',label);a.href=url;a.target='_blank';a.rel='noopener noreferrer';return a;}
function directions(h){const destination=encodeURIComponent(h.coords[1]+','+h.coords[0]),apple=/iPhone|iPad|iPod/.test(navigator.userAgent??'')||(/Macintosh/.test(navigator.userAgent??'')&&navigator.maxTouchPoints>1);return apple?'https://maps.apple.com/?daddr='+destination+'&dirflg=d':'https://www.google.com/maps/dir/?api=1&destination='+destination+'&travelmode=driving&dir_action=navigate';}
function navigationLink(h){const a=link('Naviger hit',directions(h));a.className='navigate-link';a.setAttribute('aria-label','Naviger hit: '+h.name);return a;}
async function json(url,options={},timeout=25000){const controller=new AbortController(),timer=setTimeout(()=>controller.abort(),timeout);try{const response=await fetch(url,{...options,signal:controller.signal});if(!response.ok)throw new Error('Tjenesten svarte med '+response.status);return await response.json();}finally{clearTimeout(timer);}}
async function chooseCity(name,features){return new Promise((resolve,reject)=>{const dialog=$('choose');$('choose-label').textContent=`Flere norske steder passer til «${name}». Velg stedet du vil bruke.`;$('choices').replaceChildren();for(let i=0;i<features.length;i++){const f=features[i],b=el('button',f.properties.name);b.type='submit';b.value=String(i);b.append(el('small',[f.properties.city,f.properties.county,f.properties.state].filter(Boolean).filter((v,i,a)=>a.indexOf(v)===i).join(', ')));$('choices').append(b);}dialog.addEventListener('close',()=>{const index=Number(dialog.returnValue);if(dialog.returnValue==='cancel'||dialog.returnValue===''||!features[index])reject(new Error('Søket ble avbrutt.'));else resolve(features[index]);},{once:true});dialog.returnValue='';dialog.showModal();});}
async function city(name){const key='veihotell-place-v3-'+name.toLocaleLowerCase('nb');try{const cached=JSON.parse(sessionStorage.getItem(key));if(cached)return cached;}catch{}const known=(await loadPlaces()).filter(p=>normalizePlace(p.name)===normalizePlace(name));const queryName=name.split('/')[0].replace(/\s*\([^)]*\)\s*$/,'').trim();const params=new URLSearchParams({q:queryName,countrycode:'NO',limit:'10'});params.append('layer','city');params.append('layer','locality');const data=await json('https://photon.komoot.io/api/?'+params);let features=(data.features??[]).filter(f=>f.properties.countrycode?.toUpperCase()==='NO');if(known.length){const local=features.filter(f=>known.some(p=>inSettlement(f.geometry.coordinates,p)));if(local.length)features=local;else features=[];}if(!features.length)throw new Error(`Fant ikke «${name}» som norsk by eller tettsted. Prøv et annet navn.`);const exact=features.filter(f=>f.properties.name.toLocaleLowerCase('nb')===queryName.toLocaleLowerCase('nb'));if(exact.length)features=exact;const inhabited=features.filter(f=>['city','town','village','hamlet'].includes(f.properties.osm_value));if(inhabited.length)features=inhabited;const f=features.length===1?features[0]:await chooseCity(name,features);const result={name:f.properties.name,coords:f.geometry.coordinates,region:f.properties.state??''};try{sessionStorage.setItem(key,JSON.stringify(result));}catch{}return result;}
function initMap(){if(!window.L){$('map').append(el('p','Kartet kunne ikke lastes. Resultatene vises fortsatt i listen.'));return;}map=L.map('map',{zoomControl:false}).setView([59.66,10.73],9);L.control.zoom({position:'topright'}).addTo(map);L.tileLayer('https://tile.openstreetmap.org/{z}/{x}/{y}.png',{maxZoom:19,attribution:'© <a href="https://www.openstreetmap.org/copyright">OpenStreetMap</a>'}).addTo(map);markers=L.layerGroup().addTo(map);}
function pin(label,city=false,kind='hotel'){const station=!city&&kind!=='hotel';return L.divIcon({className:'pin'+(city?' city-pin':'')+(kind==='activity'?' activity-pin':'')+(kind==='fuel'?' fuel-pin':kind==='charging'?' charging-pin':''),html:station?'<span aria-hidden="true">'+(kind==='activity'?'★':kind==='charging'?'⚡':'⛽')+'</span><b>'+String(label)+'</b>':String(label),iconSize:[30,30],iconAnchor:[15,15]});}
function popup(h){const node=el('div');node.append(el('strong',h.name),el('p',km(h.distance)+(active?.mode==='nearby'?' fra deg i luftlinje':' fra ruten i luftlinje')),navigationLink(h));return node;}
function focusHotel(index){if(!map)return;const marker=active.hotelMarkers[index];if(!marker)return;map.setView(marker.getLatLng(),14);marker.openPopup();if(innerWidth<=800)$('map').scrollIntoView({behavior:'smooth',block:'start'});}
function render(data,cached=false){
  const near=data.mode==='nearby',types=data.types??['hotel'],label=resultLabel(types);active={...data,hotelMarkers:[]};$('results-title').textContent=label[0].toUpperCase()+label.slice(1)+(near?' nær deg':' langs ruten');
  $('summary').hidden=false;$('summary').replaceChildren(el('div',near?label[0].toUpperCase()+label.slice(1)+' nær deg':data.from.name+' → '+data.to.name,'summary-route'));
  const distance=el('div',km(near?data.radius*1000:data.route.distance),'stat');distance.append(el('small',near?'Søkeradius':'Kjørerute'));
  let other;
  if(near){other=el('div',Math.ceil(data.accuracy)+' m','stat');other.append(el('small','Oppgitt posisjonsnøyaktighet'));}
  else{const minutes=Math.round(data.route.duration/60);other=el('div',minutes>=60?Math.floor(minutes/60)+' t '+minutes%60+' min':minutes+' min','stat');other.append(el('small','Estimert, uten trafikk'));}
  $('summary').append(distance,other);
  const note=near?'Steder der du befinner deg tas med. Avstandene er i luftlinje.':types.includes('hotel')?'Hoteller i startstedets tettstedsområde er utelatt: '+data.startAreaName+(types.some(t=>t!=='hotel')?'. Bensinstasjoner, ladestasjoner og aktiviteter i startstedet tas med.':''):'Bensinstasjoner, ladestasjoner og aktiviteter i startstedet tas med.';
  $('summary').append(el('small',note,'summary-exclusion'));
  $('count').textContent=String(data.hotels.length);$('results').replaceChildren();$('navigation-hint').hidden=!data.hotels.length;
  if(!data.hotels.length){const empty=el('div',undefined,'empty');empty.append(el('strong','Ingen '+label+' innen '+radiusText(data.radius)+(near?' fra deg':' fra ruten')),el('p',near?'Velg andre kategorier eller prøv igjen fra et annet sted.':'Øk avstanden eller prøv et nytt søk.'));$('results').append(empty);}
  for(const [i,h] of data.hotels.entries()){
    const card=el('article',undefined,'hotel'),button=el('button',String(i+1),'hotel-index');button.type='button';button.setAttribute('aria-label','Vis '+h.name+' i kartet');button.addEventListener('click',()=>focusHotel(i));
    const content=el('div'),title=el('h3',h.name),tags=h.tags;content.append(title,el('span',h.kind==='activity'?activityLabel(tags):kindLabel(h.kind),h.kind==='charging'?'kind-label charging-label':h.kind==='fuel'?'kind-label fuel-label':'kind-label'),el('p',km(h.distance)+(near?' fra deg i luftlinje':' fra ruten'),'distance'));
    if(!near)content.append(el('p','Ca. '+km(h.along)+' fra start langs ruten'));
    const address=[tags['addr:street'],tags['addr:housenumber'],tags['addr:city']].filter(Boolean).join(' ');if(address)content.append(el('p',address));
    if(h.kind==='activity'){if(tags.opening_hours)content.append(el('p','Registrerte åpningstider: '+(tags.opening_hours==='24/7'?'Døgnåpent':tags.opening_hours)));if(tags.fee==='yes'||tags.fee==='no')content.append(el('p',tags.fee==='yes'?'Registrert med inngangsavgift':'Registrert uten inngangsavgift'));}
    if(h.kind==='fuel'){const details=fuelDetails(tags);if(details.hours)content.append(el('p','Registrerte åpningstider: '+details.hours));if(details.fuels.length)content.append(el('p','Registrert drivstoff: '+details.fuels.join(', ')));}
    if(h.kind==='charging'){const details=chargingDetails(tags);if(details.operator)content.append(el('p','Operatør: '+details.operator));if(details.connectors.length)content.append(el('p','Registrerte kontakter: '+details.connectors.join(', ')));if(details.hours)content.append(el('p','Registrerte åpningstider: '+details.hours));if(details.access)content.append(el('p',details.access));content.append(el('p','Ledighet og ladepris må sjekkes hos operatøren.'));}
    const links=el('div',undefined,'hotel-links'),website=safeWebsite(tags.website??tags['contact:website']);links.append(navigationLink(h));if(website)links.append(link(h.kind==='activity'?'Aktivitetens nettside':h.kind&&h.kind!=='hotel'?'Stasjonens nettside':'Hotellets nettside',website));links.append(link('Kartdetaljer','https://www.openstreetmap.org/'+h.id));content.append(links);card.append(button,content);$('results').append(card);
  }
  const stamp=new Date(data.savedAt).toLocaleString('nb-NO',{dateStyle:'short',timeStyle:'short'});
  status(cached?'Viser siste lagrede søk fra '+stamp+'. Nye søk krever internett.':'Fant '+data.hotels.length+' '+label+' innen '+radiusText(data.radius)+' '+(near?'fra deg':'fra ruten')+'. Oppdatert '+stamp+'.'+(near&&data.accuracy>100?' Posisjonen er upresis; avstandene kan avvike.':''));
  $('map-tip').textContent=near?label.toUpperCase()+' NÆR DEG':data.from.name.toUpperCase()+' → '+data.to.name.toUpperCase();document.querySelector('.map-area').classList.add('has-route');
  document.querySelector('.map-caption').firstChild.classList.toggle('nearby-key',near);
  $('map-line-label').textContent=near?'Søkeområde':'Kjørerute';$('hotel-legend').hidden=!types.includes('hotel');$('fuel-legend').hidden=!types.includes('fuel');$('charging-legend').hidden=!types.includes('charging');$('activity-legend').hidden=!hasActivities(types);
  if(map){
    map.invalidateSize();markers.clearLayers();if(routeLayer)map.removeLayer(routeLayer);
    if(near){routeLayer=L.circle([data.origin[1],data.origin[0]],{radius:data.radius*1000,color:'#176448',weight:2,fillOpacity:.05}).addTo(map);L.marker([data.origin[1],data.origin[0]],{icon:pin('Du',true)}).bindPopup(el('strong','Din posisjon')).addTo(markers);}
    else{routeLayer=L.polyline(data.route.geometry.coordinates.map(p=>[p[1],p[0]]),{color:'#176448',weight:5,opacity:.95}).addTo(map);[data.from,data.to].forEach((c,i)=>L.marker([c.coords[1],c.coords[0]],{icon:pin(i?'B':'A',true)}).bindPopup(el('strong',c.name)).addTo(markers));}
    map.fitBounds(routeLayer.getBounds(),{padding:[45,65]});data.hotels.forEach((h,i)=>active.hotelMarkers.push(L.marker([h.coords[1],h.coords[0]],{icon:pin(i+1,false,h.kind??'hotel')}).bindPopup(popup(h)).addTo(markers)));
  }
}
function radiusText(radius){return Number(radius)===0.3?'300 m':radius+' km';}
function setBusy(value){busy=value;document.querySelectorAll('#search input,#search button,#search select,#nearby button,#nearby select,#nearby input,#types').forEach(c=>c.disabled=value);}
async function nearbySearch(){
  if(busy)return;if(!selectedTypes($('types').value).length){status('Velg minst én type: Hoteller, Bensin, Elbil-lading eller Aktiviteter.',true);return;}if(!navigator.onLine){status('Du er uten nett. Søk nær deg krever internett.',true);return;}
  setBusy(true);$('locate').textContent='Henter posisjon …';
  try{
    status('Tillat posisjon når telefonen spør. Posisjonen brukes til dette søket.');
    const types=selectedTypes($('types').value),label=resultLabel(types),location=await getPosition(navigator.geolocation);
    $('locate').textContent='Søker …';status('Finner '+label+' nær posisjonen din …');
    let radius,hotels=[];
    for(const searchRadius of [10,25,50]){
      radius=searchRadius;
      const result=await overpass(nearQuery(location.coords,radius*1000,types));
      hotels=extractPlaces(result.elements??[],location.coords,radius*1000,types,true).slice(0,10);
      if(hotels.length===10)break;
    }
    render({mode:'nearby',types,origin:location.coords,accuracy:location.accuracy,radius,hotels,savedAt:Date.now()});
  }catch(error){status(error.message+(active?' Viser fortsatt forrige søk.':''),true);}
  finally{setBusy(false);updateSearchLabels();}
}
async function overpass(query){
  const endpoints=['https://overpass.private.coffee/api/interpreter','https://overpass-api.de/api/interpreter'];
  for(const [index,endpoint] of endpoints.entries()){
    if(index)status('Kartregisteret svarte ikke. Prøver reserveserveren …');
    try{
      const result=await json(endpoint,{method:'POST',headers:{'Content-Type':'application/x-www-form-urlencoded'},body:new URLSearchParams({data:query})},55000);
      // A timed-out query may include partial elements. Never present these as a complete search.
      if(!result.remark&&Array.isArray(result.elements))return result;
    }catch{}
  }
  throw new Error('Ingen av kartregisterets to servere svarte med et fullstendig søk. Vent et minutt og prøv igjen.');
}
$('locate')?.addEventListener('click',nearbySearch);
async function search(event){event?.preventDefault();if(busy)return;const from=$('from').value.trim(),to=$('to').value.trim(),radius=Number($('radius').value),types=selectedTypes($('types').value),label=resultLabel(types);if(!types.length){status('Velg minst én type: Hoteller, Bensin, Elbil-lading eller Aktiviteter.',true);return;}if(!from||!to){status('Fyll inn både startsted og målsted.',true);return;}if(from.toLocaleLowerCase('nb')===to.toLocaleLowerCase('nb')){status('Velg to forskjellige byer eller tettsteder.',true);return;}if(!navigator.onLine){status('Du er uten nett. Siste lagrede søk kan fortsatt vises, men nye søk krever internett.',true);return;}setBusy(true);$('submit').textContent='Søker …';try{status('Finner byene eller tettstedene …');const a=await city(from),b=await city(to);if(a.coords.join(',')===b.coords.join(','))throw new Error('Begge navnene peker til samme sted. Velg to forskjellige byer eller tettsteder.');status('Beregner kjøreruten …');const r=await json(`https://router.project-osrm.org/route/v1/driving/${a.coords.join(',')};${b.coords.join(',')}?overview=full&geometries=geojson&steps=false`);if(r.code!=='Ok'||!r.routes?.length)throw new Error('Fant ingen kjørbar rute mellom stedene.');const route=r.routes[0];const places=await loadPlaces();if(types.includes('hotel')&&!findStartSettlement(a,places))throw new Error('Fant ikke tettstedsgrensen for '+a.name+'. Velg et startsted fra forslagene.');status('Leter etter '+label+' langs hele ruten …');const query=routeQuery(route.geometry.coordinates,radius*1000,types);const hotelsData=await overpass(query);const data=withoutStartHotels({from:a,to:b,radius,types,route:{distance:route.distance,duration:route.duration,geometry:route.geometry},hotels:extractPlaces(hotelsData.elements??[],route.geometry.coordinates,radius*1000,types),savedAt:Date.now()},places);render(data);try{localStorage.setItem('veihotell-last-v3',JSON.stringify(data));}catch{status('Søket er klart, men kunne ikke lagres på denne enheten.');}}catch(error){const msg=error.name==='AbortError'?'Søket tok for lang tid. Prøv igjen om litt.':error.message;status(msg+(active?' Viser fortsatt forrige vellykkede søk.':''),true);}finally{setBusy(false);updateSearchLabels();}}
$('search')?.addEventListener('submit',search);$('radius')?.addEventListener('change',syncChoices);$('swap')?.addEventListener('click',()=>{const value=$('from').value;$('from').value=$('to').value;$('to').value=value;});
window.addEventListener('beforeinstallprompt',event=>{event.preventDefault();deferredInstall=event;$('install').hidden=false;});$('install').addEventListener('click',async()=>{if(!deferredInstall)return;await deferredInstall.prompt();deferredInstall=null;$('install').hidden=true;});window.addEventListener('appinstalled',()=>{$('install').hidden=true;});
window.addEventListener('offline',()=>status('Du er uten nett. Viser siste søk; bakgrunnskartet kan være utilgjengelig.'));window.addEventListener('online',()=>status('Du er på nett igjen. Du kan søke etter en ny rute.'));
if('serviceWorker' in navigator)navigator.serviceWorker.register('./sw.js').catch(()=>{});
const mobile=matchMedia('(max-width:800px)'),mapArea=document.querySelector('.map-area');let panelClosed=false;
function arrangeMap(){if(mobile.matches&&!panelClosed)document.querySelector('aside').insertBefore(mapArea,$('summary'));else document.querySelector('main').append(mapArea);if(map)map.invalidateSize();}
function setPanelClosed(closed){
  panelClosed=closed;document.body.classList.toggle('panel-closed',closed);
  const panel=$('search-panel'),toggle=$('panel-toggle');
  panel.inert=closed;panel.setAttribute('aria-hidden',String(closed));
  toggle.setAttribute('aria-expanded',String(!closed));toggle.setAttribute('aria-label',closed?'Åpne søkepanelet':'Skjul søkepanelet');
  toggle.firstElementChild.textContent=closed?'›':'‹';arrangeMap();
}
let panelDragStart=null,ignorePanelClick=false;
$('panel-toggle')?.addEventListener('click',()=>{if(ignorePanelClick){ignorePanelClick=false;return;}setPanelClosed(!panelClosed);});
$('panel-toggle')?.addEventListener('pointerdown',event=>{ignorePanelClick=false;panelDragStart=event.clientX;event.currentTarget.setPointerCapture(event.pointerId);});
$('panel-toggle')?.addEventListener('pointerup',event=>{
  if(panelDragStart===null)return;const dx=event.clientX-panelDragStart;panelDragStart=null;
  if(Math.abs(dx)>25){setPanelClosed(dx<0);ignorePanelClick=true;event.preventDefault();}
});
$('panel-toggle')?.addEventListener('pointercancel',()=>{panelDragStart=null;});
mobile.addEventListener('change',arrangeMap);arrangeMap();initMap();
async function bootstrap(){try{const places=await loadPlaces();let restored=false;try{const stored=JSON.parse(localStorage.getItem('veihotell-last-v3')??localStorage.getItem('veihotell-last-v2')??localStorage.getItem('veihotell-last-v1'));if(stored?.route?.geometry?.coordinates?.length&&Array.isArray(stored.hotels)){const data=stored.filterVersion===3?stored:withoutStartHotels(stored,places);restored=true;$('types').value=typeValue(data.types);updateSearchLabels();$('from').value=data.from.name;$('to').value=data.to.name;$('radius').value=data.radius;syncChoices();render(data,true);localStorage.setItem('veihotell-last-v3',JSON.stringify(data));}}catch{}if(!restored)search();}catch{status('Stedsoversikten kunne ikke lastes. Koble til internett og prøv igjen.',true);}}if(!isNearby)bootstrap();else updateSearchLabels();


