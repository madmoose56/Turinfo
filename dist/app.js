import {findStartSettlement,excludeStartHotels,inSettlement,normalizePlace} from './geo.js?v=29';
import {getPosition} from './nearby.js?v=29';
import {fixedMapView,routeAhead,headingTarget} from './map-view.js?v=29';
import {selectedTypes,resultLabel,routeQueries,nearQuery,extractPlaces,fuelDetails,chargingDetails,typeValue,kindLabel,activityLabel,activityTypes,activityCategories,hasActivities} from './poi.js?v=29';
const isNearby=document.body?.dataset.page==='nearby';
const $=id=>document.getElementById(id),fmt=new Intl.NumberFormat('nb-NO',{maximumFractionDigits:1}),km=n=>fmt.format(n/1000)+' km';let map,routeLayer,markers,active,deferredInstall,placesPromise,busy=false;
let gpsPosition,gpsMarker,gpsAccuracy,cameraAnchor=[10.73,59.66],cameraTarget=null;
async function loadPlaces(){if(!placesPromise)placesPromise=json('./places.json',{},30000).then(data=>{const list=$('cities');const names=[...new Set(data.places.map(p=>p.name))];list.replaceChildren(...names.map(name=>{const option=el('option');option.value=name;return option;}));return data.places;}).catch(error=>{placesPromise=null;throw error;});return placesPromise;}
function withoutStartHotels(data,places){
  const needsHotels=(data.types??['hotel']).includes('hotel'),startArea=needsHotels?findStartSettlement(data.from,places):null;
  if(needsHotels&&!startArea&&!data.from.gpsOrigin)throw new Error('Fant ikke tettstedsgrensen for '+data.from.name+'. Velg et startsted fra forslagene.');
  const filterFrom=data.from.gpsOrigin&&startArea?{...data.from,name:startArea.name}:data.from;
  const hotels=data.hotels.filter(h=>!startArea||(h.kind&&h.kind!=='hotel')||excludeStartHotels([h],filterFrom,startArea).length);
  return {...data,hotels,startAreaName:startArea?.name??'',excludedCount:data.hotels.length-hotels.length,filterVersion:3};
}
function fromGPS(){return $('from-mode')?.value==='gps';}
function refreshFromMode(){
  if(isNearby)return;
  const gps=fromGPS();$('from-place').hidden=gps;$('from-gps-note').hidden=!gps;
  $('from').required=!gps;$('from').disabled=busy||gps;$('swap').hidden=gps;$('swap').disabled=busy||gps;
  document.querySelectorAll('input[name="from-mode-choice"]').forEach(input=>{input.checked=input.value===(gps?'gps':'place');});
}
function routeButtonText(){if(!busy)return 'Søk langs ruta';const names={hotel:'hoteller',fuel:'bensin',charging:'elbil-lading',family:'familie',outdoor:'friluft og sport',culture:'kultur',food:'mat og drikke',activity:'aktiviteter'};return 'Søker: '+selectedTypes($('types').value).map(type=>names[type]).join(' · ')+' …';}
function updateSearchLabels(){const label=resultLabel(selectedTypes($('types').value));if($('submit'))$('submit').textContent=routeButtonText();if($('locate'))$('locate').textContent='Finn '+label+' nær meg';if($('nearby-title'))$('nearby-title').textContent=label[0].toUpperCase()+label.slice(1)+' nær deg';syncChoices();}
$('types').addEventListener('change',()=>{$('category-counts').hidden=true;updateSearchLabels();});
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
  if(!busy)$('category-counts').hidden=true;
  const input=event.target;
  if(input.name==='poi-type'){
    $('types').value=[...document.querySelectorAll('input[name="poi-type"]')].filter(item=>item.checked).map(item=>item.value).join(',');updateSearchLabels();
  }else if(input.name==='radius-choice'){$('radius').value=input.value;syncChoices();}
  else if(input.name==='from-mode-choice'){$('from-mode').value=input.value;refreshFromMode();}
});
$('from-mode')?.addEventListener('change',refreshFromMode);
function status(message,error=false){if(error&&$('category-counts')){$('category-counts').hidden=false;$('category-counts').textContent='Søket ble ikke fullført. Ingen nye antall treff å vise.';}$('status').textContent=message;$('status').classList.toggle('error',error);}
function el(tag,text,className){const node=document.createElement(tag);if(text!==undefined)node.textContent=text;if(className)node.className=className;return node;}
function safeWebsite(raw){if(!raw)return null;try{const u=new URL(raw.match(/^https?:\/\//i)?raw:'https://'+raw);return ['https:','http:'].includes(u.protocol)?u.href:null;}catch{return null;}}
function link(label,url){const a=el('a',label);a.href=url;a.target='_blank';a.rel='noopener noreferrer';return a;}
function directions(h){const destination=encodeURIComponent(h.coords[1]+','+h.coords[0]),apple=/iPhone|iPad|iPod/.test(navigator.userAgent??'')||(/Macintosh/.test(navigator.userAgent??'')&&navigator.maxTouchPoints>1);return apple?'https://maps.apple.com/?daddr='+destination+'&dirflg=d':'https://www.google.com/maps/dir/?api=1&destination='+destination+'&travelmode=driving&dir_action=navigate';}
function navigationLink(h){const a=link('Naviger hit',directions(h));a.className='navigate-link';a.setAttribute('aria-label','Naviger hit: '+h.name);return a;}
async function json(url,options={},timeout=25000){const controller=new AbortController(),timer=setTimeout(()=>controller.abort(),timeout);try{const response=await fetch(url,{...options,signal:controller.signal});if(!response.ok)throw new Error('Tjenesten svarte med '+response.status);return await response.json();}finally{clearTimeout(timer);}}
async function chooseCity(name,features){return new Promise((resolve,reject)=>{const dialog=$('choose');$('choose-label').textContent=`Flere norske steder passer til «${name}». Velg stedet du vil bruke.`;$('choices').replaceChildren();for(let i=0;i<features.length;i++){const f=features[i],b=el('button',f.properties.name);b.type='submit';b.value=String(i);b.append(el('small',[f.properties.city,f.properties.county,f.properties.state].filter(Boolean).filter((v,i,a)=>a.indexOf(v)===i).join(', ')));$('choices').append(b);}dialog.addEventListener('close',()=>{const index=Number(dialog.returnValue);if(dialog.returnValue==='cancel'||dialog.returnValue===''||!features[index])reject(new Error('Søket ble avbrutt.'));else resolve(features[index]);},{once:true});dialog.returnValue='';dialog.showModal();});}
async function city(name){const key='veihotell-place-v3-'+name.toLocaleLowerCase('nb');try{const cached=JSON.parse(sessionStorage.getItem(key));if(cached)return cached;}catch{}const known=(await loadPlaces()).filter(p=>normalizePlace(p.name)===normalizePlace(name));const queryName=name.split('/')[0].replace(/\s*\([^)]*\)\s*$/,'').trim();const params=new URLSearchParams({q:queryName,countrycode:'NO',limit:'10'});params.append('layer','city');params.append('layer','locality');const data=await json('https://photon.komoot.io/api/?'+params);let features=(data.features??[]).filter(f=>f.properties.countrycode?.toUpperCase()==='NO');if(known.length){const local=features.filter(f=>known.some(p=>inSettlement(f.geometry.coordinates,p)));if(local.length)features=local;else features=[];}if(!features.length)throw new Error(`Fant ikke «${name}» som norsk by eller tettsted. Prøv et annet navn.`);const exact=features.filter(f=>f.properties.name.toLocaleLowerCase('nb')===queryName.toLocaleLowerCase('nb'));if(exact.length)features=exact;const inhabited=features.filter(f=>['city','town','village','hamlet'].includes(f.properties.osm_value));if(inhabited.length)features=inhabited;const f=features.length===1?features[0]:await chooseCity(name,features);const result={name:f.properties.name,coords:f.geometry.coordinates,region:f.properties.state??''};try{sessionStorage.setItem(key,JSON.stringify(result));}catch{}return result;}
function initMap(){if(!window.L){$('map').append(el('p','Kartet kunne ikke lastes. Resultatene vises fortsatt i listen.'));return;}map=L.map('map',{zoomControl:false,zoomSnap:0}).setView([59.66,10.73],9);L.control.zoom({position:'topright'}).addTo(map);L.tileLayer('https://tile.openstreetmap.org/{z}/{x}/{y}.png',{maxZoom:19,attribution:'© <a href="https://www.openstreetmap.org/copyright">OpenStreetMap</a>'}).addTo(map);markers=L.layerGroup().addTo(map);applyMapView();}
function applyMapView(){
  if(!map)return;const size=map.getSize(),pixels=Math.min(size.x,size.y);if(pixels<=36)return;
  const view=fixedMapView(cameraAnchor,cameraTarget,pixels);
  map.setView([view.center[1],view.center[0]],view.zoom,{animate:false});
}
function resetMapView(){
  const near=active?.mode==='nearby';cameraAnchor=gpsPosition?.coords??(near?active.origin:active?.from.coords)??[10.73,59.66];
  if(!near&&active?.route)cameraTarget=routeAhead(active.route.geometry.coordinates,cameraAnchor);
  else if(near){const nearest=active.hotels.find(h=>h.coords[0]!==cameraAnchor[0]||h.coords[1]!==cameraAnchor[1]);cameraTarget=Number.isFinite(gpsPosition?.heading)?headingTarget(cameraAnchor,gpsPosition.heading):nearest?.coords??headingTarget(cameraAnchor,0);}
  else cameraTarget=null;
  applyMapView();
}
function drawGPS(){
  if(!map||!gpsPosition)return;
  if(gpsMarker)map.removeLayer(gpsMarker);if(gpsAccuracy)map.removeLayer(gpsAccuracy);
  const point=[gpsPosition.coords[1],gpsPosition.coords[0]];
  gpsAccuracy=L.circle(point,{radius:gpsPosition.accuracy,color:'#2674df',weight:1,fillOpacity:.08,interactive:false}).addTo(map);
  gpsMarker=L.circleMarker(point,{radius:8,color:'#fff',weight:3,fillColor:'#2674df',fillOpacity:1}).bindPopup(el('strong','Din GPS-posisjon · nøyaktighet '+Math.ceil(gpsPosition.accuracy)+' m')).addTo(map);
}
async function showMyPosition(){
  if(busy)return;
  const button=$('map-location');button.disabled=true;$('map-location-status').textContent='Henter GPS-posisjonen …';
  try{const position=await getPosition(navigator.geolocation);if(isNearby)await nearbySearch(position);else{gpsPosition=position;drawGPS();resetMapView();$('map-location-status').textContent='Blå prikk: din GPS-posisjon. Oppgitt nøyaktighet '+Math.ceil(gpsPosition.accuracy)+' m.';}}
  catch(error){$('map-location-status').textContent=error.message;}
  finally{button.disabled=false;}
}
function pin(label,city=false,kind='hotel'){const station=!city&&kind!=='hotel';return L.divIcon({className:'pin'+(city?' city-pin':'')+(kind==='activity'?' activity-pin':'')+(kind==='fuel'?' fuel-pin':kind==='charging'?' charging-pin':''),html:station?'<span aria-hidden="true">'+(kind==='activity'?'★':kind==='charging'?'⚡':'⛽')+'</span><b>'+String(label)+'</b>':String(label),iconSize:[30,30],iconAnchor:[15,15]});}
function popup(h){const node=el('div');node.append(el('strong',h.name),el('p',km(h.distance)+(active?.mode==='nearby'?' fra deg i luftlinje':' fra ruten i luftlinje')),navigationLink(h));return node;}
function focusHotel(index){if(!map)return;const marker=active.hotelMarkers[index];if(!marker)return;cameraAnchor=active.hotels[index].coords;cameraTarget=null;applyMapView();marker.openPopup();if(innerWidth<=800)$('map').scrollIntoView({behavior:'smooth',block:'start'});}
function renderCategoryCounts(data,cached=false){
  const types=data.types??['hotel'],names={hotel:'Hoteller',fuel:'Bensin',charging:'Elbil-lading',family:'Familie',outdoor:'Friluft og sport',culture:'Kultur',food:'Mat og drikke',activity:'Aktiviteter'};
  const counts=types.map(type=>names[type]+': '+((data.unavailableTypes??[]).includes(type)?'utilgjengelig':data.hotels.filter(h=>type==='activity'?h.kind==='activity':activityTypes.includes(type)?h.kind==='activity'&&activityCategories(h.tags).includes(type):(h.kind??'hotel')===type).length));
  const box=$('category-counts');box.hidden=false;box.textContent=(cached?'Siste lagrede søk: ':data.mode==='nearby'?'Treff i listen: ':'')+counts.join(' · ');
  if(data.hotelSnapshotAt)box.textContent+=' · Hotellopplysninger fra '+new Date(data.hotelSnapshotAt).toLocaleDateString('nb-NO');
}
function render(data,cached=false){
  const near=data.mode==='nearby',types=data.types??['hotel'],label=resultLabel(types);active={...data,hotelMarkers:[]};$('results-title').textContent=label[0].toUpperCase()+label.slice(1)+(near?' nær deg':' langs ruten');
  $('overview-hint').hidden=true;$('summary').hidden=false;$('summary').replaceChildren(el('div',near?label[0].toUpperCase()+label.slice(1)+' nær deg':data.from.name+' → '+data.to.name,'summary-route'));
  const distance=el('div',km(near?data.radius*1000:data.route.distance),'stat');distance.append(el('small',near?'Søkeradius':'Kjørerute'));
  let other;
  if(near){other=el('div',Math.ceil(data.accuracy)+' m','stat');other.append(el('small','Oppgitt posisjonsnøyaktighet'));}
  else{const minutes=Math.round(data.route.duration/60);other=el('div',minutes>=60?Math.floor(minutes/60)+' t '+minutes%60+' min':minutes+' min','stat');other.append(el('small','Estimert, uten trafikk'));}
  $('summary').append(distance,other);
  const note=near?'Steder der du befinner deg tas med. Avstandene er i luftlinje.':types.includes('hotel')?(data.startAreaName?'Hoteller i startstedets tettstedsområde er utelatt: '+data.startAreaName+(types.some(t=>t!=='hotel')?'. Bensinstasjoner, ladestasjoner og aktiviteter i startstedet tas med.':''):'Startposisjonen er utenfor et tettstedsområde. Hoteller langs ruten tas med.'):'Bensinstasjoner, ladestasjoner og aktiviteter i startstedet tas med.';
  $('summary').append(el('small',note,'summary-exclusion'));
  renderCategoryCounts(data,cached);$('count').textContent=String(data.hotels.length);$('results').replaceChildren();$('navigation-hint').hidden=!data.hotels.length;
  if(!data.hotels.length){const empty=el('div',undefined,'empty'),availableLabel=resultLabel(types.filter(type=>!(data.unavailableTypes??[]).includes(type)));empty.append(el('strong','Ingen '+availableLabel+' innen '+radiusText(data.radius)+(near?' fra deg':' fra ruten')),el('p',near?'Velg andre kategorier eller prøv igjen fra et annet sted.':'Øk avstanden eller prøv et nytt søk.'));$('results').append(empty);}
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
  if(!cached&&data.hotelSnapshotAt)status('Kartregisteret svarte ikke på hotellsøket. Viser hotelloversikten fra '+new Date(data.hotelSnapshotAt).toLocaleDateString('nb-NO')+'. Fant '+data.hotels.length+' '+label+' innen '+radiusText(data.radius)+(near?' fra deg.':' fra ruten.'));
  if(data.unavailableTypes?.length)status('Søket er delvis. Viser hotelloversikten fra '+new Date(data.hotelSnapshotAt).toLocaleDateString('nb-NO')+'. '+resultLabel(data.unavailableTypes)+' kunne ikke hentes. Viser '+data.hotels.length+' hotelltreff'+(near?' nær deg.':' langs ruten.')+' Prøv igjen for de andre kategoriene.');
  $('map-tip').textContent=near?label.toUpperCase()+' NÆR DEG':data.from.name.toUpperCase()+' → '+data.to.name.toUpperCase();document.querySelector('.map-area').classList.add('has-route');
  document.querySelector('.map-caption').firstChild.classList.toggle('nearby-key',near);
  $('map-line-label').textContent=near?'Søkeområde':'Kjørerute';$('hotel-legend').hidden=!types.includes('hotel');$('fuel-legend').hidden=!types.includes('fuel');$('charging-legend').hidden=!types.includes('charging');$('activity-legend').hidden=!hasActivities(types);
  if(map){
    map.invalidateSize();markers.clearLayers();if(routeLayer)map.removeLayer(routeLayer);
    if(near){gpsPosition={coords:data.origin,accuracy:data.accuracy,heading:data.heading};routeLayer=L.circle([data.origin[1],data.origin[0]],{radius:data.radius*1000,color:'#176448',weight:2,fillOpacity:.05}).addTo(map);$('map-location-status').textContent='Blå prikk: din GPS-posisjon. Oppgitt nøyaktighet '+Math.ceil(data.accuracy)+' m.';}
    else{routeLayer=L.polyline(data.route.geometry.coordinates.map(p=>[p[1],p[0]]),{color:'#176448',weight:5,opacity:.95}).addTo(map);[data.from,data.to].forEach((c,i)=>L.marker([c.coords[1],c.coords[0]],{icon:pin(i?'B':'A',true)}).bindPopup(el('strong',c.name)).addTo(markers));}
    data.hotels.forEach((h,i)=>active.hotelMarkers.push(L.marker([h.coords[1],h.coords[0]],{icon:pin(i+1,false,h.kind??'hotel')}).bindPopup(popup(h)).addTo(markers)));
    drawGPS();resetMapView();
  }
}
function radiusText(radius){return Number(radius)===0.3?'300 m':radius+' km';}
function setBusy(value){if(value&&$('category-counts'))$('category-counts').hidden=true;busy=value;document.querySelectorAll('#search input,#search button,#search select,#nearby button,#nearby select,#nearby input,#types,#map-location').forEach(c=>c.disabled=value);refreshFromMode();}
async function nearbySearch(locationOverride){
  if(busy)return;if(!selectedTypes($('types').value).length){status('Velg minst én type: Hoteller, Bensin, Elbil-lading eller Aktiviteter.',true);return;}if(!navigator.onLine){status('Du er uten nett. Søk nær deg krever internett.',true);return;}
  setBusy(true);$('locate').textContent='Henter posisjon …';
  try{
    status('Tillat posisjon når telefonen spør. Posisjonen brukes til dette søket.');
    const types=selectedTypes($('types').value),label=resultLabel(types),location=locationOverride?.coords?locationOverride:await getPosition(navigator.geolocation);
    $('locate').textContent='Søker …';status('Finner '+label+' nær posisjonen din …');
    let radius,hotels=[],hotelSnapshotAt,reserveSnapshot,unavailableTypes=[];
    for(const searchRadius of [10,25,50]){
      radius=searchRadius;
      let result;
      if(!reserveSnapshot)try{result=await overpass(nearQuery(location.coords,radius*1000,types));}catch(error){if(!types.includes('hotel'))throw error;reserveSnapshot=await json('./hotels.json',{},10000);if(!reserveSnapshot.updatedAt||!Array.isArray(reserveSnapshot.elements))throw error;hotelSnapshotAt=reserveSnapshot.updatedAt;}
      if(reserveSnapshot){
        result=reserveSnapshot;
        const remaining=types.filter(type=>type!=='hotel');
        if(remaining.length&&!unavailableTypes.length)try{const other=await overpass(nearQuery(location.coords,radius*1000,remaining));result={elements:[...reserveSnapshot.elements,...other.elements]};}catch{unavailableTypes=remaining;}
      }
      hotels=extractPlaces(result.elements??[],location.coords,radius*1000,types,true).slice(0,10);
      if(hotels.length===10)break;
    }
    render({mode:'nearby',types,origin:location.coords,accuracy:location.accuracy,heading:location.heading,radius,hotels,hotelSnapshotAt,unavailableTypes,savedAt:Date.now()});
  }catch(error){status(error.message+(active?' Viser fortsatt forrige søk.':''),true);}
  finally{setBusy(false);updateSearchLabels();}
}
let preferredOverpass='https://overpass.openstreetmap.fr/api/interpreter';
async function overpass(query){
  const endpoints=[...new Set([preferredOverpass,'https://overpass.openstreetmap.fr/api/interpreter','https://overpass.private.coffee/api/interpreter','https://overpass-api.de/api/interpreter'])];
  for(const [index,endpoint] of endpoints.entries()){
    if(index)status('Kartregisteret svarte ikke. Prøver reserveserveren …');
    try{
      const result=await json(endpoint,{method:'POST',headers:{'Content-Type':'application/x-www-form-urlencoded'},body:new URLSearchParams({data:query})},20000);
      // A timed-out query may include partial elements. Never present these as a complete search.
      if(!result.remark&&Array.isArray(result.elements)){preferredOverpass=endpoint;return result;}
    }catch{}
  }
  throw new Error('Ingen av kartregisterets servere svarte med et fullstendig søk. Vent et minutt og prøv igjen.');
}
$('locate')?.addEventListener('click',nearbySearch);
async function search(event){
  event?.preventDefault();if(busy)return;
  const gps=fromGPS(),from=$('from').value.trim(),to=$('to').value.trim(),radius=Number($('radius').value),types=selectedTypes($('types').value),label=resultLabel(types);
  if(!types.length){status('Velg minst én type: Hoteller, Bensin, Elbil-lading eller Aktiviteter.',true);return;}
  if(!to||(!gps&&!from)){status(gps?'Fyll inn målstedet.':'Fyll inn både startsted og målsted.',true);return;}
  if(!gps&&from.toLocaleLowerCase('nb')===to.toLocaleLowerCase('nb')){status('Velg to forskjellige byer eller tettsteder.',true);return;}
  if(!navigator.onLine){status('Du er uten nett. Siste lagrede søk kan fortsatt vises, men nye søk krever internett.',true);return;}
  setBusy(true);$('submit').textContent=routeButtonText();
  try{
    let position,a;
    if(gps){status('Henter GPS-posisjonen din. Tillat posisjon når telefonen spør.');position=await getPosition(navigator.geolocation);a={name:'Der jeg er',coords:position.coords,gpsOrigin:true};}
    else{status('Finner startstedet …');a=await city(from);}
    status('Finner målstedet …');const b=await city(to);
    if(a.coords.join(',')===b.coords.join(','))throw new Error('Start og mål er på samme sted. Velg et annet målsted.');
    status('Beregner kjøreruten …');
    const r=await json(`https://router.project-osrm.org/route/v1/driving/${a.coords.join(',')};${b.coords.join(',')}?overview=full&geometries=geojson&steps=false`);
    if(r.code!=='Ok'||!r.routes?.length)throw new Error('Fant ingen kjørbar rute mellom stedene.');
    const route=r.routes[0],places=await loadPlaces();
    if(types.includes('hotel')&&!a.gpsOrigin&&!findStartSettlement(a,places))throw new Error('Fant ikke tettstedsgrensen for '+a.name+'. Velg et startsted fra forslagene.');
    const coords=route.geometry.coordinates,elements=new Map();let hotelSnapshotAt,unavailableTypes=[];
    try{for(const query of routeQueries(coords,radius*1000,types)){status('Leter etter '+label+' langs ruten …');const part=await overpass(query);for(const element of part.elements)elements.set(element.type+'/'+element.id,element);}}
    catch(error){
      if(!types.includes('hotel'))throw error;status('Henter hotelloversikten …');const snapshot=await json('./hotels.json',{},10000);
      if(!snapshot.updatedAt||!Array.isArray(snapshot.elements))throw error;hotelSnapshotAt=snapshot.updatedAt;elements.clear();for(const element of snapshot.elements)elements.set(element.type+'/'+element.id,element);
      const remaining=types.filter(type=>type!=='hotel');
      if(remaining.length){const otherElements=new Map();try{for(const query of routeQueries(coords,radius*1000,remaining)){const part=await overpass(query);for(const element of part.elements)otherElements.set(element.type+'/'+element.id,element);}for(const [id,element] of otherElements)elements.set(id,element);}catch{unavailableTypes=remaining;}}
    }
    const data=withoutStartHotels({from:a,to:b,radius,types,route:{distance:route.distance,duration:route.duration,geometry:route.geometry},hotels:extractPlaces([...elements.values()],route.geometry.coordinates,radius*1000,types),hotelSnapshotAt,unavailableTypes,savedAt:Date.now()},places);
    if(position){gpsPosition=position;$('map-location-status').textContent='Blå prikk: rutens start fra din GPS-posisjon. Oppgitt nøyaktighet '+Math.ceil(position.accuracy)+' m.';}
    render(data);
    if(!gps&&!unavailableTypes.length)try{localStorage.setItem('veihotell-last-v3',JSON.stringify(data));}catch{status('Søket er klart, men kunne ikke lagres på denne enheten.');}
  }catch(error){const msg=error.name==='AbortError'?'Søket tok for lang tid. Prøv igjen om litt.':error.message;status(msg+(active?' Viser fortsatt forrige vellykkede søk.':''),true);}
  finally{setBusy(false);updateSearchLabels();}
}
for(const id of ['from','to'])$(id)?.addEventListener('input',()=>{$('category-counts').hidden=true;});$('search')?.addEventListener('submit',search);$('radius')?.addEventListener('change',syncChoices);$('swap')?.addEventListener('click',()=>{if(fromGPS())return;$('category-counts').hidden=true;const value=$('from').value;$('from').value=$('to').value;$('to').value=value;});
window.addEventListener('beforeinstallprompt',event=>{event.preventDefault();deferredInstall=event;$('install').hidden=false;});$('install').addEventListener('click',async()=>{if(!deferredInstall)return;await deferredInstall.prompt();deferredInstall=null;$('install').hidden=true;});window.addEventListener('appinstalled',()=>{$('install').hidden=true;});
window.addEventListener('offline',()=>status('Du er uten nett. Viser siste søk; bakgrunnskartet kan være utilgjengelig.'));window.addEventListener('online',()=>status('Du er på nett igjen. Du kan søke etter en ny rute.'));
if('serviceWorker' in navigator)navigator.serviceWorker.register('./sw.js').catch(()=>{});
const mapArea=document.querySelector('.map-area'),overview=document.querySelector('.overview'),mapDialog=$('map-fullscreen');
overview.append(mapArea);
function resizeMap(){if(map){map.invalidateSize({pan:false});applyMapView();}}
function openMap(){
  $('fullscreen-map').append(mapArea);mapDialog.showModal();resizeMap();$('map-back').focus();
}
function closeMap(){mapDialog.close();}
$('map-open').addEventListener('click',openMap);
$('map-back').addEventListener('click',closeMap);
mapDialog.addEventListener('close',()=>{overview.append(mapArea);resizeMap();$('map-open').focus();});
initMap();
$('map-location').addEventListener('click',showMyPosition);$('map-reset').addEventListener('click',resetMapView);
if(typeof ResizeObserver!=='undefined')new ResizeObserver(resizeMap).observe($('map'));
async function bootstrap(){try{const places=await loadPlaces();if(busy||fromGPS())return;let restored=false;try{const stored=JSON.parse(localStorage.getItem('veihotell-last-v3')??localStorage.getItem('veihotell-last-v2')??localStorage.getItem('veihotell-last-v1'));if(!stored?.from?.gpsOrigin&&stored?.route?.geometry?.coordinates?.length&&Array.isArray(stored.hotels)){const data=stored.filterVersion===3?stored:withoutStartHotels(stored,places);restored=true;$('types').value=typeValue(data.types);updateSearchLabels();$('from').value=data.from.name;$('to').value=data.to.name;$('radius').value=data.radius;syncChoices();render(data,true);localStorage.setItem('veihotell-last-v3',JSON.stringify(data));}}catch{}if(!restored)search();}catch{status('Stedsoversikten kunne ikke lastes. Koble til internett og prøv igjen.',true);}}refreshFromMode();if(!isNearby)bootstrap();else updateSearchLabels();


