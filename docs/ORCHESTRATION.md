# 编排结构说明（三层嵌套 · 收益与代价）

> 数据截至 30 条主问题的一次完整运行：严格匹配 **12/30（原始）/ 15/30（答案规范化后）**，基线 0/30；43 次模型调用，5.2 分钟。

## 一、结构

```
orchestration.main                depth 0
├─ plan    event  → code.plan     切块 + 本地检索 + 契约（0 次模型调用）
├─ read    flow   → orchestration.read      depth 1
│     └─ fanout event → code.read           depth 2   批量精读 + 证据逐字校验
└─ verify  flow   → orchestration.verify    depth 1
      └─ check  event → code.verify         depth 2   契约核验 + 整形
```

另有 `orchestration.v2`（`plan → read`，砍掉 verify）用于消融。

**嵌套是引擎原生的**：`main` 里的 `type:"flow"` 节点会触发引擎的 `runNode → run(childFlow)` 递归，不存在我们自写的调度器。全仓只有一处 `flow.run(...)` 调用，且只调 `main`。

## 二、上下文怎么传

- 每个流程、每个节点都**必须显式声明 `params` / `results`**。引擎的 `checkAllArgs` 在 `params` 为 `null` 时返回 `{}`，会把上一层传入的参数全部丢掉；`results` 未声明的字段会被静默裁掉。
- 因此数据流是"字段级契约"：`plan.results` 产出 `chunks/contract/keywords` → `read.params` 声明接收 → `read.results` 产出 `evidence/drafts` → `verify.params` 接收。
- 静态校验器（`validateFlowConfig` 的 R7）会对这条链做**字段级闭合检查**，人工和 LLM 写错都能抓。

## 三、失败怎么上抛

引擎不允许回退，节点内抛异常会带崩整个流程，所以分三层兜：

1. **节点内 try/catch**（`bootstrap.ts` 的 `wrap`）：异常转成 `{error}` 返回，流程继续，trace 记 `status=error`。
2. **契约失败**（`code.verify` 判不出来）：返回 `verdict.pass=false`，由节点层调 `stop('orchestration.main', {failed, failReason})`。`flowStopSignal` 是全局表，子流程能终止父流程——这条已在 `--smoke-stop` 里验证。
3. **整条 run 失败**：CLI 捕获，行数据照样落盘，`error` 字段写原因。

## 四、引擎约束与绕法（实测，不是文档抄的）

| 约束 | 后果 | 我们的绕法 |
|---|---|---|
| 同层串行（`for` + `await`） | 扇出不能靠多节点 | 扇出写在单节点内 `Promise.all` |
| 路由无条件 | 不能按题型分流 | 分派只能写进节点内部（本次未做） |
| 不能回退 | 重试无法回读 | 重试写在节点内；跨层用 `stop()` 终止 |
| `params` 缺失 = 参数全丢 | 整条数据流断 | 校验器 R1 + R7 |
| `results` 裁剪 | 未声明字段静默消失 | 校验器 R7 + 运行时 trace |
| `register/load` 重复抛错 | 热更新二次执行会炸 | 模块级幂等 + try/catch |
| 同 target 多路由会重复执行 | 节点跑两次 | 校验器 R3（单入边） |

**这七条决定了"结构优化"的空间**：线性链 + 递归子流程只能表达"固定顺序的流水线"，表达不了"按题型选流水线"。所以层数加得再多，也只是同一条链上多一道工序。

## 五、层的收益与代价（消融实测）

| | V1 基线 | V2 两层 | V3 三层 |
|---|---|---|---|
| 严格匹配（原 10 条） | 0/10 | 4/10 | 5/10 |
| 调用次数 | 0（复用） | 23 | 34 |
| prompt token | — | 276k | 373k |

**唯一的差异是 IB-09**：V2 答 `About thirty years old`（官方 0.4），V3 答 `Thirty`（1.0）。机制是**契约强制格式**，不是"多一层读得更准"。

代价：每 10 条多约 11 次调用、10 万 token、每条约 1 次往返延迟。

> 消融在时延优化（去掉 plan 的 LLM 调用、并发批跑）之前跑，V2/V3 使用同一套节点实现，结构差异仍然成立。

**结论**：第三层买的是"答案合规"，不是"召回"。这是我们最初没料到的——原假设是层级提升准确性。

## 六、为什么长文聚合几乎全灭（覆盖率）

| | 每次喂给模型的文本 | 占 3.86M 全文比例 |
|---|---|---|
| 本结构 | 6 块 × 4000 = 2.4 万字符 | **0.62%** |
| 基线 v3（截断） | 约 17.4 万 prompt token（≈26 万字符，估算） | **约 6.7%** |

基线看的文本量比我们**多一个数量级**。所以"全书有多少条时间线"这类题，我们输是结构决定的，不是模型不努力。

三个失败机制（15 条失败的归因见 `FAILURES.md`）：

1. **答案不是可检索的字符串**（计数/是否存在）：检索得再准也没用，答案要"数出来"。
2. **稀有实体定位**：实体名在文中罕见，词频检索够不到。
3. **情节/语义**：问法与原文零字面重叠。

## 七、两次改造实验：一次部分成功，一次被证否

### 7.1 代码按函数边界切块（部分成功）

- 改动：`chunkByStructure` 按 `def/class/function` 切块并在块首写函数名；`code_debug` 契约从 `choice_letter` 改为 `short_entity`（gold 是函数名）。
- 结果：契约修对了（不再强求不存在的 A/B/C/D），但 **0/3 仍全错**。
- 结论：不是切块问题，是"读懂代码找 bug"超出当前能力。

### 7.2 全文分片 map-reduce（证否）

- 假设：长文失败因为覆盖率低，摊开全文分片重读应该能救。
- 实测（IB-13，522k 字符，14 片 + 1 次汇总）：**17 次调用、122 万 prompt token，14/14 片返回 `found:false`，证据 0 条**。
- 结论：**"每片问模型"这条路不成立**——4 万字的分片里，模型判断不出"与本问题相关"。要做得改成"定向抽取 + 本地聚合"（见下）。
- 该路径已默认关闭，`ESCALATE=1` 可复现。

## 八、结构演进建议（下一步，不是已完成）

1. **层 = 文本规模，不是阶段**：现在 plan/read/verify 都在处理同一批 6 个块，加层只加开销。理想是"抽样 → 全量结构化扫描 → 精读整形"。
2. **候选生成 + 模型判定**：本地正则全量抽候选（0 调用、100% 召回）→ 模型只判"是不是人名/是否同一人" → 本地聚合。把"搜索"和"判断"分开。
3. **节点内分派 + 一次内部重读**：因为引擎不支持条件路由与回退。
4. **消融按机制做**：位置先验 / 证据校验 / 契约强制 / 聚合层，四个开关，而不是"层数"。

## 九、复现

前置：Node ≥ 22 + pnpm；数据随仓库分发（`data/` 下三个文件），**不需要下载 2.3 GB**；
跑实验还需要模型网关（`OPENAI_BASE_URL` / `OPENAI_API_KEY` / `MODEL=gpt-6-sol`）。
完整步骤、命令速查与排错见 `docs/RUNBOOK.md`。

```bash
pnpm orchestrate --check-issues        # 三方对账，生成 data/issues.jsonl
pnpm orchestrate --validate            # 8 条静态规则
pnpm orchestrate --selftest-validator  # 故意破坏结构，7/7 应被捕获
pnpm orchestrate --smoke-nest          # 三层空跑，打印 trace
pnpm orchestrate --smoke-stop          # 跨层 stop
pnpm orchestrate --all                 # 30 条（4 路并发，约 5 分钟）
pnpm orchestrate --rescore main30v2    # 只重算判分，0 次模型调用
pnpm orchestrate --ablation            # 两层消融
```
