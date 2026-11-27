import * as THREE from 'three';
const vec=(x=0,y=0,z=0)=>new THREE.Vector3(x,y,z);
// Nine independent scoring volumes, separate from navigation and collision search.
export const ZONES=Object.freeze([-32,0,32].flatMap((z,row)=>[-32,0,32].map((x,col)=>({id:`Z${row*3+col+1}`,min:vec(x-12,-12,z-12),max:vec(x+12,12,z+12),multiplier:row===1?2:1}))));
export const SCORE_CONFIG={tickCount:60,base:1,cap:3,victory:1000};
export function zoneCounts(state,zone){const counts={ALLY:0,ENEMY:0};for(const f of state.fleets)for(const s of f.ships)if(s.alive&&s.position.x>=zone.min.x&&s.position.x<=zone.max.x&&s.position.y>=zone.min.y&&s.position.y<=zone.max.y&&s.position.z>=zone.min.z&&s.position.z<=zone.max.z)counts[f.team]++;return counts;}
export function scoreZones(state){const gains={ALLY:0,ENEMY:0};for(const zone of ZONES){const n=zoneCounts(state,zone),d=THREE.MathUtils.clamp(n.ALLY-n.ENEMY,-SCORE_CONFIG.cap,SCORE_CONFIG.cap),v=SCORE_CONFIG.base*zone.multiplier;gains.ALLY+=Math.max(d,0)*v;gains.ENEMY+=Math.max(-d,0)*v;}state.scores.ALLY+=gains.ALLY;state.scores.ENEMY+=gains.ENEMY;const a=state.scores.ALLY>=SCORE_CONFIG.victory,e=state.scores.ENEMY>=SCORE_CONFIG.victory;if(a||e){state.result=a&&e?(state.scores.ALLY===state.scores.ENEMY?'DRAW':state.scores.ALLY>state.scores.ENEMY?'ALLY':'ENEMY'):a?'ALLY':'ENEMY';state.phase='RESULT';}return gains;}
