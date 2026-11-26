# 问题清单（10 条主问题 + 2 条对照组）

> 数据源：`data/issues.jsonl`，由 `pnpm orchestrate --check-issues` 从 InfiniteBench 原始 jsonl 三方对账后生成。
> 基线：`gpt-6-sol` / prompt v3 的已存输出（`infinitebench-data-audit/out/api/gpt-6-sol/v3/`），未重跑。

## 一、失败类型

| 类型 | 含义 |
|---|---|
| F1 定位失败 | 答案所在段落没有被检索到，或读到了但没抽出来 |
| F3 格式不符 | 答案内容对，但带了多余解释/单位，违反输出契约 |
| F4 读到但没输出 | 证据在上下文里，模型仍答“未提供/没有” |
| F6 生成截断 | 答案串不完整（少字符），生成提前停止 |
| 对照组 | 答案正确或指标失真，不修，用于证明“不是所有失败都该修” |

## 二、主问题

| # | 任务 / 样本 | 问题 | 期望 | ctx 字符 | 基线输出 | 基线分 | 类型 |
|---|---|---|---|---|---|---|---|
| IB-01 | `longbook_qa_chn` #79 | 文中的主角可以任意改变时间线, 请问故事的时间线是否只有5条？ | 否 | 3,859,199 | 不是，故事中有多次时间线重启，远不止5条。 | 0 | F1 |
| IB-02 | `longbook_qa_chn` #76 | 文中姓夏的角色一共有几个？ | 五 / 5 | 3,859,199 | 0个 | 0 | F1 |
| IB-03 | `longbook_qa_chn` #137 | 中森明菜和木村宏是什么关系 | 情侣 | 2,234,380 | 夫妻关系。 | 0 | F1 |
| IB-04 | `longbook_qa_chn` #136 | 木宏村如何重新开始一个新的人生 | 喝醉 | 2,234,380 | 木村宏重生为1983年的十七岁美少年后，戒掉放纵的生活，改变造型，凭借歌唱才华… | 0 | F1 |
| IB-05 | `longbook_qa_chn` #112 | 李波罗有多少个女儿？ | 0 / 零 / 无 / 没有 | 2,149,235 | 一个。 | 0 | F1 |
| IB-06 | `passkey` #270 | What is the pass key? | 99700 | 469,858 | Not provided. | 0 | F4 |
| IB-07 | `number_string` #277 | What is the sequence of digits? | 3333995555 | 469,888 | No digits. | 0 | F4 |
| IB-08 | `kv_retrieval` #9 | Key: "2fdab9e3-7247-4844-9f8d-e42175eafef2" The value associated wit… | a3fa5e4c-705c-4fad-bb48-b37a21f437cc | 200,011 | a3fa5e4c-705c-4fad-bb48-b37a21f437c | 0 | F6 |
| IB-09 | `longbook_qa_eng` #255 | How old is Felicity at the start of his narration? | Thirty | 434,156 | About thirty years old. | 0.4 | F3 |
| IB-10 | `code_debug` #3 | Which funtion has deliberate error? | _init | 807,189 | B | 0 | F1 |

## 三、对照组（不修）

| # | 任务 / 样本 | 问题 | 期望 | ctx 字符 | 基线输出 | 基线分 | 为什么不修 |
|---|---|---|---|---|---|---|---|
| CF-01 | `longbook_qa_eng` #71 | What Is The Name Of Theresa Brent’s Mother? | The name of Theresa Brent’s mother is A… | 968,742 | Alannys Harlaw | 0.4 | 答案正确、只是没复述整句 → 判分误杀，不修 |
| CF-02 | `longbook_sum_eng` #1 | The summary of the book is: | The novel is fragmented into stream-of-… | 381,748 | When Mr Bronwyn declares that bad weath… | 0.1284848484848485 | ROUGE 与人工负相关 → 指标问题，不修 |

## 四、对账时发现的三处差异（以数据为准）

1. **IB-10 的 gold 不是两个值**：数据里只有 `["_init"]`，方案表写的“_init（+ 选项 A）”不准确——选项 A 在 `options` 数组里，不在 `answer` 里。
2. **IB-06 / IB-07 不是同一份 context**：ctx 长度差 30 字符（469,858 vs 469,888），指纹不同，需各读一次。
3. **IB-01 / IB-02 共用同一份 3.86M 全文**，IB-03 / IB-04 共用同一份 2.23M 全文——按 context 指纹去重后，5 条中文 QA 只需处理 3 份全文。

## 五、判分口径的两个坑（对照组的价值）

- **CF-01**：gold 是整句 `The name of Theresa Brent’s mother is Alannys Harlaw`，基线只答 `Alannys Harlaw`——人名对、但没复述整句，指标判 0。这是**抽取规则误杀**，不是能力问题。
- **CF-02**：摘要任务用 ROUGE，基线写了 627 字摘要、gold 更长，ROUGE 与人工判断负相关。这是**指标问题**。

> 这两条决定了本任务的对照必须给“官方分 + 语义对错”两列，否则会把判分错误算成模型错误。
