import type { PersonalRequest, PersonalResponse } from '../shared/personal-api';

type Preview = { files: { id: string; path: string; mime: string }[] };
export const artifactPreviewCsp = "sandbox allow-scripts; default-src 'none'; script-src agentroom-artifact: 'unsafe-inline'; style-src agentroom-artifact: 'unsafe-inline'; img-src agentroom-artifact: data: blob:; font-src agentroom-artifact: data:; connect-src 'none'; base-uri 'none'; form-action 'none'; frame-src 'none'; object-src 'none'";

/** An opaque, expiring revision capability. Never maps a request to a disk path. */
export async function artifactPreviewResponse(rawUrl: string, request: (input: PersonalRequest) => Promise<PersonalResponse>): Promise<Response> {
  const denied = () => new Response('Preview unavailable', { status: 404 });
  try {
    const url = new URL(rawUrl);
    if (url.protocol !== 'agentroom-artifact:' || !/^[a-f0-9]{48}$/.test(url.hostname) || url.port || url.username || url.password || url.search) return denied();
    const path = decodeURIComponent(url.pathname.slice(1));
    if (!path || path.includes('\\') || path.split('/').some(part => !part || part === '.' || part === '..')) return denied();
    const meta = await request({ method: 'GET', path: `/api/library/previews/${url.hostname}` });
    if (meta.status !== 200) return denied();
    const file = (meta.body as Preview).files.find(item => item.path === path);
    if (!file) return denied();
    const result = await request({ method: 'GET', path: `/api/library/previews/${url.hostname}/files/${file.id}` });
    if (result.status !== 200) return denied();
    const body = result.body as { text: string; mime: string };
    return new Response(body.text, { headers: { 'Content-Type': `${body.mime}; charset=utf-8`, 'Content-Security-Policy': artifactPreviewCsp,
      'X-Content-Type-Options': 'nosniff', 'Cache-Control': 'no-store', 'Referrer-Policy': 'no-referrer' } });
  } catch { return denied(); }
}
