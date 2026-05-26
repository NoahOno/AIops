import { execSync } from "node:child_process";

export interface MountEntry {
  device: string;
  mountPoint: string;
  filesystemType: string;
  options: string[];
  isReadOnly: boolean;
  isBindMount: boolean;
  isNetwork: boolean;
  isFuse: boolean;
  status: "ok" | "missing" | "error";
}

export interface MountCheckResult {
  mounts: MountEntry[];
  issues: {
    readOnlyMounts: string[];
    networkMounts: string[];
    missingMounts: string[];
  };
  fstabEntries: string[];
  fstabMissing: string[];
}

export function checkMounts(): MountCheckResult {
  // Get current mounts from /proc/mounts
  const mountOutput = execSync("cat /proc/mounts 2>/dev/null", {
    encoding: "utf-8",
    timeout: 5000,
  });

  const mountsRaw = mountOutput
    .trim()
    .split("\n")
    .filter(Boolean)
    .map((line) => {
      const parts = line.split(/\s+/);
      if (parts.length < 4) return null;
      const [device, mountPoint, fsType, options] = parts;
      const opts = options.split(",");
      return {
        device,
        mountPoint,
        filesystemType: fsType,
        options: opts,
        isReadOnly: opts.includes("ro"),
        isBindMount: opts.includes("bind"),
        isNetwork: ["nfs", "nfs4", "cifs", "smb3"].includes(fsType),
        isFuse: fsType.startsWith("fuse"),
        status: "ok" as "ok",
      };
    })
    .filter((m): m is NonNullable<typeof m> => m !== null);
  const mounts: MountEntry[] = mountsRaw as MountEntry[];

  // Get fstab entries
  let fstabEntries: string[] = [];
  try {
    const fstab = execSync("cat /etc/fstab 2>/dev/null", {
      encoding: "utf-8",
      timeout: 5000,
    });
    fstabEntries = fstab
      .trim()
      .split("\n")
      .filter((l) => l.trim() && !l.startsWith("#"));
  } catch {
    // no fstab
  }

  // Check for mounts in fstab not currently mounted
  const currentMountPoints = new Set(mounts.map((m) => m.mountPoint));
  const fstabMountPoints: string[] = [];
  for (const entry of fstabEntries) {
    const parts = entry.split(/\s+/);
    if (parts.length >= 2) {
      fstabMountPoints.push(parts[1]);
    }
  }
  const fstabMissing = fstabMountPoints.filter(
    (mp) => !currentMountPoints.has(mp) && !mp.startsWith("/dev")
  );

  const readOnlyMounts = mounts
    .filter((m) => m.isReadOnly)
    .map((m) => m.mountPoint);

  const networkMounts = mounts
    .filter((m) => m.isNetwork)
    .map((m) => `${m.device} -> ${m.mountPoint}`);

  const missingMounts = fstabMissing;

  return {
    mounts,
    issues: { readOnlyMounts, networkMounts, missingMounts },
    fstabEntries,
    fstabMissing,
  };
}
