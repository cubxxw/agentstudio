import { Brain, Code2, Compass, PenLine, Search, Sparkles, SquareTerminal, UserRound, Users } from "lucide-react";
import codexIcon from "@agentstudio/brand/assets/chatgpt.png";
import type { Contact } from "./types";

export const avatarIcons = { auto: SquareTerminal, spark: Sparkles, code: Code2, research: Search, write: PenLine, compass: Compass, brain: Brain, person: UserRound };
export const avatarLabels: Record<string, string> = { auto: "助手图标", spark: "灵感", code: "代码", research: "研究", write: "写作", compass: "探索", brain: "思考", person: "伙伴" };
export function Avatar({ contact, group, size = "" }: { contact?: Pick<Contact, "name" | "color" | "kind"> & Partial<Pick<Contact, "icon" | "binding" | "avatarAgent">>; group?: boolean; size?: string }) {
  const agent = contact?.avatarAgent || (contact?.binding?.type === "local" ? contact.binding.localAgentId : null);
  const Icon = avatarIcons[(contact?.icon || "auto") as keyof typeof avatarIcons] || SquareTerminal;
  const automatic = !contact?.icon || contact.icon === "auto";
  return <span className={`im-avatar ${contact?.color || "blue"} ${size} ${automatic && agent ? `im-avatar-${agent}` : ""}`} aria-hidden="true">
    {group ? <Users size={23} /> : contact?.kind === "human" ? contact.name.trim().slice(0, 1).toUpperCase() : automatic && agent === "codex" ? <img src={codexIcon} alt="" /> : automatic && agent === "pi" ? <span className="im-pi-mark">π</span> : automatic && agent === "claude" ? <Sparkles size={24} /> : <Icon size={23} strokeWidth={1.8} />}
  </span>;
}
