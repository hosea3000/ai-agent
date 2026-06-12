# AI Agent 开发指南

## 1. 什么是 AI Agent

### 1.1 Agent 与 ChatBot 的区别

普通 ChatBot 的工作方式是 **"你说我答"**：用户提问，模型生成文字回复，结束。模型只能"说话"，不能"做事"。

AI Agent 的核心进化在于 —— **模型不仅能说话，还能行动**。当模型判断需要读取文件、搜索网页、执行代码时，它会主动调用工具（Tool），拿到结果后继续推理，直到完成任务。

```
ChatBot:  用户 → 模型 → 文字回复（结束）
Agent:    用户 → 模型 → 调用工具 → 拿到结果 → 继续推理 → ... → 文字回复（结束）
```

打个比方：ChatBot 像一个只能打电话的客服，你问他问题他只能口头回答；Agent 像一个有手有脚的助手，不仅能回答你，还能帮你查资料、写文档、操作电脑。

### 1.2 Agent 的核心循环

Agent 的运行过程可以概括为一个经典循环：

```
感知（接收用户输入）
  → 推理（模型决定下一步做什么）
  → 行动（调用工具 / 生成回复）
  → 观察（获取工具返回结果）
  → 再次推理...
```

这就是 **ReAct（Reasoning + Acting）模式** —— 来源于 2022 年的论文《ReAct: Synergizing Reasoning and Acting in Language Models》。它是目前绝大多数 Agent 的基础工作模式。

### 1.3 Agent 的能力分层

```
Level 0: 纯对话       — ChatBot，只能文字问答
Level 1: 工具调用     — Agent，能调用外部工具完成任务
Level 2: 规划执行     — Plan Agent，能拆解复杂任务、按计划执行
Level 3: 自主迭代     — 能自我反思、纠正错误、调整策略
Level 4: 多 Agent 协作 — 多个 Agent 分工合作完成复杂项目
```

---

## 3. Agent 核心技术

### 3.1 函数调用（Function Calling / Tool Use）

模型本身不能直接操作文件系统或网络，它只能输出文本。**函数调用机制**让模型能"告诉"程序它想调用什么工具、传什么参数。

#### 工作原理

```
1. 开发者定义工具列表（名称、描述、参数格式）
2. 将工具列表随对话一起发送给模型
3. 模型决定是否需要调用工具
4. 如果需要，模型输出结构化的工具调用请求（JSON）
5. 程序执行对应工具，将结果返回给模型
6. 模型拿到结果后继续推理
```

#### 工具定义格式

使用 JSON Schema 描述每个工具：

```javascript
{
  type: "function",
  function: {
    name: "write_file",                    // 工具名称
    description: "写入文件内容，不存在则创建",  // 描述（模型靠这个决定何时调用）
    parameters: {                           // 参数（JSON Schema 格式）
      type: "object",
      properties: {
        path: { type: "string", description: "文件路径" },
        content: { type: "string", description: "文件内容" },
      },
      required: ["path", "content"],
    },
  },
}
```

**关键要点**：
- `description` 非常重要 —— 模型完全依赖描述来理解工具用途和决定调用时机
- `parameters` 使用 JSON Schema 格式，模型据此生成合法的参数 JSON
- `required` 告诉模型哪些参数是必须的

#### 工具执行调度

收到模型的工具调用请求后，需要一个调度器执行对应工具：

```javascript
async function executeTool(name, args) {
  switch (name) {
    case "list_files":  { /* 列出目录内容 */ }
    case "read_file":   { /* 读取文件 */ }
    case "write_file":  { /* 写入文件 */ }
    case "delete_file": { /* 删除文件 */ }
    case "web_search":  { /* 调用搜索 API */ }
    default:
      return `未知工具: ${name}`;
  }
}
```

**关键要点**：
- 统一的错误处理 —— 工具执行出错时不中断循环，而是把错误信息作为结果返回给模型
- 模型收到错误后可以自我纠正（比如换个参数重试）

### 3.2 多轮工具调用循环

这是 Agent 最本质的特征。模型可能需要连续调用多个工具才能完成一个任务。

```
用户: "帮我查天气并写入文件"

模型 → 调用 web_search("今天天气")     ← 第1次工具调用
模型 ← 搜索结果: "北京晴，25°C"
模型 → 调用 write_file("weather.txt")  ← 第2次工具调用
模型 ← 写入结果: "已写入"
模型 → 回复用户: "已帮你查好天气并写入文件"  ← stop，循环结束
```

实现上是一个嵌套循环：

```javascript
// 外层循环：等待用户输入
while (true) {
  const input = await prompt("你: ");
  messages.push({ role: "user", content: input });

  // 内层循环：处理工具调用链
  while (true) {
    const data = await chat(messages);
    const choice = data.choices[0];
    messages.push(choice.message);

    if (choice.finish_reason === "stop") {
      // 模型认为任务完成，输出回复
      console.log(choice.message.content);
      break;  // 退出内层循环，等待用户下一轮输入
    }

    if (choice.finish_reason === "tool_calls") {
      // 模型要调用工具 → 执行 → 结果加入消息 → 继续循环
      for (const tc of choice.message.tool_calls) {
        const result = await executeTool(tc.function.name, args);
        messages.push({ role: "tool", tool_call_id: tc.id, content: result });
      }
    }
  }
}
```

**循环退出的唯一条件**是模型返回 `finish_reason === "stop"`。

### 3.3 消息历史管理

Agent 需要维护完整的对话上下文，包括四种角色的消息：

```
system    → 系统提示词（定义 Agent 的行为和规则）
user      → 用户输入
assistant → 模型的回复或工具调用请求
tool      → 工具执行结果（带 tool_call_id 关联到具体调用）
```

一个完整的工具调用交互：

```javascript
const messages = [
  { role: "system", content: "你是一个有帮助的AI助手" },
  { role: "user", content: "帮我查天气" },
  { role: "assistant", tool_calls: [{
    function: { name: "web_search", arguments: '{"query":"今天天气"}' },
    id: "call_xxx"
  }] },
  { role: "tool", tool_call_id: "call_xxx", content: "北京今天晴，25°C..." },
  { role: "assistant", content: "北京今天天气晴朗，气温25°C。" },
];
```

**关键要点**：
- 每次请求都发送完整的 `messages` 数组 —— 模型需要看到完整历史才能做正确决策
- `tool` 消息的 `tool_call_id` 必须与 `assistant` 消息中的 `tool_calls[].id` 严格对应
- 随着对话增长，需要考虑 token 限制（截断、摘要等策略）

### 3.4 系统提示词（System Prompt）

System Prompt 是控制 Agent 行为的核心手段。它决定了 Agent 的工作模式、行为边界和输出风格。

#### 基础用法

```javascript
{ role: "system", content: "你是一个有帮助的AI助手，可以使用工具来完成任务。" }
```

#### 动态 Prompt

Agent 的系统提示词不是固定的，而是每轮对话动态构建：

```javascript
// 基础 prompt + 工具使用指引 + 当前激活的能力模块
const dynamicSystem = basePrompt + skillPrompt;
messages[0] = { role: "system", content: dynamicSystem };
```

#### Prompt 即能力

通过修改系统提示词可以改变 Agent 的行为模式：

| Prompt 设计 | Agent 行为 |
|-------------|-----------|
| "先制定计划再执行" | Plan 模式，拆解步骤 |
| "你是代码专家" | 聚焦代码生成和调试 |
| "每次只做一个步骤" | 控制执行粒度 |
| "不确定时先搜索" | 引导使用搜索工具 |

**关键要点**：Prompt 是 Agent 开发中性价比最高的调优手段 —— 不需要改代码，只需调整提示词就能显著改变 Agent 的行为。

### 3.5 沙盒安全机制

Agent 能操作文件系统是一个强大但危险的能力。必须做安全隔离。

```javascript
const WORK_DIR = resolve(process.env.WORK_DIR || process.cwd());

function safePath(p) {
  const abs = resolve(WORK_DIR, p);
  if (!abs.startsWith(WORK_DIR)) throw new Error(`无权访问: ${p}`);
  return abs;
}
```

所有文件操作都经过 `safePath()` 处理：
- 先把相对路径解析为绝对路径
- 检查是否在 `WORK_DIR` 范围内
- 拒绝 `../../etc/passwd` 这类路径遍历攻击

**核心原则**：永远不要让模型直接操作真实文件系统，而是在受限的沙盒中操作。

---

## 4. Agent 核心设计模式

### 4.1 ReAct 模式

最常见的 Agent 模式，模型交替进行推理（Reasoning）和行动（Acting）：

```
用户: 北京和上海今天哪个更热？

思考: 需要查询两个城市的天气 → 调用 web_search("北京今天天气")
观察: 北京 28°C
思考: 还需要上海的天气 → 调用 web_search("上海今天天气")
观察: 上海 32°C
思考: 两个结果都有了，可以回答 → 上海更热，32°C > 28°C
```

### 4.2 Plan & Execute 模式

处理复杂任务时，先制定计划再逐步执行：

```
用户: 帮我创建一个完整的网页项目

1. 制定计划:
   - 创建 index.html
   - 创建 style.css
   - 创建 app.js
   - 验证文件结构

2. 逐步执行:
   ⏳ 创建 index.html → ✅
   ⏳ 创建 style.css → ✅
   ⏳ 创建 app.js → ✅
   ⏳ 验证文件结构 → ✅

3. 总结完成
```

**实现要点**：
- 新增 `create_plan` 和 `update_plan` 两个工具
- 通过系统 Prompt 引导模型先计划后执行
- 用状态管理（pending/doing/done）跟踪进度并实时展示

### 4.3 Skill / Plugin 模式

通过 Prompt 模板模块化扩展 Agent 能力：

```
skills/
  translator.md   → 翻译专家
  coder.md        → 代码助手
  writer.md       → 写作助手
```

每个 Skill 是一个 Markdown 文件，包含 YAML 元信息和 Prompt 正文。模型根据用户请求自动匹配并激活对应 Skill，无需修改核心代码。

### 4.4 多 Agent 协作模式

将复杂任务拆分给多个专业 Agent 协作完成：

```
用户: "开发一个 Todo 应用"

Planner Agent  → 制定开发计划
Coder Agent    → 编写代码
Reviewer Agent → 审查代码质量
Tester Agent   → 测试功能
```

每个 Agent 有独立的 System Prompt 和工具集，通过消息传递协作。

---

## 5. Agent 开发要点

### 5.1 工具设计原则

| 原则 | 说明 |
|------|------|
| **描述清晰** | 工具的 `description` 是模型唯一的信息来源，务必写清楚功能和使用场景 |
| **参数简洁** | 参数越少越好，复杂参数用 JSON Schema 约束 |
| **结果可读** | 工具返回的结果要精炼、结构化，方便模型理解和决策 |
| **错误可恢复** | 工具出错时返回错误信息而非抛异常，让模型有机会自我纠正 |
| **职责单一** | 每个工具只做一件事，让模型自由组合 |

### 5.2 Prompt 工程技巧

1. **明确工作模式** — 告诉模型"先计划再执行"或"逐步思考"
2. **约束行为边界** — 明确什么该做什么不该做
3. **提供示例** — 在 Prompt 中给出期望的输入输出示例
4. **动态注入** — 根据上下文动态修改系统 Prompt（如激活 Skill、注入计划状态）
5. **错误自愈引导** — 告诉模型遇到错误时如何处理

### 5.3 安全与可靠性

- **沙盒隔离** — 所有文件操作限制在指定目录内
- **输入校验** — 对模型生成的参数做基本校验
- **错误兜底** — 工具执行出错时不中断循环，返回错误信息让模型处理
- **权限最小化** — 只给模型完成任务所需的最小权限
- **人工确认** — 危险操作（如删除文件）可以要求人工确认

### 5.4 性能优化

- **控制消息长度** — 对话过长时截断或摘要，避免 token 超限
- **并行工具调用** — 模型一次返回多个 tool_calls 时可并行执行
- **流式输出** — 支持 SSE 流式响应，提升用户体验
- **缓存** — 对重复的 API 调用做缓存

---

## 6. API 调用模式

本项目的 API 调用基于智谱AI的 OpenAI 兼容接口，这也是行业主流格式：

```javascript
const res = await fetch(API_URL, {
  method: "POST",
  headers: {
    "Content-Type": "application/json",
    Authorization: `Bearer ${API_KEY}`,
  },
  body: JSON.stringify({
    model: MODEL,           // 模型名称
    messages: messages,     // 完整对话历史
    tools: tools,           // 可用工具列表
  }),
});
```

响应中的关键字段：

```javascript
const data = await res.json();
const choice = data.choices[0];

choice.finish_reason          // "stop" = 回复完成 | "tool_calls" = 要调用工具
choice.message.content        // 模型的文字回复（stop 时）
choice.message.tool_calls     // 工具调用请求列表（tool_calls 时）
```

**要点**：
- `tools` 参数在每次请求中都发送 —— 模型需要看到可用工具才能决定调用哪个
- 这种格式是行业标准，OpenAI、智谱、通义千问、DeepSeek 等主流 API 都支持

---

## 7. 延伸学习方向

1. **多 Agent 协作** — 多个 Agent 分工合作，如"规划 Agent + 执行 Agent + 审查 Agent"
2. **记忆系统** — 短期记忆（对话历史）+ 长期记忆（向量数据库/知识图谱）
3. **流式输出** — SSE / WebSocket 逐字输出，提升用户体验
4. **Token 管理** — 自动截断、摘要、滑动窗口，避免超出上下文限制
5. **多模态** — 图片、音频、视频输入，让 Agent 能"看"和"听"
6. **RAG（检索增强生成）** — 让 Agent 能查询企业知识库后再回答
7. **Agent 框架** — LangChain、LangGraph、CrewAI 等框架的设计理念和适用场景
8. **评估与测试** — 如何评估 Agent 的表现，自动化测试 Agent 行为
