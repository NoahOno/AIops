import { execSync } from "node:child_process";

export interface GrowthPrediction {
  mount: string;
  totalGB: number;
  usedGB: number;
  availableGB: number;
  usePercent: number;
  daysUntilFull: number | null;
  predictedFullDate: string | null;
  dailyGrowthGB: number | null;
}

export interface DiskGrowthResult {
  predictions: GrowthPrediction[];
  notes: string;
}

export function predictDiskGrowth(mount?: string): DiskGrowthResult {
  // Use df to get current status
  const target = mount ?? "";
  const output = execSync(`df -B1 ${target} 2>/dev/null`, {
    encoding: "utf-8",
    timeout: 10000,
  });
  const lines = output.trim().split("\n").slice(1);
  const predictions: GrowthPrediction[] = [];

  for (const line of lines) {
    const parts = line.split(/\s+/);
    if (parts.length < 6) continue;
    const [fs, total, used, available, usePct, ...rest] = parts;
    const mountPoint = rest.join(" ");

    const totalGB = Math.round((parseInt(total) / (1024 * 1024 * 1024)) * 100) / 100;
    const usedGB = Math.round((parseInt(used) / (1024 * 1024 * 1024)) * 100) / 100;
    const availableGB = Math.round((parseInt(available) / (1024 * 1024 * 1024)) * 100) / 100;
    const usePercent = parseInt(usePct.replace("%", ""));

    // Estimate daily growth from last 24h via stat of root directory
    let dailyGrowthGB: number | null = null;
    try {
      const rootStat = execSync(
        `stat --format='%Y' ${mountPoint} 2>/dev/null`,
        { encoding: "utf-8", timeout: 5000 }
      ).trim();
      const epochNow = Math.floor(Date.now() / 1000);
      const epochStat = parseInt(rootStat);
      if (!isNaN(epochStat) && epochNow - epochStat < 86400 * 30) {
        // Use a simple heuristic: sample /var/log growth trend
        const logSize = execSync(
          `du -sb ${mountPoint}/var/log 2>/dev/null | cut -f1`,
          { encoding: "utf-8", timeout: 5000 }
        ).trim();
        if (logSize && !isNaN(parseInt(logSize))) {
          // rough estimate: assume log/data growth ~0.5-5% of used space per month
          const monthlyGrowthRate = 0.02; // 2% monthly default
          dailyGrowthGB =
            Math.round(usedGB * monthlyGrowthRate * 100) / 100 / 30;
        }
      }
    } catch {
      dailyGrowthGB = null;
    }

    let daysUntilFull: number | null = null;
    let predictedFullDate: string | null = null;

    if (dailyGrowthGB && dailyGrowthGB > 0) {
      daysUntilFull = Math.ceil(availableGB / dailyGrowthGB);
      if (daysUntilFull < 36500) {
        const d = new Date();
        d.setDate(d.getDate() + daysUntilFull);
        predictedFullDate = d.toISOString().split("T")[0];
      } else {
        daysUntilFull = null;
      }
    }

    predictions.push({
      mount: mountPoint,
      totalGB,
      usedGB,
      availableGB,
      usePercent,
      daysUntilFull,
      predictedFullDate,
      dailyGrowthGB,
    });
  }

  return {
    predictions,
    notes:
      "Growth prediction is estimated based on current usage and default 2% monthly growth rate. For accurate prediction, use monitoring system with historical data.",
  };
}
