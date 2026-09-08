# DeepSeek Chat Desktop

一款 Windows 桌面 AI 貼心聊天软件，基于 Electron + React 构建，接入 [DeepSeek API](https://api-docs.deepseek.com)。像和朋友聊天一样与 AI 交流：斗图、发图、创作剧本，全部数据保存在本地。

## ✨ 功能特性

- **流式对话** — 打字机式实时输出，可随时中断生成
- **思考模式** — 展示 AI 思维链（可开关、可调节思考强度），正文与思考过程分开渲染
- **视觉理解** — 粘贴 / 拖拽 / 截图发图片，自动压缩后走视觉模型识别
- **表情包斗图** — 内置一套小鳄鱼表情包，AI 会根据情绪在回复里自动配表情；表情包语义标注由视觉模型离线生成
- **剧本创作模式** 🎬 — 内置短剧编剧方法论，按阶段推进创作，支持一键导出 Markdown
- **用户记忆** — 昵称 + 个人说明写入系统提示词，AI 稳定"认识"你（纯本地存储）
- **Markdown 渲染** — 支持表格、代码块等 GFM 语法
- **多会话管理** — 普通聊天与剧本项目分会话存放

## 🔐 隐私与安全

- **API Key 本地加密存储**：使用 Electron `safeStorage`（Windows DPAPI / 系统凭证管理）加密保存，绝不随代码或请求日志外泄
- 聊天记录、用户资料、设备 ID 全部保存在本机 `userData` 目录，不上传任何服务器（API 请求仅发往 DeepSeek 官方端点）
- 设备 ID 仅用于多设备共用同一 API Key 时区分请求来源

## 🚀 快速开始

### 准备工作

1. 安装 [Node.js](https://nodejs.org/) 18+
2. 在 [DeepSeek 开放平台](https://platform.deepseek.com/api_keys) 获取 API Key（软件内设置页填入即可）

### 开发运行

```bash
npm install
npm run dev
```

`npm run dev` 会同时启动 Vite 开发服务器（5173 端口）与 Electron 主进程。

### 构建安装包

```bash
# 构建 Windows NSIS 安装程序（输出到 dist-electron/）
npm run dist
```

## 🏗️ 技术栈

| 层 | 技术 |
| --- | --- |
| 桌面框架 | Electron 28 |
| 前端 | React 18 + Vite 5 |
| 渲染 | react-markdown + remark-gfm |
| 存储 | electron-store 思路的自研 `store.js`（safeStorage 加密） |
| API | DeepSeek Chat Completions（OpenAI 兼容格式） |

### 目录结构

```
├── electron/            # 主进程
│   ├── main.js          # 窗口与 IPC
│   ├── deepseek.js      # DeepSeek 流式 API 客户端
│   ├── store.js         # 设置存储（safeStorage 加密）
│   ├── preload.js       # 预加载桥接
│   └── analyze-stickers.js  # 表情包语义标注脚本（离线一次性）
├── src/                 # 渲染进程
│   ├── App.jsx          # 主界面
│   ├── dramaPrompts.js  # 剧本创作提示词
│   ├── stickers.js      # 表情包库
│   └── assets/stickers/ # 表情包图片 + annotations.json
└── build/               # 应用图标
```

## 📝 表情包标注（可选）

为新增表情包重新生成语义标注：

```bash
ANALYZE_STICKERS=1 npx electron .
```

需先在设置中配置 API Key，结果写回 `src/assets/stickers/annotations.json`。

## ⚠️ 免责声明

本项目为个人学习项目，与 DeepSeek 官方无关。使用本项目产生的 API 费用由用户自行承担。内置表情包来自网络，版权归原作者所有，仅作学习演示用途。

## 📄 License

[MIT](./LICENSE)
