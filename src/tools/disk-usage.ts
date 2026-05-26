import { execSync } from "node:child_process";

export interface MountInfo {
  filesystem: string;
  type: string;
  total: number;
  used: number;
  available: number;
  usePercent: number;
  mount: string;
}

export interface DiskUsageResult {
  mounts: MountInfo[];
  summary: {
    total: number;
    used: number;
    available: number;
    usePercent: number;
  };
}

export function getDiskUsage(path?: string): DiskUsageResult {
  const target = path ? path : "";
  const output = execSync(`df -B1 ${target} 2>/dev/null`, {
    encoding: "utf-8",
    timeout: 10000,
  });
  const lines = output.trim().split("\n").slice(1);
  const mounts: MountInfo[] = [];

  for (const line of lines) {
    const parts = line.split(/\s+/);
    if (parts.length < 6) continue;
    const [fs, total, used, available, usePct, ...rest] = parts;
    const mountPoint = rest.join(" ");
    const pct = parseInt(usePct.replace("%", ""));
    mounts.push({
      filesystem: fs,
      type: "",
      total: parseInt(total),
      used: parseInt(used),
      available: parseInt(available),
      usePercent: isNaN(pct) ? 0 : pct,
      mount: mountPoint,
    });
  }

  // Enrich with filesystem type
  try {
    const dfT = execSync(`df -T ${target} 2>/dev/null`, {
      encoding: "utf-8",
      timeout: 5000,
    });
    const tLines = dfT.trim().split("\n").slice(1);
    for (const line of tLines) {
      const parts = line.split(/\s+/);
      if (parts.length < 7) continue;
      const m = parts[parts.length - 1];
      const fsType = parts[1];
      const found = mounts.find((mt) => mt.mount === m);
      if (found) found.type = fsType;
    }
  } catch {
    // ignore
  }

  const summary = {
    total: mounts.reduce((s, m) => s + m.total, 0),
    used: mounts.reduce((s, m) => s + m.used, 0),
    available: mounts.reduce((s, m) => s + m.available, 0),
    usePercent:
      mounts.length > 0
        ? Math.round(
            (mounts.reduce((s, m) => s + m.total, 0) > 0
              ? (mounts.reduce((s, m) => s + m.used, 0) /
                  mounts.reduce((s, m) => s + m.total, 0)) *
                100
              : 0) * 100
          ) / 100
        : 0,
  };

  return { mounts, summary };
}
