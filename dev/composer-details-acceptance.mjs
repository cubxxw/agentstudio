// Opt-in native UI acceptance. All records are synthetic; no provider is called.
import {createRequire} from 'node:module';
import {createServer} from 'node:http';
import {mkdtemp,mkdir,writeFile} from 'node:fs/promises';
import {isAbsolute,join,resolve} from 'node:path';
import {cleanDesktopTestEnv,launchDesktopTest} from './desktop-test-env.mjs';
const root=process.env.AGENTROOM_DETAILS_EVIDENCE_DIR;
if(!root || !isAbsolute(root))throw new Error('Set AGENTROOM_DETAILS_EVIDENCE_DIR to an absolute registered artifact directory');
const baseline=process.argv.includes('--baseline');const output=await mkdtemp(join(root,baseline?'ui-before-':'ui-after-'));
const require=createRequire(new URL('../apps/desktop/package.json',import.meta.url));const {_electron,expect}=require('@playwright/test');
const cli=join(output,'fake-codex');await writeFile(cli,`#!${process.execPath}\nif(process.argv.includes('--version'))console.log('codex 0.0.1-synthetic');else if(process.argv.includes('login'))console.error('Logged in');else process.exit(1);\n`,{mode:0o700});await mkdir(join(output,'codex-home'));await writeFile(join(output,'codex-home/config.toml'),'model = "synthetic-model"\nmodel_reasoning_effort = "high"\n');
const env=cleanDesktopTestEnv({...process.env,AGENTSTUDIO_USER_DATA_DIR:join(output,'profile'),AGENTSTUDIO_WORKSPACE:'personal',CODEX_HOME:join(output,'codex-home'),AGENTSTUDIO_CODEX_BIN:cli,AGENTSTUDIO_CLAUDE_BIN:join(output,'missing'),AGENTSTUDIO_PI_BIN:join(output,'missing'),AGENTSTUDIO_MOCK_KEYCHAIN:'1'});
// Visibility remains opt-in through the shared launcher. Baselines require an explicit build ref.
if(baseline && !env.AGENTROOM_EXPECTED_BUILD_REF)throw new Error('--baseline requires AGENTROOM_EXPECTED_BUILD_REF');
const packaged=process.env.AGENTSTUDIO_PACKAGED_APP;
const app=await launchDesktopTest(_electron,{executablePath:packaged?join(packaged,'Contents/MacOS/AgentRoom'):require('electron'),args:packaged?[]:[resolve(process.env.AGENTROOM_DETAILS_APP_DIR || 'apps/desktop')],env});
let page,remote;let diagnosticsEligible=false;const errors=[],checks=[],observations={};let requests=0;
try{
 page=await app.firstWindow();expect(await app.evaluate(({app})=>app.getPath('userData'))).toBe(env.AGENTSTUDIO_USER_DATA_DIR);diagnosticsEligible=true;page.on('pageerror',e=>errors.push(e.message));
 const api=(path,body)=>page.evaluate(async({path,body})=>{const r=await window.agentStudioPersonal.request({path:'/api'+path,method:body?'POST':'GET',...(body?{body}:{})});if(r.status>=400)throw Error(JSON.stringify(r));return r.body;},{path,body});
 const bounds=(w,h,zoom=1)=>app.evaluate(({BrowserWindow},{w,h,zoom})=>{const win=BrowserWindow.getAllWindows()[0];win.setMinimumSize(0,0);win.setBounds({width:w,height:h});win.webContents.setZoomFactor(zoom);},{w,h,zoom});
 const shot=async name=>{
  // Electron's capture avoids Playwright clipping a zoomed native viewport.
  const png=await app.evaluate(async({BrowserWindow})=>(await BrowserWindow.getAllWindows()[0].webContents.capturePage(undefined,{stayHidden:true})).toPNG().toString('base64'));
  await writeFile(join(output,name+'.png'),Buffer.from(png,'base64'));
 };
 observations.build=(await api('/health')).build;await app.evaluate(({nativeTheme})=>nativeTheme.themeSource='light');await page.emulateMedia({colorScheme:'light'});
 await bounds(1200,780);await api('/workspace/onboarding',{action:'complete',name:'合成界面验收',clientId:'ui-owner'});await api('/contacts/local',{agentIds:['codex'],clientId:'ui-adopt'});
 const peers=[];for(const [name,handle]of [['设计伙伴一','design_one'],['设计伙伴二','design_two']])peers.push(await api('/contacts',{kind:'agent',name,handle,binding:{type:'local',localAgentId:'codex'},clientId:handle}));
 const group=await api('/chats',{kind:'group',title:'合成设计讨论',memberIds:peers.map(p=>p.id),clientId:'ui-group'});
 const local=await api('/threads',{text:'合成资料：请保留这份本地报告。',mode:'local',clientId:'ui-local-task'});await expect.poll(async()=>(await api('/threads/'+local.id)).status).toBe('completed');
 await page.reload();await page.getByTestId('im-nav-chats').click();await page.getByTestId('im-chat-'+group.id).click();const input=()=>page.getByTestId('im-message-input');
 await input().fill('@des');await expect(page.getByTestId('im-mention-'+peers[0].id)).toBeVisible();await shot('01-mentions');
 if(baseline){await input().press('ArrowDown');await input().press('Enter');await expect.poll(async()=>(await api('/threads/'+group.id)).messages.length).toBeGreaterThan(0);observations.firstEnterSentMessage=true;}
 else{
  const order=await page.getByTestId('im-mention-list').evaluate(node=>[...node.querySelectorAll('[role="option"]')].map(x=>x.dataset.testid));
  await expect(page.getByTestId(order[0])).toHaveAttribute('aria-selected','true');await input().press('ArrowDown');await expect(page.getByTestId(order[1])).toHaveAttribute('aria-selected','true');await input().press('Enter');
  const chosen=peers.find(p=>'im-mention-'+p.id===order[1]);await expect(input()).toHaveValue('@'+chosen.handle+' ');expect((await api('/threads/'+group.id)).messages.length).toBe(0);await expect(input()).toBeFocused();
  await input().press('Enter');await expect.poll(async()=>(await api('/threads/'+group.id)).messages.length).toBe(1);checks.push('arrow and Enter choose a mention before a later Enter sends');
  await input().fill('@des');await input().press('ArrowUp');await expect(page.getByTestId(order[1])).toHaveAttribute('aria-selected','true');await input().press('Escape');await expect(page.getByTestId('im-mention-list')).toHaveCount(0);await expect(input()).toHaveValue('@des');
  await input().pressSequentially('i');await expect(page.getByTestId('im-mention-list')).toBeVisible();await input().press('Shift+Enter');await expect(page.getByTestId('im-mention-list')).toHaveCount(0);checks.push('mention wrapping, Escape and Shift+Enter keep editing predictable');
  await input().fill('@des');const cdp=await page.context().newCDPSession(page);await cdp.send('Input.imeSetComposition',{text:'设',selectionStart:1,selectionEnd:1});await input().press('Enter');expect((await api('/threads/'+group.id)).messages.length).toBe(1);await cdp.send('Input.imeSetComposition',{text:'',selectionStart:0,selectionEnd:0});checks.push('IME Enter commits input without sending');
  await input().fill('@des');await input().press('Home');await expect(page.getByTestId('im-mention-list')).toHaveCount(0);checks.push('moving the caret away from the suffix restores ordinary editing');
 }
 await page.getByTestId('im-chat-'+local.id).click();await input().fill('附件预览关闭后，继续保留这份草稿。');
 const longName='design-review-'.repeat(14)+'.md';const files=[{name:longName,text:'# 合成附件\n\n长文件名预览完整内容。'},{name:'重复.md',text:'第一份同名资料'},{name:'重复.md',text:'第二份同名资料'},{name:'取舍.txt',text:'方案取舍'},{name:'清单.md',text:'行动清单'}];
 await page.getByTestId('im-attach').setInputFiles(files.map(f=>({name:f.name,mimeType:'text/plain',buffer:Buffer.from(f.text)})));await shot('02-attachments-wide');await bounds(640,1020,2);await expect.poll(()=>page.evaluate(()=>innerWidth)).toBe(320);await shot('03-attachments-narrow');
 observations.attachmentLayout=await page.getByTestId('im-app').evaluate(node=>{const file=node.querySelector('.im-draft-files')?.firstElementChild;const buttons=file?.querySelectorAll('button');const button=buttons?.[buttons.length-1];return {viewport:innerWidth,height:innerHeight,right:button?.getBoundingClientRect().right,bottom:button?.getBoundingClientRect().bottom,fileWidth:file?.getBoundingClientRect().width,fileHeight:file?.getBoundingClientRect().height};});
 if(!baseline){
  await expect(page.getByTestId('im-draft-file')).toHaveCount(5);await expect(page.getByTestId('im-draft-remove-0')).toBeInViewport();expect(observations.attachmentLayout.right).toBeLessThanOrEqual(320);
  await page.getByTestId('im-draft-preview-0').click();await expect(page.getByTestId('personal-modal')).toContainText('长文件名预览完整内容');await expect(page.getByTestId('personal-modal-close')).toBeInViewport();await shot('04-attachment-preview');await page.getByTestId('personal-modal-close').click();await expect(page.getByTestId('im-draft-preview-0')).toBeFocused();await expect(input()).toHaveValue('附件预览关闭后，继续保留这份草稿。');
  await page.getByTestId('im-draft-preview-2').click();await expect(page.getByTestId('personal-modal')).toContainText('第二份同名资料');await page.getByTestId('personal-modal-close').click();await page.getByTestId('im-draft-remove-2').click();await expect(page.getByTestId('im-draft-file')).toHaveCount(4);await expect(input()).toBeFocused();await page.reload();await expect(page.getByTestId('im-draft-file')).toHaveCount(4);await expect(input()).toHaveValue('附件预览关闭后，继续保留这份草稿。');checks.push('long and duplicate attachments remain previewable and removable at 320px; draft survives reload');
  while(await page.getByTestId('im-draft-file').count())await page.getByTestId('im-draft-remove-0').click();
  await page.getByTestId('im-attach').setInputFiles(Array.from({length:5},(_,i)=>({name:`${i}-${longName}`,mimeType:'text/plain',buffer:Buffer.from('合成长文件资料')})));await bounds(640,780,2);
  await expect(page.getByTestId('im-send')).toBeInViewport();await page.getByTestId('im-draft-remove-4').scrollIntoViewIfNeeded();await expect(page.getByTestId('im-draft-remove-4')).toBeInViewport();await expect(page.getByTestId('im-send')).toBeInViewport();await shot('04b-five-long-attachments-short-window');await page.getByTestId('im-draft-remove-4').click();await expect(input()).toHaveValue('附件预览关闭后，继续保留这份草稿。');checks.push('five long attachments scroll within a 320 by 390 CSS px window while Send stays visible');
 }
 remote=createServer((_req,res)=>{requests++;res.writeHead(500).end();});await new Promise(resolve=>remote.listen(0,'127.0.0.1',resolve));
 const connection=await api('/connections',{name:'合成审批目标',type:'a2a',url:`http://127.0.0.1:${remote.address().port}/`,clientId:'ui-connection'});
 const requestText=Array.from({length:12},(_,i)=>`第 ${i+1} 项：请核对资料、来源和相关限制，保留明确的取舍。`).join('\n')+'\n末尾限制：没有确认前不要发送。';
 const pending=await api('/threads',{text:requestText,mode:'connection',connectionId:connection.id,clientId:'ui-approval'});let thread;await expect.poll(async()=>{thread=await api('/threads/'+pending.id);return thread.status;}).toBe('needs_input');
 await bounds(1200,780);await page.getByTestId('im-nav-approvals').click();await page.getByTestId('im-approval-'+thread.decisions[0].id).click();await shot('05-approval-collapsed');
 observations.approvalLayout=await page.getByTestId('im-approval-source').evaluate(node=>{const p=node.querySelector('.im-approval-request');return {visibleHeight:p.clientHeight,fullHeight:p.scrollHeight};});
 if(!baseline){
  const toggle=page.getByTestId('im-approval-request-toggle');await expect(toggle).toBeVisible();await toggle.focus();await toggle.press('Enter');await expect(toggle).toHaveAttribute('aria-expanded','true');await expect(page.getByTestId('im-approval-request-text')).toContainText('末尾限制：没有确认前不要发送。');expect(await page.getByTestId('im-approval-request-text').evaluate(n=>n.scrollHeight<=n.clientHeight+1)).toBe(true);await shot('06-approval-expanded');await toggle.press('Enter');await expect(toggle).toHaveAttribute('aria-expanded','false');
  await bounds(640,1020,2);await expect(page.getByTestId('im-approval-open-chat')).toBeInViewport();expect((await page.getByTestId('im-approval-open-chat').boundingBox()).height).toBeLessThan(36);await toggle.scrollIntoViewIfNeeded();await toggle.press('Enter');await expect(toggle).toBeInViewport();expect(await page.getByTestId('im-approval-source').evaluate(n=>n.scrollWidth<=n.clientWidth)).toBe(true);await shot('07-approval-narrow');await toggle.press('Enter');checks.push('long approval requests expand by keyboard and remain readable at 320px');
  await app.evaluate(({nativeTheme})=>nativeTheme.themeSource='dark');await page.emulateMedia({colorScheme:'dark',contrast:'more',reducedMotion:'reduce'});await shot('08-dark');
 }
 expect(requests).toBe(0);expect(errors).toEqual([]);checks.push('no provider submission or renderer exceptions');await writeFile(join(output,'results.json'),JSON.stringify({baseline,checks,observations,errors,requests,synthetic:true},null,2));console.log(JSON.stringify({output,checks,observations}));
}catch(error){await writeFile(join(output,'failure.json'),JSON.stringify({error:String(error),checks,observations,requests,errors,diagnosticsEligible},null,2));if(page && diagnosticsEligible)await page.screenshot({path:join(output,'failure.png')}).catch(()=>{});console.error('OUTPUT '+output);throw error;}finally{await app.close();if(remote)await new Promise(resolve=>remote.close(resolve));}
