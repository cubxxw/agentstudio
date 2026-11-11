// Grok Bot's own avatars. A bot's avatar is a shape and a color (or a photo,
// avatar_url). Grok Bot draws the shapes with its own code, so AgentRoom doesn't
// ship them: when the Grok Bot app is installed on this Mac, AgentRoom runs that
// app's shape code once (in a hidden window) and keeps the result in
// userData/grokbot-shapes, one mask per shape (body black, eyes white), plus
// the app's colors. It redoes this when the app's version changes. Avatars are
// the bot's mask tinted with its color. Without the app (or if its code
// changed), there is no mask and the caller shows the Grok Bot icon instead.

import { existsSync, mkdirSync, readFileSync, readdirSync, writeFileSync } from "node:fs";
import { homedir } from "node:os";
import { join } from "node:path";
import { BrowserWindow, nativeImage } from "electron";
import type { AvatarImage } from "./types";

/** Grok Bot's colors and the ones it picks from when a bot has none set. */
const COLOR_IDS = ["black", "brown", "red", "orange", "yellow", "green", "cyan", "blue", "violet", "magenta", "gray"];
const DEFAULT_COLORS = COLOR_IDS.filter((c) => c !== "black");
const DEFAULT_SHAPES = ["blob", "pebble", "squircle", "tablet", "wedge", "hex", "cloud", "teardrop"];
/** The shapes in Grok Bot's avatar picker. */
const SHAPES = ["blob", "pebble", "bean", "egg", "squircle", "tablet", "capsule", "cylinder", "hex", "gem", "crystal", "wedge", "shield", "dome", "arch", "cloud", "teardrop", "leaf", "square", "sparkle", "clover", "flower", "heart", "house", "star"];
const SIZE = 256;

function fnv1a(s: string): number {
  let h = 2166136261;
  for (let i = 0; i < s.length; i++) h = Math.imul(h ^ s.charCodeAt(i), 16777619);
  return h >>> 0;
}

/** Grok Bot's default shape for a bot id. */
export function defaultShape(id: string): string {
  let t = fnv1a(id) | 0;
  t = Math.imul(t ^ (t >>> 16), 73244475);
  t = Math.imul(t ^ (t >>> 13), 3266489909);
  return DEFAULT_SHAPES[((t ^ (t >>> 16)) >>> 0) % DEFAULT_SHAPES.length]!;
}

/** Grok Bot's default color for a bot id. */
export function defaultColor(id: string): string {
  const salt = Math.imul(1, 2654435769);
  let t = (((fnv1a(id) ^ salt) >>> 0) ^ salt) >>> 0;
  t = (t + 1831565813) | 0;
  let e = Math.imul(t ^ (t >>> 15), 1 | t);
  e = (e + Math.imul(e ^ (e >>> 7), 61 | e)) ^ e;
  const r = ((e ^ (e >>> 14)) >>> 0) / 4294967296;
  return DEFAULT_COLORS[Math.floor(r * DEFAULT_COLORS.length)]!;
}

// ---- the shapes, made from the installed Grok Bot app ------------------------------

type Shapes = { dir: string; version: string; colors: Record<string, string> };

/** The installed Grok Bot app, or null. AGENTSTUDIO_GROKBOT_APP overrides (tests). */
function grokApp(): string | null {
  const candidates = process.env.AGENTSTUDIO_GROKBOT_APP !== undefined
    ? [process.env.AGENTSTUDIO_GROKBOT_APP]
    : ["/Applications/Grok Bot.app", join(homedir(), "Applications", "Grok Bot.app")];
  return candidates.find((p) => !!p && existsSync(join(p, "Contents", "Resources", "app.asar"))) ?? null;
}

function appVersion(app: string): string {
  const plist = readFileSync(join(app, "Contents", "Info.plist"), "utf8");
  return /<key>CFBundleShortVersionString<\/key>\s*<string>([^<]+)<\/string>/.exec(plist)?.[1] ?? "unknown";
}

const shapes = new Map<string, Promise<Shapes | null>>();

/** The shape masks for this Mac's Grok Bot app (made once per app version), or null without the app. */
export function grokShapes(userData: string): Promise<Shapes | null> {
  const app = grokApp();
  if (!app) return Promise.resolve(null);
  const dir = join(userData, "grokbot-shapes");
  const version = `${appVersion(app)}/3`;
  const key = `${dir}:${app}:${version}`;
  let pending = shapes.get(key);
  if (pending) return pending;
  pending = loadShapes(app, dir, version).catch((err) => {
    console.warn("[connectors] couldn't make Grok Bot's avatar shapes:", err);
    return null;
  });
  shapes.set(key, pending);
  return pending;
}

async function loadShapes(app: string, dir: string, version: string): Promise<Shapes> {
  const stamp = join(dir, "version");
  const colorsFile = join(dir, "colors.json");
  if (existsSync(stamp) && readFileSync(stamp, "utf8") === version && existsSync(colorsFile) && SHAPES.every(shape => existsSync(join(dir, `${shape}.png`)))) {
    try {
      const colors = JSON.parse(readFileSync(colorsFile, "utf8")) as Record<string, string>;
      if (COLOR_IDS.every(color => /^#[0-9a-f]{6}$/i.test(colors[color] ?? ""))) return { dir, version, colors };
    } catch { /* Regenerate incomplete or corrupt derived data. */ }
  }
  const made = await makeShapes(join(app, "Contents", "Resources", "app.asar", "dist", "renderer", "assets"));
  mkdirSync(dir, { recursive: true });
  for (const [shape, dataUrl] of Object.entries(made.shapes)) {
    writeFileSync(join(dir, `${shape}.png`), Buffer.from(dataUrl.split(",")[1]!, "base64"));
  }
  writeFileSync(colorsFile, JSON.stringify(made.colors));
  writeFileSync(stamp, version);
  return { dir, version, colors: made.colors };
}

/** Select pure rendering exports by their purpose, never by minified names.
 * Inspecting function source does not invoke unrelated app exports or hooks.
 * This function is also serialized into the offline sandbox below.
 */
export function avatarExportNames(common: Record<string, unknown>, platform: Record<string, unknown>) {
  const select = (label: string, module: Record<string, unknown>, accepts: (source: string) => boolean) => {
    const found = Object.entries(module).filter(([, value]) => typeof value === "function" && accepts(Function.prototype.toString.call(value)));
    if (found.length !== 1) throw new Error(`Grok Bot avatar ${label} exports are unfamiliar or ambiguous (${found.length})`);
    return found[0]![0];
  };
  return {
    body: select("body", common, source => source.includes("sphere") && source.includes("starFlower") && source.includes("heartChubby")),
    color: select("color", common, source => source.includes(".find(") && /\.id\s*===/.test(source) && source.includes(".value??")),
    still: select("still", platform, source => /return\s*[`"']data:image\/svg\+xml,/.test(source) && source.includes("encodeURIComponent")),
  };
}

/**
 * Runs the Grok Bot app's own shape code in a hidden, sandboxed window (no
 * Node, no network) and draws each shape. The app's modules export minified
 * names; if a new version renames them, this throws and avatars fall back to
 * the Grok Bot icon.
 */
async function makeShapes(assets: string): Promise<{ shapes: Record<string, string>; colors: Record<string, string> }> {
  const pick = (prefix: string) => {
    const f = readdirSync(assets).find((x) => x.startsWith(prefix) && x.endsWith(".js"));
    if (!f) throw new Error(`${prefix}*.js not found in Grok Bot`);
    return encodeURI(`file://${join(assets, f)}`);
  };
  const win = new BrowserWindow({
    show: false,
    webPreferences: { sandbox: true, contextIsolation: true, nodeIntegration: false, webSecurity: false, partition: "agentstudio-grokbot-shapes" },
  });
  let timeout: ReturnType<typeof setTimeout> | undefined;
  try {
    // The page may only read the app's files; nothing goes to the network.
    win.webContents.session.webRequest.onBeforeRequest((d, cb) => cb({ cancel: !/^(file|data):/.test(d.url) }));
    await win.loadURL("data:text/html,<html></html>");
    const result = (await Promise.race([
      win.webContents.executeJavaScript(`(async () => {
        const c = await import(${JSON.stringify(pick("index.eager-common-"))});
        const p = await import(${JSON.stringify(pick("index.eager-platform-"))});
        const names = (${avatarExportNames.toString()})(c, p);
        const pad = 4, size = ${SIZE} - pad * 2;
        const shapes = {};
        for (const shape of ${JSON.stringify(SHAPES)}) {
          const body = c[names.body](shape);
          const image = new Image();
          image.src = p[names.still]({ body, ink: "#000000", size });
          await image.decode();
          const cv = document.createElement("canvas");
          cv.width = cv.height = ${SIZE};
          const g = cv.getContext("2d");
          g.drawImage(image, pad, pad, size, size);
          shapes[shape] = cv.toDataURL("image/png");
        }
        const colors = {};
        for (const color of ${JSON.stringify(COLOR_IDS)}) {
          const value = c[names.color](color);
          if (typeof value !== "string" || !/^#[0-9a-f]{3}([0-9a-f]{3})?$/i.test(value)) throw new Error("Invalid Grok Bot avatar color");
          colors[color] = value.length === 4 ? "#" + [...value.slice(1)].map(c => c + c).join("") : value;
        }
        return { shapes, colors };
      })()`),
      new Promise<never>((_, reject) => { timeout = setTimeout(() => reject(new Error("timed out")), 30_000); }),
    ])) as { shapes: Record<string, string>; colors: Record<string, string> };
    if (Object.keys(result.shapes).length !== SHAPES.length) throw new Error("missing shapes");
    return result;
  } finally {
    clearTimeout(timeout);
    win.destroy();
  }
}

// ---- avatars ------------------------------------------------------------------------------

const cache = new Map<string, AvatarImage | null>();

/** The bot's avatar as Grok Bot draws it, or null when the shapes aren't available. */
export async function grokAvatar(agent: { id: string; avatarShape?: string; avatarColor?: string }, userData: string): Promise<AvatarImage | null> {
  const s = await grokShapes(userData);
  if (!s) return null;
  const known = (shape: string) => SHAPES.includes(shape) && existsSync(join(s.dir, `${shape}.png`));
  const shape = agent.avatarShape && known(agent.avatarShape) ? agent.avatarShape : defaultShape(agent.id);
  const color = agent.avatarColor && s.colors[agent.avatarColor] ? agent.avatarColor : defaultColor(agent.id);
  const key = `${s.dir}:${s.version}:${shape}:${color}`;
  if (cache.has(key)) return cache.get(key)!;
  const mask = known(shape) ? nativeImage.createFromPath(join(s.dir, `${shape}.png`)) : null;
  const hex = s.colors[color];
  let img: AvatarImage | null = null;
  if (mask && !mask.isEmpty() && hex && /^#[0-9a-f]{6}$/i.test(hex)) {
    const [r, g, b] = [1, 3, 5].map((i) => parseInt(hex.slice(i, i + 2), 16));
    // Premultiplied BGRA: grey/alpha is how white the pixel is (eyes 1, body 0).
    const px = mask.toBitmap();
    for (let i = 0; i < px.length; i += 4) {
      const a = px[i + 3]!;
      if (a === 0) continue;
      const v = Math.min(1, px[i]! / a);
      px[i] = Math.round((b! + (255 - b!) * v) * (a / 255));
      px[i + 1] = Math.round((g! + (255 - g!) * v) * (a / 255));
      px[i + 2] = Math.round((r! + (255 - r!) * v) * (a / 255));
    }
    img = { mime: "image/png", data: nativeImage.createFromBitmap(px, mask.getSize()).toPNG() };
  }
  cache.set(key, img);
  return img;
}
