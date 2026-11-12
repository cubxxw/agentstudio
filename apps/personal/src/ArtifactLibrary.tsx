import type { ReactNode } from 'react';
import { FileText, FolderOpen, Globe, Users } from 'lucide-react';
import type { WorkspaceArtifact } from './types';

export function ArtifactLibrary({ artifacts, selected, query, onOpen, onClearSearch, onCreate }: { artifacts: WorkspaceArtifact[]; selected: string | null; query: string; onOpen: (id: string) => void; onClearSearch: () => void; onCreate: () => void }) {
  return <div data-testid="artifact-library">{artifacts.length ? artifacts.map(artifact => <button className={`im-chat-row library-row ${selected === artifact.id ? 'selected' : ''}`} key={artifact.id} data-testid={`library-artifact-${artifact.id}`} onClick={() => onOpen(artifact.id)}><span className="library-symbol">{artifact.kind === 'website' ? <Globe size={21} /> : <FileText size={21} />}</span><span className="im-row-copy"><strong>{artifact.title}</strong><small>{artifact.status === 'archived' ? '已归档 · ' : ''}{artifact.kind === 'website' ? '静态网页' : '文档'} · {new Date(artifact.updatedAt).toLocaleDateString('zh-CN')}</small></span></button>) : <div className="im-list-empty" data-testid="library-empty"><span>{query ? '没有找到匹配的作品' : '还没有作品'}</span><small>{query ? '换个关键词，或清除搜索查看全部作品。' : '在群聊中提出想法，审核共创方案后，作品会保存在这里。'}</small>{query ? <button data-testid="library-clear-search" onClick={onClearSearch}>清除搜索</button> : <button data-testid="library-start-group" onClick={onCreate}>发起共创群聊</button>}</div>}</div>;
}

export function LibraryWelcome({ hasArtifacts, toolbar, onCreate }: { hasArtifacts: boolean; toolbar: ReactNode; onCreate: () => void }) {
  return <div className="im-welcome" data-testid="library-welcome"><div className="im-welcome-toolbar">{toolbar}</div><div className="im-welcome-symbol"><FolderOpen size={37} strokeWidth={1.3} /></div><h2>{hasArtifacts ? '选择一件作品，接着打磨。' : '一起做的作品，都在这里。'}</h2><p>{hasArtifacts ? '从列表打开作品，查看预览、文件和版本，或回到群聊继续讨论。' : '和伙伴在群聊中提出想法、讨论分工。审核共创方案后，文档和网页都会保存在这里。'}</p>{!hasArtifacts && <button className="im-primary" data-testid="library-welcome-start" onClick={onCreate}><Users size={17} />发起共创群聊</button>}</div>;
}
