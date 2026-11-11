import {APIError} from './store.mjs';

const icons=['room','spark','code','compass','leaf','coffee'];
const colors=['teal','blue','violet','orange','rose'];
const invalid=()=>{throw new APIError(400,'invalid_group_avatar','请选择提供的图案和配色，或重新选择一张 PNG、JPG、WebP 图片');};

/** Only bounded raster data is persisted; URLs and executable image formats are never accepted. */
export function validateGroupAvatar(value){
 if(value==null)return null;
 if(typeof value!=='object'||Array.isArray(value))invalid();
 if(value.kind==='preset'){
  if(Object.keys(value).some(k=>!['kind','icon','color'].includes(k))||!icons.includes(value.icon)||!colors.includes(value.color))invalid();
  return {kind:'preset',icon:value.icon,color:value.color};
 }
 if(value.kind!=='image'||Object.keys(value).some(k=>!['kind','dataUrl'].includes(k))||typeof value.dataUrl!=='string'||value.dataUrl.length>131094)invalid();
 const match=/^data:image\/png;base64,([A-Za-z0-9+/]+={0,2})$/.exec(value.dataUrl);
 if(!match)invalid();
 const bytes=Buffer.from(match[1],'base64');
 if(bytes.length>96*1024||bytes.length<57||bytes.toString('base64')!==match[1]||!bytes.subarray(0,8).equals(Buffer.from([137,80,78,71,13,10,26,10])))invalid();
 if(bytes.readUInt32BE(8)!==13||bytes.toString('ascii',12,16)!=='IHDR')invalid();
 const width=bytes.readUInt32BE(16),height=bytes.readUInt32BE(20);
 if(!width||width!==height||width>256)invalid();
 let offset=8,hasData=false,ended=false;
 while(offset+12<=bytes.length){
  const length=bytes.readUInt32BE(offset),type=bytes.toString('ascii',offset+4,offset+8);
  if(length>bytes.length-offset-12||!/^[A-Za-z]{4}$/.test(type)||(offset!==8&&type==='IHDR'))invalid();
  if(type==='IDAT'&&length>0)hasData=true;
  offset+=length+12;
  if(type==='IEND'){
   if(length!==0||!hasData||offset!==bytes.length)invalid();
   ended=true;break;
  }
 }
 if(!ended)invalid();
 return {kind:'image',dataUrl:value.dataUrl};
}
