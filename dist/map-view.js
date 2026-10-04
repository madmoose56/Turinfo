const MERCATOR_R=6378137,GROUND_R=6371000,RAD=Math.PI/180;

function coordinate(value){
  if(!Array.isArray(value)||value.length!==2||!value.every(Number.isFinite)||Math.abs(value[0])>180||Math.abs(value[1])>=85)throw new RangeError('Ugyldig kartposisjon.');
  return value;
}
function project(point){return [MERCATOR_R*point[0]*RAD,MERCATOR_R*Math.log(Math.tan(Math.PI/4+point[1]*RAD/2))];}
function unproject(point){return [point[0]/MERCATOR_R/RAD,Math.atan(Math.sinh(point[1]/MERCATOR_R))/RAD];}
function distance(a,b){
  const dLat=(b[1]-a[1])*RAD,dLon=(b[0]-a[0])*RAD;
  return 2*GROUND_R*Math.asin(Math.min(1,Math.sqrt(Math.sin(dLat/2)**2+Math.cos(a[1]*RAD)*Math.cos(b[1]*RAD)*Math.sin(dLon/2)**2)));
}
function bearing(a,b){
  const dLon=(b[0]-a[0])*RAD,lat1=a[1]*RAD,lat2=b[1]*RAD;
  return Math.atan2(Math.sin(dLon)*Math.cos(lat2),Math.cos(lat1)*Math.sin(lat2)-Math.sin(lat1)*Math.cos(lat2)*Math.cos(dLon))/RAD;
}

// The map stays north-up. Its scale measures 20 km along the vertical centre
// line, with the horizontal centre line matching to within a few metres in Norway.
export function fixedMapView(anchorLonLat,targetLonLat,pixels,size=20000,insetPixels=18){
  coordinate(anchorLonLat);
  if(!Number.isFinite(pixels)||!Number.isFinite(size)||size<=0||!Number.isFinite(insetPixels)||insetPixels<0||pixels<=2*insetPixels||pixels<=0)throw new RangeError('Ugyldig kartstørrelse.');
  const anchor=project(anchorLonLat);let edge=null,shiftX=0,shiftY=0;
  if(targetLonLat!=null){
    const target=project(coordinate(targetLonLat)),dx=target[0]-anchor[0],dy=target[1]-anchor[1];
    if(Math.hypot(dx,dy)>1e-7){
      if(Math.abs(dx)>Math.abs(dy)){edge=dx>0?'left':'right';shiftX=Math.sign(dx);}
      else{edge=dy>0?'bottom':'top';shiftY=Math.sign(dy);}
    }
  }
  const offset=1-2*insetPixels/pixels;
  const centreFor=half=>[anchor[0]+shiftX*half*offset,anchor[1]+shiftY*half*offset];
  const northSouth=half=>{const centre=centreFor(half);return GROUND_R*(Math.atan(Math.sinh((centre[1]+half)/MERCATOR_R))-Math.atan(Math.sinh((centre[1]-half)/MERCATOR_R)));};
  let low=0,high=size*MERCATOR_R/(GROUND_R*Math.cos(anchorLonLat[1]*RAD));
  if(!Number.isFinite(high)||high<=0||size>=Math.PI*GROUND_R)throw new RangeError('Ugyldig kartstørrelse.');
  while(northSouth(high)<size){high*=2;if(!Number.isFinite(high))throw new RangeError('Ugyldig kartstørrelse.');}
  for(let i=0;i<60;i++){const middle=(low+high)/2;if(northSouth(middle)<size)low=middle;else high=middle;}
  const half=(low+high)/2,projectedCentre=centreFor(half),center=unproject(projectedCentre);
  if(Math.abs(unproject([0,projectedCentre[1]+half])[1])>=85||Math.abs(unproject([0,projectedCentre[1]-half])[1])>=85||Math.abs(center[0])>180)throw new RangeError('Kartutsnittet ligger utenfor støttet kartområde.');
  return {center,zoom:Math.log2(pixels*2*Math.PI*MERCATOR_R/(256*2*half)),edge};
}

export function headingTarget(origin,heading,distanceMetres=5000){
  coordinate(origin);
  if(!Number.isFinite(heading)||!Number.isFinite(distanceMetres)||distanceMetres<0)throw new RangeError('Ugyldig retning eller avstand.');
  const lat=origin[1]*RAD,lon=origin[0]*RAD,angle=heading*RAD,arc=distanceMetres/GROUND_R;
  const targetLat=Math.asin(Math.max(-1,Math.min(1,Math.sin(lat)*Math.cos(arc)+Math.cos(lat)*Math.sin(arc)*Math.cos(angle))));
  const targetLon=lon+Math.atan2(Math.sin(angle)*Math.sin(arc)*Math.cos(lat),Math.cos(arc)-Math.sin(lat)*Math.sin(targetLat));
  return [((targetLon/RAD+540)%360)-180,targetLat/RAD];
}

export function routeAhead(coords,origin,lookahead=5000){
  coordinate(origin);
  if(!Array.isArray(coords)||!coords.length||!Number.isFinite(lookahead)||lookahead<0)throw new RangeError('Ugyldig rute.');
  const projected=coords.map(point=>project(coordinate(point)));
  if(coords.length===1)return [...coords[0]];
  const p=project(origin);let best=Infinity,index=1,start;
  for(let i=1;i<projected.length;i++){
    const a=projected[i-1],b=projected[i],dx=b[0]-a[0],dy=b[1]-a[1];
    const ratio=Math.max(0,Math.min(1,((p[0]-a[0])*dx+(p[1]-a[1])*dy)/(dx*dx+dy*dy||1)));
    const candidate=[a[0]+ratio*dx,a[1]+ratio*dy],squared=(candidate[0]-p[0])**2+(candidate[1]-p[1])**2;
    if(squared<best){best=squared;index=i;start=unproject(candidate);}
  }
  let remaining=lookahead;
  for(let i=index;i<coords.length;i++){
    const end=coords[i],length=distance(start,end);
    if(remaining<=length)return length?headingTarget(start,bearing(start,end),remaining):[...end];
    remaining-=length;start=end;
  }
  return [...coords.at(-1)];
}
