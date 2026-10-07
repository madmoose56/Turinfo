const knownChains=[
  ['Best Western',/\bbest\s*western\b/i],
  ['Thon',/\bthon(?:\s*hotels?)?\b/i],
  ['Scandic',/\bscandic\b/i],
  ['Radisson',/\bradisson\b/i],
  ['Quality',/\bquality(?:\s*hotels?)?\b/i],
  ['Clarion',/\bclarion\b/i],
  ['Comfort',/\bcomfort(?:\s*hotels?)?\b/i],
  ['Strawberry',/\bstrawberry\b/i],
  ['First Hotels',/\bfirst\s*hotels?\b/i],
];
const tidy=value=>String(value??'').normalize('NFKC').replace(/\s+/g,' ').trim();
const key=value=>tidy(value).toLocaleLowerCase('nb');
export function hotelChain(place){
  if((place.kind??'hotel')!=='hotel')return null;
  const tags=place.tags??{},brand=tidy(tags.brand)||tidy(tags.network);
  if(brand){const known=knownChains.find(([,pattern])=>pattern.test(brand));return {id:key(known?.[0]??brand),name:known?.[0]??brand};}
  const known=knownChains.find(([,pattern])=>pattern.test(tidy(place.name)))??knownChains.find(([,pattern])=>pattern.test(tidy(tags.operator)));
  return known?{id:key(known[0]),name:known[0]}:{id:'other',name:'Øvrige hoteller'};
}
const stationChains={
 fuel:[['Circle K',/\bcircle\s*k\b/i],['Uno-X',/\buno[\s-]*x\b/i],['YX',/\byx\b/i],['Esso',/\besso\b/i],['Shell',/\bshell\b/i],['St1',/\bst\s*1\b/i],['Best',/\bbest\b/i],['Bunker Oil',/\bbunker\s*oil\b/i]],
 charging:[['Tesla',/\btesla\b/i],['Recharge',/\brecharge\b/i],['Mer',/\bmer(?:\s+(?:norway|norge|as))?\b/i],['Kople',/\bkople\b/i],['Circle K',/\bcircle\s*k\b/i],['Ionity',/\bionity\b/i],['Eviny',/\beviny\b/i],['Bilkraft',/\bbilkraft\b/i],['E.ON',/\be[.]?on\b/i],['Uno-X',/\buno[\s-]*x\b/i],['Fortum',/\bfortum\b/i],['Ladeklar',/\bladeklar\b/i]]
};
export function placeChain(place,type){
 if(type==='hotel')return hotelChain(place);
 if(place.kind!==type||!stationChains[type])return null;
 const tags=place.tags??{},fields=type==='charging'?['operator','network','brand']:['brand','network','operator'];
 const registered=fields.map(field=>tidy(tags[field])).find(Boolean);
 const known=stationChains[type].find(([,pattern])=>pattern.test(registered||tidy(place.name)));
 if(known)return {id:key(known[0]),name:known[0]};
 return registered?{id:key(registered),name:registered}:{id:'other',name:type==='fuel'?'Øvrige bensinstasjoner':'Øvrige ladestasjoner'};
}
export function chainCounts(places,type){
  const groups=new Map();let total=0;
  for(const place of places){const chain=placeChain(place,type);if(!chain)continue;total++;const group=groups.get(chain.id)??{...chain,count:0};group.count++;groups.set(chain.id,group);}
  const sorted=[...groups.values()].sort((a,b)=>a.id==='other'?1:b.id==='other'?-1:a.name.localeCompare(b.name,'nb'));
  return [{id:null,name:'Alle',count:total},...sorted];
}
export const hotelChainCounts=places=>chainCounts(places,'hotel');
