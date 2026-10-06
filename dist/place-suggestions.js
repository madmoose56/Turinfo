// Keep place matching local so typing never sends a partial place name to a service.
export function normalizePlaceQuery(value){
  return String(value??'').trim().toLocaleLowerCase('nb').normalize('NFKD')
    .replace(/[\u0300-\u036f]/g,'').replace(/æ/g,'ae').replace(/ø/g,'o');
}

export function matchPlaces(query,places){
  const needle=normalizePlaceQuery(query);
  if(!needle)return [];
  return places.map(place=>{
    const names=[place.name,...(place.aliases??[])].map(normalizePlaceQuery);
    const rank=Math.min(...names.map(name=>name===needle?0:name.startsWith(needle)?1:name.split(/[\s\-–/]+/).some(word=>word.startsWith(needle))?2:name.includes(needle)?3:4));
    return {place,rank};
  }).filter(item=>item.rank<4).sort((a,b)=>a.rank-b.rank
    ||a.place.name.localeCompare(b.place.name,'nb')
    ||String(a.place.region??'').localeCompare(String(b.place.region??''),'nb')
    ||String(a.place.id??'').localeCompare(String(b.place.id??''),'nb')).map(item=>item.place);
}

export function attachPlaceSuggestions(input,{listbox,getPlaces,onSelect=()=>{},onEdit=()=>{}}){
  if(!input||!listbox)throw new Error('Place suggestions need an input and a listbox.');
  const doc=input.ownerDocument??document;
  let selected=null,items=[],optionNodes=[],activeIndex=-1,request=0,pointerInside=false,choosing=false;
  const optionPrefix=(listbox.id||`${input.id}-suggestions`)+'-option-';
  if(!listbox.id)listbox.id=`${input.id}-suggestions`;
  listbox.setAttribute('role','listbox');
  input.setAttribute('role','combobox');
  input.setAttribute('aria-autocomplete','list');
  input.setAttribute('aria-haspopup','listbox');
  input.setAttribute('aria-controls',listbox.id);

  function resetList(){
    items=[];optionNodes=[];activeIndex=-1;
    listbox.hidden=true;listbox.replaceChildren();
    input.setAttribute('aria-expanded','false');
    input.removeAttribute('aria-activedescendant');
  }
  function close(){request++;resetList();}
  function setActive(index){
    activeIndex=index;
    optionNodes.forEach((node,i)=>node.setAttribute('aria-selected',String(i===index)));
    if(index<0){input.removeAttribute('aria-activedescendant');return;}
    const option=optionNodes[index];
    input.setAttribute('aria-activedescendant',option.id);
    option.scrollIntoView?.({block:'nearest'});
  }
  function moveActive(step){
    if(!items.length)return;
    const next=activeIndex<0?(step>0?0:items.length-1):(activeIndex+step+items.length)%items.length;
    setActive(next);
  }
  function choose(index){
    const place=items[index];
    if(!place||input.disabled)return;
    selected=place;input.value=place.name;
    close();choosing=true;input.focus();choosing=false;onSelect(place);
  }
  async function show(){
    const value=input.value,token=++request;
    if(input.disabled||!normalizePlaceQuery(value)){close();return false;}
    // Old matches must not be selectable while a newer name is being loaded.
    resetList();
    let places;
    try{places=await getPlaces();}catch{
      if(token===request)close();
      return false;
    }
    if(token!==request||input.disabled||input.value!==value)return false;
    items=matchPlaces(value,places);activeIndex=-1;optionNodes=[];
    const nameCounts=new Map();
    for(const place of items){const name=normalizePlaceQuery(place.name);nameCounts.set(name,(nameCounts.get(name)??0)+1);}
    for(let i=0;i<items.length;i++){
      const place=items[i],option=doc.createElement('div'),name=doc.createElement('span');
      option.className='place-option';option.id=optionPrefix+i;option.dataset.placeIndex=String(i);
      option.setAttribute('role','option');option.setAttribute('aria-selected','false');
      name.className='place-name';name.textContent=place.name;option.append(name);
      const region=place.region||(nameCounts.get(normalizePlaceQuery(place.name))>1&&place.population
        ?`${Number(place.population).toLocaleString('nb')} innbyggere`:'');
      if(region){const detail=doc.createElement('small');detail.className='place-region';detail.textContent=region;option.append(detail);}
      optionNodes.push(option);
    }
    listbox.replaceChildren(...optionNodes);listbox.hidden=!items.length;
    input.setAttribute('aria-expanded',String(items.length>0));input.removeAttribute('aria-activedescendant');
    return items.length>0;
  }
  input.addEventListener('input',()=>{selected=null;onEdit();void show();});
  input.addEventListener('focus',()=>{if(choosing||!listbox.hidden||!normalizePlaceQuery(input.value))return;void show();});
  input.addEventListener('blur',()=>{
    // Touch panning must be allowed to finish before deciding that the user left the field.
    setTimeout(()=>{if(doc.activeElement!==input&&!pointerInside)close();},0);
  });
  input.addEventListener('keydown',event=>{
    if(event.isComposing)return;
    if(event.key==='Escape'){
      if(!listbox.hidden){event.preventDefault();event.stopPropagation();}
      close();return;
    }
    if(event.key==='ArrowDown'||event.key==='ArrowUp'){
      if(input.disabled||!normalizePlaceQuery(input.value))return;
      event.preventDefault();const step=event.key==='ArrowDown'?1:-1;
      if(!listbox.hidden)moveActive(step);else void show().then(open=>{if(open)moveActive(step);});
      return;
    }
    if(event.key==='Enter'&&!listbox.hidden&&activeIndex>=0){
      event.preventDefault();event.stopPropagation();choose(activeIndex);
    }else if(event.key==='Enter'||event.key==='Tab')close();
  });
  listbox.addEventListener('pointerdown',event=>{
    pointerInside=true;
    // Mouse clicks keep focus on the combobox; touch keeps its normal scroll gesture.
    if(event.pointerType!=='touch')event.preventDefault();
  });
  listbox.addEventListener('click',event=>{
    const option=event.target.closest?.('[data-place-index]');
    if(!option||!listbox.contains(option))return;
    event.preventDefault();choose(Number(option.dataset.placeIndex));
  });
  doc.addEventListener('pointerdown',event=>{
    if(event.target!==input&&!listbox.contains(event.target)){pointerInside=false;close();}
  });
  const finishPointer=()=>setTimeout(()=>{
    pointerInside=false;
    if(doc.activeElement!==input)close();
  },0);
  doc.addEventListener('pointerup',finishPointer);doc.addEventListener('pointercancel',finishPointer);
  close();
  return {close,clearSelection(){selected=null;},get selection(){return selected;}};
}
