import {inRing,normalizePlace} from './geo.js?v=50';

const endpoint='https://api.kartverket.no/stedsnavn/v1/sted';
const fields='navn.stedsnummer,navn.stedsnavn,navn.kommuner,navn.navneobjekttype,navn.representasjonspunkt,navn.stedstatus,metadata';
const settlementTypes=['by','tettsted','statistiskTettsted','tettbebyggelse','tettsteddel','grend','bygdelagBygd','bydel','boligfelt','poststed'];
const coreSettlementLabels=new Set(['by','tettsted','statistisk tettsted']);
const otherSettlementLabels=new Set(['tettbebyggelse','tettsteddel','grend','bygdelag (bygd)','bydel','boligfelt','poststed']);
const fold=value=>normalizePlace(value).normalize('NFKD').replace(/[\u0300-\u036f]/g,'').replace(/æ/g,'ae').replace(/ø/g,'o');
const abortError=()=>Object.assign(new Error('Stedsnavnsøket ble avbrutt.'),{name:'AbortError'});
const currentName=name=>typeof name?.skrivemåte==='string'&&name.skrivemåte.trim()
  &&typeof name.skrivemåtestatus==='string'&&name.skrivemåtestatus.trim()&&!/(historisk|utgått|slettet|avslått|foreslått)/i.test(name.skrivemåtestatus)
  &&!/(historisk|utgått|slettet)/i.test(name.navnestatus??'');

function chooseName(names,query){
  const needle=fold(query),exact=normalizePlace(query);
  return names.filter(name=>fold(name.skrivemåte).startsWith(needle)).sort((a,b)=>
    Number(normalizePlace(b.skrivemåte)===exact)-Number(normalizePlace(a.skrivemåte)===exact)
    ||Number(normalizePlace(b.skrivemåte).startsWith(exact))-Number(normalizePlace(a.skrivemåte).startsWith(exact))
    ||Number(b.navnestatus==='hovednavn')-Number(a.navnestatus==='hovednavn')
    ||Number(b.språk==='Norsk')-Number(a.språk==='Norsk')
    ||a.skrivemåte.localeCompare(b.skrivemåte,'nb'))[0];
}

function normalizeResult(row,query,places){
  if(row?.stedstatus!=='aktiv'||!/^\d+$/.test(String(row.stedsnummer??''))||Number(row.stedsnummer)<=0)return null;
  const point=row.representasjonspunkt,coords=[point?.øst,point?.nord];
  if(point?.koordsys!==4326||!coords.every(Number.isFinite)||Math.abs(coords[0])>180||Math.abs(coords[1])>90)return null;
  const municipalities=(Array.isArray(row.kommuner)?row.kommuner:[]).filter(item=>typeof item?.kommunenummer==='string'&&/^\d{4}$/.test(item.kommunenummer)&&typeof item.kommunenavn==='string'&&item.kommunenavn.trim());
  if(!municipalities.length)return null;
  const names=(Array.isArray(row.stedsnavn)?row.stedsnavn:[]).filter(currentName),chosen=chooseName(names,query);
  if(!chosen)return null;
  const name=chosen.skrivemåte.trim(),aliases=[...new Set(names.map(item=>item.skrivemåte.trim()).filter(value=>value!==name))];
  const result={id:'kartverket:'+row.stedsnummer,name,aliases,
    region:[...new Set(municipalities.map(item=>item.kommunenavn.trim()))].join(', '),
    municipalityIds:[...new Set(municipalities.map(item=>item.kommunenummer))],
    coords,kartverketId:String(row.stedsnummer),source:'kartverket',
    priority:coreSettlementLabels.has(normalizePlace(row.navneobjekttype))?0:otherSettlementLabels.has(normalizePlace(row.navneobjekttype))?.5:1,kindLabel:row.navneobjekttype??'Sted'};
  // A farm, island or other named object can sit inside a town and share its
  // name. Only a settlement represents the SSB settlement's selectable place.
  if(!coreSettlementLabels.has(normalizePlace(row.navneobjekttype)))return result;
  const remoteNames=new Set([name,...aliases].map(normalizePlace));
  const local=places.find(place=>[place.name,...(place.aliases??[])].some(value=>remoteNames.has(normalizePlace(value)))
    &&Array.isArray(place.rings)&&place.rings.some(ring=>Array.isArray(ring)&&ring.length>=3&&inRing(coords,ring)));
  if(!local)return result;
  return {...local,...result,id:local.id,ssbId:local.id,
    aliases:[...new Set([local.name,...(local.aliases??[]),...aliases].filter(value=>value&&value!==name))]};
}

// Fetch only the current prefix, never download or persist the SSR register.
export function createKartverketSearch({getPlaces=()=>[],fetchImpl=fetch,timeoutMs=7000}={}){
  return async function searchKartverket(query,{signal}={}){
    const value=Array.from(String(query??'').replace(/[*?]/g,'').trim().normalize('NFKC')).slice(0,99).join('');
    if(signal?.aborted)throw abortError();
    if(!value)return [];
    const controller=new AbortController(),abort=()=>controller.abort(abortError());
    signal?.addEventListener('abort',abort,{once:true});
    const timer=setTimeout(()=>controller.abort(Object.assign(new Error('Stedsnavnsøket tok for lang tid.'),{name:'TimeoutError'})),timeoutMs);
    const localPlaces=Promise.resolve().then(getPlaces).catch(()=>[]);
    async function request(priority){
      const params=new URLSearchParams({sok:value+'*',utkoordsys:'4326',treffPerSide:'20',side:'1',filtrer:fields});
      if(priority)for(const type of settlementTypes)params.append('navneobjekttype',type);
      const response=await fetchImpl(endpoint+'?'+params,{signal:controller.signal,credentials:'omit'});
      if(!response.ok)throw new Error('Kartverket svarte med '+response.status+'.');
      const data=await response.json();
      if(!Array.isArray(data?.navn))throw new Error('Kartverket svarte uten stedsnavn.');
      return data.navn;
    }
    try{
      const responses=await Promise.allSettled([request(true),request(false)]);
      if(signal?.aborted)throw abortError();
      if(controller.signal.aborted)throw controller.signal.reason??abortError();
      const successful=responses.filter(result=>result.status==='fulfilled');
      if(!successful.length)throw responses[0].reason;
      const loaded=await localPlaces,places=Array.isArray(loaded)?loaded:[];
      if(signal?.aborted)throw abortError();
      if(controller.signal.aborted)throw controller.signal.reason??abortError();
      const bySSR=new Map();
      for(const row of successful.flatMap(result=>result.value)){
        const place=normalizeResult(row,value,places);
        if(place&&(!bySSR.has(place.kartverketId)||place.priority<bySSR.get(place.kartverketId).priority))bySSR.set(place.kartverketId,place);
      }
      const byPlace=new Map();
      for(const place of bySSR.values())if(!byPlace.has(place.id)||place.priority<byPlace.get(place.id).priority)byPlace.set(place.id,place);
      return [...byPlace.values()].sort((a,b)=>a.priority-b.priority
        ||a.name.localeCompare(b.name,'nb')||a.region.localeCompare(b.region,'nb')||a.id.localeCompare(b.id,'nb'));
    }finally{
      clearTimeout(timer);signal?.removeEventListener('abort',abort);
    }
  };
}
