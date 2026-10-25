import { spawn } from 'node:child_process';

/** Opens a URL in the laptop's default browser; does nothing if there is no browser to open. */
export function openInBrowser(url: string) {
  const cmd = process.platform === 'darwin' ? ['open', url] : process.platform === 'win32' ? ['cmd', '/c', 'start', '', url] : ['xdg-open', url];
  try {
    spawn(/*turbopackIgnore: true*/ cmd[0], cmd.slice(1), { stdio: 'ignore', detached: true }).unref();
  } catch {
    // The printed link still works.
  }
}
