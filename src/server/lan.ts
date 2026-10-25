import { networkInterfaces } from 'node:os';
import QRCode from 'qrcode';

// Adapters phones can't reach: VirtualBox/VMware/Hyper-V/WSL/Docker networks, VPN tunnels, Bluetooth.
const VIRTUAL = /vEthernet|VirtualBox|VMware|Hyper-V|WSL|Docker|Loopback|Bluetooth|utun|bridge|vmnet|tailscale|zerotier/i;

/** The laptop's Wi-Fi address, so phones on the same network can reach the server (and the QR shows it). */
export function lanAddress(): string {
  const candidates: { address: string; name: string }[] = [];
  for (const [name, list] of Object.entries(networkInterfaces())) {
    for (const net of list ?? []) {
      if (net.family === 'IPv4' && !net.internal && !net.address.startsWith('169.254.')) candidates.push({ address: net.address, name });
    }
  }
  // 192.168.56.x is VirtualBox's host-only network, which Windows laptops often have; used only if nothing else is there.
  const virtual = (c: { address: string; name: string }) => Number(VIRTUAL.test(c.name) || c.address.startsWith('192.168.56.'));
  const ranked = candidates.sort((a, b) => virtual(a) - virtual(b) || score(b.address) - score(a.address));
  return ranked[0]?.address ?? 'localhost';
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
