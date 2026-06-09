# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## 项目简介

一个简单的 Node.js AI Agent CLI，集成智谱AI (ZhipuAI) API。支持多轮对话和函数调用（工具使用），为模型提供文件操作、联网搜索和 Skill 激活能力，所有文件操作限制在沙盒工作目录内。

## 常用命令

- **运行 Agent**: `node index.mjs` 或 `npm start`
- **安装依赖**: `npm install`（仅使用 `dotenv`）
- 无构建步骤、无测试套件、无 lint 配置。

## 架构

单文件架构（`index.mjs`），使用 Node.js ESM 模块。

### 核心流程

1. **配置加载** — 通过 `dotenv/config` 从 `.env` 读取：`API_KEY`、`MODEL`、`API_URL`、`WORK_DIR`、`SYSTEM_PROMPT`、`TAVILY_API_KEY`
2. **Skill 加载** — 启动时解析 `skills/*.md` 文件（YAML frontmatter + 正文），加载到内存
3. **对话循环** — REPL 读取用户输入，发送到智谱AI API，处理多轮 `tool_calls` 循环直到 `finish_reason === "stop"`
4. **工具执行** — 模型返回 `tool_calls` 时，逐个执行并将结果追加为 `role: "tool"` 消息
5. **Skill Prompt 注入** — 调用 `activate_skill` 时，将 skill 的 prompt 动态注入到系统消息中

### 安全模型

- `safePath()` 将所有路径解析到 `WORK_DIR`（默认为当前工作目录）下，拒绝任何逃逸沙盒的路径遍历
- 文件操作（`list_files`、`read_file`、`write_file`、`delete_file`）均限制在此沙盒内

### 提供给模型的工具

| 工具 | 用途 |
|------|------|
| `list_files` | 列出沙盒内目录内容 |
| `read_file` | 读取沙盒内文件内容 |
| `write_file` | 创建/覆盖文件（自动创建父目录） |
| `delete_file` | 删除沙盒内文件 |
| `web_search` | 通过 Tavily API 联网搜索（需配置 `TAVILY_API_KEY`） |
| `activate_skill` | 按 name 激活一个 skill，将其 prompt 注入系统消息 |

### Skill 系统

Skill 是 `skills/` 目录下的 Markdown 文件，包含 YAML frontmatter（`name`、`description`、`keywords`）和 prompt 正文。工作流程：

1. `loadSkills()` 读取 `skills/` 下所有 `.md` 文件，解析 frontmatter 和正文
2. `buildSkillCatalog()` 将 skill 描述追加到系统 prompt，让模型知道有哪些可用 skill
3. 模型调用 `activate_skill` 时，匹配的 skill prompt 通过 `activeSkillPrompt` 注入到 `messages[0].content`（系统消息）
4. 每轮新用户输入会重置 `activeSkillPrompt`，即 skill 作用域为当前轮次

### API 集成

使用原生 `fetch`（无 SDK）调用智谱AI 的 OpenAI 兼容接口。请求格式遵循 OpenAI chat completions 规范，通过 `tools` 参数实现函数调用。

## 关键设计决策

- **无 SDK 依赖** — 直接使用 `fetch` 调用，智谱AI API 足够兼容 OpenAI 格式
- **纯 ESM** — `package.json` 中 `"type": "module"`，全程使用 `import` 语法
- **动态系统 prompt** — 每轮对话重建系统消息，以整合当前激活的 skill
- **同步文件操作** — 使用 `*Sync` 的 fs 方法，简化单线程 REPL 的实现
- **调试输出** — 对话循环中会打印完整的消息数组和模型响应（`[发送模型]`、`[模型回复]`）

## 环境变量（.env）

| 变量 | 默认值 | 说明 |
|------|--------|------|
| `API_KEY` | （必填） | 智谱AI API Key |
| `MODEL` | `glm-4-flash` | 使用的模型名称 |
| `API_URL` | （必填） | Chat completions 接口地址 |
| `WORK_DIR` | `cwd` | 文件操作沙盒目录 |
| `SYSTEM_PROMPT` | `"你是一个有帮助的AI助手。"` | Agent 系统提示词 |
| `TAVILY_API_KEY` | （无） | Tavily API Key，用于联网搜索 |
