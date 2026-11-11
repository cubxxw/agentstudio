import { FileText, Globe } from 'lucide-react';
import type { WorkspaceArtifact } from './types';

export function ArtifactLibrary({ artifacts, selected, onOpen }: { artifacts: WorkspaceArtifact[]; selected: string | null; onOpen: (id: string) => void }) {
  return <div data-testid="artifact-library">{artifacts.length ? artifacts.map(artifact => <button className={`im-chat-row library-row ${selected === artifact.id ? 'selected' : ''}`} key={artifact.id} data-testid={`library-artifact-${artifact.id}`} onClick={() => onOpen(artifact.id)}><span className="library-symbol">{artifact.kind === 'website' ? <Globe size={21} /> : <FileText size={21} />}</span><span className="im-row-copy"><strong>{artifact.title}</strong><small>{artifact.status === 'archived' ? '已归档 · ' : ''}{artifact.kind === 'website' ? '静态网页' : '文档'} · {new Date(artifact.updatedAt).toLocaleDateString('zh-CN')}</small></span></button>) : <div className="im-list-empty">从群聊里提出想法，审核方案后，作品会出现在这里。</div>}</div>;
}
