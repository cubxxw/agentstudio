// Local, deterministic portraits. Contact IDs never appear in the image or a request.
const palettes: Record<string, [string, string]> = {
  blue: ["#e4edf7", "#6488b6"], teal: ["#e1efea", "#5b998b"],
  violet: ["#eee6f4", "#9b7caf"], orange: ["#f7eadc", "#c08c59"], rose: ["#f4e3e9", "#b97e97"],
};
const portraits = new Map<string, string>();
export function humanAvatarUrl(contact: { id?: string; handle?: string; name: string; color?: string }) {
  const identity = contact.id || contact.handle || contact.name || "friend";
  let seed = 2166136261;
  for (const char of identity) seed = Math.imul(seed ^ char.codePointAt(0)!, 16777619) >>> 0;
  const palette = palettes[contact.color || ""] || Object.values(palettes)[seed % 5]!;
  const key = `${seed}:${palette[0]}`;
  const cached = portraits.get(key); if (cached) return cached;
  const skin = ["#edc5a3", "#dca785", "#c58f70", "#f0d3b5", "#af7c61"][(seed >>> 3) % 5];
  const hair = ["#47434a", "#65544c", "#846653", "#484f5e", "#665367"][(seed >>> 6) % 5];
  const tops = [
    '<path d="M16 30c-3-18 12-24 23-19 8 3 12 12 9 22l-5-13c-8 5-13 2-18-1l-9 11Z"/>',
    '<path d="M15 31c-4-15 5-23 17-23s22 8 17 25l-7-15c-6 6-15 7-23 3l-4 10Z"/>',
    '<path d="M15 32C9 17 19 9 27 11c9-8 25 3 22 20l-8-12-6 5-10-5-10 13Z"/>',
    '<path d="M16 31c-5-17 8-23 16-23 14 0 23 13 16 29l-5-18c-5 1-9-1-14-4l-13 16Z"/>',
  ];
  const glasses = seed & 64 ? '<g fill="none" stroke="#4b4850" stroke-width="1.4"><rect x="20" y="29" width="10" height="8" rx="3"/><rect x="34" y="29" width="10" height="8" rx="3"/><path d="M30 32h4"/></g>' : '';
  const svg = `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 64 64" data-portrait="${seed.toString(16)}"><rect width="64" height="64" fill="${palette[0]}"/><circle cx="${10 + seed % 43}" cy="${9 + (seed >>> 8) % 18}" r="18" fill="#fff" opacity=".25"/><path d="M5 67c0-15 11-22 27-22s27 7 27 22" fill="${palette[1]}"/><path d="M27 44v6q5 5 10 0v-6" fill="${skin}"/><circle cx="17" cy="33" r="4" fill="${skin}"/><circle cx="47" cy="33" r="4" fill="${skin}"/><rect x="17" y="14" width="30" height="34" rx="15" fill="${skin}"/><g fill="${hair}">${tops[(seed >>> 10) % tops.length]}</g><g fill="#464149"><circle cx="25" cy="33" r="1.6"/><circle cx="39" cy="33" r="1.6"/></g>${glasses}<path d="M28 40q4 4 8 0" fill="none" stroke="#895e56" stroke-width="1.8" stroke-linecap="round"/></svg>`;
  const url = `data:image/svg+xml;charset=utf-8,${encodeURIComponent(svg)}`;
  if (portraits.size >= 256) portraits.delete(portraits.keys().next().value!);
  portraits.set(key, url); return url;
}
