import {PGlite} from '@electric-sql/pglite';
import fs from 'node:fs';import assert from 'node:assert/strict';
const db=new PGlite();
const root=new URL('..',import.meta.url).pathname;
await db.exec(`create schema wbl_private;create role anon;create role authenticated;
 create table wbl_private.league(id text primary key,name text,settings jsonb,season_json jsonb,schedule_json jsonb,teams_json jsonb,revision bigint default 1,updated_at timestamptz);
 create table wbl_private.games(id uuid primary key,league_id text,entry_id text,state jsonb,owner_hash bytea,lease_until timestamptz,status text default 'live',revision bigint default 1,epoch bigint default 1,updated_at timestamptz);
 create table wbl_private.receipts(op_id uuid,league_id text,request_hash bytea,receipt jsonb,game_id uuid);
 create function wbl_private.validate_text_tree(jsonb) returns void language sql as 'select';`);
const migration=fs.readFileSync(root+'/supabase/migrations/20261010191952_rosters_series_stats.sql','utf8');
await db.exec(migration);console.log('PASS PostgreSQL compiles complete migration');
let passed=1;
async function bad(query,params=[]){await assert.rejects(()=>db.query(query,params));passed++;}
async function good(query,params=[]){await db.query(query,params);passed++;}
const rule={weeks:6,innings:3,outs:2,maxPlayers:3,seriesLength:5};
for(const n of [0,-1,2,4,2.5,10,null,'3'])await bad('select wbl_private.check_settings($1)',[JSON.stringify({...rule,seriesLength:n})]);
for(const n of [1,3,5,7,9])await good('select wbl_private.check_settings($1)',[JSON.stringify({...rule,seriesLength:n})]);
for(const n of [0,-1,31,1.5,null,'2'])await bad('select wbl_private.check_settings($1)',[JSON.stringify({...rule,maxPlayers:n})]);
await good('select wbl_private.check_settings($1)',[JSON.stringify({weeks:6,innings:3,outs:2})]);
const teams={teams:[{name:'A',players:['A1','A2','A3']},{name:'B',players:['B1']},{name:'C',players:['C1']}]};
async function insert(id,t=teams,r=rule,s={days:[]}){await db.query('insert into wbl_private.league(id,name,settings,teams_json,season_json,schedule_json) values($1,$1,$2,$3,$4,$5)',[id,r,t,{games:[]},s]);}
await insert('exact');passed++;
await assert.rejects(()=>insert('over',{teams:[{name:'A',players:['A1','A2','A3','A4']}]}));passed++;
await assert.rejects(()=>db.query('update wbl_private.league set settings=$1 where id=$2',[{...rule,maxPlayers:2},'exact']));passed++;
const series={away:'A',home:'B',bestOf:5,gameNumber:1,gamesInSeries:Array.from({length:5},(_,i)=>({gameNumber:i+1,result:null,skipped:null})),result:null};
const schedule={days:[{day:1,byeTeam:'C',games:[series]}]};await insert('schedule',teams,rule,schedule);passed++;
await assert.rejects(()=>insert('badweek',teams,rule,{days:[{day:1,games:[series,{...series,home:'C'}]}]}));passed++;
await assert.rejects(()=>insert('even',teams,rule,{days:[{day:1,games:[{...series,bestOf:4}]}]}));passed++;
const clinched=structuredClone(series);for(let i=0;i<3;i++)clinched.gamesInSeries[i].result={type:'win',winner:'A',loser:'B'};clinched.result={type:'win',winner:'A'};
for(let i=3;i<5;i++)clinched.gamesInSeries[i].skipped={reason:'series_clinched'};
await insert('clinch',teams,rule,{days:[{day:1,games:[clinched]}]});passed++;
const extra=structuredClone(clinched);extra.gamesInSeries[3].result={type:'win',winner:'B'};await assert.rejects(()=>insert('afterclinch',teams,rule,{days:[{day:1,games:[extra]}]}));passed++;
const fake=structuredClone(series);fake.result={type:'win',winner:'A'};await assert.rejects(()=>insert('fakewinner',teams,rule,{days:[{day:1,games:[fake]}]}));passed++;
const premature=structuredClone(series);premature.gamesInSeries[0].skipped={reason:'series_clinched'};await assert.rejects(()=>insert('premature',teams,rule,{days:[{day:1,games:[premature]}]}));passed++;
console.log('PASS '+passed+' local embedded PostgreSQL validation checks; NOT PostgREST/RLS/concurrency acceptance');
await db.close();
