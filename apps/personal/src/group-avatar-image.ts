const MAX_SOURCE=5*1024*1024;
const MAX_DATA_URL=131094;
const failure=()=>new Error("这张图片无法读取，请选择 PNG、JPG 或 WebP 图片");

/** Decode a local raster once and persist only cropped pixels, without its metadata. */
export async function groupAvatarImage(file:File):Promise<string>{
 if(file.size>MAX_SOURCE)throw new Error("图片超过 5 MB，请选择小一点的图片");
 if(!["image/png","image/jpeg","image/webp"].includes(file.type))throw failure();
 const header=new Uint8Array(await file.slice(0,16).arrayBuffer());
 const png=header.length>=8&&[137,80,78,71,13,10,26,10].every((b,i)=>header[i]===b);
 const jpeg=header[0]===255&&header[1]===216&&header[2]===255;
 const webp=header.length>=12&&String.fromCharCode(...header.slice(0,4))==="RIFF"&&String.fromCharCode(...header.slice(8,12))==="WEBP";
 if(!(file.type==="image/png"?png:file.type==="image/jpeg"?jpeg:webp))throw failure();
 const data=await new Promise<string>((resolve,reject)=>{const reader=new FileReader();reader.onload=()=>typeof reader.result==="string"?resolve(reader.result):reject(failure());reader.onerror=()=>reject(failure());reader.onabort=()=>reject(failure());reader.readAsDataURL(file);});
 const image=new Image();
 await new Promise<void>((resolve,reject)=>{image.onload=()=>resolve();image.onerror=()=>reject(failure());image.src=data;});
 const width=image.naturalWidth,height=image.naturalHeight;
 if(!width||!height||width*height>40_000_000)throw new Error("图片尺寸过大，请选择较小的图片");
 const canvas=document.createElement("canvas"),context=canvas.getContext("2d");
 if(!context)throw failure();
 const side=Math.min(width,height);
 for(const size of [256,128]){
  canvas.width=size;canvas.height=size;
  context.drawImage(image,(width-side)/2,(height-side)/2,side,side,0,0,size,size);
  const result=canvas.toDataURL("image/png");
  if(result.startsWith("data:image/png;base64,")&&result.length<=MAX_DATA_URL)return result;
 }
 throw new Error("图片处理后仍然过大，请换一张图片");
}
