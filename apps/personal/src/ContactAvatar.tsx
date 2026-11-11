import { Brain, Code2, Compass, FileText, PenLine, Search, Sparkles, SquareTerminal, UserRound } from "lucide-react";
import codexIcon from "@agentstudio/brand/assets/chatgpt.png";
import claudeIcon from "@agentstudio/brand/assets/claude.png";
import piIcon from "@agentstudio/brand/assets/pi.svg";
import geminiIcon from "@agentstudio/brand/assets/gemini.png";
import opencodeIcon from "@agentstudio/brand/assets/opencode.png";
import grokIcon from "@agentstudio/brand/assets/grokbot.png";
import museIcon from "@agentstudio/brand/assets/muse-mark.png";
import cueIcon from "@agentstudio/brand/assets/cue.png";
import { GroupAvatar } from "./GroupAvatar";
import type { GroupAvatar as GroupAppearance } from "./types";
import type { Contact } from "./types";

export const avatarIcons = { auto: SquareTerminal, spark: Sparkles, code: Code2, research: Search, write: PenLine, compass: Compass, brain: Brain, person: UserRound };
export const avatarLabels: Record<string, string> = { auto: "助手头像", spark: "灵感", code: "代码", research: "研究", write: "写作", compass: "探索", brain: "思考", person: "伙伴" };
const agentImages: Record<string, string> = { codex: codexIcon, claude: claudeIcon, pi: piIcon, gemini: geminiIcon, opencode: opencodeIcon, grokbot: grokIcon, muse: museIcon, dots: codexIcon, cue: cueIcon };
export function Avatar({ contact, group, groupAvatar, size = "" }: { contact?: Pick<Contact, "name" | "color" | "kind"> & Partial<Pick<Contact, "icon" | "binding" | "avatarAgent" | "avatarService" | "avatarDataUrl">>; group?: boolean; groupAvatar?: GroupAppearance | null; size?: string }) {
  if (group) return <GroupAvatar avatar={groupAvatar} size={size} />;
  const agent = contact?.avatarAgent || (contact?.binding?.type === "local" ? contact.binding.localAgentId : null);
  const Icon = avatarIcons[(contact?.icon || "auto") as keyof typeof avatarIcons] || SquareTerminal;
  const automatic = !contact?.icon || contact.icon === "auto";
  const botImage = contact?.avatarDataUrl && contact.avatarDataUrl.length <= 683_000 && /^data:image\/png;base64,iVBORw0KGgo[A-Za-z0-9+/]*={0,2}$/.test(contact.avatarDataUrl) ? contact.avatarDataUrl : undefined;
  const source = contact?.kind === "agent" && automatic ? botImage ? "bot" : agent || contact.avatarService : undefined;
  const image = source === "bot" ? botImage : source && agentImages[source];
  const initials = Array.from(contact?.name.trim() || "?").slice(0, /^[\x00-\x7f]/.test(contact?.name || "") ? 1 : 2).join("").toUpperCase();
  return <span className={`im-avatar ${contact?.color || "blue"} ${size} ${contact?.kind === "agent" ? "im-avatar-agent" : ""} ${image ? `im-avatar-brand im-avatar-${source}` : !contact ? "im-avatar-group" : ""}`} data-testid="im-avatar" data-avatar-source={image ? source : !contact ? "notes" : automatic || contact.kind === "human" ? "initials" : "custom"} aria-hidden="true">
    {!contact ? <FileText size={23} strokeWidth={1.6} /> : image ? <img src={image} alt="" draggable={false} data-testid="im-avatar-image" /> : contact.kind === "human" || automatic ? initials : <Icon size={23} strokeWidth={1.8} />}
  </span>;
}
