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

## 快速开始

```bash
pnpm install
cp .env.example .env.local      # 填 DATA_DIR / BASELINE_DIR / OPENAI_*
pnpm dev                        # 打开 /orchestration（静态导出，无运行按钮）

# 不需要模型
pnpm orchestrate --check-issues          # 三方对账，生成 data/issues.jsonl
pnpm orchestrate --validate              # 8 条静态规则
pnpm orchestrate --selftest-validator    # 故意破坏结构，7/7 应被捕获
pnpm orchestrate --smoke-nest            # 三层空跑，打印 trace
pnpm orchestrate --smoke-stop            # 跨层 stop 验证

# 需要模型（约 43 次调用 / 5 分钟）
pnpm orchestrate --all                   # 30 条，4 路并发
pnpm orchestrate --rescore main30v2      # 只重算判分，0 次调用
pnpm orchestrate --ablation              # 两层消融
pnpm orchestrate --autogen-demo          # 让模型生成结构 → L1 校验判死
```

## 页面

- `/orchestration`：结构画布 + 30 条结果（含证据与 trace 展开）+ 前后对照 + 复现命令
- `/visual`：已迁移，客户端跳转到 `/orchestration`

页面是**静态导出**（`output: 'export'`），执行在服务端命令行，结果落盘 `public/results/*.json` 后由页面读取——所以没有“运行”按钮，这是有意的取舍。

## 文档

| 文件 | 内容 |
|---|---|
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
data/issues.jsonl            30 条问题（不含 context）
public/results/*.json        运行结果（含证据与 trace）
```

## 环境

Node ≥ 22（本项目实测 v24，直接跑 `.ts`）、pnpm、Next.js 16。
数据不随仓库分发：`DATA_DIR` 指向 InfiniteBench 原始 jsonl，`BASELINE_DIR` 指向已存基线。
