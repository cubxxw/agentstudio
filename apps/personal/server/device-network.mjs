import { networkInterfaces } from 'node:os';
import { APIError } from './store.mjs';

export function isTailnetIP(value) {
  const parts = String(value).split('.');
  return parts.length === 4 && parts.every(p => /^\d{1,3}$/.test(p) && String(Number(p)) === p && Number(p) <= 255)
    && Number(parts[0]) === 100 && Number(parts[1]) >= 64 && Number(parts[1]) <= 127;
}
export function tailnetAddresses() {
  return [...new Set(Object.values(networkInterfaces()).flat().filter(item => item?.family === 'IPv4' && isTailnetIP(item.address)).map(item => item.address))];
}
export function deviceOrigin(value) {
  let url;
  try { url = new URL(value); } catch { throw new APIError(400, 'invalid_node_url', '请输入设备的 Tailscale 地址'); }
  const loopback = ['localhost', '127.0.0.1', '[::1]'].includes(url.hostname);
  if (url.pathname !== '/' || url.username || url.password || url.search || url.hash ||
    !(url.protocol === 'https:' && url.hostname.endsWith('.ts.net') || url.protocol === 'http:' && (loopback || isTailnetIP(url.hostname)))) {
    throw new APIError(400, 'invalid_node_url', '使用 Tailscale IP 的 HTTP 地址或 .ts.net 的 HTTPS 根地址');
  }
  return url.origin;
}
