// Staging-only HTTP checks. Run prepare before the migration, verify after it,
// and setup after provisioning a one-time setup hash for this synthetic fixture.
import assert from 'node:assert/strict';
import {randomUUID,randomBytes} from 'node:crypto';
import {readFileSync,writeFileSync} from 'node:fs';
const url='https://axyywkipikyahayzipbu.supabase.co';
const source=readFileSync(new URL('./browser.cjs',import.meta.url),'utf8');
const key=source.match(/const anon = '([^']+)'/)[1];
const file=process.env.WBL_PERSISTENT_FIXTURE;
if(!file)throw Error('Set WBL_PERSISTENT_FIXTURE to a temporary fixture path.');
const token=()=>randomBytes(32).toString('hex');
async function rpc(name,args) {
 const response=await fetch(url+'/rest/v1/rpc/'+name,{method:'POST',headers:{apikey:key,'Content-Type':'application/json'},body:JSON.stringify(args),signal:AbortSignal.timeout(30000)});
 return {status:response.status,data:await response.json()};
}
function ok(r){assert.equal(r.status,200,JSON.stringify(r.data));assert.ok(!r.data.error,JSON.stringify(r.data));return r.data;}
function denied(r){assert.ok(r.status>=400||r.data.error,JSON.stringify(r.data));}
const pass=name=>console.log('PASS '+name);
if(process.argv[2]==='prepare') {
 const fixture={token:token(),setupToken:token(),setupSession:token(),code:'Persistent8!'};
 fixture.draft={op_id:randomUUID(),session_token:fixture.token,name:'Persistent Access '+randomUUID(),code:fixture.code,settings:{weeks:6,innings:3,outs:2},teams:{teams:[{name:'Synthetic Away',players:[]},{name:'Synthetic Home',players:[]}]}};
 const result=ok(await rpc('wbl_create',{p_request:fixture.draft}));
 assert.ok(result.expires_at);fixture.id=result.league_id;
 writeFileSync(file,JSON.stringify(fixture),{mode:0o600});pass('Prepared a seven-day synthetic grant for upgrade testing');
} else {
 const f=JSON.parse(readFileSync(file,'utf8'));
 const read=t=>rpc('wbl_read',{p_league_id:f.id,p_access_token:t});
 if(process.argv[2]==='verify') {
  ok(await read(f.token));pass('Previously expired stored grant survives the migration');
  assert.equal(ok(await rpc('wbl_create',{p_request:f.draft})).expires_at,null);pass('Creation retry returns a permanent grant');
  const other=token();assert.equal(ok(await rpc('wbl_join',{p_league_id:f.id,p_code:f.code,p_session_token:other})).expires_at,null);pass('Correct code grants permanent device access');
  denied(await read(token()));denied(await rpc('wbl_read',{p_league_id:'6767',p_access_token:f.token}));pass('Forged and cross-league permanent grants are denied');
  ok(await rpc('wbl_leave_access',{p_league_id:f.id,p_access_token:f.token}));denied(await read(f.token));ok(await read(other));pass('Leave revokes only that device');
  denied(await rpc('wbl_create',{p_request:f.draft}));pass('Creation retry cannot recreate a deliberately revoked grant');
  const another=token();ok(await rpc('wbl_join',{p_league_id:f.id,p_code:f.code,p_session_token:another}));
  ok(await rpc('wbl_change_code',{p_league_id:f.id,p_access_token:other,p_code:'Rotated9!'}));denied(await read(other));denied(await read(another));pass('Code rotation still revokes every permanent grant');
 } else if(process.argv[2]==='setup') {
  const args={p_league_id:f.id,p_setup_token:f.setupToken,p_session_token:f.setupSession,p_code:'Setup10!'};
  assert.equal(ok(await rpc('wbl_setup',args)).expires_at,null);ok(await read(f.setupSession));pass('One-time setup grants permanent device access');
  denied(await rpc('wbl_setup',args));pass('Setup token remains single use');
 } else throw Error('Use prepare, verify or setup.');
}
