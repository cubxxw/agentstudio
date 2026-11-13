// Isolated group-picture journey. No real account, model, conversation or image is used.
import {createRequire} from 'node:module';
import {mkdtemp,mkdir,writeFile} from 'node:fs/promises';
import {join,resolve} from 'node:path';
import {randomUUID} from 'node:crypto';
import {createPersonalServer} from '../apps/personal/server/index.mjs';
import {cleanDesktopTestEnv, launchDesktopTest} from './desktop-test-env.mjs';

const require=createRequire(new URL('../apps/desktop/package.json',import.meta.url));
const {chromium,_electron}=createRequire(require.resolve('@playwright/test'))('playwright');
const {expect}=require('@playwright/test');
const native=process.argv.includes('--native');
const parent=process.env.AGENTROOM_EVIDENCE_DIR||resolve('output/playwright/group-avatars');
await mkdir(parent,{recursive:true});
const output=await mkdtemp(join(parent,native?'native-':'browser-'));
const checks=[],errors=[],consoleMessages=[];
let server,browser,application,page;
const env={...process.env,AGENTSTUDIO_USER_DATA_DIR:join(output,'profile'),AGENTSTUDIO_MOCK_KEYCHAIN:'1',AGENTSTUDIO_WORKSPACE:'personal'};
cleanDesktopTestEnv(env);
for(const agent of ['CODEX','CLAUDE','PI','GEMINI','OPENCODE'])env[`AGENTSTUDIO_${agent}_BIN`]=join(output,'missing-'+agent);
const watchPage=target=>{
 target.on('pageerror',e=>errors.push(e.message));
 target.on('console',message=>{
  if(!['warning','error'].includes(message.type()))return;
  const text=message.text().replace(/data:image\/[a-z+]+;base64,[A-Za-z0-9+/=]+/g,'[synthetic image]').slice(0,500);
  consoleMessages.push({type:message.type(),text});
  if(message.type()==='error')errors.push(text);
 });
};
const launchNative=async()=>{
 const packaged=process.env.AGENTSTUDIO_PACKAGED_APP;
 application=await launchDesktopTest(_electron, {executablePath:packaged?join(packaged,'Contents/MacOS/AgentRoom'):require('electron'),args:packaged?[]:[resolve('apps/desktop')],env,timeout:60000});
 expect(await application.evaluate(({app})=>app.getPath('userData'))).toBe(join(output,'profile'));
 page=await application.firstWindow();
 await application.evaluate(({BrowserWindow})=>BrowserWindow.getAllWindows()[0].setBounds({width:1120,height:900}));
 watchPage(page);
 await expect(page.getByTestId('im-app')).toBeVisible();
};
const request=async(path,body)=>{
 if(native)return page.evaluate(async({path,body})=>{
  const r=await window.agentStudioPersonal.request({path:'/api'+path,method:body?'POST':'GET',...(body?{body}:{})});
  if(r.status>=400)throw new Error(`HTTP ${r.status}`);return r.body;
 },{path,body});
 const r=await fetch(`http://127.0.0.1:${server.address().port}/api${path}`,{method:body?'POST':'GET',headers:body?{'content-type':'application/json'}:{},...(body?{body:JSON.stringify(body)}:{})});
 if(!r.ok)throw new Error(`HTTP ${r.status}`);return r.json();
};
const check=name=>{checks.push(name);console.log('PASS '+name);};
const capture=name=>page.screenshot({path:join(output,name+'.png')});
const preview=()=>page.getByTestId('im-group-avatar-preview').getByTestId('im-avatar');
const editor=()=>page.getByTestId('im-chat-info').click();
const save=async()=>{await expect(page.getByTestId('im-group-save')).toBeEnabled();await page.getByTestId('im-group-save').click();await expect(page.getByTestId('im-group-editor')).toHaveCount(0);};
const holdRead=()=>page.evaluate(()=>{
 const Base=window.FileReader;window.__avatarReadDone=false;window.__avatarReadRelease=null;
 window.FileReader=class extends Base{
  readAsDataURL(file){
   this.addEventListener('loadend',()=>{window.__avatarReadDone=true;},{once:true});
   window.__avatarReadRelease=()=>{window.FileReader=Base;super.readAsDataURL(file);};
  }
 };
});
const releaseRead=async()=>{await expect.poll(()=>page.evaluate(()=>typeof window.__avatarReadRelease==='function')).toBe(true);await page.evaluate(()=>window.__avatarReadRelease());await expect.poll(()=>page.evaluate(()=>window.__avatarReadDone)).toBe(true);};

try{
 if(native)await launchNative();else{
  server=await createPersonalServer({dataDir:join(output,'data'),port:0,staticDir:process.env.AGENTROOM_STATIC_DIR||resolve('apps/personal/dist'),codexCommand:'/missing-group-avatar-agent',discoverLocalAgents:async()=>({agents:[{id:'codex',name:'Codex',installed:false,auth:{status:'unknown'},execution:{supported:false}}]})});await server.listen();
  browser=await chromium.launch({headless:true,...(process.platform==='darwin'?{channel:'chrome'}:{})});
  page=await browser.newPage({viewport:{width:1120,height:900}});watchPage(page);await page.goto(`http://127.0.0.1:${server.address().port}`);
 }
 expect(await page.title()).toMatch(/^AgentRoom/);
 await expect(page.getByTestId('im-app')).toBeVisible();
 await request('/workspace/onboarding',{action:'complete',name:'图标验收',clientId:randomUUID()});
 const person=await request('/contacts',{kind:'human',name:'设计伙伴',handle:'avatar-partner',clientId:randomUUID()});
 const second=await request('/contacts',{kind:'human',name:'旅行搭子',handle:'avatar-second',clientId:randomUUID()});
 await page.getByTestId('im-refresh').click();
 await page.getByTestId('im-new').click();await page.getByTestId('im-new-group').click();
 await expect(page.getByTestId('im-pair-hint')).toBeVisible();
 await expect(page.getByTestId('im-group-name')).toHaveCount(0);
 await page.getByTestId('im-member-'+person.id).check();await expect(page.getByTestId('im-group-save')).toHaveText('开始私聊');await save();
 const directId=new URL(page.url()).searchParams.get('thread');expect((await request('/threads/'+directId)).kind).toBe('direct');
 await page.getByTestId('im-new').click();await page.getByTestId('im-new-group').click();await page.getByTestId('im-member-'+person.id).check();await save();
 expect(new URL(page.url()).searchParams.get('thread')).toBe(directId);
 check('one selected contact starts and reuses a direct chat');
 await page.getByTestId('im-new').click();await page.getByTestId('im-new-group').click();
 await page.getByTestId('im-member-'+person.id).check();await page.getByTestId('im-member-'+second.id).check();
 await page.getByTestId('im-group-name').fill('周末创作室');
 await expect(preview()).toHaveAttribute('data-member-count','3');
 const trio=preview().getByTestId('im-group-avatar-member');await expect(trio).toHaveCount(3);
 for(const ratio of await trio.evaluateAll(elements=>elements.map(e=>e.getBoundingClientRect().width/e.parentElement.getBoundingClientRect().width)))expect(ratio).toBeGreaterThan(.5);
 await expect(trio.getByTestId('im-avatar-image')).toHaveCount(3);expect(await trio.allTextContents()).toEqual(['','','']);
 await capture('three-human-portraits');
 await holdRead();await page.getByTestId('im-group-avatar-file').setInputFiles({name:'pending.png',mimeType:'image/png',buffer:Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+k2w0AAAAASUVORK5CYII=','base64')});
 await expect(page.getByTestId('im-group-save')).toBeDisabled();
 await page.getByTestId('im-member-'+second.id).uncheck();await expect(page.getByTestId('im-group-save')).toBeEnabled();
 await releaseRead();await page.getByTestId('im-member-'+second.id).check();await expect(page.getByTestId('im-group-save')).toBeEnabled();
 await expect(preview()).toHaveAttribute('data-group-avatar-kind','members');
 check('an interrupted group-picture read cannot block the direct chat or later group creation');
 const green=await preview().evaluate(e=>getComputedStyle(e).backgroundColor);
 await capture('group-default-editor-light');
 await page.getByTestId('im-group-motif-coffee').click();await page.getByTestId('im-group-color-violet').click();
 expect(await preview().evaluate(e=>getComputedStyle(e).backgroundColor)).not.toBe(green);
 await capture('group-editor-light');await save();
 const id=new URL(page.url()).searchParams.get('thread');
 expect(id).toBeTruthy();
 const surfaces=()=>[page.getByTestId('im-chat-info').getByTestId('im-avatar'),page.getByTestId('im-chat-'+id).getByTestId('im-avatar'),page.getByTestId('im-pinned-'+id).getByTestId('im-avatar')];
 await page.getByTestId('im-chat-'+id).hover();await page.getByTestId('im-pin-'+id).click();
 for(const avatar of surfaces()){await expect(avatar).toHaveAttribute('data-group-icon','coffee');await expect(avatar).toHaveAttribute('data-group-color','violet');}
 expect((await request('/threads/'+id)).groupAvatar).toEqual({kind:'preset',icon:'coffee',color:'violet'});
 check('preset/color previews and all three saved portrait surfaces agree');
 await capture('group-preset-saved');

 const images=await page.evaluate(()=>{
  const canvas=document.createElement('canvas');canvas.width=480;canvas.height=160;
  const c=canvas.getContext('2d');c.fillStyle='#b570c0';c.fillRect(0,0,160,160);c.fillStyle='#e4aa53';c.fillRect(160,0,160,160);c.fillStyle='#539677';c.fillRect(320,0,160,160);
  return {png:canvas.toDataURL('image/png').split(',')[1],jpeg:canvas.toDataURL('image/jpeg',.9).split(',')[1],webp:canvas.toDataURL('image/webp',.9).split(',')[1]};
 });
 const file=(kind='png')=>({name:'wide-room.'+(kind==='jpeg'?'jpg':kind),mimeType:'image/'+kind,buffer:Buffer.from(images[kind],'base64')});
 await editor();await page.getByTestId('im-group-avatar-file').setInputFiles(file());
 await expect(preview()).toHaveAttribute('data-group-avatar-kind','image');
 const crop=await page.getByTestId('im-group-avatar-preview').getByTestId('im-group-avatar-image').evaluate(image=>{
  const c=document.createElement('canvas');c.width=c.height=1;c.getContext('2d').drawImage(image,0,0,1,1);
  return {width:image.naturalWidth,height:image.naturalHeight,pixel:[...c.getContext('2d').getImageData(0,0,1,1).data]};
 });
 expect(crop.width).toBe(crop.height);expect(crop.width).toBeLessThanOrEqual(256);
 // Chromium's raster backends can round a channel by one; the central gold band
 // is still clearly distinguishable from either cropped-away side band.
 crop.pixel.slice(0,3).forEach((value,index)=>expect(Math.abs(value-[228,170,83][index])).toBeLessThanOrEqual(2));expect(crop.pixel[3]).toBe(255);
 await capture('group-picture-preview');await save();
 for(const avatar of surfaces())await expect(avatar).toHaveAttribute('data-group-avatar-kind','image');
 const stored=(await request('/threads/'+id)).groupAvatar;
 expect(stored.dataUrl.length).toBeLessThanOrEqual(131094);
 await page.reload();await expect(page.getByTestId('im-chat-info')).toContainText('周末创作室');
 for(const avatar of surfaces())await expect(avatar).toHaveAttribute('data-group-avatar-kind','image');
 check('a wide local PNG is center-cropped, bounded, saved and restored after reload');

 await editor();await page.getByTestId('im-group-motif-leaf').click();await page.getByTestId('personal-modal-close').click();
 expect((await request('/threads/'+id)).groupAvatar).toEqual(stored);
 await editor();
 for(const input of [
  {name:'unsafe.svg',mimeType:'image/svg+xml',buffer:Buffer.from('<svg/>')},
  {name:'disguised.png',mimeType:'image/png',buffer:Buffer.from('<svg/>')},
  {name:'too-large.png',mimeType:'image/png',buffer:Buffer.alloc(5*1024*1024+1)},
 ]){
  await page.getByTestId('im-group-avatar-file').setInputFiles(input);await expect(page.getByTestId('im-group-avatar-error')).toBeVisible();await expect(preview()).toHaveAttribute('data-group-avatar-kind','image');
 }
 check('cancel and rejected input preserve the saved image and current draft');
 for(const format of ['jpeg','webp']){
  await page.getByTestId('im-group-avatar-file').setInputFiles(file(format));
  await expect(page.getByTestId('im-group-avatar-error')).toHaveCount(0);await expect(preview()).toHaveAttribute('data-group-avatar-kind','image');await expect(page.getByTestId('im-group-save')).toBeEnabled();
 }
 check('JPEG and WebP sources normalize locally without a renderer error');

 const noise=await page.evaluate(()=>{
  const canvas=document.createElement('canvas');canvas.width=canvas.height=512;
  const c=canvas.getContext('2d'),image=c.createImageData(512,512);let seed=508;
  for(let i=0;i<image.data.length;i+=4){for(let channel=0;channel<3;channel++){seed=(Math.imul(seed,1664525)+1013904223)>>>0;image.data[i+channel]=seed>>>24;}image.data[i+3]=255;}
  c.putImageData(image,0,0);return canvas.toDataURL('image/png').split(',')[1];
 });
 await page.getByTestId('im-group-avatar-file').setInputFiles({name:'textured.png',mimeType:'image/png',buffer:Buffer.from(noise,'base64')});
 await expect.poll(()=>page.getByTestId('im-group-avatar-preview').getByTestId('im-group-avatar-image').evaluate(image=>image.naturalWidth)).toBe(128);
 expect((await page.getByTestId('im-group-avatar-preview').getByTestId('im-group-avatar-image').getAttribute('src')).length).toBeLessThanOrEqual(131094);
 check('textured pictures reduce to a smaller square to keep saved image data bounded');

 await holdRead();await page.getByTestId('im-group-avatar-file').setInputFiles(file());
 await expect(page.getByTestId('im-group-save')).toBeDisabled();await page.getByTestId('im-group-motif-compass').click();await releaseRead();
 await expect(preview()).toHaveAttribute('data-group-icon','compass');await expect(page.getByTestId('im-group-save')).toBeEnabled();
 check('a late image read cannot replace a newer motif selection');
 await save();
 await editor();await holdRead();await page.getByTestId('im-group-avatar-file').setInputFiles(file());await page.getByTestId('personal-modal-close').click();await releaseRead();await editor();
 await expect(preview()).toHaveAttribute('data-group-icon','compass');
 check('closing the editor discards a pending image read');
 await page.getByTestId('im-group-avatar-reset').click();await expect(preview()).toHaveAttribute('data-group-avatar-kind','members');await save();
 expect((await request('/threads/'+id)).groupAvatar).toBeNull();
 for(const avatar of surfaces())await expect(avatar).toHaveAttribute('data-group-avatar-kind','members');
 check('restore default returns to the live member collage');

 const additions=[];
 for(let index=0;index<8;index++)additions.push(await request('/contacts',{kind:index%2?'agent':'human',name:['阿青','Mia','旅行','手作','小林','Robin','阿橙','Nova'][index],handle:'mosaic-'+index,...(index%2?{binding:{type:'local',localAgentId:'codex'}}:{}),color:['teal','blue','violet','orange','rose'][index%5],clientId:randomUUID()}));
 await page.getByTestId('im-refresh').click();await editor();
 for(let index=0;index<additions.length;index++){
  await page.getByTestId('im-member-'+additions[index].id).check();
  const count=Math.min(index+4,9);
  await expect(preview()).toHaveAttribute('data-member-count',String(count));
  const tiles=preview().getByTestId('im-group-avatar-member');await expect(tiles).toHaveCount(count);
  const boxes=await tiles.evaluateAll(elements=>elements.map(e=>{const r=e.getBoundingClientRect();return{x:r.x,y:r.y,w:r.width,h:r.height};}));
  for(const box of boxes){expect(box.w).toBeGreaterThan(15);expect(Math.abs(box.w-box.h)).toBeLessThan(1);}
  if([4,5,7,9].includes(index+4)){await preview().scrollIntoViewIfNeeded();await capture('mosaic-'+(index+4)+'-members');}
 }
 await save();
 for(const avatar of surfaces()){await expect(avatar).toHaveAttribute('data-member-count','9');await expect(avatar.getByTestId('im-group-avatar-member')).toHaveCount(9);}
 await capture('mosaic-saved-nine');
 await page.reload();await expect(page.getByTestId('im-chat-info')).toBeVisible();
 for(const avatar of surfaces())await expect(avatar).toHaveAttribute('data-member-count','9');
 await editor();
 for(const contact of additions)await page.getByTestId('im-member-'+contact.id).uncheck();
 await save();
 for(const avatar of surfaces())await expect(avatar).toHaveAttribute('data-member-count','3');
 const contact=(await request('/contacts')).contacts.find(contact=>contact.id===person.id);
 const portraits=()=>page.getByTestId('im-chat-info').getByTestId('im-group-avatar-member').getByTestId('im-avatar-image');
 const originalFace=await portraits().nth(1).getAttribute('src');
 await request('/contacts/'+person.id,{kind:'human',name:'新伙伴',handle:contact.handle,version:contact.version,clientId:randomUUID()});
 await page.getByTestId('im-refresh').click();await expect(portraits().nth(1)).toHaveAttribute('src',originalFace);
 expect(await page.getByTestId('im-chat-info').getByTestId('im-group-avatar-member').allTextContents()).toEqual(['','','']);
 check('three-to-nine layouts, membership changes and text-free human portraits stay stable after rename and reload');

 await editor();await page.emulateMedia({colorScheme:'dark'});await capture('group-editor-dark');
 if(!native){await page.setViewportSize({width:390,height:844});expect(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth)).toBe(true);await capture('group-editor-narrow-dark');await page.setViewportSize({width:1120,height:900});}
 await page.getByTestId('personal-modal-close').click();
 await editor();await page.getByTestId('im-member-'+second.id).uncheck();await save();
 for(const avatar of surfaces()){await expect(avatar).toHaveAttribute('data-group-avatar-kind','peer');await expect(avatar.getByTestId('im-group-avatar-member')).toHaveCount(1);}
 expect((await request('/threads/'+id)).id).toBe(id);await capture('pair-after-member-leaves');
 check('an existing group keeps its ID when reduced to a pair and shows one full portrait');
 if(!native){
  const saved=structuredClone(server.store.require('thread',id));
  try{
   server.store.put('thread',{...saved,memberIds:['self'],members:saved.members.filter(member=>member.contactId==='self')});
   await page.reload();await expect(page.getByTestId('im-chat-info').getByTestId('im-avatar-image')).toHaveCount(1);
   await expect(page.getByTestId('im-chat-info').getByTestId('im-avatar')).toHaveAttribute('data-group-avatar-kind','peer');
  }finally{server.store.put('thread',saved);await page.reload();}
  check('an imported owner-only group has a full owner portrait rather than a blank square');
 }
 if(native){
  await editor();await page.getByTestId('im-group-avatar-file').setInputFiles(file());await expect(preview()).toHaveAttribute('data-group-avatar-kind','image');await save();
  await application.close();application=null;await launchNative();
  await expect(page.getByTestId('im-chat-'+id)).toBeVisible();await page.getByTestId('im-chat-'+id).click();await expect(page.getByTestId('im-chat-info').getByTestId('im-avatar')).toHaveAttribute('data-group-avatar-kind','image');await capture('group-picture-after-native-restart');
  const health=await request('/health');expect(health.build.serverFiles['group-avatar.mjs']).toMatch(/^[a-f0-9]{64}$/);
  check('packaged native restart restores the group and owns the avatar validation module');
 }
 const final=await request('/threads/'+id);expect(final.memberIds).toContain(person.id);expect(final.messages).toEqual([]);expect(final.runs).toEqual([]);expect(final.decisions).toEqual([]);expect(errors).toEqual([]);
 check('membership and empty conversation/execution state remain intact');
}finally{
 await writeFile(join(output,'receipt.json'),JSON.stringify({native,checks,errors,consoleMessages,syntheticOnly:true,browserPlugin:'absent',fallbackReason:'Browser plugin not available; existing repository Playwright setup used',output},null,2)+'\n');
 await application?.close();await browser?.close();await server?.close();console.log(JSON.stringify({output,checks,errors}));
}
