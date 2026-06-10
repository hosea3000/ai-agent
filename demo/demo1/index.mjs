import "dotenv/config";
import { createInterface } from "node:readline";

// ── 配置 ──────────────────────────────────────────────────
const API_KEY = process.env.API_KEY;
const MODEL = process.env.MODEL || "glm-4-flash";
const API_URL = process.env.API_URL;

if (!API_KEY || !API_URL) {
  console.error("请在 .env 中配置 API_KEY 和 API_URL");
  process.exit(1);
}

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

  if (!res.ok) {
    const text = await res.text();
    throw new Error(`API 请求失败 (${res.status}): ${text}`);
  }

  return await res.json();
}

// ── 读取用户输入 ──────────────────────────────────────────
const rl = createInterface({ input: process.stdin, output: process.stdout });
const prompt = (q) => new Promise((r) => rl.question(q, r));

// ── 主循环 ────────────────────────────────────────────────
async function main() {
  const messages = [
    { role: "system", content: "你是一个有帮助的AI助手。" },
  ];
  console.log("🤖 基础 Agent 已启动，输入消息开始对话，输入 exit 退出\n");

  while (true) {

    const input = await prompt("你: ");
    if (input.trim() === "exit") {
      console.log("再见！");
      rl.close();
      break;
    }
    if (!input.trim()) continue;

    messages.push({ role: "user", content: input });

    try {
      const data = await chat(messages);
      const reply = data.choices[0].message;
      console.log(`\n🤖 ${reply.content}\n`);
      messages.push(reply);
    } catch (err) {
      console.error(`\n❌ ${err.message}\n`);
    }
  }
}

main();
