// Local settlements can be shown immediately; optional live results use the same matching rules.
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
    const priority=Number.isFinite(place.priority)?place.priority:0;
    return {place,rank,priority};
  }).filter(item=>item.rank<4).sort((a,b)=>a.priority-b.priority||a.rank-b.rank
    ||a.place.name.localeCompare(b.place.name,'nb')
    ||String(a.place.region??'').localeCompare(String(b.place.region??''),'nb')
    ||String(a.place.id??'').localeCompare(String(b.place.id??''),'nb')).map(item=>item.place);
}

export function attachPlaceSuggestions(input,{listbox,getPlaces,searchPlaces,onSelect=()=>{},onEdit=()=>{}}){
  if(!input||!listbox)throw new Error('Place suggestions need an input and a listbox.');
  const doc=input.ownerDocument??document;
  let selected=null,items=[],optionNodes=[],activeIndex=-1,request=0,pointerInside=false,choosing=false;
  let debounceTimer=null,liveController=null,pendingRefresh=null;
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
  function cancelLive(){
    if(debounceTimer!==null){clearTimeout(debounceTimer);debounceTimer=null;}
    liveController?.abort();liveController=null;pendingRefresh=null;
    listbox.setAttribute('aria-busy','false');
  }
  function close(){request++;cancelLive();resetList();}
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
  function renderPlaces(places,token,value){
    if(token!==request||input.disabled||input.value!==value)return;
    // A server response must not replace an option between touch-down and click.
    if(pointerInside){pendingRefresh={places,token,value};return;}
    const previous=items[activeIndex],previousId=previous?.id;
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
      const kind=place.kindLabel??place.type;
      if(kind){const detail=doc.createElement('small');detail.className='place-kind';detail.textContent=kind;option.append(detail);}
      optionNodes.push(option);
    }
    listbox.replaceChildren(...optionNodes);listbox.hidden=!items.length;
    input.setAttribute('aria-expanded',String(items.length>0));input.removeAttribute('aria-activedescendant');
    if(previous){const index=items.findIndex(place=>previousId!==undefined?String(place.id)===String(previousId):place===previous);if(index>=0)setActive(index);}
  }
  async function show(){
    cancelLive();const value=input.value,token=++request;
    if(input.disabled||!normalizePlaceQuery(value)){close();return false;}
    // Old matches must not be selectable while a newer name is being loaded.
    resetList();
    let local=[],remote=[];
    const refresh=()=>{
      const merged=new Map();
      for(const place of [...local,...remote])merged.set(place.id==null?place:String(place.id),place);
      renderPlaces([...merged.values()],token,value);
    };
    if(searchPlaces){
      const controller=new AbortController();liveController=controller;
      debounceTimer=setTimeout(async()=>{
        debounceTimer=null;
        if(token!==request||input.disabled||input.value!==value){controller.abort();return;}
        listbox.setAttribute('aria-busy','true');
        try{
          const places=await searchPlaces(value,{signal:controller.signal});
          if(!controller.signal.aborted&&token===request&&!input.disabled&&input.value===value){remote=Array.isArray(places)?places:[];refresh();}
        }catch{/* The immediate settlement suggestions remain usable when the live service fails. */}
        finally{if(liveController===controller){if(input.disabled)controller.abort();listbox.setAttribute('aria-busy','false');}}
      },250);
    }
    try{const places=await getPlaces();local=Array.isArray(places)?places:[];}catch{/* A live result can still be shown if the local index is unavailable. */}
    if(token!==request||input.disabled||input.value!==value)return false;
    refresh();return items.length>0;
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
    else if(pendingRefresh){const update=pendingRefresh;pendingRefresh=null;renderPlaces(update.places,update.token,update.value);}
  },0);
  doc.addEventListener('pointerup',finishPointer);doc.addEventListener('pointercancel',finishPointer);
  if(typeof MutationObserver!=='undefined')new MutationObserver(()=>{if(input.disabled)close();}).observe(input,{attributes:true,attributeFilter:['disabled']});
  close();
  return {close,clearSelection(){selected=null;},get selection(){return selected;}};
}
