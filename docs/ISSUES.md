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

## 六、扩容抽样规则（先注册，后抽题）

原 10 条的分母太小（5/10 与 4/10 只差一条），因此把主问题扩到 **30 条**。
**下面的规则在看到新增样本的结果之前写定**，任何人按此规则都能复现同一批题。

| 项 | 规则 |
|---|---|
| 新增配额 | `longbook_qa_chn` 10、`passkey` 2、`number_string` 2、`kv_retrieval` 2、`longbook_qa_eng` 2、`code_debug` 2（与原 10 条的任务族比例一致，×2） |
| 入选条件 | 基线 `gpt-6-sol` / v3 的 `score = 0`（即基线确实失败的样本），且 sample_id 未被原 10 条占用 |
| 排序 | 同任务内按 `sample_id` 数值升序，取前 N 个 |
| 编号 | `IB-11` … `IB-30`，按上表任务顺序连续编号 |
| 失败类型 | 按任务族映射：`longbook_qa_*` → F1、`passkey`/`number_string` → F4、`kv_retrieval` → F6、`code_debug` → F1 |

> 规则的作用是防止“看到结果再换题”。若新增 20 条里修好 ≥5 条，则总数 ≥10/30；若不足，就照实报告，不改抽样。

## 七、扩容样本（按 §六 规则抽取，共 20 条）

| # | 任务 / 样本 | 问题 | 期望 | ctx 字符 |
|---|---|---|---|---|
| IB-11 | `longbook_qa_chn` #19 | 哪一章的主角最后死了？ | 大回 | 28,207 |
| IB-12 | `longbook_qa_chn` #40 | 狄仁杰的复仇计划有亲自动手吗？ | 否 / 不是 | 233,284 |
| IB-13 | `longbook_qa_chn` #62 | 陈晋毅的父亲在陈晋毅多少岁时死的？ | 25 / 二十五 | 521,940 |
| IB-14 | `longbook_qa_chn` #71 | 袁国洋的第二个师父是谁？ | 梅英道人 | 535,468 |
| IB-15 | `longbook_qa_chn` #91 | 秉文总共有多少个二爷？ | 2 / 两 / 二 | 1,822,870 |
| IB-16 | `longbook_qa_chn` #104 | 请问有多少个人当过皇帝？ | 4 / 四 / 四个 / 4个 | 1,729,011 |
| IB-17 | `longbook_qa_chn` #106 | 姬象穿越过几次？ | 一 / 1 | 1,729,011 |
| IB-18 | `longbook_qa_chn` #122 | 最后, 公司给王贵平的赔偿费是多少 | 十万 | 1,139,536 |
| IB-19 | `longbook_qa_chn` #125 | 淑妃和她的孙女在哪里最后一次见面？ | 木屋 / 临时驻地 / 临时驻地的木屋 | 6,556,639 |
| IB-20 | `longbook_qa_chn` #143 | 唐三一共花了多少费用拍下狐尾舍利和“迟缓之石” | 8000元素币 / 八千元素币 | 2,870,020 |
| IB-21 | `passkey` #291 | What is the pass key? | 57654 | 469,858 |
| IB-22 | `passkey` #295 | What is the pass key? | 82368 | 469,858 |
| IB-23 | `number_string` #292 | What is the sequence of digits? | 4511111822 | 469,888 |
| IB-24 | `number_string` #303 | What is the sequence of digits? | 6664444889 | 469,888 |
| IB-25 | `kv_retrieval` #149 | Key: "e84c3080-45f6-4c50-9487-fd2be08bff23" The v… | 81c74316-6ce3-4dbc-… | 200,011 |
| IB-26 | `kv_retrieval` #153 | Key: "b4911b8d-634d-49b2-92e0-c9c5d201857e" The v… | 17ee2cbf-d011-4fdb-… | 200,011 |
| IB-27 | `longbook_qa_eng` #2 | What's the name of the Bronwyns' summer home? | the Hebrides | 381,748 |
| IB-28 | `longbook_qa_eng` #43 | What happens to Viola after his date with Skylar … | Chong Hwa | 380,419 |
| IB-29 | `code_debug` #63 | Which funtion has deliberate error? | Input._do_read | 693,285 |
| IB-30 | `code_debug` #340 | Which funtion has deliberate error? | RemoteLink.moveIntf | 476,780 |
