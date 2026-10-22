// HTTP → DM job → fake Claude CLI → DM reply. No real CLI agent execution.
import {test} from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import http from 'node:http';
import {spawn} from 'node:child_process';
import {DatabaseSync} from 'node:sqlite';
const sleep=ms=>new Promise(r=>setTimeout(r,ms));
test('opt-in subscription DM isolates child environment, context, replies, failures and provider',async()=>{
 const dir=fs.mkdtempSync(path.join(os.tmpdir(),'hub-private-test-')), capture=path.join(dir,'calls.jsonl'), bin=path.join(dir,'claude');
 fs.writeFileSync(bin,`#!/usr/bin/env node
const fs=require('fs');const args=process.argv.slice(2);
if(args.includes('--help')){console.log('--safe-mode --restricted --no-session-persistence --strict-mcp-config --disable-slash-commands --no-chrome --tools');process.exit(0);}
let input='';process.stdin.on('data',d=>input+=d).on('end',()=>{fs.appendFileSync(${JSON.stringify(capture)},JSON.stringify({args,input,cwd:process.cwd(),envKeys:Object.keys(process.env)})+'\\n');if(input.includes('FAIL-PRIVATE')){console.log(JSON.stringify({is_error:true,result:'authentication required Bearer PRIVATE-TOKEN-SECRET'}));process.exitCode=1;}else console.log(JSON.stringify({result:'REMEMBER: CLI-PRIVATE-REPLY'}));});`);fs.chmodSync(bin,0o755);
 const reserve=http.createServer().listen(0,'127.0.0.1');await new Promise(r=>reserve.once('listening',r));const port=reserve.address().port;await new Promise(r=>reserve.close(r));
 const dbPath=path.join(dir,'db.sqlite');
 const child=spawn(process.execPath,['server.js'],{cwd:path.resolve(import.meta.dirname,'..'),env:{PATH:process.env.PATH,HOME:dir,PORT:String(port),HOST:'127.0.0.1',DB_FILE:dbPath,AI_ENGINE:'subscription',CLAUDE_BIN:bin,CODEX_BIN:'/not-a-real-codex',HUB_PRIVATE_CLAUDE_CLI:'1',BRIDGE_TOKEN:'fixture',TRIAL_START:'1'},stdio:'ignore'});
 const api=async(route,body)=>{const response=await fetch(`http://127.0.0.1:${port}/api/${route}`,{method:body?'POST':'GET',headers:{Authorization:'Bearer fixture','Content-Type':'application/json'},body:body?JSON.stringify(body):undefined});return {status:response.status,body:await response.json()};};
 try{
  let ready=false;for(let i=0;i<100;i++){try{await api('overview');ready=true;break;}catch{await sleep(30);}}assert.ok(ready);
  const db=new DatabaseSync(dbPath);db.exec("INSERT INTO memories(id,project,text,author) VALUES('shared','default','SHARED-CONTEXT-SECRET','human')");
  await api('direct',{project:'default',agent:'codex',text:'OTHER-DM-SECRET'});
  const before=db.prepare('SELECT count(*) n FROM activity').get().n;
  const send=await api('direct',{project:'default',agent:'claude',text:'PRIVATE-QUESTION',reply:true});assert.equal(send.status,200);
  const done=async()=>{for(let i=0;i<100;i++){const x=(await api('direct-status?project=default&agent=claude')).body;if(x.request?.state!=='working')return x;await sleep(20);}throw new Error('reply timeout');};
  assert.equal((await done()).request.state,'completed');
  const call=JSON.parse(fs.readFileSync(capture,'utf8').trim());assert.ok(call.input.includes('PRIVATE-QUESTION'));assert.ok(!call.input.includes('OTHER-DM-SECRET'));assert.ok(!call.input.includes('SHARED-CONTEXT-SECRET'));
  for(const flag of ['--safe-mode','--restricted','--no-session-persistence','--strict-mcp-config','--disable-slash-commands','--no-chrome'])assert.ok(call.args.includes(flag));
  assert.equal(call.args[call.args.indexOf('--tools')+1],'');assert.ok(!call.envKeys.includes('BRIDGE_TOKEN'));assert.ok(!fs.existsSync(call.cwd));
  const messages=(await api('direct?project=default&agent=claude')).body;assert.equal(messages.at(-1).text,'REMEMBER: CLI-PRIVATE-REPLY');
  assert.equal((await api('chat?project=default')).body.length,0);assert.equal((await api('search?project=default&agent=group&q=PRIVATE')).body.length,0);
  assert.equal(db.prepare('SELECT count(*) n FROM activity').get().n,before);assert.equal(db.prepare('SELECT count(*) n FROM memories').get().n,1);
  await api('direct',{project:'default',agent:'claude',text:'FAIL-PRIVATE',reply:true});const failed=(await done()).request;assert.equal(failed.state,'failed');assert.equal(failed.error_category,'auth_required');assert.equal(failed.error_stage,'invoke');assert.ok(!JSON.stringify(failed).includes('PRIVATE-TOKEN-SECRET'));assert.ok(!JSON.stringify(failed).includes('Bearer'));
  assert.equal((await api('direct',{project:'default',agent:'codex',text:'no fallback',reply:true})).status,400);
  assert.equal(fs.readFileSync(capture,'utf8').trim().split('\n').length,2);db.close();
 }finally{child.kill();await new Promise(r=>child.once('exit',r));fs.rmSync(dir,{recursive:true,force:true});}
});
test('private subscription adapter is off by default and cannot start a CLI',async()=>{
 const previous=process.env.HUB_PRIVATE_CLAUDE_CLI;delete process.env.HUB_PRIVATE_CLAUDE_CLI;
 try{const {runPrivateClaude}=await import('../src/cli.js');await assert.rejects(runPrivateClaude({system:'test',prompt:'must not launch'}),/disabled/);}
 finally{if(previous!==undefined)process.env.HUB_PRIVATE_CLAUDE_CLI=previous;}
});
