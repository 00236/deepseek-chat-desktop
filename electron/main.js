const { app, BrowserWindow, ipcMain, dialog } = require('electron');
const path = require('path');
const fs = require('fs');
const Store = require('./store');
const { streamChat, abortChat } = require('./deepseek');
const { readFilePayloads, FILE_FILTERS } = require('./files');

const isDev = process.env.DEV === 'true';

let mainWindow;
// 全局持有当前活跃的流式请求 AbortController，便于中断
let currentAbortController = null;

function createWindow() {
  mainWindow = new BrowserWindow({
    width: 1100,
    height: 720,
    minWidth: 880,
    minHeight: 600,
    title: 'DeepSeek Chat',
    backgroundColor: '#f5f6f7',
    webPreferences: {
      preload: path.join(__dirname, 'preload.js'),
      contextIsolation: true,
      nodeIntegration: false
    }
  });

  if (isDev) {
    mainWindow.loadURL('http://localhost:5173');
    mainWindow.webContents.openDevTools();
  } else {
    mainWindow.loadFile(path.join(__dirname, '..', 'dist', 'index.html'));
  }
}

app.whenReady().then(async () => {
  // 始终开启辅助功能树（屏幕阅读器 / 自动化工具可稳定读取界面）
  app.setAccessibilitySupportEnabled(true);
  // 离线模式：批量标注表情包语义（ANALYZE_STICKERS=1），不创建窗口
  if (process.env.ANALYZE_STICKERS === '1') {
    try {
      await require('./analyze-stickers').main();
    } catch (e) {
      console.error('[analyze] 运行失败：', e);
    }
    app.quit();
    return;
  }
  createWindow();
  app.on('activate', () => {
    if (BrowserWindow.getAllWindows().length === 0) createWindow();
  });
});

app.on('window-all-closed', () => {
  if (process.platform !== 'darwin') app.quit();
});

/* ============ IPC: 设置（API Key 等） ============ */
ipcMain.handle('settings:get', async () => {
  return Store.getSettings();
});

/* ============ IPC: 设备信息（多设备共用 Key 的隔离标识） ============ */
ipcMain.handle('app:getDeviceId', async () => {
  return Store.getDeviceId();
});

ipcMain.handle('settings:set', async (_event, partial) => {
  Store.setSettings(partial);
  return Store.getSettings();
});

/* ============ IPC: 流式聊天 ============ */
// 参数：{ messages, settings }
// 通过 mainWindow.webContents.send 推送增量 token
ipcMain.handle('chat:stream', async (event, payload) => {
  const { messages, model } = payload;
  const settings = Store.getSettings();
  if (!settings.apiKey) {
    return { ok: false, error: '未配置 API Key，请先在设置中填入 DeepSeek API Key。' };
  }

  currentAbortController = new AbortController();

  try {
    await streamChat({
      apiKey: settings.apiKey,
      baseUrl: settings.baseUrl,
      // payload.model 可覆盖默认模型（含图片时前端传 visionModel）
      model: model || settings.model,
      messages,
      deviceId: Store.getDeviceId(),
      signal: currentAbortController.signal,
      thinking: settings.thinking !== false, // 默认开启思考模式
      reasoningEffort: settings.reasoningEffort,
      onDelta: (delta) => {
        event.sender.send('chat:delta', delta);
      },
      onReasoning: (delta) => {
        event.sender.send('chat:reasoning', delta);
      },
      onDone: (full) => {
        event.sender.send('chat:done', full);
      },
      onError: (err) => {
        event.sender.send('chat:error', err);
      }
    });
    return { ok: true };
  } catch (e) {
    return { ok: false, error: e.message };
  } finally {
    currentAbortController = null;
  }
});

ipcMain.handle('chat:abort', async () => {
  if (currentAbortController) {
    currentAbortController.abort();
    currentAbortController = null;
  }
  return { ok: true };
});

/* ============ IPC: 附件文件（文档 / 图片） ============ */
// 弹出系统选择框，返回解析后的附件 payload 数组
ipcMain.handle('files:pick', async () => {
  const result = await dialog.showOpenDialog(mainWindow, {
    title: '上传文件（文档 / 图片）',
    buttonLabel: '添加',
    properties: ['openFile', 'multiSelections'],
    filters: FILE_FILTERS
  });
  if (result.canceled || !result.filePaths?.length) return [];
  return readFilePayloads(result.filePaths);
});

// 按路径读取（拖拽文件时渲染进程拿到的是本地路径）
ipcMain.handle('files:read', (_event, paths) => {
  return readFilePayloads(Array.isArray(paths) ? paths.filter((p) => typeof p === 'string') : []);
});

/* ============ IPC: 导出剧本为 Markdown 文件 ============ */
ipcMain.handle('export:markdown', async (_event, { title, content }) => {
  const result = await dialog.showSaveDialog(mainWindow, {
    title: '导出剧本',
    defaultPath: path.join(app.getPath('documents'), `${title || '剧本'}.md`),
    filters: [{ name: 'Markdown', extensions: ['md'] }, { name: '文本文件', extensions: ['txt'] }]
  });
  if (result.canceled || !result.filePath) return { ok: false, canceled: true };
  try {
    fs.writeFileSync(result.filePath, content, 'utf8');
    return { ok: true, path: result.filePath };
  } catch (e) {
    return { ok: false, error: e.message };
  }
});
