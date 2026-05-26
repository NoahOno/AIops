import { execSync } from "node:child_process";

export interface LargeFileEntry {
  size: string;
  sizeBytes: number;
  path: string;
}

export interface LargeFilesResult {
  files: LargeFileEntry[];
  totalScanned: string;
  command: string;
}

export function findLargeFiles(
  path: string = "/",
  count: number = 20,
  minSize: string = "100M"
): LargeFilesResult {
  const cmd = `find ${path} -xdev -type f -size +${minSize} -exec du -h {} + 2>/dev/null | sort -rh | head -${count}`;
  const output = execSync(cmd, { encoding: "utf-8", timeout: 30000 });
  const lines = output.trim().split("\n").filter(Boolean);
  const files: LargeFileEntry[] = [];

  for (const line of lines) {
    const match = line.match(/^(\S+)\s+(.+)$/);
    if (match) {
      const sizeStr = match[1];
      const filePath = match[2];
      const bytes = parseSize(sizeStr);
      files.push({ size: sizeStr, sizeBytes: bytes, path: filePath });
    }
  }

  return {
    files,
    totalScanned: `Top ${files.length} files in ${path}`,
    command: cmd,
  };
}

function parseSize(s: string): number {
  const num = parseFloat(s);
  if (s.endsWith("T")) return num * 1024 * 1024 * 1024 * 1024;
  if (s.endsWith("G")) return num * 1024 * 1024 * 1024;
  if (s.endsWith("M")) return num * 1024 * 1024;
  if (s.endsWith("K")) return num * 1024;
  return num;
}
