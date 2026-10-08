export function createSearchTask({onSlow=()=>{},setTimer=setTimeout,clearTimer=clearTimeout}={}){
  const controller=new AbortController();
  const timer=setTimer(()=>{if(!controller.signal.aborted)onSlow();},3000);
  const check=()=>{if(controller.signal.aborted)throw controller.signal.reason;};
  return {
    signal:controller.signal,check,
    wait(promise){
      return new Promise((resolve,reject)=>{
        const abort=()=>reject(controller.signal.reason);
        controller.signal.addEventListener('abort',abort,{once:true});
        Promise.resolve(promise).then(value=>{controller.signal.removeEventListener('abort',abort);try{check();resolve(value);}catch(error){reject(error);}},error=>{controller.signal.removeEventListener('abort',abort);reject(error);});
        if(controller.signal.aborted)abort();
      });
    },
    cancel(){clearTimer(timer);const error=new Error('Søket ble avbrutt.');error.name='SearchCancelled';controller.abort(error);},
    finish(){clearTimer(timer);}
  };
}
