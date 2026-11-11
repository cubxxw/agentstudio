import { createRequire } from 'node:module';
import { mkdir, mkdtemp, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { resolve, dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { createAgentNode } from '../apps/personal/server/agent-node.mjs';
// macOS native regression: an unrelated native provider never answers discovery.
// All profiles, node state and credentials are isolated synthetic fixtures.
const root=resolve(dirname(fileURLToPath(import.meta.url)),'..');
const output=await mkdtemp(join(process.env.AGENTSTUDIO_NODE_EVIDENCE_DIR || tmpdir(),'agentroom-node-ui-'));
await mkdir(output,{recursive:true});
const require=createRequire(root+'/apps/desktop/package.json');
const {_electron,expect}=require('@playwright/test');
const token='synthetic-ui-node-credential-123456789';
const node=await createAgentNode({dataDir:output+'/synthetic-node',name:'QA Server',port:0,token,agents:['codex','claude'],
 discover:async()=>({agents:['codex','claude'].map(id=>({id,installed:true,auth:{status:'configured'}}))}),execute:async()=>({markdown:'Synthetic UI result'})});
const address=await node.listen();
const env={...process.env,AGENTSTUDIO_USER_DATA_DIR:output+'/profile',AGENTSTUDIO_WORKSPACE:'personal',AGENTSTUDIO_MOCK_KEYCHAIN:'1',AGENTSTUDIO_CODEX_BIN:'/missing-ui-codex',AGENTSTUDIO_CLAUDE_BIN:'/missing-ui-claude',AGENTSTUDIO_PI_BIN:'/missing-ui-pi'};
for(const k of ['ELECTRON_RUN_AS_NODE','ELECTRON_RENDERER_URL','AGENTSTUDIO_PERSONAL_DATA_DIR','PERSONAL_DATA_DIR'])delete env[k];
let app;const errors=[];
try{
 const bundle=process.env.AGENTSTUDIO_PACKAGED_APP;
 app=await _electron.launch({executablePath:bundle ? join(bundle,'Contents/MacOS/AgentRoom') : require('electron'),args:bundle ? [] : [join(root,'apps/desktop')],env,timeout:30000});
 await app.evaluate(({ipcMain})=>{ipcMain.removeHandler('agentstudio:personal:integration');ipcMain.handle('agentstudio:personal:integration',()=>new Promise(()=>{}));});
 const page=await app.firstWindow();page.on('pageerror',e=>errors.push(e.message));
 await page.getByTestId('im-app').waitFor();await page.getByTestId('im-settings').click();
 await page.getByTestId('personal-node-add').click();
 await page.getByTestId('personal-node-url').fill(`http://127.0.0.1:${address.port}`);
 await page.getByTestId('personal-node-token').fill(token);
 await page.getByTestId('personal-node-save').click();
 await expect(page.getByTestId('personal-node-row')).toHaveCount(1);
 await expect(page.getByTestId('personal-node-form')).toHaveCount(0);
 await expect(page.getByTestId('personal-node-agent-remove')).toHaveCount(2);
 await page.getByTestId('personal-node-check').click();
 await expect(page.getByTestId('personal-node-check')).toHaveText('检查连接');
 await page.getByTestId('personal-node-row').scrollIntoViewIfNeeded();
 await page.screenshot({path:output+'/server-added.png'});
 const state=await page.evaluate(async()=>{const b=window.agentStudioPersonal;const health=await b.request({path:'/api/health',method:'GET'});const integrations=await b.request({path:'/api/integrations',method:'GET'});return {health:health.body,integrations:integrations.body};});
 if(!state.health.build.serverFiles['remote-nodes.mjs'])throw new Error('packaged runtime missing node module fingerprint');
 if(state.integrations.nodes[0].agents.length!==2)throw new Error('multi-agent catalog missing');
 await page.getByTestId('personal-node-agent-remove').first().click();
 await expect(page.getByTestId('personal-node-agent-remove')).toHaveCount(1);
 if(errors.length)throw new Error(errors.join('\n'));
 const result={passed:true,scope:'native macOS app, isolated profile, synthetic remote node, real IPC/vault/catalog, unrelated native discovery held indefinitely',url:page.url(),checks:['node form','multi-agent enrollment','private token cleared','connectivity check','guarded individual removal','packaged backend fingerprint','no renderer errors'],build:state.health.build.ref};
 await writeFile(output+'/result.json',JSON.stringify(result,null,2));console.log(JSON.stringify(result));
}finally{await app?.close();await node.close();}
