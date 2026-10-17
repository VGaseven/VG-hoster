// Local fixture preview. No production environment, agents, integrations or credentials.
import http from 'node:http';
import fs from 'node:fs';
import path from 'node:path';
import os from 'node:os';
import { DatabaseSync } from 'node:sqlite';
const root = path.resolve(import.meta.dirname, '..');
const folder = fs.mkdtempSync(path.join(os.tmpdir(), 'bridge-chat-preview-'));
const db = new DatabaseSync(path.join(folder, 'fixtures.db'));
db.exec(`CREATE TABLE messages(id INTEGER PRIMARY KEY, project TEXT, author TEXT, text TEXT, at TEXT DEFAULT CURRENT_TIMESTAMP);`);
const projects = [{name:'Team Bridge · Preview',description:'Isolated sample conversation · محادثة تجريبية'}, {name:'Creative studio',description:'A separate project with its own conversation.'}];
const insert = db.prepare('INSERT INTO messages(project,author,text) VALUES (?,?,?)');
for (const [author,text] of [
 ['human','خلّونا نجمع الأفكار هنا. نحتاج واجهة واضحة لكل المشروع.'],
 ['chatgpt','Here is a place for the team’s notes, decisions and questions.\nكل رسالة تبقى مع مشروعها.'],
 ['claude','The outline is ready for review. The task record alongside this conversation shows its saved state.'],
 ['codex','This is fixture data for the interface preview. No agents or external services are connected.'],
]) insert.run(projects[0].name,author,text);
const tasks = [{id:'DEMO-1',project:projects[0].name,title:'Review the conversation layout',status:'in_progress',assignee:'human'}, {id:'DEMO-2',project:projects[0].name,title:'مراجعة النص العربي',status:'open',assignee:'anyone'}];
const server = http.createServer(async(req,res)=>{
 const u=new URL(req.url,'http://127.0.0.1');
 const json=(code,data)=>{res.writeHead(code,{'Content-Type':'application/json'});res.end(JSON.stringify(data));};
 if(u.pathname.startsWith('/api/')){
  const project=u.searchParams.get('project');
  if(u.pathname==='/api/projects' && req.method==='GET')return json(200,projects);
  if(u.pathname==='/api/tasks')return json(200,tasks.filter(t=>t.project===project));
  if(u.pathname==='/api/files')return json(200,[]);
  if(u.pathname==='/api/chat' && req.method==='GET')return json(200,db.prepare('SELECT * FROM messages WHERE project=? ORDER BY id').all(project));
  if(u.pathname==='/api/chat' && req.method==='POST'){
   let body='';for await(const part of req){body+=part;if(body.length>100000)return json(413,{});}
   try{const data=JSON.parse(body);if(!projects.some(p=>p.name===data.project)||typeof data.text!=='string')return json(400,{});
   insert.run(data.project,'human',data.text);return json(200,{answering:[]});}catch{return json(400,{});}
  }
  return json(405,{error:'Fixture preview supports only existing projects and sample messages.'});
 }
 const file=path.resolve(root,'public','.'+(u.pathname==='/'?'/index.html':u.pathname));
 if(!file.startsWith(path.join(root,'public')+path.sep)||!fs.existsSync(file)||!fs.statSync(file).isFile()){res.writeHead(404);return res.end();}
 const ext=path.extname(file);res.writeHead(200,{'Content-Type':({'.html':'text/html','.js':'text/javascript','.css':'text/css','.png':'image/png'})[ext]||'application/octet-stream'});
 let data=fs.readFileSync(file);
 if(ext==='.html')data=data.toString().replace('<body>','<body><div style="padding:10px 20px;background:#302342;color:white;text-align:center;font:13px Arial">PREVIEW · Sample data only · بيانات تجريبية فقط</div>');
 res.end(data);
});
server.listen(Number(process.env.PREVIEW_PORT||4317),'127.0.0.1',()=>console.log('Fixture preview: http://127.0.0.1:'+server.address().port+'/#project='+encodeURIComponent(projects[0].name)));
