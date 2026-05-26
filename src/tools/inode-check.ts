import { execSync } from "node:child_process";

export interface InodeMountInfo {
  filesystem: string;
  mount: string;
  totalInodes: number;
  usedInodes: number;
  freeInodes: number;
  usePercent: number;
}

export interface InodeCheckResult {
  mounts: InodeMountInfo[];
  summary: {
    totalInodes: number;
    usedInodes: number;
    freeInodes: number;
    usePercent: number;
  };
}

export function checkInodeUsage(path?: string): InodeCheckResult {
  const target = path ?? "";
  const output = execSync(`df -i ${target} 2>/dev/null`, {
    encoding: "utf-8",
    timeout: 10000,
  });
  const lines = output.trim().split("\n").slice(1);
  const mounts: InodeMountInfo[] = [];

  for (const line of lines) {
    const parts = line.split(/\s+/);
    if (parts.length < 6) continue;
    const [fs, total, used, free, usePct, ...rest] = parts;
    const mountPoint = rest.join(" ");
    const totalI = parseInt(total);
    const usedI = parseInt(used);
    const freeI = parseInt(free);
    const pct = parseInt(usePct.replace("%", ""));

    mounts.push({
      filesystem: fs,
      mount: mountPoint,
      totalInodes: isNaN(totalI) ? 0 : totalI,
      usedInodes: isNaN(usedI) ? 0 : usedI,
      freeInodes: isNaN(freeI) ? 0 : freeI,
      usePercent: isNaN(pct) ? 0 : pct,
    });
  }

  const summary = {
    totalInodes: mounts.reduce((s, m) => s + m.totalInodes, 0),
    usedInodes: mounts.reduce((s, m) => s + m.usedInodes, 0),
    freeInodes: mounts.reduce((s, m) => s + m.freeInodes, 0),
    usePercent:
      mounts.length > 0
        ? Math.round(
            (mounts.reduce((s, m) => s + m.totalInodes, 0) > 0
              ? (mounts.reduce((s, m) => s + m.usedInodes, 0) /
                  mounts.reduce((s, m) => s + m.totalInodes, 0)) *
                100
              : 0) * 100
          ) / 100
        : 0,
  };

  return { mounts, summary };
}

export function analyzeSmallFilesDirs(
  path: string = "/",
  top: number = 10
): { directory: string; fileCount: number }[] {
  const cmd = `find ${path} -xdev -type d 2>/dev/null | while read d; do echo "$(find "$d" -xdev -maxdepth 1 -type f 2>/dev/null | wc -l) $d"; done | sort -rn | head -${top}`;
  try {
    const output = execSync(cmd, { encoding: "utf-8", timeout: 60000 });
    return output
      .trim()
      .split("\n")
      .filter(Boolean)
      .map((line) => {
        const m = line.match(/^(\d+)\s+(.+)$/);
        return m
          ? { directory: m[2], fileCount: parseInt(m[1]) }
          : { directory: line, fileCount: 0 };
      });
  } catch {
    return [];
  }
}
