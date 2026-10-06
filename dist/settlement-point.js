// A local fallback for an SSB settlement when its name has no usable geocoder
// result. This is an approximate settlement location; routing snaps it to a road.
// The boundary data contains separate outer rings, without polygon holes.
const coordinate=point=>Array.isArray(point)&&point.length>=2
  &&Number.isFinite(point[0])&&Number.isFinite(point[1])
  &&Math.abs(point[0])<=180&&Math.abs(point[1])<=90;

function ringAreaAndCentroid(ring){
  // Translate before summing to avoid cancellation around Norwegian coordinates.
  const [ox,oy]=ring[0];let twiceArea=0,x=0,y=0;
  for(let i=0,j=ring.length-1;i<ring.length;j=i++){
    const ax=ring[j][0]-ox,ay=ring[j][1]-oy,bx=ring[i][0]-ox,by=ring[i][1]-oy;
    const cross=ax*by-bx*ay;
    twiceArea+=cross;x+=(ax+bx)*cross;y+=(ay+by)*cross;
  }
  return {area:Math.abs(twiceArea),centroid:[ox+x/(3*twiceArea),oy+y/(3*twiceArea)]};
}

function strictlyInside(point,ring){
  if(!coordinate(point))return false;
  const [x,y]=point,scaleX=Math.cos(y*Math.PI/180);let inside=false;
  for(let i=0,j=ring.length-1;i<ring.length;j=i++){
    const [ax,ay]=ring[j],[bx,by]=ring[i],dx=bx-ax,dy=by-ay;
    const mx=dx*scaleX,px=(x-ax)*scaleX,py=y-ay;
    const t=Math.max(0,Math.min(1,(px*mx+py*dy)/(mx*mx+dy*dy||1)));
    // Keep clear of the 10 cm boundary tolerance used by the app's polygon test.
    if(Math.hypot(px-t*mx,py-t*dy)*Math.PI/180*6371000<=0.1)return false;
    if((ay>y)!==(by>y)&&x<ax+(y-ay)*dx/dy)inside=!inside;
  }
  return inside;
}

function scanlinePoint(ring){
  // A latitude halfway between consecutive vertex levels never passes through a
  // vertex. Its crossing pairs form genuine interior intervals, even in concave
  // polygons whose centroid or bounding-box centre lies outside the settlement.
  const levels=[...new Set(ring.map(point=>point[1]))].sort((a,b)=>a-b);
  const bands=levels.slice(1).map((high,i)=>({y:levels[i]+(high-levels[i])/2,gap:high-levels[i]}));
  bands.sort((a,b)=>b.gap-a.gap||a.y-b.y);
  for(const {y} of bands){
    const crossings=[];
    for(let i=0,j=ring.length-1;i<ring.length;j=i++){
      const [ax,ay]=ring[j],[bx,by]=ring[i];
      if((ay>y)!==(by>y))crossings.push(ax+(y-ay)*(bx-ax)/(by-ay));
    }
    crossings.sort((a,b)=>a-b);
    const intervals=[];
    for(let i=1;i<crossings.length;i+=2){
      const left=crossings[i-1],right=crossings[i];
      if(right>left)intervals.push({point:[left+(right-left)/2,y],width:right-left});
    }
    intervals.sort((a,b)=>b.width-a.width||a.point[0]-b.point[0]);
    const interval=intervals.find(candidate=>strictlyInside(candidate.point,ring));
    if(interval)return interval.point;
  }
  return null;
}

export function settlementPoint(place){
  if(!place||!Array.isArray(place.bbox)||place.bbox.length!==4
    ||!place.bbox.every(Number.isFinite)||!Array.isArray(place.rings)||!place.rings.length)return null;
  const [west,south,east,north]=place.bbox;
  if(west>=east||south>=north||west< -180||east>180||south< -90||north>90)return null;
  if(place.rings.some(ring=>!Array.isArray(ring)||ring.length<3||ring.some(point=>!coordinate(point))))return null;
  const main=place.rings.map((ring,index)=>({ring,index,...ringAreaAndCentroid(ring)}))
    .filter(item=>Number.isFinite(item.area)&&item.area>0)
    .sort((a,b)=>b.area-a.area||a.index-b.index)[0];
  if(!main)return null;
  const point=strictlyInside(main.centroid,main.ring)?main.centroid:scanlinePoint(main.ring);
  return point&&point[0]>=west&&point[0]<=east&&point[1]>=south&&point[1]<=north?point:null;
}
