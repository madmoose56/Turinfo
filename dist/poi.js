import {haversine,routePosition} from './geo.js?v=37';

export function selectedTypes(value){if(value==='all')return ['hotel','fuel','charging'];if(value==='both')return ['hotel','fuel'];return [...new Set(String(value??'hotel').split(',').filter(t=>['hotel','fuel','charging','activity','family','outdoor','culture','food'].includes(t)))];}
export function typeValue(types=['hotel']){return types.join(',');}
export function kindLabel(kind){return kind==='activity'?'Aktivitet':kind==='charging'?'Ladestasjon':kind==='fuel'?'Bensinstasjon':'Hotell';}
export const activityTypes=['family','outdoor','culture','food'];
export function hasActivities(types){return types.some(t=>t==='activity'||activityTypes.includes(t));}
export function resultLabel(types){if(!types.length)return 'steder';const names=types.filter(t=>!activityTypes.includes(t)&&t!=='activity').map(t=>t==='charging'?'ladestasjoner':t==='fuel'?'bensinstasjoner':'hoteller');if(hasActivities(types)){const categories=types.filter(t=>activityTypes.includes(t));names.push(categories.length===1&&!types.includes('activity')?({family:'familieaktiviteter',outdoor:'frilufts- og sportsaktiviteter',culture:'kulturaktiviteter',food:'spisesteder'})[categories[0]]:'aktiviteter');}return names.length===1?names[0]:names.slice(0,-1).join(', ')+' og '+names.at(-1);}
const activityGroups={
 family:{tourism:{zoo:'Dyrepark',aquarium:'Akvarium',theme_park:'Fornøyelsespark'},leisure:{playground:'Lekeplass',water_park:'Badeland',miniature_golf:'Minigolf',amusement_arcade:'Spillhall'}},
 outdoor:{tourism:{viewpoint:'Utsiktspunkt',picnic_site:'Pikniksted'},leisure:{bathing_place:'Badeplass',nature_reserve:'Naturreservat',park:'Park',sports_centre:'Sportssenter',swimming_pool:'Svømmebasseng',golf_course:'Golfbane',disc_golf_course:'Diskgolf',horse_riding:'Ridesenter',ice_rink:'Skøytebane',climbing:'Klatreanlegg'},natural:{beach:'Strand'},highway:{trailhead:'Turstart'}},
 culture:{tourism:{attraction:'Severdighet',museum:'Museum',gallery:'Galleri',artwork:'Kunstverk'},amenity:{theatre:'Teater',arts_centre:'Kultursenter'},historic:{castle:'Slott eller borg',ruins:'Ruiner',archaeological_site:'Arkeologisk sted'}},
 food:{amenity:{restaurant:'Restaurant',cafe:'Kafé',fast_food:'Hurtigmat',pub:'Pub',bar:'Bar',ice_cream:'Iskiosk'}}
};
export function activityCategories(tags){return activityTypes.filter(type=>Object.entries(activityGroups[type]).some(([key,values])=>values[tags[key]]));}
export function activityLabel(tags){for(const type of activityTypes)for(const [key,values] of Object.entries(activityGroups[type]))if(values[tags[key]])return values[tags[key]];return null;}
function selectors(types){const selected=[...new Set(types.flatMap(t=>t==='activity'?activityTypes:[t]))];return selected.flatMap(type=>activityGroups[type]?Object.entries(activityGroups[type]).map(([key,values])=>'["'+key+'"~"^('+Object.keys(values).join('|')+')$"]["access"!~"^(private|no)$"]'):type==='charging'?'["amenity"="charging_station"]["motorcar"!="no"]["access"!~"^(private|no)$"]':type==='fuel'?'["amenity"="fuel"]':'["tourism"="hotel"]');}
function query(types,around){return `[out:json][timeout:15];(${selectors(types).map(selector=>`nwr${selector}(around:${around});`).join('')});out center tags;`;}
export function routeQuery(coords,radius,types){
  // Limit the server's tag lookup to the route's region. The exact distance
  // to every segment is still checked locally in extractPlaces.
  let west=Infinity,south=Infinity,east=-Infinity,north=-Infinity;
  for(const [lon,lat] of coords){west=Math.min(west,lon);east=Math.max(east,lon);south=Math.min(south,lat);north=Math.max(north,lat);}
  const latPad=(radius+150)/110000,lonPad=latPad/Math.cos(Math.max(Math.abs(south),Math.abs(north))*Math.PI/180);
  const box=[south-latPad,west-lonPad,north+latPad,east+lonPad].map(n=>n.toFixed(6)).join(',');
  return `[out:json][timeout:15];(${selectors(types).map(selector=>`nwr${selector}(${box});`).join('')});out center tags;`;
}
// Adjacent pieces share boundaries, including long sparse geometry segments.
export function routeQueries(coords,radius,types,maxLength=10000){
  if(coords.length<2||!Number.isFinite(maxLength)||maxLength<=0)throw new Error('Ugyldig rute.');
  const pieces=[];let piece=[coords[0]],length=0;
  for(let i=1;i<coords.length;i++){
    let start=coords[i-1],end=coords[i],remaining=haversine(start,end);
    while(length+remaining>maxLength){
      const ratio=(maxLength-length)/remaining;
      const boundary=[start[0]+(end[0]-start[0])*ratio,start[1]+(end[1]-start[1])*ratio];
      piece.push(boundary);pieces.push(piece);piece=[boundary];length=0;
      start=boundary;remaining=haversine(start,end);
    }
    piece.push(end);length+=remaining;
  }
  if(piece.length>1)pieces.push(piece);
  return pieces.map(part=>routeQuery(part,radius,types));
}

export function nearQuery(coords,radius,types){
  const [lon,lat]=coords;
  if(!Number.isFinite(lon)||!Number.isFinite(lat)||Math.abs(lon)>180||Math.abs(lat)>90||!Number.isFinite(radius)||radius<1000||radius>50000)throw new Error('Ugyldig posisjon eller søkeradius.');
  return query(types,`${radius},${lat.toFixed(6)},${lon.toFixed(6)}`);
}
export function extractPlaces(elements,coords,radius,types,near=false){
  const results=[];
  for(const e of elements){
    const tags=e.tags??{},kind=tags.amenity==='charging_station'?'charging':tags.amenity==='fuel'?'fuel':tags.tourism==='hotel'?'hotel':activityLabel(tags)?'activity':null;
    if(!kind||(kind==='activity'?!types.includes('activity')&&!activityCategories(tags).some(t=>types.includes(t)):!types.includes(kind)))continue;
    if((kind==='charging'&&tags.motorcar==='no')||(['charging','activity'].includes(kind)&&['private','no'].includes(tags.access)))continue;
    const lon=e.lon??e.center?.lon,lat=e.lat??e.center?.lat;
    if(!Number.isFinite(lon)||!Number.isFinite(lat))continue;
    const point=[lon,lat],pos=near?{distance:haversine(coords,point)}:routePosition(point,coords);
    if(pos.distance>radius+1e-6)continue;
    const name=tags.name??tags['name:nb']??(kind==='activity'?activityLabel(tags)+' uten registrert navn':kind!=='hotel'?(tags.brand??tags.operator??tags.network??(kind==='charging'?'Ladestasjon uten registrert navn':'Bensinstasjon uten registrert navn')):'Hotell uten registrert navn');
    if(results.some(p=>p.kind===kind&&p.name===name&&haversine(p.coords,point)<120))continue;
    results.push({id:`${e.type}/${e.id}`,kind,name,coords:point,tags,...pos});
  }
  return results.sort((a,b)=>near?(a.distance-b.distance||a.name.localeCompare(b.name,'nb')):(a.along-b.along||a.distance-b.distance));
}
export function fuelDetails(tags){
  const fuels=[['fuel:diesel','Diesel'],['fuel:octane_95','Bensin 95'],['fuel:octane_98','Bensin 98'],['fuel:e10','E10'],['fuel:lpg','LPG'],['fuel:cng','CNG'],['fuel:adblue','AdBlue']].filter(([key])=>tags[key]==='yes').map(([,label])=>label);
  const hours=tags.opening_hours==='24/7'?'Døgnåpent':tags.opening_hours;
  return {fuels,hours};
}

export function chargingDetails(tags){
  const sockets=[['type2_combo','CCS'],['type2','Type 2'],['type2_cable','Type 2 med kabel'],['chademo','CHAdeMO'],['tesla_supercharger','Tesla Supercharger'],['nacs','NACS'],['schuko','Schuko']];
  const connectors=sockets.filter(([key])=>{const value=tags['socket:'+key];return value==='yes'||String(value??'').split(';').some(n=>Number(n)>0);}).map(([key,name])=>name+(tags['socket:'+key+':output']?' ('+tags['socket:'+key+':output']+')':''));
  return {connectors,operator:tags.operator??tags.network,hours:tags.opening_hours==='24/7'?'Døgnåpent':tags.opening_hours,access:tags.access==='customers'?'Kun for kunder':tags.access==='permissive'?'Tillatt etter eierens vilkår':undefined};
}
