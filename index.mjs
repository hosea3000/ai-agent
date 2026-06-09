import "dotenv/config";
import { createInterface } from "node:readline";
import {
  readFileSync,
  writeFileSync,
  readdirSync,
  statSync,
  mkdirSync,
  unlinkSync,
  existsSync,
} from "node:fs";
import { join, resolve } from "node:path";

const API_KEY = process.env.API_KEY;
const MODEL = process.env.MODEL || "glm-4-flash";
const API_URL = process.env.API_URL;
const SYSTEM_PROMPT = process.env.SYSTEM_PROMPT || "你是一个有帮助的AI助手。";
const TAVILY_API_KEY = process.env.TAVILY_API_KEY;

const WORK_DIR = resolve(process.env.WORK_DIR || process.cwd());
const SKILLS_DIR = resolve(process.cwd(), "skills");

function safePath(p) {
  const abs = resolve(WORK_DIR, p);
  if (!abs.startsWith(WORK_DIR)) throw new Error(`无权访问: ${p}`);
  return abs;
}

// ── Skill 加载 ──────────────────────────────────────────────

function loadSkills() {
  if (!existsSync(SKILLS_DIR)) return [];
  return readdirSync(SKILLS_DIR)
    .filter((f) => f.endsWith(".md"))
    .map((f) => {
      const raw = readFileSync(join(SKILLS_DIR, f), "utf-8");
      const match = raw.match(/^---\n([\s\S]*?)\n---\n([\s\S]*)$/);
      if (!match) return null;
      const meta = {};
      match[1].split("\n").forEach((line) => {
        const [k, ...v] = line.split(":");
        if (k && v.length) meta[k.trim()] = v.join(":").trim();
      });
      return {
        name: meta.name || f.replace(".md", ""),
        description: meta.description || "",
        keywords: (meta.keywords || "").split(",").map((s) => s.trim()).filter(Boolean),
        prompt: match[2].trim(),
      };
    })
    .filter(Boolean);
}

const skills = loadSkills();

function buildSkillCatalog() {
  if (!skills.length) return "";
  const items = skills.map(
    (s) => `- ${s.name}: ${s.description} (关键词: ${s.keywords.join(", ")})`
  );
  return [
    "\n\n## 可用 Skills",
    "当用户的请求与以下某个 skill 匹配时，你必须调用 activate_skill 工具激活对应 skill，然后按 skill 指令回答：\n",
    items.join("\n"),
  ].join("\n");
}

let activeSkillPrompt = "";

// ── 工具定义 ────────────────────────────────────────────────

const tools = [
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
  {
    type: "function",
    function: {
      name: "activate_skill",
      description:
        "激活一个 skill。当用户请求匹配某个 skill 的关键词或描述时调用此工具。只需调用一次，后续回复将自动遵循该 skill 的指令。",
      parameters: {
        type: "object",
        properties: {
          name: {
            type: "string",
            description: `要激活的 skill 名称，可选: ${skills.map((s) => s.name).join(", ")}`,
            enum: skills.map((s) => s.name),
          },
        },
        required: ["name"],
      },
    },
  },
];

// ── 工具执行 ────────────────────────────────────────────────

async function executeTool(name, args) {
  switch (name) {
    case "list_files": {
      const dir = safePath(args.path || ".");
      const items = readdirSync(dir).map((n) => {
        const s = statSync(join(dir, n));
        return `${s.isDirectory() ? "📁" : "📄"} ${n}`;
      });
      return items.join("\n") || "(空目录)";
    }
    case "read_file": {
      return readFileSync(safePath(args.path), "utf-8");
    }
    case "write_file": {
      const p = safePath(args.path);
      mkdirSync(join(p, ".."), { recursive: true });
      writeFileSync(p, args.content, "utf-8");
      return `已写入: ${args.path}`;
    }
    case "delete_file": {
      unlinkSync(safePath(args.path));
      return `已删除: ${args.path}`;
    }
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
    case "activate_skill": {
      const skill = skills.find((s) => s.name === args.name);
      if (!skill) return `未知 skill: ${args.name}`;
      activeSkillPrompt = `\n\n## 当前激活的 Skill: ${skill.name}\n${skill.prompt}`;
      console.log(`\n  ✨ 已激活 Skill: ${skill.name} — ${skill.description}\n`);
      return `已激活 skill "${skill.name}"，请按照该 skill 的指令来回答用户。`;
    }
    default:
      return `未知工具: ${name}`;
  }
}

// ── 主循环 ──────────────────────────────────────────────────

const rl = createInterface({ input: process.stdin, output: process.stdout });
const question = (prompt) => new Promise((r) => rl.question(prompt, r));

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

async function main() {
  const systemContent = SYSTEM_PROMPT + buildSkillCatalog();
  const messages = [{ role: "system", content: systemContent }];

  console.log(`模型: ${MODEL} | 工作目录: ${WORK_DIR} | Skills: ${skills.map((s) => s.name).join(", ")}`);
  console.log(`输入 exit 退出\n`);

  while (true) {
    const input = (await question("你: ")).trim();
    if (!input || input === "exit") break;

    // 新一轮对话重置 skill
    activeSkillPrompt = "";
    messages.push({ role: "user", content: input });

    while (true) {
      // 动态注入当前激活的 skill prompt
      const dynamicSystem = systemContent + activeSkillPrompt;
      messages[0] = { role: "system", content: dynamicSystem };

      const data = await chat(messages);
      const firstChoice = data.choices[0];
      const msg = firstChoice.message;
      messages.push(msg);

      if (firstChoice.finish_reason === "stop") {
        console.log(`\nAI: ${msg.content}\n`);
        break;
      }

      if (firstChoice.finish_reason === "tool_calls") {
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
