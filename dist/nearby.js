import {haversine} from './geo.js?v=16';

export function nearbyQuery(coords,radius){
  const [lon,lat]=coords;
  if(!Number.isFinite(lon)||!Number.isFinite(lat)||Math.abs(lon)>180||Math.abs(lat)>90||!Number.isFinite(radius)||radius<1000||radius>50000)throw new Error('Ugyldig posisjon eller søkeradius.');
  return `[out:json][timeout:45];nwr["tourism"="hotel"](around:${radius},${lat.toFixed(6)},${lon.toFixed(6)});out center tags;`;
}

export function extractNearbyHotels(elements,coords,radius){
  const hotels=[];
  for(const e of elements){
    const lon=e.lon??e.center?.lon,lat=e.lat??e.center?.lat;
    if(!Number.isFinite(lon)||!Number.isFinite(lat))continue;
    const point=[lon,lat],distance=haversine(coords,point);
    if(distance>radius)continue;
    const tags=e.tags??{},name=tags.name??tags['name:nb']??'Hotell uten registrert navn';
    if(hotels.some(h=>h.name===name&&haversine(h.coords,point)<120))continue;
    hotels.push({id:`${e.type}/${e.id}`,name,coords:point,tags,distance});
  }
  return hotels.sort((a,b)=>a.distance-b.distance||a.name.localeCompare(b.name,'nb'));
}

export function getPosition(geolocation){
  return new Promise((resolve,reject)=>{
    if(!geolocation){reject(new Error('Posisjon er ikke tilgjengelig her. Åpne siden i Safari på iPhone og prøv igjen.'));return;}
    geolocation.getCurrentPosition(position=>{
      const {longitude,latitude,accuracy}=position.coords;
      if(!Number.isFinite(longitude)||!Number.isFinite(latitude)||!Number.isFinite(accuracy)||accuracy<0){reject(new Error('Telefonen returnerte en ugyldig posisjon. Prøv igjen.'));return;}
      resolve({coords:[longitude,latitude],accuracy});
    },error=>{
      const messages={1:'Posisjonstilgang ble avslått. Tillat posisjon for Turinfo i Safari eller iPhone-innstillingene og prøv igjen.',2:'Telefonen fant ikke posisjonen. Sjekk at stedstjenester er slått på og prøv igjen.',3:'Det tok for lang tid å finne posisjonen. Prøv igjen, gjerne utendørs.'};
      reject(new Error(messages[error.code]??'Posisjonen kunne ikke hentes. Prøv igjen.'));
    },{enableHighAccuracy:true,timeout:20000,maximumAge:0});
  });
}
