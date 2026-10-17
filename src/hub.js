// Human Hub read models. Private messages never enter the legacy group/event tables.
import { all, get, run, db } from './db.js';
import * as core from './core.js';
import {privateFailure} from './private-errors.js';
import { askPrivate, privateReplyCapability } from './llm.js';
const agents = new Set(['claude','codex','chatgpt','claude-code','local','bridge']);
db.exec(`CREATE TABLE IF NOT EXISTS direct_messages (
 id INTEGER PRIMARY KEY, project TEXT NOT NULL, agent TEXT NOT NULL,
 author TEXT NOT NULL, text TEXT NOT NULL, at TEXT DEFAULT CURRENT_TIMESTAMP);
 CREATE INDEX IF NOT EXISTS direct_scope ON direct_messages(project,agent,id);
 CREATE TABLE IF NOT EXISTS hub_sessions (
 id TEXT PRIMARY KEY, project TEXT NOT NULL, task_id TEXT, source TEXT NOT NULL,
 source_url TEXT, title TEXT NOT NULL, status TEXT NOT NULL DEFAULT 'unknown',
 summary TEXT NOT NULL DEFAULT '', updated TEXT DEFAULT CURRENT_TIMESTAMP);
 CREATE TABLE IF NOT EXISTS project_parents (project TEXT PRIMARY KEY, parent TEXT NOT NULL);`);
function project(name) {
 if (typeof name !== 'string' || !get('SELECT name FROM projects WHERE name=?',name)) throw new Error('Unknown project');
 return name;
}
function agent(name) { if (!agents.has(name)) throw new Error('Unknown conversation'); return name; }
const limitOf = n => Math.max(1,Math.min(200,Number(n)||100));
export function directMessages(a) {
 return all('SELECT * FROM direct_messages WHERE project=? AND agent=? ORDER BY id DESC LIMIT ?',project(a.project),agent(a.agent),limitOf(a.limit)).reverse();
}
db.exec(`CREATE TABLE IF NOT EXISTS direct_requests (message_id INTEGER PRIMARY KEY, project TEXT NOT NULL, agent TEXT NOT NULL, state TEXT NOT NULL, updated TEXT DEFAULT CURRENT_TIMESTAMP);`);
for(const column of ['error_category','error_stage'])if(!all('PRAGMA table_info(direct_requests)').some(c=>c.name===column))db.exec(`ALTER TABLE direct_requests ADD COLUMN ${column} TEXT`);
// A restart cannot resume an in-flight external request safely. Do not auto-retry.
run("UPDATE direct_requests SET state='interrupted',updated=CURRENT_TIMESTAMP WHERE state='working'");
const privateJobs = new Map();
export function directStatus(a) {
 const p=project(a.project), who=agent(a.agent);
 return { capability: privateReplyCapability(who), request:get('SELECT message_id,state,updated,error_category,error_stage FROM direct_requests WHERE project=? AND agent=? ORDER BY message_id DESC LIMIT 1',p,who)||null };
}
export function sendDirect(a) {
 const p=project(a.project), who=agent(a.agent);
 if(typeof a.text!=='string'||!a.text.trim()||a.text.length>20000) throw new Error('Invalid message');
 if(a.reply !== undefined && typeof a.reply !== 'boolean') throw new Error('Invalid reply choice');
 const scope=JSON.stringify([p,who]);
 if(a.reply){core.assertRunning();if(!privateReplyCapability(who).available)throw new Error('Private reply provider unavailable');if(privateJobs.has(scope))throw new Error('A private reply is already working');}
 const r=run('INSERT INTO direct_messages(project,agent,author,text) VALUES(?,?,?,?)',p,who,'human',a.text.trim());
 const posted=get('SELECT * FROM direct_messages WHERE id=?',r.lastInsertRowid);
 if(a.reply){
  const history=directMessages({project:p,agent:who,limit:30}).map(m=>({role:m.author==='human'?'user':'assistant',content:m.text}));
  run("INSERT INTO direct_requests(message_id,project,agent,state) VALUES(?,?,?,'working')",posted.id,p,who);
  const job=(async()=>{try{
   const reply=await askPrivate(who,history,p);
   run('INSERT INTO direct_messages(project,agent,author,text) VALUES(?,?,?,?)',p,who,who,reply);
   run("UPDATE direct_requests SET state='completed',updated=CURRENT_TIMESTAMP WHERE message_id=?",posted.id);
  }catch(error){
   // Provider errors may echo private prompts; neither store nor log the raw error.
   const safe=privateFailure(error);
   run("UPDATE direct_requests SET state='failed',error_category=?,error_stage=?,updated=CURRENT_TIMESTAMP WHERE message_id=?",safe.category,safe.stage,posted.id);
  }finally{privateJobs.delete(scope);}})();privateJobs.set(scope,job);
 }
 return {posted,answering:a.reply?[who]:[],delivery:a.reply?'reply_requested':'stored'};
}
export function sessions(a) { return all('SELECT * FROM hub_sessions WHERE project=? ORDER BY updated DESC',project(a.project)); }
export function children(a) {
 const p=project(a.project);
 return all('SELECT p.* FROM projects p JOIN project_parents r ON r.project=p.name WHERE r.parent=?',p);
}
export function setParent(a) {
 const p=project(a.project), parent=project(a.parent);
 if(p===parent) throw new Error('A project cannot contain itself');
 let next=parent; const seen=new Set([p]);
 while(next) { if(seen.has(next)) throw new Error('Project cycle'); seen.add(next); next=get('SELECT parent FROM project_parents WHERE project=?',next)?.parent; }
 run('INSERT INTO project_parents VALUES(?,?) ON CONFLICT(project) DO UPDATE SET parent=excluded.parent',p,parent);
 return {project:p,parent};
}
export function decisions(a) {
 const p=project(a.project);
 const approvals=core.pendingApprovals().filter(x=> {try{const a=JSON.parse(x.args);return (a.project||(a.id?core.getTask(a.id)?.project:null)||'default')===p;}catch{return false;}});
 const tasks=core.listTasks({project:p}).filter(x=>x.status!=='done'&&(x.assignee==='human'||x.status==='blocked'));
 return {approvals,tasks};
}
export function search(a) {
 const p=project(a.project), q=String(a.q||'').trim().toLocaleLowerCase();
 if(q.length<2) return [];
 const match=(...v)=>v.join(' ').toLocaleLowerCase().includes(q);
 const rows=[];
 for(const t of core.listTasks({project:p})) if(match(t.title,t.details,...t.notes.map(n=>n.note))) rows.push({kind:'task',id:t.id,title:t.title});
 for(const f of core.listFiles({project:p})) {const item=core.readFile({project:p,path:f.path});if(match(f.path,item.content)) rows.push({kind:'file',id:f.path,title:f.path});}
 for(const s of sessions({project:p})) if(match(s.title,s.summary)) rows.push({kind:'session',id:s.id,title:s.title});
 // Search is scoped to the selected conversation; private text is never in group results.
 const privateScope=a.agent&&a.agent!=='group';
 const msgs=privateScope?all('SELECT * FROM direct_messages WHERE project=? AND agent=? AND instr(lower(text),?)>0 ORDER BY id DESC LIMIT 100',p,agent(a.agent),q):all('SELECT * FROM messages WHERE project=? AND instr(lower(text),?)>0 ORDER BY id DESC LIMIT 100',p,q);
 for(const m of msgs) rows.push({kind:'message',id:m.id,title:m.text.slice(0,180),agent:a.agent||'group'});
 return rows.slice(0,100);
}
// Explicit human registration records provenance; URLs are never synthesized from task IDs.
export function registerSession(a) {
 const p=project(a.project);
 if(!['claude','codex'].includes(a.source)||typeof a.id!=='string'||!a.id.trim()||typeof a.title!=='string'||!a.title.trim())throw new Error('Session identity, source and title required');
 let url=null;
 if(a.source_url){const u=new URL(a.source_url);const valid=a.source==='claude'?u.protocol==='https:'&&u.hostname==='claude.ai'&&/^\/(?:chat\/[\w-]+|code\/session_[\w]+)$/.test(u.pathname):u.protocol==='codex:'&&u.hostname==='threads'&&/^\/[\w-]+$/.test(u.pathname);if(!valid||u.search||u.hash||u.username||u.password)throw new Error('Unsupported original session URL');url=u.href;}
 const status=['working','waiting_for_user','blocked','completed','unknown'].includes(a.status)?a.status:'unknown';
 if(a.task_id&&!get('SELECT id FROM tasks WHERE id=? AND project=?',a.task_id,p))throw new Error('Task is outside project');
 const existing=get('SELECT project FROM hub_sessions WHERE id=?',a.id);if(existing&&existing.project!==p)throw new Error('Session belongs to another project');
 run(`INSERT INTO hub_sessions(id,project,task_id,source,source_url,title,status,summary) VALUES(?,?,?,?,?,?,?,?)
 ON CONFLICT(id) DO UPDATE SET task_id=excluded.task_id,source=excluded.source,source_url=excluded.source_url,title=excluded.title,status=excluded.status,summary=excluded.summary,updated=CURRENT_TIMESTAMP`,a.id,p,a.task_id||null,a.source,url,a.title,status,String(a.summary||''));
 return get('SELECT * FROM hub_sessions WHERE id=?',a.id);
}
db.exec(`CREATE TABLE IF NOT EXISTS task_results(task_id TEXT PRIMARY KEY,summary TEXT NOT NULL,files TEXT NOT NULL DEFAULT '[]',session_id TEXT,updated TEXT DEFAULT CURRENT_TIMESTAMP)`);
export function setResult(a) {
 const p=project(a.project);
 if(!get('SELECT id FROM tasks WHERE id=? AND project=?',a.task_id,p))throw new Error('Task is outside project');
 if(typeof a.summary!=='string'||!a.summary.trim()||!Array.isArray(a.files))throw new Error('Summary and files required');
 for(const f of a.files)if(typeof f!=='string'||!core.listFiles({project:p}).some(x=>x.path===f))throw new Error('Deliverable unavailable in this project');
 if(a.session_id&&!get('SELECT id FROM hub_sessions WHERE id=? AND project=?',a.session_id,p))throw new Error('Session is outside project');
 run('INSERT INTO task_results(task_id,summary,files,session_id) VALUES(?,?,?,?) ON CONFLICT(task_id) DO UPDATE SET summary=excluded.summary,files=excluded.files,session_id=excluded.session_id,updated=CURRENT_TIMESTAMP',a.task_id,a.summary,JSON.stringify(a.files),a.session_id||null);
 return {ok:true};
}
export function results(a) {
 return all('SELECT r.* FROM task_results r JOIN tasks t ON r.task_id=t.id WHERE t.project=?',project(a.project)).map(r=>({...r,files:JSON.parse(r.files),session:r.session_id?get('SELECT * FROM hub_sessions WHERE id=?',r.session_id):null}));
}

export function message(a){const p=project(a.project);if(!/^\d+$/.test(String(a.id)))throw new Error('Invalid message');const m=a.agent&&a.agent!=='group'?get('SELECT * FROM direct_messages WHERE id=? AND project=? AND agent=?',Number(a.id),p,agent(a.agent)):get('SELECT * FROM messages WHERE id=? AND project=?',Number(a.id),p);if(!m)throw new Error('Message unavailable');return m;}
