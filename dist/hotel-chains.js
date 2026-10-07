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
export function hotelChainCounts(places){
  const groups=new Map();let total=0;
  for(const place of places){const chain=hotelChain(place);if(!chain)continue;total++;const group=groups.get(chain.id)??{...chain,count:0};group.count++;groups.set(chain.id,group);}
  const sorted=[...groups.values()].sort((a,b)=>a.id==='other'?1:b.id==='other'?-1:a.name.localeCompare(b.name,'nb'));
  return [{id:null,name:'Alle',count:total},...sorted];
}
