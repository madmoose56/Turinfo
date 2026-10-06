import fs from 'node:fs';
import path from 'node:path';
import assert from 'node:assert/strict';

const source=fs.readFileSync(path.resolve('dist/place-suggestions.js'),'utf8');
const {normalizePlaceQuery,matchPlaces,attachPlaceSuggestions}=await import('data:text/javascript;base64,'+Buffer.from(source).toString('base64'));
const places=[
  {id:'oslo',name:'Oslo',region:'Oslo',population:1000},
  {id:'moss',name:'Moss',region:'Moss',population:500},
  {id:'aalesund',name:'Ålesund',region:'Ålesund',population:400},
  {id:'oresund',name:'Øresund',region:'Testkommune',population:300},
  {id:'saetre',name:'Sætre',region:'Asker',population:200},
  {id:'mo-as',name:'Mo',region:'Ås',population:100},
  {id:'mo-le',name:'Mo',region:'Levanger',population:150},
  {id:'mo-i-rana',name:'Mo i Rana',region:'Rana',population:500},
  {id:'saetre-mo',name:'Sætre-Mo',region:'Asker',population:50},
  {id:'demoss',name:'Demoss',region:'Testkommune',population:50},
  {id:'vikhammer',name:'Vikhammer',aliases:['Malvik'],region:'Malvik',population:400}
];
assert.equal(normalizePlaceQuery('  ÅÆØÉ  '),'aaeoe');
assert.deepEqual(matchPlaces('',places),[],'An empty field must not display the full register');
assert.deepEqual(matchPlaces('aal',places),[],'Norwegian å is folded to a, not to aa');
assert.equal(matchPlaces('ales',places)[0].id,'aalesund');
assert.equal(matchPlaces('ØRE',places)[0].id,'oresund');
assert.equal(matchPlaces('saet',places)[0].id,'saetre');
assert.equal(matchPlaces('Malv',places)[0].id,'vikhammer','The former SSB name still leads to the current settlement');
assert.deepEqual(matchPlaces('bø',[{id:'bod',name:'Bodø'},{id:'bom',name:'Bø',region:'Midt-Telemark'},{id:'bog',name:'Bogen'},{id:'bon',name:'Bø',region:'Bø'}]).slice(0,2).map(p=>p.id),['bon','bom'],'Exact Norwegian place names precede other names with the same normalized prefix');
assert.deepEqual(matchPlaces('mo',[{id:'farm',name:'Mo',priority:1},{id:'town',name:'Moss',priority:0}]).map(p=>p.id),['town','farm'],'Cities and towns precede other feature types even when another feature matches exactly');
const moMatches=matchPlaces('mo',places);
assert(moMatches.indexOf(places.find(p=>p.id==='moss'))<moMatches.indexOf(places.find(p=>p.id==='saetre-mo')),'A place-name prefix ranks ahead of a later word prefix');
assert(moMatches.indexOf(places.find(p=>p.id==='saetre-mo'))<moMatches.indexOf(places.find(p=>p.id==='demoss')),'A word prefix ranks ahead of a substring');
assert.deepEqual(matchPlaces('mo',places).filter(p=>p.name==='Mo').map(p=>p.id),['mo-le','mo-as'],'Same-named places remain distinct and sort by municipality');
const large=Array.from({length:300},(_,i)=>({id:String(i),name:'Asted '+i,region:'Kommune '+i}));
assert.equal(matchPlaces('a',large).length,300,'Suggestions must retain all matching settlements');

class Element {
  constructor(doc,tag='div'){this.ownerDocument=doc;this.tagName=tag;this.children=[];this.handlers=new Map();this.attributes={};this.dataset={};this.hidden=false;this._disabled=false;this.value='';this.id='';this._text='';}
  get disabled(){return this._disabled;}set disabled(value){this._disabled=value;this.onDisabledChange?.();}
  append(...nodes){for(const node of nodes){node.parent=this;this.children.push(node);}}
  replaceChildren(...nodes){for(const node of this.children)node.parent=null;this.children=[];this.append(...nodes);}
  setAttribute(name,value){this.attributes[name]=String(value);} removeAttribute(name){delete this.attributes[name];}
  getAttribute(name){return this.attributes[name]??null;}
  set textContent(value){this._text=String(value);this.children=[];}
  get textContent(){return this._text+this.children.map(node=>node.textContent).join('');}
  addEventListener(type,handler){if(!this.handlers.has(type))this.handlers.set(type,[]);this.handlers.get(type).push(handler);}
  contains(node){return node===this||this.children.some(child=>child.contains(node));}
  closest(selector){if(selector==='[data-place-index]'&&this.dataset.placeIndex!==undefined)return this;return this.parent?.closest?.(selector)??null;}
  focus(){if(this.ownerDocument.activeElement===this)return;this.ownerDocument.activeElement=this;this.fire('focus',{},false);}
  blur(){this.ownerDocument.activeElement=null;this.fire('blur',{},false);}
  scrollIntoView(options){this.lastScroll=options;}
  fire(type,data={},bubbles=true){
    const event={type,target:this,defaultPrevented:false,stopped:false,preventDefault(){this.defaultPrevented=true;},stopPropagation(){this.stopped=true;},...data};
    for(let node=this;node;node=bubbles&&!event.stopped?node.parent:null){for(const handler of node.handlers.get(type)??[])handler(event);}
    return event;
  }
}
class Document extends Element {
  constructor(){super(null);this.ownerDocument=this;this.activeElement=null;}
  createElement(tag){return new Element(this,tag);}
}
const tick=()=>new Promise(resolve=>setTimeout(resolve,0));
const debounce=()=>new Promise(resolve=>setTimeout(resolve,270));
const deferred=()=>{let resolve,reject;const promise=new Promise((ok,fail)=>{resolve=ok;reject=fail;});return {promise,resolve,reject};};
function fixture(provider=async()=>places,searchProvider){
  const doc=new Document(),input=doc.createElement('input'),listbox=doc.createElement('div'),outside=doc.createElement('button');
  input.id='from';listbox.id='from-suggestions';doc.append(input,listbox,outside);
  const selections=[],remoteRequests=[];let edits=0,loads=0;
  const control=attachPlaceSuggestions(input,{listbox,getPlaces(){loads++;return provider();},searchPlaces:searchProvider?(query,options)=>{remoteRequests.push({query,...options});return searchProvider(query,options);}:undefined,onSelect:place=>selections.push(place),onEdit:()=>edits++});
  const type=value=>{input.value=value;input.fire('input');};
  return {doc,input,listbox,outside,control,selections,type,remoteRequests,get edits(){return edits;},get loads(){return loads;}};
}

const f=fixture();
assert.equal(f.loads,0,'Attaching the controls makes no request');
assert.equal(f.input.getAttribute('role'),'combobox');assert.equal(f.listbox.getAttribute('role'),'listbox');
f.input.focus();assert.equal(f.loads,0,'Empty focus makes no request and opens no choices');
f.type('m');await tick();
assert.equal(f.listbox.hidden,false,'The first matching letter opens suggestions');
assert.equal(f.input.getAttribute('aria-expanded'),'true');
assert(f.listbox.children.every(option=>option.getAttribute('role')==='option'));
assert(f.listbox.children.some(option=>option.textContent==='MoLevanger'),'A municipality disambiguates identical place names');
assert.equal(f.edits,1);
const down=f.input.fire('keydown',{key:'ArrowDown'});
assert(down.defaultPrevented);assert.equal(f.input.getAttribute('aria-activedescendant'),f.listbox.children[0].id);
assert.equal(f.listbox.children[0].getAttribute('aria-selected'),'true');
assert.deepEqual(f.listbox.children[0].lastScroll,{block:'nearest'});
const enter=f.input.fire('keydown',{key:'Enter'});
assert(enter.defaultPrevented&&enter.stopped,'Selecting with Enter must not submit the route form');
assert.equal(f.selections.length,1);assert.equal(f.control.selection,f.selections[0]);
assert.equal(f.input.value,f.selections[0].name);assert(f.listbox.hidden);assert.equal(f.input.getAttribute('aria-activedescendant'),null);
f.type('Malv');await tick();assert.equal(f.control.selection,null,'Editing invalidates an earlier exact selection');
assert.equal(f.listbox.children.length,1);
f.input.fire('keydown',{key:'ArrowUp'});f.input.fire('keydown',{key:'Enter'});
assert.equal(f.control.selection.id,'vikhammer');assert.equal(f.input.value,'Vikhammer');
f.control.clearSelection();assert.equal(f.control.selection,null);assert.equal(f.input.value,'Vikhammer','Clearing the exact choice does not overwrite typed text');

f.type('os');await tick();
const freeformEnter=f.input.fire('keydown',{key:'Enter'});
assert(!freeformEnter.defaultPrevented,'A typed free-form place can still be submitted without selecting a suggestion');
assert(f.listbox.hidden);
f.type('os');await tick();const escape=f.input.fire('keydown',{key:'Escape'});
assert(escape.defaultPrevented);assert(f.listbox.hidden);
f.type('no matches');await tick();assert(f.listbox.hidden);
f.type('m');await tick();f.outside.fire('pointerdown');assert(f.listbox.hidden,'Outside pointer interaction closes the list');

const all=fixture(async()=>large);all.input.focus();all.type('a');await tick();
assert.equal(all.listbox.children.length,300,'Every matching settlement remains selectable by scrolling');
const last=all.listbox.children.at(-1);last.children[0].fire('pointerdown',{pointerType:'mouse'});last.children[0].fire('click');
assert.equal(all.control.selection.name,last.children[0].textContent,'A pointer can choose a result beyond the first page of suggestions');

const mobile=fixture();mobile.input.focus();mobile.type('mo');await tick();
const option=mobile.listbox.children.find(node=>node.textContent==='MoÅs');
const touch=option.children[0].fire('pointerdown',{pointerType:'touch'});
assert(!touch.defaultPrevented,'Touch scrolling of the suggestion list keeps its native pan gesture');
mobile.input.blur();await tick();assert(!mobile.listbox.hidden,'Touch selection survives the input blur before the click');
option.children[0].fire('pointerup',{pointerType:'touch'});option.children[0].fire('click');await tick();
assert.equal(mobile.control.selection.id,'mo-as','A touch click selects the exact same-named settlement');
assert.equal(mobile.doc.activeElement,mobile.input);assert(mobile.listbox.hidden,'Refocusing after a touch selection does not reopen the list');

const pending=[];const race=fixture(()=>{const request=deferred();pending.push(request);return request.promise;});
race.input.focus();race.type('os');race.type('mo');
pending[1].resolve(places);await tick();assert(race.listbox.children.every(node=>node.textContent.includes('Mo')||node.textContent.includes('Moss')||node.textContent.includes('Demoss')));
const latest=race.listbox.children.map(node=>node.textContent);
pending[0].resolve(places);await tick();assert.deepEqual(race.listbox.children.map(node=>node.textContent),latest,'An older response never overwrites newer typing');
race.input.fire('keydown',{key:'ArrowDown'});race.type('os');
assert(race.listbox.hidden,'Changing the query removes old choices immediately while new data is pending');
const staleEnter=race.input.fire('keydown',{key:'Enter'});assert(!staleEnter.defaultPrevented,'A pending query cannot select an old highlighted result');
pending[2].resolve(places);await tick();assert(race.listbox.hidden,'Submitting or closing cancels a pending suggestions request');
race.type('mo');race.input.disabled=true;pending[3].resolve(places);await tick();assert(race.listbox.hidden,'A GPS-disabled origin cannot reopen after a late response');
const failure=fixture(async()=>{throw new Error('Index unavailable');});failure.input.focus();failure.type('os');await tick();assert(failure.listbox.hidden,'Unavailable local data leaves free-form entry usable');

const emptyLive=fixture(async()=>places,async()=>[]);emptyLive.input.focus();await debounce();
assert.equal(emptyLive.loads,0);assert.equal(emptyLive.remoteRequests.length,0,'Empty focus makes neither a local load nor a live search');
const localMoss=places.find(place=>place.id==='moss'),liveReply=deferred();
const live=fixture(async()=>[localMoss],()=>liveReply.promise);live.input.focus();live.type('mo');await tick();
assert.equal(live.listbox.children.length,1,'Local towns are usable before the remote request begins');assert.equal(live.remoteRequests.length,0,'Typing starts the live debounce rather than an immediate request');
live.input.fire('keydown',{key:'ArrowDown'});await debounce();assert.equal(live.remoteRequests.length,1);assert.equal(live.remoteRequests[0].query,'mo');
const remoteMoss={...localMoss,coords:[10.66,59.43],priority:0,kindLabel:'Tettsted'},remoteTown={id:'rana',name:'Mo i Rana',region:'Rana',priority:0,kindLabel:'By'},remoteFarm={id:'farm',name:'Mo',region:'Moss',priority:1,type:'Gård'};
liveReply.resolve([remoteFarm,remoteTown,remoteMoss]);await tick();
assert.equal(live.listbox.children.length,3,'Remote data replaces a duplicate ID and adds other places');
const activeOption=live.listbox.children.find(option=>option.id===live.input.getAttribute('aria-activedescendant'));
assert.equal(activeOption.children[0].textContent,'Moss','A remote refresh preserves the active place when its index changes');
assert.equal(live.listbox.children[0].children[0].textContent,'Mo i Rana');assert.equal(live.listbox.children.at(-1).children[0].textContent,'Mo','Cities and towns stay above other live feature types');
assert.equal(activeOption.children[1].textContent,'Moss','Municipality stays on its own line');assert.equal(activeOption.children[2].textContent,'Tettsted','The optional feature type is shown below municipality');
live.input.fire('keydown',{key:'Enter'});assert.equal(live.control.selection,remoteMoss,'The richer live entry wins when its ID replaces a local entry');assert.deepEqual(live.control.selection.coords,[10.66,59.43]);

const calls=[];const typing=fixture(async()=>places,()=>{const reply=deferred();calls.push(reply);return reply.promise;});typing.input.focus();typing.type('o');await tick();typing.type('Ø');await debounce();
assert.equal(typing.remoteRequests.length,1,'Fast typing makes only one live request');assert.equal(typing.remoteRequests[0].query,'Ø','The service receives the original Norwegian spelling');
typing.type('mo');assert(typing.remoteRequests[0].signal.aborted,'New typing aborts an in-flight request');await debounce();assert.equal(typing.remoteRequests.length,2);
calls[1].resolve([remoteTown]);await tick();const current=typing.listbox.children.map(option=>option.textContent);
calls[0].resolve([{id:'old',name:'Øre',region:'Old result',priority:1}]);await tick();assert.deepEqual(typing.listbox.children.map(option=>option.textContent),current,'An old response is ignored even when its provider does not honor abort');
typing.control.close();assert(typing.remoteRequests[1].signal.aborted);assert(typing.listbox.hidden);
const cancelled=fixture(async()=>places,async()=>[]);cancelled.input.focus();cancelled.type('o');cancelled.control.close();await debounce();assert.equal(cancelled.remoteRequests.length,0,'Closing cancels the scheduled request');

const touchReply=deferred(),touchLive=fixture(async()=>[localMoss],()=>touchReply.promise);touchLive.input.focus();touchLive.type('mo');await tick();await debounce();
const tapped=touchLive.listbox.children[0];tapped.children[0].fire('pointerdown',{pointerType:'touch'});
touchReply.resolve([remoteTown,remoteMoss]);await tick();assert.equal(touchLive.listbox.children[0],tapped,'Live results cannot replace a pressed touch option before the click');
tapped.children[0].fire('pointerup',{pointerType:'touch'});tapped.children[0].fire('click');await tick();assert.equal(touchLive.control.selection,localMoss,'The touch selects the exact option originally pressed');assert(touchLive.listbox.hidden);
const panReply=deferred(),panning=fixture(async()=>[localMoss],()=>panReply.promise);panning.input.focus();panning.type('mo');await tick();await debounce();
panning.listbox.children[0].fire('pointerdown',{pointerType:'touch'});panReply.resolve([remoteTown]);await tick();
panning.listbox.fire('pointercancel',{pointerType:'touch'});await tick();assert.equal(panning.listbox.children.length,2,'A deferred update appears after a scroll gesture finishes without selecting');

const liveFailure=fixture(async()=>[localMoss],async()=>{throw new Error('Service unavailable');});liveFailure.input.focus();liveFailure.type('mo');await tick();await debounce();await tick();
assert(!liveFailure.listbox.hidden);assert.equal(liveFailure.listbox.children.length,1,'A failed live service retains local suggestions');assert.equal(liveFailure.listbox.getAttribute('aria-busy'),'false');
const remoteOnly=fixture(async()=>{throw new Error('Local index unavailable');},async()=>[remoteTown]);remoteOnly.input.focus();remoteOnly.type('mo');await debounce();await tick();assert.equal(remoteOnly.listbox.children[0].children[0].textContent,'Mo i Rana','Live suggestions still work if the local index cannot load');

const priorObserver=globalThis.MutationObserver;
globalThis.MutationObserver=class {constructor(callback){this.callback=callback;}observe(input){input.onDisabledChange=this.callback;}};
const disabledReply=deferred(),disabledLive=fixture(async()=>[localMoss],()=>disabledReply.promise);disabledLive.input.focus();disabledLive.type('mo');await tick();await debounce();
disabledLive.input.disabled=true;assert(disabledLive.remoteRequests[0].signal.aborted,'Disabling the origin immediately aborts its live request');assert(disabledLive.listbox.hidden);
disabledReply.resolve([remoteTown]);await tick();assert(disabledLive.listbox.hidden,'Late results cannot reopen a disabled GPS-origin field');
if(priorObserver===undefined)delete globalThis.MutationObserver;else globalThis.MutationObserver=priorObserver;

console.log('PASS: local SSB matching and Norwegian aliases; exact keyboard/touch selection and free-form submit; live debounce/abort and original spelling; immediate local and failure fallback; priority and stable active identity; ID merge; pointer refresh safety; disabled-field and stale-response guards.');
