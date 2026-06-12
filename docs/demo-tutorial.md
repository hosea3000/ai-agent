# AI Agent 渐进式开发 — Demo 1~4 实战

基于 [simple-agent](../) 项目，通过 4 个 Demo 逐步构建一个完整的 AI Agent。

```
Demo 1: 基础对话      →  能和模型聊天               (~60 行)
Demo 2: 工具调用      →  模型可以操作文件、搜索网页    (~130 行)
Demo 3: Skill 系统    →  通过 Prompt 模块化扩展能力   (~170 行)
Demo 4: Plan 模式     →  复杂任务先制定计划再逐步执行   (~210 行)
```

---

## Demo 1 — 基础对话

**目标**：实现最基本的"能和模型聊天"的 Agent。

**运行**：`node demo/demo1/index.mjs`

### 完整代码

```javascript
import "dotenv/config";
import { createInterface } from "node:readline";

// ── 配置 ──────────────────────────────────────────────────
const API_KEY = process.env.API_KEY;
const MODEL = process.env.MODEL || "glm-4-flash";
const API_URL = process.env.API_URL;

// ── 调用大模型 ────────────────────────────────────────────
async function chat(messages) {
  const res = await fetch(API_URL, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      Authorization: `Bearer ${API_KEY}`,
    },
    body: JSON.stringify({ model: MODEL, messages }),
  });
  return await res.json();
}

// ── 主循环 ────────────────────────────────────────────────
const rl = createInterface({ input: process.stdin, output: process.stdout });
const prompt = (q) => new Promise((r) => rl.question(q, r));

async function main() {
  const messages = [
    { role: "system", content: "你是一个有帮助的AI助手。" },
  ];

  console.log("🤖 基础 Agent 已启动，输入 exit 退出\n");

  while (true) {
    const input = (await prompt("你: ")).trim();
    if (!input || input === "exit") break;

    messages.push({ role: "user", content: input });

    const data = await chat(messages);
    const reply = data.choices[0].message;
    console.log(`\n🤖 ${reply.content}\n`);
    messages.push(reply);  // 保留上下文，支持多轮对话
  }

  rl.close();
  console.log("再见！");
}

main();
```

### 核心概念

1. **`chat(messages)`** — 用 `fetch` 调用智谱AI 的 OpenAI 兼容接口，发送消息数组
2. **`messages` 数组** — 持续累积用户和助手的消息，实现多轮对话
3. **`readline` + `while(true)`** — REPL 循环，逐行等待用户输入

**要点**：这是所有 Agent 的起点 —— 先让模型"能说话"，后面的 Demo 都是在此基础上做加法。

---

## Demo 2 — 工具调用

**目标**：让模型从"只能说话"进化为"能做事"，通过 Function Calling 调用工具。

**运行**：`node demo/demo2/index.mjs`

### 相比 Demo 1 新增了什么

```
Demo 1                      Demo 2
┌──────────────┐            ┌──────────────┐
│ fetch 调用API │            │ fetch 调用API │
│ messages     │  +tools    │ messages     │
│ while 循环   │ ────────→  │ while × 2    │  ← 嵌套循环
│              │            │ executeTool  │  ← 工具执行器
│              │            │ safePath     │  ← 沙盒安全
│              │            │ tools 定义    │  ← JSON Schema
└──────────────┘            └──────────────┘
```

### 新增 1：工具定义

用 JSON Schema 告诉模型有哪些工具可用：

```javascript
const tools = [
  {
    type: "function",
    function: {
      name: "write_file",
      description: "写入文件内容，不存在则创建",
      parameters: {
        type: "object",
        properties: {
          path: { type: "string", description: "文件路径" },
          content: { type: "string", description: "文件内容" },
        },
        required: ["path", "content"],
      },
    },
  },
  // list_files, read_file, delete_file, web_search ...
];
```

**要点**：`description` 是模型理解工具用途的唯一依据，务必写清楚。

### 新增 2：沙盒安全

```javascript
function safePath(p) {
  const abs = resolve(WORK_DIR, p);
  if (!abs.startsWith(WORK_DIR)) throw new Error(`无权访问: ${p}`);
  return abs;
}
```

所有文件操作经过 `safePath()` 处理，防止路径遍历攻击。

### 新增 3：工具执行调度器

```javascript
async function executeTool(name, args) {
  switch (name) {
    case "write_file": {
      const p = safePath(args.path);
      mkdirSync(join(p, ".."), { recursive: true });
      writeFileSync(p, args.content, "utf-8");
      return `已写入: ${args.path}`;
    }
    case "web_search": { /* 调用 Tavily API */ }
    // ...
  }
}
```

**要点**：工具出错时返回错误信息而非抛异常，让模型有机会自我纠正。

### 新增 4：tool_calls 循环（核心！）

```javascript
messages.push({ role: "user", content: input });

// 内层循环：处理模型的工具调用链
while (true) {
  const data = await chat(messages);
  const choice = data.choices[0];
  messages.push(choice.message);

  // 模型认为任务完成
  if (choice.finish_reason === "stop") {
    console.log(`\n🤖 ${choice.message.content}\n`);
    break;
  }

  // 模型要调用工具 → 执行 → 结果加入消息 → 继续循环
  if (choice.finish_reason === "tool_calls") {
    for (const tc of choice.message.tool_calls) {
      const args = JSON.parse(tc.function.arguments);
      const result = await executeTool(tc.function.name, args);
      messages.push({ role: "tool", tool_call_id: tc.id, content: result });
    }
  }
}
```

**运行效果**：

```
你: 帮我创建一个 hello.txt 文件，内容写 Hello World

  🔧 调用: write_file({"path":"hello.txt","content":"Hello World"})
  📤 结果: 已写入: hello.txt

🤖 已帮你创建 hello.txt，内容为 "Hello World"。
```

**要点**：
- `finish_reason === "tool_calls"` 时不退出循环，执行工具后把结果追加到消息历史
- 模型可以连续调用任意多次工具，循环退出的唯一条件是 `finish_reason === "stop"`
- `tool_call_id` 必须严格对应，模型靠它匹配请求和结果

---

## Demo 3 — Skill 系统

**目标**：通过 Prompt 模板模块化扩展 Agent 能力，无需修改核心代码。

**运行**：`node demo/demo3/index.mjs`

### 相比 Demo 2 新增了什么

```
Demo 2                      Demo 3
┌──────────────┐            ┌──────────────┐
│ fetch 调用API │            │ fetch 调用API │
│ messages     │  +skills   │ messages     │
│ while × 2    │ ────────→  │ while × 2    │
│ executeTool  │            │ executeTool  │
│ tools 定义   │            │ tools 定义   │
│ safePath     │            │ safePath     │
│              │            │ loadSkills   │  ← Skill 加载
│              │            │ 动态 Prompt  │  ← 系统消息动态构建
│              │            │ activate_skill│  ← Skill 激活工具
└──────────────┘            └──────────────┘
```

### 新增 1：Skill 文件

`skills/` 目录下的 Markdown 文件，YAML frontmatter + Prompt 正文：

```markdown
---
name: translator
description: 专业翻译专家
keywords: 翻译,translate
---
你现在是专业翻译专家模式。请严格遵循以下规则：
1. 自动识别输入文本的语言
2. 翻译时保持原文的语气和风格
```

### 新增 2：Skill 加载

启动时解析 skills 目录：

```javascript
function loadSkills() {
  return readdirSync(SKILLS_DIR)
    .filter((f) => f.endsWith(".md"))
    .map((f) => {
      const raw = readFileSync(join(SKILLS_DIR, f), "utf-8");
      const match = raw.match(/^---\n([\s\S]*?)\n---\n([\s\S]*)$/);
      // 返回 { name, description, keywords, prompt }
    });
}
```

### 新增 3：动态 System Prompt

每轮对话重建系统消息，注入当前激活的 Skill：

```javascript
let activeSkillPrompt = "";

// 每轮对话重建系统消息
const dynamicSystem = systemContent + activeSkillPrompt;
messages[0] = { role: "system", content: dynamicSystem };
```

当模型调用 `activate_skill` 工具时，对应 Skill 的 Prompt 被注入：

```javascript
case "activate_skill": {
  const skill = skills.find((s) => s.name === args.name);
  activeSkillPrompt = `\n\n## 当前激活的 Skill: ${skill.name}\n${skill.prompt}`;
  return `已激活 skill "${skill.name}"`;
}
```

**运行效果**：

```
你: 帮我把这段话翻译成英文：今天天气不错

  🔧 调用: activate_skill({"name":"translator"})
  ✨ 已激活 Skill: translator — 专业翻译专家

🤖 The weather is nice today.
```

**要点**：
- Skill 不是代码，而是 **Prompt 模板** —— 通过注入到系统消息来改变模型行为
- 新增 Skill 只需添加一个 `.md` 文件，零代码改动
- 每轮新用户输入时重置 Skill 状态，避免跨轮次泄漏

---

## Demo 4 — Plan 模式

**目标**：让 Agent 遇到复杂任务时，先制定计划，再逐步执行，实时展示进度。

**运行**：`node demo/demo4/index.mjs`

### 相比 Demo 2 新增了什么

```
Demo 2                      Demo 4
┌──────────────┐            ┌──────────────┐
│ fetch 调用API │            │ fetch 调用API │
│ messages     │  +plan     │ messages     │
│ while × 2    │ ────────→  │ while × 2    │
│ executeTool  │            │ executeTool  │
│ tools 定义   │            │ tools 定义   │
│ safePath     │            │ safePath     │
│              │            │ plan 管理    │  ← 计划状态
│              │            │ printPlan    │  ← 进度展示
│              │            │ create_plan  │  ← 创建计划工具
│              │            │ update_plan  │  ← 更新进度工具
│              │            │ Plan Prompt  │  ← 系统提示词增强
└──────────────┘            └──────────────┘
```

### 新增 1：两个计划工具

```javascript
// 创建计划 — 模型将复杂任务拆解为步骤
{
  name: "create_plan",
  description: "为复杂任务创建一个分步执行计划。当任务需要多个步骤时使用。",
  parameters: {
    title: "计划标题",
    steps: ["步骤1", "步骤2", "步骤3"]  // 字符串数组
  }
}

// 更新进度 — 模型每开始/完成一步时调用
{
  name: "update_plan",
  description: "更新计划中某个步骤的状态或内容。每开始或完成一个步骤时调用。",
  parameters: {
    step_index: 1,         // 步骤序号（从1开始）
    status: "doing|done",  // doing=进行中, done=已完成
    description: "..."     // 可选，修改步骤描述
  }
}
```

### 新增 2：计划状态管理 + 实时进度展示

```javascript
let plan = null;

function printPlan() {
  if (!plan) return;
  console.log(`\n📋 计划: ${plan.title}`);
  plan.steps.forEach((s, i) => {
    const icon = s.status === "done" ? "✅" : s.status === "doing" ? "⏳" : "⬜";
    console.log(`  ${icon} ${i + 1}. ${s.description}`);
  });
  console.log();
}
```

工具执行中的实现：

```javascript
case "create_plan": {
  plan = {
    title: args.title,
    steps: args.steps.map((desc) => ({ description: desc, status: "pending" })),
  };
  printPlan();
  return `计划已创建，共 ${plan.steps.length} 个步骤。请按顺序执行。`;
}

case "update_plan": {
  const idx = args.step_index - 1;
  plan.steps[idx].status = args.status;
  if (args.description) plan.steps[idx].description = args.description;
  printPlan();
  return `步骤 ${args.step_index} 状态已更新为 ${args.status}`;
}
```

### 新增 3：增强系统 Prompt

```
## 工作模式：Plan & Execute

当用户提出复杂任务（需要多个步骤才能完成）时，你必须遵循以下流程：

1. 先制定计划 — 调用 create_plan，将任务拆解为清晰的步骤
2. 逐步执行 — 每开始一步调用 update_plan 标记为 doing，然后使用工具完成
3. 更新进度 — 完成一步后立即调用 update_plan 标记为 done
4. 最终总结 — 所有步骤完成后，给用户一个总结

注意：简单的问答可以直接回答，无需创建计划。
```

### 运行效果

```
你: 帮我创建一个网页项目，包含 HTML、CSS、JS 三个文件

  🔧 调用: create_plan({"title":"创建网页项目","steps":["创建 index.html","创建 style.css","创建 app.js"]})

📋 计划: 创建网页项目
  ⬜ 1. 创建 index.html
  ⬜ 2. 创建 style.css
  ⬜ 3. 创建 app.js

  🔧 调用: update_plan({"step_index":1,"status":"doing"})

📋 计划: 创建网页项目
  ⏳ 1. 创建 index.html
  ⬜ 2. 创建 style.css
  ⬜ 3. 创建 app.js

  🔧 调用: write_file({"path":"index.html","content":"<!DOCTYPE html>..."})

  🔧 调用: update_plan({"step_index":1,"status":"done"})

📋 计划: 创建网页项目
  ✅ 1. 创建 index.html
  ⬜ 2. 创建 style.css
  ⬜ 3. 创建 app.js

  ... (重复直到所有步骤完成)

🤖 网页项目已创建完成！包含 index.html、style.css 和 app.js 三个文件。
```

**要点**：
- Plan 模式的本质是通过 **工具 + 系统提示词** 引导模型的行为模式
- 模型自己决定何时创建计划、何时更新进度 —— 程序只提供工具和展示
- 简单问答直接回答，只有复杂任务才走计划流程

---

## 运行所有 Demo

```bash
# 确保在项目根目录，已配置 .env
node demo/demo1/index.mjs   # 基础对话
node demo/demo2/index.mjs   # 工具调用
node demo/demo3/index.mjs   # Skill 系统
node demo/demo4/index.mjs   # Plan 模式
```
