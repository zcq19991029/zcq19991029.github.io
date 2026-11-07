# 刷题 · 项目专属规则

> 这份只管「刷题」这一个工具。跨项目通用的规矩在 `claude项目/CLAUDE.md`，
> 华夏工具合集共用的（库 id、账号表、权限函数）在 `华夏工具/CLAUDE.md`。
> 判断标准：换个工具读这条还成立吗？不成立 → 就该写在这份里。

## 题库导入：一律进用户自己的账号

用户原话（2026-11-07）：「你直接帮我搬完不就行了 **我以后让你导入题目你就导入我的账号**
我寻思除了你别人也弄不到内置题库 这个按钮不多余吗」。

用户说「导入这套题 / 导入这本书前五章的练习题」时，**产物直接进他自己的开发者账号**，
不要让他自己上页面点按钮，也不要只丢一份 JSON 让他手动导。

### 写进哪张表、什么范围

| 用户想要 | 怎么做 |
|---|---|
| 给学生刷 | `quiz_publish(p_id, p_name, p_questions, p_owner_name, p_classes, p_teachers)` → `quiz_public` 表 |
| 全部学生可见 | `p_classes = null` |
| 只自己刷 | `p_classes = '{}'`（空数组，不是 null！null 等于全校可见） |
| 只发给某几个班 | `p_classes = [班级id...]`，只能是自己教的班 |
| **发给某几位老师** | `p_teachers = [老师uuid...]`，**`p_classes` 必须同时传 `'{}'`** |
| 老师把收到的题再发给自己班 | 老师在自己页面点「转发」→ `quiz_forward(p_id, p_new_name, p_owner_name, p_classes)` |

**「发给老师」的硬规矩（2026-11-08 用户定）**：给了老师名单却把 `p_classes` 传 `null`，
数据库会直接报错拒绝 —— 不允许「本来只想给某个老师，结果悄悄变成全校可见」。
老师收到之后是**复制**（新题库 id `f-xxxxxxxx`，服务端 `gen_random_uuid()` 生成），原文不动，各自可改、各自排位。
只改老师名单用 `quiz_set_teachers(p_id, p_teachers)`；若原题库是「全部学生可见」，它会报错要求先把学生范围收起来。

- `owner` 固定是开发者账号 **`4791fc22-50b8-418b-94d4-c0635db2ea44`**
  （⚠️ 2026-11-08 更正：以前这份文档和项目记忆里一直误写成 `479ffc22-…`，差一个字符。
  真值以 `select user_id from public.hx_profiles where is_dev = true` 为准）
- `owner_name` 用他当前的显示名（`夜夜开发者` / `夜夜`），**不要让数据库自己猜**——
  猜出来是邮箱前缀 `phh4j926xq`（2026-11-08 实测踩过，见下）
- 一次最多 5000 题、3MB（`quiz_public_size` 约束）

### `id` 不许随便起（这条最要命）

`wiring` / `mcu` / `psychology` / `education` 这四个 id 被下面两个表绑死：

- `quiz_rank_hits.bank`
- `quiz_rank_keys.bank`

它们存的就是这四个名字，**1896 题的历史排位成绩按它对账**。改了名字 → 全部成绩对不上，等于作废。

- **新导入的科目：用自己的英文 id**（比如 `dzjs-2026`、`scm-1`），绝不复用这四个
- **给这四套补题：id 保持不变**，只往 `questions` 数组里追加
- id 正则：`^[A-Za-z0-9_-]{1,64}$`

### 本地 `data/*.json` 只是兜底，不是正本

`app.js` 的 `baseOf()` 是「**云端优先、本地兜底**」：登录且云端有 → 读云端；否则读 `data/*.json`。

但有两个打包流程**直接读本地文件**：

- `单片机/theory.cjs` → 读 `刷题/data/mcu.json`
- `考试/build.js` → 同样读 `刷题/data/mcu.json`

所以：

- **改「单片机应用技术」的题 → 云端和 `data/mcu.json` 两边都要改**。
  只改云端 → 网页刷到新版，打出来的理论试卷还是旧版。
- 其余三套（wiring / psychology / education）只改云端即可，没有打包流程依赖它们。

### 导入前必须校验

唯一口径是 `刷题/imports.js` 的 `normalizeQuestions()`（**能在 node 里直接 import 复用**，已实测）。

- `type` 只能是 `single` / `multiple` / `judgment` / `fill` / `short` / `term` / `prog`
- 选择题：必须有 `options`（≥2 个），`answer` 的每个 key 都要在选项里，单选只能 1 个答案
- 填空题：题干里必须有 `____` 表示空位，否则学生没地方填
- 程序分析题（`prog`）：要有 `code` + `sub`（小问数组）+ `answer[0]`（参考答案 ≤2000 字）
- 简答题参考答案 ≤1200 字（太长了多半是把原文整段搬过来）
- 同一套题 `id` 不许重复

**不合格的题不要塞进去**——宁可少几题，也不要让学生刷到错题。被拒的条目要连
「第几条 + 题干前几个字 + 为什么不行」一起列给用户。

### 入库后必须报数

- 这套题一共几题、按题型各几题
- `quiz_public` 里查到的 `total` 是多少
- `target_classes` 是什么范围

**数字对不上就是没成功**，不要说「应该好了」。

### 交接给另一边的会话时，必须多带这三样（2026-11-07 Claude 主动要求）

用户会在 Claude 和 WorkBuddy 之间来回交接同一批活。光给「校验过的 JSON + SQL」不够，要加：

1. **每题的来源**（原文件名 + 页码/章节）——出问题能回查是哪一页看错了；
2. **不合格题清单单独一份**，不要混在要入库的数据里；
3. **一条核验查询**，比如：
   ```sql
   select type, count(*) from jsonb_array_elements(
     (select questions from public.quiz_public where id = '<科目id>')
   ) t group by type order by 1;
   ```
   对方拿去执行后直接对数字，不用自己现编。

## 分享码（2026-11-08）

- 表 `quiz_share`，函数 `quiz_share_create` / `quiz_share_get` / `quiz_share_list` / `quiz_share_del`
- 6 位码，字母表 `ABCDEFGHJKMNPQRSTUVWXYZ23456789`（去掉 I L O 0 1，避免看错）
- **署名必须由前端传**（`p_owner_name` 第 4 参）：
  一开始让数据库自己猜，先查 `hx_students`（老师/开发者不在学生名单里，查不到），
  再退到 `auth.jwt()->>'email'` 前缀 —— 结果开发者账号的署名变成 `phh4j926xq`。
  现在前端传 `hx.name(S.user, S.me)`，和全站头像、班级列表同一个来源。
- 取码（`quiz_share_get`）对 `anon` 开放——朋友可能还没登录
- 生成码限制：每人同时最多 20 个、一份最多 5000 题、有效期 1～365 天

## 口诀 / 提要求（`q.spec`）

- 存的是**给 AI 的要求**（祈使句），**不是**学生看到的成品文案。
  用户原话：「口诀是相当于给 skills 给 ai 解析回答内容的规范约束…**而不是我们写进去** 不同 api 回复还不固定呢」
- 形状：`q.spec = { items: [祈使句 1..5], words: 原话备份, at: 时间戳 }`
- 点「✦ AI 逐项解析」时，`items.join('；')` 作为 `explainQuestion` 第 5 参拼进提示词
- **要求不能推翻准确性**：提示词里有兜底句「要求与准确性冲突时，先保证准确，
  再在最后一行写『与老师要求不一致：原因』」
- 整理函数：`ai.js` 的 `parseStudySpec()`（返回 `{read, items, ask}`）
- 老字段 `q.study`（卡片文案）保留兼容，不砸旧数据，但新数据不再写它
