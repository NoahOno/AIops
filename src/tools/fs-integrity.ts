import { execSync } from "node:child_process";

export interface FSCheckResult {
  mount: string;
  device: string;
  filesystemType: string;
  lastCheckTime: string | null;
  lastCheckDate: string | null;
  mountCount: number | null;
  errorCount: number | null;
  state: "clean" | "dirty" | "error" | "unknown";
  needsFsck: boolean;
  details: string;
}

export interface FsIntegrityResult {
  checks: FSCheckResult[];
  summary: {
    total: number;
    clean: number;
    needsFsck: number;
    error: number;
  };
}

export function checkFsIntegrity(mount?: string): FsIntegrityResult {
  const target = mount ?? "";
  // Get filesystem info
  const dfOutput = execSync(`df -T ${target} 2>/dev/null`, {
    encoding: "utf-8",
    timeout: 10000,
  });
  const lines = dfOutput.trim().split("\n").slice(1);
  const checks: FSCheckResult[] = [];

  for (const line of lines) {
    const parts = line.split(/\s+/);
    if (parts.length < 7) continue;
    const [device, fstype, total, used, available, usePct, ...rest] = parts;
    const mountPoint = rest.join(" ");

    // Skip pseudo filesystems
    if (["tmpfs", "devtmpfs", "proc", "sysfs", "cgroup", "cgroup2", "devpts", "hugetlbfs", "mqueue", "pstore", "configfs", "efivarfs", "fusectl", "debugfs", "tracefs", "securityfs", "bpf", "autofs", "overlay"].includes(fstype)) continue;

    let lastCheckTime: string | null = null;
    let lastCheckDate: string | null = null;
    let mountCount: number | null = null;
    let errorCount: number | null = null;
    let state: FSCheckResult["state"] = "unknown";
    let needsFsck = false;
    let details = "";

    try {
      // Check last fsck time via tune2fs (ext4) or dumpfs
      if (["ext2", "ext3", "ext4"].includes(fstype)) {
        const tuneOutput = execSync(
          `tune2fs -l ${device} 2>/dev/null | grep -E "Last checked|Mount count|Error behavior"`,
          { encoding: "utf-8", timeout: 5000 }
        );
        const tuneLines = tuneOutput.trim().split("\n");
        for (const tl of tuneLines) {
          if (tl.includes("Last checked")) {
            lastCheckTime = tl.replace(/.*:\s*/, "").trim();
            const d = new Date(lastCheckTime);
            if (!isNaN(d.getTime())) {
              lastCheckDate = d.toISOString().split("T")[0];
            }
          }
          if (tl.includes("Mount count")) {
            const m = tl.match(/(\d+)/);
            mountCount = m ? parseInt(m[1]) : null;
          }
        }

        // Check if fsck is needed
        const forceCheck = execSync(
          `dumpe2fs -h ${device} 2>/dev/null | grep -i "state"`,
          { encoding: "utf-8", timeout: 5000 }
        );
        if (forceCheck.includes("errors")) {
          state = "error";
          needsFsck = true;
          details = "Filesystem has errors, fsck required";
        } else {
          state = "clean";
          details = "Filesystem appears clean";
        }
      } else if (["xfs"].includes(fstype)) {
        const xfsOutput = execSync(
          `xfs_repair -n ${device} 2>&1 | tail -5`,
          { encoding: "utf-8", timeout: 10000 }
        );
        if (xfsOutput.includes("ERROR") || xfsOutput.includes("corrupt")) {
          state = "error";
          needsFsck = true;
          details = "XFS filesystem has errors";
        } else {
          state = "clean";
          details = "XFS filesystem appears clean";
        }
      } else {
        details = `Filesystem type ${fstype} does not support detailed check via this tool`;
        state = "unknown";
      }
    } catch (e) {
      details = `Could not determine filesystem status: ${e instanceof Error ? e.message : String(e)}`;
      state = "unknown";
    }

    checks.push({
      mount: mountPoint,
      device,
      filesystemType: fstype,
      lastCheckTime,
      lastCheckDate,
      mountCount,
      errorCount,
      state,
      needsFsck,
      details,
    });
  }

  const summary = {
    total: checks.length,
    clean: checks.filter((c) => c.state === "clean").length,
    needsFsck: checks.filter((c) => c.needsFsck).length,
    error: checks.filter((c) => c.state === "error").length,
  };

  return { checks, summary };
}
