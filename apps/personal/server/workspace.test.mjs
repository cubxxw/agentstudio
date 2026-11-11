import {test} from 'node:test';
import assert from 'node:assert/strict';
import {mkdtemp,rm} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {createPersonalServer} from './index.mjs';
async function setup(t,seed) {
 const dir=await mkdtemp(join(tmpdir(),'agentroom-workspace-'));
 let app=await createPersonalServer({dataDir:dir,port:0,codexCommand:'/missing-agentroom-codex',discoverLocalAgents:async()=>({agents:[]})});
 if(seed){seed(app.store);await app.close();app=await createPersonalServer({dataDir:dir,port:0,codexCommand:'/missing-agentroom-codex',discoverLocalAgents:async()=>({agents:[]})});}
 await app.listen();t.after(async()=>{await app.close();await rm(dir,{recursive:true,force:true});});
 const request=async(path,body)=>{const r=await fetch('http://127.0.0.1:'+app.address().port+'/api'+path,{method:body?'POST':'GET',headers:body?{'content-type':'application/json'}:{},body:body?JSON.stringify(body):undefined});return {status:r.status,body:await r.json()};};
 return {app,request};
}
test('first use persists owner name and can reopen onboarding without clearing work',async t=>{
 const {app,request}=await setup(t);
 assert.equal((await request('/bootstrap')).body.workspace.onboardingCompleted,false);
 assert.equal((await request('/workspace/onboarding',{action:'complete',name:'测试同学',clientId:'first-request'})).status,200);
 assert.equal(app.store.get('contact','self').name,'测试同学');
 assert.equal((await request('/bootstrap')).body.workspace.onboardingCompleted,true);
 app.store.put('memory',{id:'memory-fixture',text:'preserve me'});
 await request('/workspace/onboarding',{action:'restart',clientId:'restart-request'});
 assert.equal((await request('/bootstrap')).body.workspace.onboardingCompleted,false);
 assert.equal(app.store.get('memory','memory-fixture').text,'preserve me');
});
test('existing populated workspaces do not receive forced onboarding',async t=>{
 const {request}=await setup(t,store=>store.put('memory',{id:'existing',text:'keep'}));
 assert.equal((await request('/bootstrap')).body.workspace.onboardingCompleted,true);
});
test('onboarding validates identity and rejects unsupported fields without writes',async t=>{
 const {app,request}=await setup(t);
 for(const fields of [{action:'complete',name:''},{action:'complete',name:'a'.repeat(81)},{action:'erase',name:'x'},{action:'complete',name:'x',path:'/real'}]){
  assert.equal((await request('/workspace/onboarding',{...fields,clientId:crypto.randomUUID()})).status,400);
 }
 assert.equal(app.store.get('contact','self').name,'你');
 assert.equal((await request('/workspace/reset',{})).status,404);
});
test('workspace switch status includes uncertain and stopping runs',async t=>{
 const {app,request}=await setup(t);
 app.store.put('thread',{id:'thr_fixture',runs:[{status:'unknown'},{status:'completed',stopUnconfirmed:true},{status:'running'}]});
 const result=await request('/workspace/status');assert.equal(result.status,200);assert.equal(result.body.blockingRuns,3);
});
test('preparing a profile switch freezes new writes and resumes when active work blocks it',async t=>{
 const {app,request}=await setup(t);
 assert.deepEqual(await app.prepareWorkspaceSwitch(),{blockingRuns:0});
 assert.equal((await request('/workspace/onboarding',{action:'complete',name:'blocked',clientId:'frozen-request'})).status,409);
 app.cancelWorkspaceSwitch();
 app.store.put('thread',{id:'thr_busy',runs:[{status:'unknown'}]});
 assert.deepEqual(await app.prepareWorkspaceSwitch(),{blockingRuns:1});
 assert.equal((await request('/workspace/onboarding',{action:'complete',name:'restored',clientId:'resumed-request'})).status,200);
});
