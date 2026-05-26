import { execSync } from "node:child_process";

export interface DiskIOStat {
  device: string;
  rrqm_s: number;
  wrqm_s: number;
  r_s: number;
  w_s: number;
  rkB_s: number;
  wkB_s: number;
  avgrq_sz: number;
  avgqu_sz: number;
  await: number;
  r_await: number;
  w_await: number;
  svctm: number;
  util: number;
}

export interface DiskIOResult {
  devices: DiskIOStat[];
  timestamp: string;
  command: string;
}

export function getDiskIO(
  device?: string,
  interval: number = 1,
  count: number = 3
): DiskIOResult {
  const devArg = device ? `-p ${device}` : "";
  const cmd = `iostat -x ${devArg} ${interval} ${count} 2>/dev/null | tail -n +4`;

  try {
    const output = execSync(cmd, {
      encoding: "utf-8",
      timeout: (interval * count + 5) * 1000,
    });
    const lines = output
      .trim()
      .split("\n")
      .filter(
        (l) => l.trim() && !l.includes("Device") && !l.includes("avg-cpu")
      );
    const devices: DiskIOStat[] = [];

    for (const line of lines) {
      const parts = line.trim().split(/\s+/);
      if (parts.length < 14) continue;
      const [
        dev,
        rrqm_s,
        wrqm_s,
        r_s,
        w_s,
        rkB_s,
        wkB_s,
        avgrq_sz,
        avgqu_sz,
        await_,
        r_await,
        w_await,
        svctm,
        util,
      ] = parts;

      devices.push({
        device: dev,
        rrqm_s: parseFloat(rrqm_s) || 0,
        wrqm_s: parseFloat(wrqm_s) || 0,
        r_s: parseFloat(r_s) || 0,
        w_s: parseFloat(w_s) || 0,
        rkB_s: parseFloat(rkB_s) || 0,
        wkB_s: parseFloat(wkB_s) || 0,
        avgrq_sz: parseFloat(avgrq_sz) || 0,
        avgqu_sz: parseFloat(avgqu_sz) || 0,
        await: parseFloat(await_) || 0,
        r_await: parseFloat(r_await) || 0,
        w_await: parseFloat(w_await) || 0,
        svctm: parseFloat(svctm) || 0,
        util: parseFloat(util) || 0,
      });
    }

    return {
      devices,
      timestamp: new Date().toISOString(),
      command: cmd,
    };
  } catch (e) {
    // Fallback: try reading /proc/diskstats directly
    return getDiskIOFallback(device);
  }
}

function getDiskIOFallback(device?: string): DiskIOResult {
  try {
    const output = execSync("cat /proc/diskstats 2>/dev/null", {
      encoding: "utf-8",
      timeout: 5000,
    });
    const lines = output.trim().split("\n").filter(Boolean);
    const devices: DiskIOStat[] = [];

    for (const line of lines) {
      const parts = line.trim().split(/\s+/);
      if (parts.length < 14) continue;
      const [, , major, minor, name, rio, rmerge, rsect, rtime, wio, wmerge, wsect, wtime, ios, iotime, weightIO] = parts;
      if (!name || name.match(/^(ram|loop|dm-)/)) continue;
      if (device && name !== device) continue;

      const reads = parseInt(rio) || 0;
      const writes = parseInt(wio) || 0;
      const readSectors = parseInt(rsect) || 0;
      const writeSectors = parseInt(wsect) || 0;
      const readTime = parseInt(rtime) || 0;
      const writeTime = parseInt(wtime) || 0;
      const ioCount = parseInt(ios) || 0;
      const ioTime = parseInt(iotime) || 0;

      devices.push({
        device: name,
        rrqm_s: 0,
        wrqm_s: 0,
        r_s: reads,
        w_s: writes,
        rkB_s: Math.round((readSectors * 512) / 1024),
        wkB_s: Math.round((writeSectors * 512) / 1024),
        avgrq_sz: ioCount > 0 ? Math.round(((readSectors + writeSectors) / ioCount) * 100) / 100 : 0,
        avgqu_sz: 0,
        await: ioCount > 0 ? Math.round(((readTime + writeTime) / ioCount) * 100) / 100 : 0,
        r_await: reads > 0 ? Math.round((readTime / reads) * 100) / 100 : 0,
        w_await: writes > 0 ? Math.round((writeTime / writes) * 100) / 100 : 0,
        svctm: ioCount > 0 ? Math.round((ioTime / ioCount) * 100) / 100 : 0,
        util: ioTime > 0 ? Math.round(((ioTime / 1000) % 100) * 100) / 100 : 0,
      });
    }

    return {
      devices,
      timestamp: new Date().toISOString(),
      command: "cat /proc/diskstats",
    };
  } catch {
    return { devices: [], timestamp: new Date().toISOString(), command: "" };
  }
}
