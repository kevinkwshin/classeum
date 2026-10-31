import { execFileSync } from "node:child_process";
import { readdirSync, statSync } from "node:fs";
import { join } from "node:path";
import type { NextConfig } from "next";

/**
 * The day the app's code last changed, shown at the foot of the teacher screen's menu: the last commit that touched
 * it, or in a copy without git (a ZIP) its newest file. Read at build time, which a change to the code always brings.
 */
function lastUpdated(): string {
  try {
    const day = execFileSync("git", ["log", "-1", "--format=%cd", "--date=format:%Y.%m.%d", "--", "src", "public", "package.json"], {
      encoding: "utf8",
      stdio: ["ignore", "pipe", "ignore"],
    }).trim();
    if (day) return day;
  } catch {
    // No git here.
  }
  let newest = 0;
  const walk = (dir: string) => {
    for (const e of readdirSync(dir, { withFileTypes: true })) {
      const path = join(dir, e.name);
      if (e.isDirectory()) walk(path);
      else newest = Math.max(newest, statSync(path).mtimeMs);
    }
  };
  try {
    walk(join(process.cwd(), "src"));
  } catch {
    return "";
  }
  const d = new Date(newest);
  return `${d.getFullYear()}.${String(d.getMonth() + 1).padStart(2, "0")}.${String(d.getDate()).padStart(2, "0")}`;
}

const nextConfig: NextConfig = {
  env: { CLASSEUM_UPDATED: lastUpdated() },
  cacheComponents: true,
  partialPrefetching: true,
  // Phones on the classroom Wi-Fi reach the dev server by the laptop's IP address.
  allowedDevOrigins: ["*.*.*.*"],
  turbopack: {
    rules: {
      "*.css": {
        loaders: ["@tailwindcss/turbopack"],
        as: "*.css",
      },
    },
  },
};

export default nextConfig;
