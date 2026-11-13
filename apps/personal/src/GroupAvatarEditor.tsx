import {Avatar,type AvatarContact} from "./ContactAvatar";
import {useEffect,useId,useRef,useState} from "react";
import {Check,ImagePlus,RotateCcw} from "lucide-react";
import {groupColors,groupMotifs} from "./GroupAvatar";
import {groupAvatarImage} from "./group-avatar-image";
import type {GroupAvatar as Appearance} from "./types";

export function GroupAvatarEditor({value,onChange,onBusyChange,disabled,description,members}:{value:Appearance|null;onChange:(value:Appearance|null)=>void;onBusyChange:(busy:boolean)=>void;disabled:boolean;description:string;members:readonly AvatarContact[]}){
 const [loading,setLoading]=useState(false),[error,setError]=useState("");
 const generation=useRef(0),hint=useId();
 useEffect(()=>()=>{generation.current++;},[]);
 const preset=value?.kind==="preset"?value:{kind:"preset" as const,icon:"room" as const,color:"teal" as const};
 const choose=(next:Appearance|null)=>{generation.current++;setLoading(false);onBusyChange(false);setError("");onChange(next);};
 return <fieldset className="im-group-avatar-editor" disabled={disabled} data-testid="im-group-avatar-editor">
  <legend>群头像</legend>
  <div className="im-group-avatar-heading"><div className="im-group-avatar-preview" data-testid="im-group-avatar-preview"><Avatar group groupAvatar={value} members={members} size="hero"/></div><div className="im-group-avatar-copy"><strong>大家的头像，拼成一个群</strong><span>{description}</span><div className="im-group-avatar-actions"><label className="im-group-upload"><ImagePlus size={15}/><span>{loading?"正在处理…":"选择图片"}</span><input type="file" accept="image/png,image/jpeg,image/webp" data-testid="im-group-avatar-file" aria-label="选择群图标图片" aria-describedby={hint} onChange={async e=>{
   const file=e.target.files?.[0];e.target.value="";if(!file)return;
   const ticket=++generation.current;setLoading(true);onBusyChange(true);setError("");
   try{const dataUrl=await groupAvatarImage(file);if(ticket===generation.current)onChange({kind:"image",dataUrl});}
   catch(reason){if(ticket===generation.current)setError(reason instanceof Error?reason.message:"图片尚未处理");}
   finally{if(ticket===generation.current){setLoading(false);onBusyChange(false);}}
  }}/></label><button type="button" className="im-group-avatar-reset" disabled={!value&&!loading} data-testid="im-group-avatar-reset" onClick={()=>choose(null)}><RotateCcw size={13}/>恢复成员拼图</button></div></div></div>
  <button type="button" className="im-group-members-choice" data-testid="im-group-avatar-members" aria-pressed={!value} onClick={()=>choose(null)}><Avatar group members={members} size="small"/><span>成员头像拼图<small>随成员和头像自动更新 · 最多九位</small></span></button>
  <div className="im-group-motifs" aria-label="群图案">{groupMotifs.map(({id,label})=><button type="button" key={id} aria-label={label} title={label} aria-pressed={value?.kind==="preset"&&preset.icon===id} data-testid={`im-group-motif-${id}`} onClick={()=>choose({kind:"preset",icon:id,color:preset.color})}><Avatar group groupAvatar={{kind:"preset",icon:id,color:preset.color}} size="small"/></button>)}</div>
  <div className="im-group-colors" aria-label="群图标配色">{groupColors.map(({id,label})=><button type="button" className={`im-group-swatch ${id}`} key={id} disabled={value?.kind!=="preset"} aria-label={label} aria-pressed={value?.kind==="preset"&&preset.color===id} data-testid={`im-group-color-${id}`} onClick={()=>choose({...preset,color:id})}>{value?.kind==="preset"&&preset.color===id&&<Check size={14}/>}</button>)}<span id={hint}>PNG、JPG、WebP · 自动居中裁成方形</span></div>
  {loading&&<span className="im-group-avatar-progress" role="status">正在准备预览，完成后即可保存</span>}
  {error&&<p className="im-error" role="alert" data-testid="im-group-avatar-error">{error}</p>}
 </fieldset>;
}
