#!/usr/bin/env node
import { Server } from "@modelcontextprotocol/sdk/server/index.js";
import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";
import {
  CallToolRequestSchema,
  ListToolsRequestSchema,
} from "@modelcontextprotocol/sdk/types.js";
import { getDiskUsage } from "./tools/disk-usage.js";
import { findLargeFiles } from "./tools/large-files.js";
import { checkInodeUsage, analyzeSmallFilesDirs } from "./tools/inode-check.js";
import { predictDiskGrowth } from "./tools/disk-growth.js";
import { getDiskIO } from "./tools/disk-io.js";
import { checkMounts } from "./tools/mount-check.js";
import { checkFsIntegrity } from "./tools/fs-integrity.js";

const server = new Server(
  { name: "mcp-disk-space", version: "1.0.0" },
  { capabilities: { tools: {} } }
);

server.setRequestHandler(ListToolsRequestSchema, async () => ({
  tools: [
    {
      name: "get_disk_usage",
      description: "磁盘使用率检查 - 查看各挂载点的总容量/已用/可用/使用率。发现磁盘空间不足风险，输出磁盘使用率（挂载点/总容量/已用/可用/使用率/剩余天数预测）",
      inputSchema: {
        type: "object",
        properties: {
          path: {
            type: "string",
            description: "指定路径（可选），如 /home",
          },
        },
      },
    },
    {
      name: "find_large_files",
      description: "大文件定位 - 查找磁盘上占用空间最大的Top N文件/目录，快速定位空间占用的主要来源。输出大文件（文件路径/大小/修改时间/所属用户）",
      inputSchema: {
        type: "object",
        properties: {
          path: {
            type: "string",
            description: "搜索起始路径，默认 /",
            default: "/",
          },
          count: {
            type: "number",
            description: "返回结果数量，默认 20",
            default: 20,
          },
          minSize: {
            type: "string",
            description: "最小文件大小，默认 100M（支持 K/M/G/T）",
            default: "100M",
          },
        },
      },
    },
    {
      name: "check_inode_usage",
      description: "Inode使用率检查 - 查看文件系统的Inode使用情况，发现大量小文件导致的Inode耗尽。输出Inode（挂载点/总Inode/已用/可用/使用率/主要小文件目录）",
      inputSchema: {
        type: "object",
        properties: {
          path: {
            type: "string",
            description: "指定路径（可选）",
          },
          analyzeDirs: {
            type: "boolean",
            description: "是否分析小文件目录分布",
            default: false,
          },
        },
      },
    },
    {
      name: "predict_disk_growth",
      description: "磁盘分区增长趋势 - 分析历史磁盘使用率变化，预测满盘时间。主动规划容量扩容。输出容量预测（各分区/日增长率/预测满盘日期/建议扩容时间/建议扩容大小）",
      inputSchema: {
        type: "object",
        properties: {
          mount: {
            type: "string",
            description: "指定挂载点（可选）",
          },
        },
      },
    },
    {
      name: "get_disk_io",
      description: "磁盘IO性能检查 - 查看磁盘IO延迟/队列长度/读写吞吐量。发现磁盘性能瓶颈。输出磁盘IO（await/r_await/w_await/avgqu-sz/iops/吞吐量/是否饱和）",
      inputSchema: {
        type: "object",
        properties: {
          device: {
            type: "string",
            description: "指定设备（可选），如 sda",
          },
          interval: {
            type: "number",
            description: "采样间隔（秒），默认 1",
            default: 1,
          },
          count: {
            type: "number",
            description: "采样次数，默认 3",
            default: 3,
          },
        },
      },
    },
    {
      name: "check_mounts",
      description: "磁盘挂载检查 - 查看磁盘挂载是否正确、是否有挂载丢失。确认存储服务正常。输出挂载检查（设备名/挂载点/文件系统类型/挂载选项/是否只读/是否丢失）",
      inputSchema: {
        type: "object",
        properties: {},
      },
    },
    {
      name: "check_fs_integrity",
      description: "文件系统完整性检查 - 检查文件系统是否有损坏、需要fsck。预防文件系统损坏导致数据丢失。输出文件系统健康（文件系统状态/是否需要修复/上次检查时间/超级块备份位置）",
      inputSchema: {
        type: "object",
        properties: {
          mount: {
            type: "string",
            description: "指定挂载点（可选）",
          },
        },
      },
    },
  ],
}));

server.setRequestHandler(CallToolRequestSchema, async (request) => {
  const { name, arguments: args } = request.params;

  try {
    switch (name) {
      case "get_disk_usage": {
        const path = args?.path as string | undefined;
        const result = getDiskUsage(path);
        const lines = result.mounts.map(
          (m) =>
            `[${m.mount}] ${m.filesystem} (${m.type || "?"}) 总:${formatGB(m.total)} 已用:${formatGB(m.used)} (${m.usePercent}%) 可用:${formatGB(m.available)}`
        );
        return {
          content: [
            {
              type: "text",
              text: [
                `## 磁盘使用率检查`,
                `**汇总:** 总:${formatGB(result.summary.total)} 已用:${formatGB(result.summary.used)} (${result.summary.usePercent}%) 可用:${formatGB(result.summary.available)}`,
                ``,
                ...lines,
              ].join("\n"),
            },
          ],
        };
      }

      case "find_large_files": {
        const path = (args?.path as string) || "/";
        const count = (args?.count as number) || 20;
        const minSize = (args?.minSize as string) || "100M";
        const result = findLargeFiles(path, count, minSize);
        const lines = result.files.map(
          (f, i) => `${(i + 1).toString().padStart(3)}. ${f.size.padStart(8)}  ${f.path}`
        );
        return {
          content: [
            {
              type: "text",
              text: [
                `## 大文件定位 (Top ${result.files.length})`,
                `搜索路径: ${path} | 最小: ${minSize}`,
                ``,
                ...lines,
                ...(result.files.length === 0
                  ? ["(未找到大于指定大小的文件)"]
                  : []),
              ].join("\n"),
            },
          ],
        };
      }

      case "check_inode_usage": {
        const inodePath = args?.path as string | undefined;
        const analyzeDirs = args?.analyzeDirs as boolean | undefined;
        const result = checkInodeUsage(inodePath);
        const lines = result.mounts.map(
          (m) =>
            `[${m.mount}] ${m.filesystem} 总Inode:${m.totalInodes.toLocaleString()} 已用:${m.usedInodes.toLocaleString()} (${m.usePercent}%) 可用:${m.freeInodes.toLocaleString()}`
        );
        let output = [
          `## Inode使用率检查`,
          `**汇总:** 总:${result.summary.totalInodes.toLocaleString()} 已用:${result.summary.usedInodes.toLocaleString()} (${result.summary.usePercent}%) 可用:${result.summary.freeInodes.toLocaleString()}`,
          ``,
          ...lines,
        ];

        if (analyzeDirs && inodePath) {
          const dirs = analyzeSmallFilesDirs(inodePath, 10);
          if (dirs.length > 0) {
            output.push(``, `### 文件数最多的目录 (Top 10):`);
            dirs.forEach((d, i) => {
              output.push(
                `${(i + 1).toString().padStart(3)}. ${d.fileCount.toString().padStart(8)}  ${d.directory}`
              );
            });
          }
        }

        return { content: [{ type: "text", text: output.join("\n") }] };
      }

      case "predict_disk_growth": {
        const mount = args?.mount as string | undefined;
        const result = predictDiskGrowth(mount);
        const lines = result.predictions.map((p) => {
          let line = `[${p.mount}] ${p.totalGB}GB 已用:${p.usedGB}GB (${p.usePercent}%) 可用:${p.availableGB}GB`;
          if (p.daysUntilFull !== null) {
            line += ` | 预计 ${p.daysUntilFull} 天后填满 (${p.predictedFullDate})`;
          } else {
            line += ` | 增长趋势: ${p.dailyGrowthGB !== null ? `${p.dailyGrowthGB}GB/天` : "数据不足"}`;
          }
          return line;
        });
        return {
          content: [
            {
              type: "text",
              text: [
                `## 磁盘分区增长趋势`,
                ...lines,
                ``,
                `> ${result.notes}`,
              ].join("\n"),
            },
          ],
        };
      }

      case "get_disk_io": {
        const device = args?.device as string | undefined;
        const interval = (args?.interval as number) || 1;
        const count = (args?.count as number) || 3;
        const result = getDiskIO(device, interval, count);
        if (result.devices.length === 0) {
          return {
            content: [
              {
                type: "text",
                text: "无法获取磁盘IO数据。请确保已安装 sysstat 包 (apt install sysstat) 或内核支持 /proc/diskstats。",
              },
            ],
          };
        }
        const header = `${"设备".padEnd(8)} ${"r/s".padStart(7)} ${"w/s".padStart(7)} ${"rkB/s".padStart(8)} ${"wkB/s".padStart(8)} ${"await".padStart(7)} ${"r_await".padStart(7)} ${"w_await".padStart(7)} ${"avgqu-sz".padStart(8)} ${"%util".padStart(6)}`;
        const separator = "-".repeat(header.length);
        const lines = result.devices.map((d) =>
          [
            d.device.padEnd(8),
            d.r_s.toFixed(1).padStart(7),
            d.w_s.toFixed(1).padStart(7),
            d.rkB_s.toFixed(1).padStart(8),
            d.wkB_s.toFixed(1).padStart(8),
            d.await.toFixed(2).padStart(7),
            d.r_await.toFixed(2).padStart(7),
            d.w_await.toFixed(2).padStart(7),
            d.avgqu_sz.toFixed(2).padStart(8),
            d.util.toFixed(1).padStart(6),
          ].join(" ")
        );
        return {
          content: [
            {
              type: "text",
              text: [
                `## 磁盘IO性能检查`,
                `采集时间: ${result.timestamp}`,
                ``,
                header,
                separator,
                ...lines,
                ``,
                "**指标说明:**",
                "- await: I/O 平均响应时间(ms)，越高表示延迟越大",
                "- r_await/w_await: 读/写平均延迟(ms)",
                "- avgqu-sz: 平均队列长度，越高表示排队越严重",
                "- %util: 磁盘繁忙率，接近100%表示饱和",
                "  - 机械盘 %util≈100% → 饱和",
                "  - SSD/NVMe 看 await 而非 %util（内部并行）",
              ].join("\n"),
            },
          ],
        };
      }

      case "check_mounts": {
        const result = checkMounts();
        const mountLines = result.mounts.map(
          (m) =>
            `${m.status === "ok" ? "✓" : "✗"} [${m.mountPoint}] ${m.device} (${m.filesystemType})${m.isReadOnly ? " [只读]" : ""}${m.isNetwork ? " [网络]" : ""}`
        );
        const output = [
          `## 磁盘挂载检查`,
          `当前挂载数: ${result.mounts.length}`,
          ``,
          ...mountLines,
        ];
        if (result.issues.readOnlyMounts.length > 0) {
          output.push(``, `### ⚠️ 只读挂载`, ...result.issues.readOnlyMounts.map((m) => `  - ${m}`));
        }
        if (result.issues.missingMounts.length > 0) {
          output.push(``, `### ❌ fstab中存在但未挂载`, ...result.issues.missingMounts.map((m) => `  - ${m}`));
        }
        return {
          content: [{ type: "text", text: output.join("\n") }],
        };
      }

      case "check_fs_integrity": {
        const mount = args?.mount as string | undefined;
        const result = checkFsIntegrity(mount);
        const lines = result.checks.map(
          (c) =>
            `${c.state === "clean" ? "✓" : c.needsFsck ? "✗" : "?"} [${c.mount}] ${c.device} (${c.filesystemType}) ${c.state}${c.lastCheckDate ? ` | 上次检查: ${c.lastCheckDate}` : ""}${c.needsFsck ? " | **需要fsck!**" : ""}`
        );
        return {
          content: [
            {
              type: "text",
              text: [
                `## 文件系统完整性检查`,
                `**汇总:** 共${result.summary.total}个 正常${result.summary.clean} 需修复${result.summary.needsFsck} 错误${result.summary.error}`,
                ``,
                ...lines,
                ...(result.checks.length === 0
                  ? ["(无可检查的文件系统，或仅包含虚拟文件系统)"]
                  : []),
                ``,
                "> 提示: 完整性检查需要 root 权限访问 tune2fs/xfs_repair 等工具。",
              ].join("\n"),
            },
          ],
        };
      }

      default:
        throw new Error(`Unknown tool: ${name}`);
    }
  } catch (error) {
    return {
      content: [
        {
          type: "text",
          text: `Error executing ${name}: ${error instanceof Error ? error.message : String(error)}`,
        },
      ],
      isError: true,
    };
  }
});

async function main() {
  const transport = new StdioServerTransport();
  await server.connect(transport);
  console.error("MCP Disk Space Server running on stdio");
}

main().catch((error) => {
  console.error("Server error:", error);
  process.exit(1);
});

function formatGB(bytes: number): string {
  const gb = bytes / (1024 * 1024 * 1024);
  return gb >= 1024 ? `${(gb / 1024).toFixed(2)}TB` : `${gb.toFixed(2)}GB`;
}
