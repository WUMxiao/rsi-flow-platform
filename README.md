# rsi-flow-platform · InfiniteBench 三层嵌套编排实验

在平台自带的 `@horsecoder/flow` 引擎上，用**原生嵌套**（`main → read(子流程) → verify(子流程)`）跑 30 条 InfiniteBench 长文问题，并与 `gpt-6-sol` 的已存基线做修复前后对照。

## 结论（先看这段）

| 指标 | 基线 | 本次 |
|---|---|---|
| 严格匹配（原始） | 0/30 | **12/30** |
| 严格匹配（答案规范化后） | 0/30 | **15/30** |
| 精确串类（passkey / number_string / kv） | 0/9 | **9/9** |
| 长文问答（中英文） | 0/18 | 6/18 |
| 代码类（code_debug） | 0/3 | 0/3 |

- **这套结构的适用边界是“答案有唯一字面锚点”**：有锚点 9/9，需要全书计数/聚合 6/18，需要读懂源码 0/3。
- **第三层（verify）的可测量收益只有 1 条**（IB-09：把 `About thirty years old` 压成 `Thirty`），买的是**格式合规**，不是召回。
- 单条覆盖全文 **0.62%**（6 块 × 4000 字），基线截断后仍看了约 6.7%——长文计数类输是结构决定的。
- 「全文分片 map-reduce」已被实验证否：14 个分片、17 次调用、122 万 token，全部返回“本片无相关内容”。

失败的 15 条按机制归类见 [`docs/FAILURES.md`](docs/FAILURES.md)；结构、约束与消融见 [`docs/ORCHESTRATION.md`](docs/ORCHESTRATION.md)。

## 结构

```
orchestration.main                          depth 0
├─ plan    event  → code.plan               切块 + 本地检索 + 契约（0 次模型调用）
├─ read    flow   → orchestration.read      depth 1
│     └─ fanout event → code.read           depth 2   批量精读 + 证据逐字校验
└─ verify  flow   → orchestration.verify    depth 1
      └─ check  event → code.verify         depth 2   契约核验 + 整形
```

嵌套由引擎的 `runNode → run(childFlow)` 递归完成，没有自写调度器（全仓只有一处 `flow.run(...)`）。

## 仓库结构

| 角色 | 仓库 | 说明 |
|---|---|---|
| 前端（本仓库） | https://github.com/WUMxiao/rsi-data-platform | 编排实验、页面、文档 |
| 前端编排框架 | https://github.com/WUMxiao/rsi-data-visual | 上游 `@horsecoder/visual-core` 0.3.12，**未改动**；本仓库在 `vendor/` 内置了一份 dist 以便单独运行 |
| 后端 | https://github.com/WUMxiao/rsi-data-spring-boot | 上游原样 fork，**未改动** |
| 后端 rsi 编排框架 | https://github.com/WUMxiao/rsi-flow | 上游原样 fork，**未改动**（Java 引擎 `cc.eamon.open.flow`） |

> **两条执行路径都成立**：
> ① 命令行：本地 Node 直接跑 JS 引擎（`pnpm orchestrate --all`），页面读静态 JSON；
> ② 平台后端：页面「后端运行」页签 → 后端 `POST /facade/engine/flow` → Java 引擎执行 `FLOW_RUN` → 节点回调本地 worker。
> 第 ② 条需要先启动后端与 worker（`scripts/start-all.ps1`），结果见 [`cases/EXPLAIN.md`](cases/EXPLAIN.md)。

## 在平台后端上跑（30 条）

```powershell
# 1) 构建后端运行包（把节点实现与 H2 注入平台自带的 fat jar）
powershell -File scripts/build-backend.ps1

# 2) 起两个进程：Node worker(39100) + Java 后端(39910，H2 内存库)
powershell -File scripts/start-all.ps1

# 3) 通过后端跑全部 30 条（结果落 cases/results/）
node server/run-all-backend.mjs 3
```

页面：`pnpm dev` → `http://localhost:3000/orchestration` →「后端运行」页签，可单条或全部运行。

最近一次通过后端的实测：**14/30** 严格匹配、69 次节点调用（`cases/results/summary.md`）。

## 快速开始（命令行）

```bash
pnpm install        # 依赖全部来自公共 npm + 仓库内 vendor/，无需私服
pnpm dev            # 打开 /orchestration，直接能看到已跑完的 30 条结果
pnpm build          # 静态导出到 out/
```

页面能看**不需要**任何外部资源。要重跑实验，只需配模型网关（**数据已随仓库分发**，见下）：

```bash
cp .env.example .env.local
# 只填三项：OPENAI_BASE_URL / OPENAI_API_KEY / MODEL=gpt-6-sol
pnpm orchestrate --all        # 30 条，约 43 次调用 / 5 分钟
```

仓库内自带实验所需的数据子集，另一台机器无需下载 2.3 GB 数据集：

| 文件 | 内容 | 体积 |
|---|---|---|
| `data/contexts.jsonl.gz` | 28 份唯一 context（按 sha1 存储） | 28.4 MB |
| `data/samples.jsonl` | 32 条样本索引（含 input / answer / sha1） | 9.6 KB |
| `data/baseline.jsonl` | 32 条 `gpt-6-sol` v3 基线记录 | 11 KB |

> 数据来源：InfiniteBench（公开数据集）。这里只再分发本实验用到的 30 条样本 + 2 条对照，
> 便于复现；配了 `DATA_DIR` / `BASELINE_DIR` 时优先用外部完整数据集。

完整步骤、命令速查与排错见 [`docs/RUNBOOK.md`](docs/RUNBOOK.md)。

## 页面

- `/orchestration`：结构画布 + 30 条结果（含证据与 trace 展开）+ 前后对照 + 复现命令
- `/visual`：已迁移，客户端跳转到 `/orchestration`

页面是**静态导出**（`output: 'export'`），执行在服务端命令行，结果落盘 `public/results/*.json` 后由页面读取——所以没有“运行”按钮，这是有意的取舍。

## 文档

| 文件 | 内容 |
|---|---|
| `docs/RUNBOOK.md` | **运行手册**：三种运行模式、命令速查、排错、边界 |
| `docs/REPORT.md` | **交付报告**：五条目标逐条自检（4 达标 / 1 部分）、口径与局限 |
| `docs/ISSUES.md` | 30 条问题清单、失败类型、扩容抽样规则（先注册后抽题）、对账差异 |
| `docs/ORCHESTRATION.md` | 三层结构、数据流、失败上抛、引擎约束、消融、两次改造实验 |
| `docs/FAILURES.md` | 15 条失败按 4 类机制归因，区分“能力不足”与“有意放弃” |
| `docs/AUTOGEN_PLAN.md` | 自动化边界（L0/L1/L2）、生成器设计、L1 校验实测 |
| `results/before_after.md` | 逐条前后对照（原始/规范化双判分） |

## 目录

```
src/flows/flows_my.ts        4 个 FlowConfig（纯 JSON，客户端可 import）
src/flows/viewstate.ts       FlowConfig → 画布 viewState
src/orchestrator/
  manifest.ts                节点清单 + 三轴（deterministic/verifiable）
  validate.ts                8 条静态规则 + 数据流闭合 + 7 个破坏用例
  bootstrap.ts               幂等注册/加载 + trace + 节点级 try/catch
  nodes.ts                   节点注册表（含跨层 stop）
  steps/plan.ts              切块 + 本地检索 + 契约
  steps/read.ts              批量精读 + 证据逐字校验（含 ESCALATE 实验开关）
  steps/verify.ts            契约核验 + 前缀补全 + 单次重试
  run.ts                     CLI
data/issues.jsonl            32 条问题（30 主 + 2 对照，不含 context）
data/contexts.jsonl.gz       28 份唯一 context（按 sha1 存，gzip 28.4 MB）
data/samples.jsonl           32 条样本索引（含 input / answer / sha1）
data/baseline.jsonl          32 条 gpt-6-sol v3 基线记录
public/results/*.json        运行结果（含证据与 trace）
```

## 环境

Node ≥ 22（本项目实测 v24，直接跑 `.ts`）、pnpm、Next.js 16。
数据随仓库分发（`data/` 下三个文件已够跑 30 条）；`DATA_DIR` / `BASELINE_DIR` 是**可选**的逃生门：
配了就优先用外部完整数据集，没配就用仓库内的包。
