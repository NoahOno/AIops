---
name: disk-trend-analysis
description: 基于 Prometheus 历史数据进行磁盘趋势分析、容量预测和 IO 性能诊断。当用户询问磁盘增长趋势、IO 性能历史变化、容量规划时使用。
---

# Disk Trend Analysis

基于 Prometheus 历史指标数据进行磁盘相关趋势分析和容量规划。需要环境中已配置 Prometheus MCP Server。

## 前置条件

- 已安装 node_exporter 并配置 Prometheus 采集
- 已配置 Prometheus MCP Server（推荐 `denysvitali/prometheus-mcp`）

MCP 配置示例（`opencode.json`）:
```json
{
  "mcpServers": {
    "prometheus": {
      "command": "prometheus-mcp",
      "args": ["stdio"],
      "env": {
        "PROMETHEUS_MCP_URL": "http://localhost:9090"
      }
    }
  }
}
```

## 有效 PromQL 速查

### 磁盘容量趋势

```promql
# 磁盘使用率（当前）
100 - (node_filesystem_avail_bytes{mountpoint="/"} / node_filesystem_size_bytes{mountpoint="/"} * 100)

# 磁盘使用率趋势（过去7天）
(1 - avg by (instance) (node_filesystem_avail_bytes{mountpoint="/"} / node_filesystem_size_bytes{mountpoint="/"})) * 100

# 磁盘空间增长速率（每天增长多少 GB）
delta(node_filesystem_avail_bytes{mountpoint="/"}[24h]) / (1024*1024*1024)

# 预测磁盘何时写满（基于过去7天趋势，预测30天后）
predict_linear(node_filesystem_avail_bytes{mountpoint="/"}[7d], 30*86400) < 0
```

### Inode 趋势

```promql
# Inode 使用率
100 - (node_filesystem_files_free{mountpoint="/"} / node_filesystem_files{mountpoint="/"} * 100)

# Inode 增长趋势（过去7天）
delta(node_filesystem_files_free{mountpoint="/"}[7d])
```

### 磁盘 IO 性能

```promql
# IOPS（每秒读写次数）
rate(node_disk_reads_completed_total[5m])
rate(node_disk_writes_completed_total[5m])

# 读写吞吐量（字节/秒）
rate(node_disk_read_bytes_total[5m])
rate(node_disk_written_bytes_total[5m])

# 平均 IO 延迟（毫秒）
rate(node_disk_read_time_seconds_total[5m]) / rate(node_disk_reads_completed_total[5m]) * 1000
rate(node_disk_write_time_seconds_total[5m]) / rate(node_disk_writes_completed_total[5m]) * 1000

# IO 利用率（%）
rate(node_disk_io_time_seconds_total[5m])
```

### 多节点聚合

```promql
# 所有节点磁盘使用率 > 80% 的节点
100 - (node_filesystem_avail_bytes / node_filesystem_size_bytes * 100) > 80

# 按节点聚合平均磁盘使用率
avg by (instance) (100 - (node_filesystem_avail_bytes / node_filesystem_size_bytes * 100))
```

## 分析流程

### 磁盘容量预测
1. 调用 `prometheus_query_range`，查询过去 7-30 天的磁盘使用率趋势
2. 用 `predict_linear()` 预测满盘日期
3. 结合 `node_filesystem_size_bytes` 给出建议扩容大小
4. 给出预警等级（<30天=紧急，<60天=警告，>90天=正常）

### IO 性能诊断
1. 查询 `rate(node_disk_io_time_seconds_total[5m])` 看设备是否饱和
2. 查询 `await`（延迟）确认是否存在性能瓶颈
3. 区分场景：
   - %util ≈ 100% + await 高 → 磁盘饱和（机械盘）
   - await < 10ms → 性能正常（SSD）
   - await > 50ms → 存在 IO 瓶颈

### 容量规划报告
- 当前各挂载点使用率
- 过去 N 天增长速率（GB/天）
- 预测满盘日期
- 建议扩容时间和大小
- 按风险等级排序

## 限制说明

- Prometheus 数据为周期性采集（通常 15s-1min），非实时值
- 本地实时精确查询（df/iostat）请配合使用 `mcp-disk-space` MCP Server
- 需要环境中已部署 Prometheus + node_exporter
