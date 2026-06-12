import "dotenv/config";
import { createInterface } from "node:readline";
import {
  readFileSync,
  writeFileSync,
  readdirSync,
  statSync,
  mkdirSync,
  unlinkSync,
} from "node:fs";
import { join, resolve } from "node:path";

// ── 配置 ──────────────────────────────────────────────────
const API_KEY = process.env.API_KEY;
const MODEL = process.env.MODEL || "glm-4-flash";
const API_URL = process.env.API_URL;
const TAVILY_API_KEY = process.env.TAVILY_API_KEY;
const WORK_DIR = resolve(process.env.WORK_DIR || process.cwd());

if (!API_KEY || !API_URL) {
  console.error("请在 .env 中配置 API_KEY 和 API_URL");
  process.exit(1);
}

// ── 路径安全 ──────────────────────────────────────────────
function safePath(p) {
  const abs = resolve(WORK_DIR, p);
  if (!abs.startsWith(WORK_DIR)) throw new Error(`无权访问: ${p}`);
  return abs;
}

// ── 计划状态管理 ──────────────────────────────────────────
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

// ── 系统提示词 ────────────────────────────────────────────
const SYSTEM_PROMPT = `你是一个有帮助的AI助手，可以使用工具来完成任务。

## 工作模式：Plan & Execute

当用户提出复杂任务（需要多个步骤才能完成）时，你必须遵循以下流程：

1. **先制定计划** — 调用 create_plan 工具，将任务拆解为清晰的步骤
2. **逐步执行** — 按计划顺序，每开始一步就调用 update_plan 标记为 doing，然后使用文件/搜索等工具完成该步骤
3. **更新进度** — 完成一步后立即调用 update_plan 标记为 done
4. **最终总结** — 所有步骤完成后，给用户一个总结

注意事项：
- 每次只执行一个步骤，不要一次调用多个步骤的工具
- 如果执行中发现计划需要调整，可以随时更新步骤内容
- 简单的问答（不需要文件操作或多步处理）可以直接回答，无需创建计划`;

// ── 工具定义 ──────────────────────────────────────────────
const tools = [
  {
    type: "function",
    function: {
      name: "create_plan",
      description: "为复杂任务创建一个分步执行计划。当任务需要多个步骤时使用。",
      parameters: {
        type: "object",
        properties: {
          title: { type: "string", description: "计划标题" },
          steps: {
            type: "array",
            items: { type: "string" },
            description: "执行步骤列表，按顺序排列",
          },
        },
        required: ["title", "steps"],
      },
    },
  },
  {
    type: "function",
    function: {
      name: "update_plan",
      description: "更新计划中某个步骤的状态或内容。每开始或完成一个步骤时调用。",
      parameters: {
        type: "object",
        properties: {
          step_index: { type: "number", description: "步骤序号（从 1 开始）" },
          status: {
            type: "string",
            enum: ["doing", "done"],
            description: "doing=开始执行, done=已完成",
          },
          description: { type: "string", description: "可选，修改步骤描述" },
        },
        required: ["step_index", "status"],
      },
    },
  },
  {
    type: "function",
    function: {
      name: "list_files",
      description: "列出指定目录下的文件和文件夹",
      parameters: {
        type: "object",
        properties: { path: { type: "string", description: "目录路径，默认为当前目录" } },
      },
    },
  },
  {
    type: "function",
    function: {
      name: "read_file",
      description: "读取文件内容",
      parameters: {
        type: "object",
        properties: { path: { type: "string", description: "文件路径" } },
        required: ["path"],
      },
    },
  },
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
  {
    type: "function",
    function: {
      name: "delete_file",
      description: "删除文件",
      parameters: {
        type: "object",
        properties: { path: { type: "string", description: "文件路径" } },
        required: ["path"],
      },
    },
  },
  {
    type: "function",
    function: {
      name: "web_search",
      description: "联网搜索，返回与查询相关的网页摘要",
      parameters: {
        type: "object",
        properties: { query: { type: "string", description: "搜索关键词" } },
        required: ["query"],
      },
    },
  },
];

// ── 工具执行 ──────────────────────────────────────────────
async function executeTool(name, args) {
  switch (name) {
    case "create_plan": {
      plan = {
        title: args.title,
        steps: args.steps.map((desc) => ({ description: desc, status: "pending" })),
      };
      printPlan();
      return `计划已创建，共 ${plan.steps.length} 个步骤。请按顺序执行。`;
    }
    case "update_plan": {
      if (!plan) return "错误：当前没有计划";
      const idx = args.step_index - 1;
      if (idx < 0 || idx >= plan.steps.length) return `错误：步骤 ${args.step_index} 不存在`;
      plan.steps[idx].status = args.status;
      if (args.description) plan.steps[idx].description = args.description;
      printPlan();
      return `步骤 ${args.step_index} 状态已更新为 ${args.status}`;
    }
    case "list_files": {
      const dir = safePath(args.path || ".");
      const items = readdirSync(dir).map((n) => {
        const s = statSync(join(dir, n));
        return `${s.isDirectory() ? "📁" : "📄"} ${n}`;
      });
      return items.join("\n") || "(空目录)";
    }
    case "read_file":
      return readFileSync(safePath(args.path), "utf-8");
    case "write_file": {
      const p = safePath(args.path);
      mkdirSync(join(p, ".."), { recursive: true });
      writeFileSync(p, args.content, "utf-8");
      return `已写入: ${args.path}`;
    }
    case "delete_file":
      unlinkSync(safePath(args.path));
      return `已删除: ${args.path}`;
    case "web_search": {
      if (!TAVILY_API_KEY) return "错误: 未配置 TAVILY_API_KEY";
      const res = await fetch("https://api.tavily.com/search", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          api_key: TAVILY_API_KEY,
          query: args.query,
          search_depth: "basic",
          max_results: 5,
        }),
      });
      if (!res.ok) return `搜索失败: ${res.status} ${await res.text()}`;
      const data = await res.json();
      return data.results
        .map((r) => `【${r.title}】\n${r.url}\n${r.content}`)
        .join("\n\n");
    }
    default:
      return `未知工具: ${name}`;
  }
}

// ── 调用大模型 ────────────────────────────────────────────
async function chat(messages) {
  console.log(`\n[发送模型] ${JSON.stringify(messages)}\n`);
  const res = await fetch(API_URL, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      Authorization: `Bearer ${API_KEY}`,
    },
    body: JSON.stringify({ model: MODEL, messages, tools }),
  });
  if (!res.ok) throw new Error(`API error: ${res.status} ${await res.text()}`);
  const data = await res.json();
  console.log(`\n[模型回复] ${JSON.stringify(data.choices)}\n`);
  return data;
}

// ── 主循环 ────────────────────────────────────────────────
const rl = createInterface({ input: process.stdin, output: process.stdout });
const prompt = (q) => new Promise((r) => rl.question(q, r));

async function main() {
  const messages = [{ role: "system", content: SYSTEM_PROMPT }];

  console.log(`🤖 Plan Agent 已启动 (模型: ${MODEL} | 工作目录: ${WORK_DIR})`);
  console.log("输入消息开始对话，输入 exit 退出\n");

  while (true) {
    const input = (await prompt("你: ")).trim();
    if (!input || input === "exit") break;

    // 新一轮对话重置计划
    plan = null;
    messages.push({ role: "user", content: input });

    // tool_calls 循环
    while (true) {
      const data = await chat(messages);
      const choice = data.choices[0];
      const msg = choice.message;
      messages.push(msg);

      if (choice.finish_reason === "stop") {
        console.log(`\n🤖 ${msg.content}\n`);
        break;
      }

      if (choice.finish_reason === "tool_calls") {
        for (const tc of msg.tool_calls) {
          const args = JSON.parse(tc.function.arguments);
          console.log(`  🔧 调用: ${tc.function.name}(${JSON.stringify(args)})`);

          let result;
          try {
            result = await executeTool(tc.function.name, args);
          } catch (e) {
            result = `错误: ${e.message}`;
          }

          console.log(`  📤 结果: ${result.slice(0, 200)}${result.length > 200 ? "..." : ""}`);
          messages.push({ role: "tool", tool_call_id: tc.id, content: result });
        }
      }
    }
  }

  rl.close();
  console.log("\n再见！");
}

main();
