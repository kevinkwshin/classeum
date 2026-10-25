import { networkInterfaces } from 'node:os';
import QRCode from 'qrcode';

/** The laptop's Wi-Fi address, so phones on the same network can reach the dev server. */
export function lanAddress(): string {
  const candidates: string[] = [];
  for (const list of Object.values(networkInterfaces())) {
    for (const net of list ?? []) {
      if (net.family === 'IPv4' && !net.internal) candidates.push(net.address);
    }
  }
  const privateFirst = candidates.sort((a, b) => score(b) - score(a));
  return privateFirst[0] ?? 'localhost';
}

function score(ip: string): number {
  if (ip.startsWith('192.168.')) return 3;
  if (ip.startsWith('10.')) return 2;
  if (/^172\.(1[6-9]|2\d|3[01])\./.test(ip)) return 1;
  return 0;
}

export async function qrSvg(url: string): Promise<string> {
  return QRCode.toString(url, { type: 'svg', margin: 0, errorCorrectionLevel: 'M', color: { dark: '#101218', light: '#FFFFFF' } });
}

export function isLocalHost(hostHeader: string | null): boolean {
  if (!hostHeader) return false;
  const host = hostHeader.replace(/:\d+$/, '').toLowerCase();
  return host === 'localhost' || host === '127.0.0.1' || host === '[::1]' || host === '::1';
}
