# 运行手册（RUNBOOK）

> 这份文档只回答一个问题：**在另一台机器上，怎么把它跑起来。**
> 分三种模式，按“需要准备什么”从少到多排列。选你需要的看。

---

## 0. 环境要求

| 项 | 要求 | 说明 |
|---|---|---|
| Node.js | **≥ 22**（本仓库在 24 上测过） | 需要直接运行 `.ts`（Node 原生类型剥离） |
| pnpm | ≥ 10（本仓库用 12） | `corepack enable` 或单独安装 |
| 网络 | 能访问 npm registry | 只装公共依赖，**不需要私服** |

克隆：

```bash
git clone https://github.com/WUMxiao/rsi-data-platform.git
cd rsi-data-platform
pnpm install
```

> Windows PowerShell 5.1 用 `Set-Content -Encoding utf8` 生成的文件会带 BOM，
> Node 的 `--env-file` 会把第一行的键读成 `\uFEFFKEY`。手工用编辑器保存即可避免。

---

## 1. 模式 A：只看页面（零外部依赖）

```bash
pnpm dev
# http://localhost:3000/orchestration
```

看得到：结论数字（15/30、12/30、43 次调用）、结构画布、30 行结果表（可展开看证据与 trace）、前后对照、复现命令。

**不需要**数据、模型 key、数据库。结果来自仓库内已提交的 `public/results/results.json`。

静态构建：

```bash
pnpm build        # 产出 out/，四个路由全部静态
```

---

## 2. 模式 B：跑校验（零外部依赖，不调模型）

```bash
pnpm orchestrate --validate            # 期望：（无问题） error 0 / warn 0
pnpm orchestrate --selftest-validator  # 期望：7 个 CAUGHT + CLEAN
pnpm orchestrate --rescore main30v2    # 期望：原始 12/30 → 规范化 15/30
```

三条都只读仓库内文件（`src/flows/flows_my.ts`、`data/issues.jsonl`、`public/results/*.json`）。

---

## 3. 模式 C：跑实验（需要模型网关）

### 3.1 配置

```bash
cp .env.example .env.local
```

只填模型相关的三项：

```ini
OPENAI_BASE_URL=https://<你的网关>/v1
OPENAI_API_KEY=<你的 key>
MODEL=gpt-6-sol
```

**数据不需要配。** 仓库自带：

| 文件 | 内容 | 体积 |
|---|---|---|
| `data/contexts.jsonl.gz` | 28 份唯一 context（按 sha1 存储） | 28.4 MB |
| `data/samples.jsonl` | 32 条样本索引（task / sampleId / input / answer / sha1） | 9.6 KB |
| `data/baseline.jsonl` | 32 条基线记录（gpt-6-sol v3 的 raw / score） | 11 KB |

> 想用完整数据集（例如跑其他题目）：在 `.env.local` 里加 `DATA_DIR` / `BASELINE_DIR`，
> 配了就优先用外部目录，没配就回落到仓库内的包。

### 3.2 逐级验证

| 命令 | 作用 | 模型调用 | 预期输出 |
|---|---|---|---|
| `pnpm orchestrate --check-issues` | 三方对账 | 0 | `PASS 12 / WARN 0 / FAIL 0` |
| `pnpm orchestrate --engine IB-06` | 单条端到端 | 1–2 | `finalAnswer = "99700"` |
| `pnpm orchestrate --all` | 30 条全量 | 约 43 | 汇总表，`12/30`（规范化 15/30） |
| `pnpm orchestrate --ablation` | 两层消融 | 约 23 | `两层 4/10，三层 5/10` |
| `pnpm orchestrate --autogen-demo` | 让模型生成结构 | 1 | 生成 JSON + L1 判定（预期判死） |

`--all` 默认写 `public/results/results.json`；要保留原文件请加 `--tag 名字`。

### 3.3 耗时与成本参考

30 条：4 路并发、约 5 分钟、43 次调用、约 72 万 prompt token。

> 结果**不会逐字复现**：模型非确定性。实测同一结构两次运行，IB-03 一次答对、一次答错。
> 换 `MODEL` 会破坏“修复前后”对照（基线是 `gpt-6-sol`）。

---

## 3.5 模式 D：跑在平台后端上（Java 引擎）

> 需要：Java 8+；**不需要 Maven、不需要私服账号**（运行包已随仓库分发）。

```powershell
powershell -File scripts/start-all.ps1      # 起 worker(39100) + 后端(39910，H2)
node server/run-all-backend.mjs 3            # 30 条全走后端，结果落 cases/results/
```

页面上：`pnpm dev` → `/orchestration` →「后端运行」页签，可单条或全部运行；也可直接带 `?tab=backend&autorun=IB-06` 打开即跑。

链路：页面/脚本 → `POST /facade/engine/flow` → Java 引擎 `FLOW_RUN` → 节点 `FLOW_CODE_RUN`（我们覆盖了平台的空壳实现）→ HTTP 回调 worker → plan→read→verify → `FlowEngine.register("result", json)`。

| 文件 | 作用 |
|---|---|
| `backend/core-starter-case.jar` | 平台原包 + 节点实现 + H2 驱动，**已入仓** |
| `server/worker.mjs` | Node worker，复用 TS 管线 |
| `server/FlowCodeRun.java` / `CorsConfig.java` | 节点新实现、跨域放行（源码，供重建） |
| `scripts/build-backend.ps1` | 从平台原始 fat jar 重建运行包（JDK 8 + Python 3） |

> 后端用 H2 内存库启动，只是为了满足控制器上的 `@Transactional`，数据不落库。

---

## 4. 命令速查

| 命令 | 需要数据 | 需要 key | 作用 |
|---|---|---|---|
| `--validate` | — | — | 8 条静态规则 |
| `--selftest-validator` | — | — | 7 个破坏用例 |
| `--rescore <tag>` | — | — | 只重算判分 |
| `--check-issues` | ✅（仓库内） | — | 方案表 / 数据集 / 基线三方对账 |
| `--engine <id>` | ✅ | ✅ | 单条走引擎 |
| `--all` | ✅ | ✅ | 30 条全量 |
| `--ablation` | ✅ | ✅ | 两层消融 |
| `--autogen-demo` | — | ✅ | 模型生成结构 → L1 校验 |
| `--plan-report` | ✅ | — | 检索命中体检（12 条） |
| `--issue <id> --dry-plan` | ✅ | — | 只看 plan 的候选块与契约 |

---

## 5. 排错

| 现象 | 原因 | 处理 |
|---|---|---|
| `ERR_PNPM_IGNORED_BUILDS` | pnpm 拦原生包安装脚本 | 仓库已设 `dangerouslyAllowAllBuilds`；仍出现就 `pnpm install --ignore-scripts` |
| `DATA_DIR 未设置，且仓库内 … 不完整` | `data/contexts.jsonl.gz` 或 `samples.jsonl` 缺失 | 重新 clone，或配 `DATA_DIR` |
| `缺少 OPENAI_BASE_URL / OPENAI_API_KEY` | `.env.local` 没配或带 BOM | 检查文件首字节；重存为 UTF-8 无 BOM |
| 页面“结果未加载” | `public/results/results.json` 缺失 | 重新 clone，或跑一次 `--all` |
| `Cannot find module '@horsecoder/visual-core'` | 依赖没装全 | `pnpm install`（已在 `vendor/` 内置） |
| `next: command not found` | 没装依赖 | `pnpm install` |

---

## 6. 边界（先看清楚再判断）

- **执行入口有两条。** ① 命令行（`pnpm orchestrate --all`，主路径，稳定）；② 页面「后端运行」页签 → 平台后端 `/facade/engine/flow` → Java 引擎 `FLOW_RUN` → 节点回调本地 worker。第 ② 条要先跑 `scripts/build-backend.ps1` 与 `scripts/start-all.ps1`，且依赖 Node worker 在 39100 上存活。
- **不经过数据库。** 后端用注入的 H2 内存库启动（`@Transactional` 需要连接），不依赖 MySQL；数据也不落库。
- **不经过后端。** 本次没有接入 Spring 的 `/facade/engine/flow`，也没有改 Java 引擎；执行在本地 Node 里跑前端同款的 `@horsecoder/flow`。
- **要“点一下就跑”，需要额外的改造**：去掉静态导出并加 `app/api/orchestrate/run`（约 2–3 小时），或接后端引擎（需重写 Java 节点）。
