import {useState} from "react";
import {Code2,Coffee,Compass,Leaf,Sparkles} from "lucide-react";
import type {GroupAvatar as Appearance} from "./types";
import "./group-avatar.css";

export const groupMotifs=[{id:"room",label:"同处一室"},{id:"spark",label:"灵感碰撞"},{id:"code",label:"一起创造"},{id:"compass",label:"共同探索"},{id:"leaf",label:"慢慢生长"},{id:"coffee",label:"闲聊时光"}] as const;
export const groupColors=[{id:"teal",label:"森林绿"},{id:"blue",label:"雾蓝"},{id:"violet",label:"鸢尾紫"},{id:"orange",label:"暖杏"},{id:"rose",label:"蔷薇粉"}] as const;
const motifs={spark:Sparkles,code:Code2,compass:Compass,leaf:Leaf,coffee:Coffee};

export function GroupAvatar({avatar,size=""}:{avatar?:Appearance|null;size?:string}){
 const [failed,setFailed]=useState<string|null>(null);
 const image=avatar?.kind==="image"&&avatar.dataUrl!==failed?avatar.dataUrl:null;
 const color=avatar?.kind==="preset"?avatar.color:"teal";
 const motif=avatar?.kind==="preset"?avatar.icon:"room";
 const Icon=motif==="room"?null:motifs[motif];
 return <span className={`im-avatar im-avatar-group im-group-portrait ${color} ${size}`} data-testid="im-avatar" data-avatar-source="group" data-group-avatar-kind={image?"image":avatar?.kind==="preset"?"preset":"default"} data-group-icon={image?undefined:motif} data-group-color={color} aria-hidden="true">
  {image?<img className="im-group-picture" data-testid="im-group-avatar-image" src={image} alt="" draggable={false} onError={()=>setFailed(image)}/>:Icon?<Icon className="im-group-symbol" strokeWidth={1.8}/>:<svg className="im-group-art" viewBox="0 0 64 64" fill="none">
   <rect x="10" y="15" width="29" height="33" rx="10" transform="rotate(-14 24 31)" fill="currentColor" opacity=".18"/>
   <rect x="26" y="12" width="27" height="34" rx="10" transform="rotate(14 39 29)" fill="currentColor" opacity=".32"/>
   <path d="M17 29a10 10 0 0 1 10-10h12a10 10 0 0 1 10 10v10a10 10 0 0 1-10 10h-9l-8 5v-7a10 10 0 0 1-5-8Z" fill="currentColor"/>
   <g fill="var(--group-paper)"><circle cx="26" cy="34" r="2.4"/><circle cx="33" cy="34" r="2.4"/><circle cx="40" cy="34" r="2.4"/></g>
  </svg>}
 </span>;
}
