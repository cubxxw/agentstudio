import { FileText, X } from "lucide-react";
import type { Attachment } from "./types";

export function DraftAttachments({ attachments, onPreview, onRemove }: { attachments: Attachment[]; onPreview: (attachment: Attachment) => void; onRemove: (index: number) => void }) {
  return <div className="im-draft-files" data-testid="im-draft-files">{attachments.map((attachment, index) => {
    const bytes = typeof attachment.size === "number" ? attachment.size : new TextEncoder().encode(attachment.text).length;
    const size = bytes < 1000 ? `${bytes} B` : `${(bytes / 1000).toLocaleString("zh-CN", { maximumFractionDigits: 1 })} KB`;
    return <div className="im-draft-file" key={index} data-testid="im-draft-file">
      <button type="button" className="im-draft-open" data-testid={`im-draft-preview-${index}`} aria-label={`预览附件 ${index + 1}：${attachment.name}`} title={attachment.name} onClick={() => onPreview(attachment)}><FileText size={16} aria-hidden="true" /><span><strong>{attachment.name}</strong><small>{size}</small></span></button>
      <button type="button" className="im-icon" data-testid={`im-draft-remove-${index}`} aria-label={`移除附件 ${index + 1}：${attachment.name}`} onClick={() => onRemove(index)}><X size={14} /></button>
    </div>;
  })}</div>;
}
