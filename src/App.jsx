import { useEffect, useState, useCallback, useRef } from 'react';
import ReactMarkdown from 'react-markdown';
import remarkGfm from 'remark-gfm';
import {
  GENRES, AUDIENCES, TONES, ENDINGS, EPISODE_OPTIONS,
  STAGES, DRAMA_SYSTEM_PROMPT, buildStageInstruction
} from './dramaPrompts';
import {
  STICKER_LIBRARY, STICKER_TAGS, findStickerByTag,
  AI_AVATAR, USER_AVATAR, MASCOT_CHAT, MASCOT_DRAMA
} from './stickers';

const MODEL_OPTIONS = [
  { value: 'deepseek-v4-flash', label: 'deepseek-v4-flash (快速·推荐)' },
  { value: 'deepseek-v4-pro', label: 'deepseek-v4-pro (高性能推理)' }
];

const VISION_MODEL_OPTIONS = [
  { value: 'deepseek-v4-flash-vision-exp', label: 'deepseek-v4-flash-vision-exp (视觉·实验版)' }
];

// 图片压缩：缩放到最长边 maxDim，输出 jpeg
// 避免过大 base64 撑爆 API 请求
function compressImage(dataUrl, maxDim = 1568, quality = 0.85) {
  return new Promise((resolve) => {
    const img = new Image();
    img.onload = () => {
      let { width, height } = img;
      const longest = Math.max(width, height);
      if (longest > maxDim) {
        const scale = maxDim / longest;
        width = Math.round(width * scale);
        height = Math.round(height * scale);
      }
      const canvas = document.createElement('canvas');
      canvas.width = width;
      canvas.height = height;
      const ctx = canvas.getContext('2d');
      ctx.drawImage(img, 0, 0, width, height);
      resolve(canvas.toDataURL('image/jpeg', quality));
    };
    img.onerror = () => resolve(dataUrl);
    img.src = dataUrl;
  });
}

// 读取文件为 dataURL
function fileToDataUrl(file) {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => resolve(reader.result);
    reader.onerror = reject;
    reader.readAsDataURL(file);
  });
}

// 字节数格式化（附件展示用）
function fmtSize(bytes) {
  if (!bytes && bytes !== 0) return '';
  if (bytes < 1024) return bytes + ' B';
  if (bytes < 1024 * 1024) return (bytes / 1024).toFixed(1) + ' KB';
  return (bytes / 1024 / 1024).toFixed(1) + ' MB';
}

// 把上传文档组装成附在消息正文后的文本块
function docTextBlock(docs) {
  if (!docs || docs.length === 0) return '';
  return docs
    .map((d) =>
      `\n\n---\n【用户上传的文档：${d.name}】\n${d.text || ''}${d.truncated ? '\n（注：该文档过长，上方内容已截断）' : ''}\n---`
    )
    .join('');
}

// 把消息对象组装成 DeepSeek/OpenAI 兼容的 content
// 含图片的 user 消息用数组格式；其余用字符串
function buildApiMessage(msg, nickname = '') {
  // 上传文档：文本注入消息正文（历史消息同样携带，保证多轮追问时文档内容仍在上下文中）
  const docBlock = docTextBlock(msg.docs);
  const baseText = (msg.content || '') + docBlock;
  if (msg.role === 'user' && msg.images && msg.images.length > 0) {
    const parts = [];
    if (baseText) parts.push({ type: 'text', text: baseText });
    for (const url of msg.images) {
      parts.push({ type: 'image_url', image_url: { url } });
    }
    return { role: msg.role, content: parts };
  }
  // 表情包消息（新版数组格式）：每张表情图 + 语义标签走视觉模型
  if (msg.stickers && msg.stickers.length > 0) {
    const who = nickname ? `你的朋友「${nickname}」` : '你的朋友';
    const tagText = msg.stickers.map((s) => `「${s.tag}」${s.desc ? `（${s.desc}）` : ''}`).join('、');
    const parts = [];
    const intro = msg.content
      ? `${who}说了："${msg.content}"，并配了${msg.stickers.length}个抹茶旦旦表情包（${tagText}）。`
      : `${who}发了${msg.stickers.length}个"抹茶旦旦"表情包（${tagText}），没说话。`;
    parts.push({
      type: 'text',
      text: docBlock
        ? `${intro}同时${who}上传了文档附件（见文末文档内容），请一并处理。像朋友斗图那样自然回应：结合聊天上下文体会TA想表达的情绪，直接接话（口语化、简短），或者回敬表情也行。不要描述图片内容，除非TA明确问图里是什么。你也可以用 [表情:标签] 回敬表情包。${docBlock}`
        : `${intro}像朋友斗图那样自然回应：结合聊天上下文体会TA想表达的情绪，直接接话（口语化、简短），或者回敬表情也行。不要描述图片内容，除非TA明确问图里是什么。你也可以用 [表情:标签] 回敬表情包。`
    });
    for (const s of msg.stickers) {
      parts.push({ type: 'image_url', image_url: { url: s.src } });
    }
    return { role: msg.role, content: parts };
  }
  // 兼容旧版单表情字段
  if (msg.sticker) {
    const who = nickname ? `你的朋友「${nickname}」` : '你的朋友';
    const known = msg.stickerTag
      ? `（这个表情包的预设含义是「${msg.stickerTag}」：${msg.stickerDesc || '—'}）`
      : '';
    return {
      role: msg.role,
      content: [
        {
          type: 'text',
          text: `${who}发来一个"抹茶旦旦"表情包${known}。像朋友之间斗图那样对待它：结合你们正在聊的话题和气氛，体会TA此刻想传达的情绪或言外之意，然后直接自然地接话。口语化、简短，像真人回消息；不要描述图片内容，不要用列表，除非TA明确问你图里是什么。你也可以用 [表情:标签] 回敬一个表情包。${docBlock}`
        },
        { type: 'image_url', image_url: { url: msg.sticker } }
      ]
    };
  }
  return { role: msg.role, content: baseText };
}

/**
 * 构造系统提示词消息组：
 * - 创作模式：短剧编剧方法论
 * - 普通聊天：用户自定义系统提示词
 * - 追加用户身份记忆（昵称 + 个人说明），让 AI 稳定"认识"当前用户
 *   （身份信息纯本地存储，仅随请求发给模型）
 */
function buildSystemMessages(session, settings) {
  const arr = [];
  if (session?.mode === 'drama') {
    arr.push({ role: 'system', content: DRAMA_SYSTEM_PROMPT });
  } else if (settings.systemPrompt) {
    arr.push({ role: 'system', content: settings.systemPrompt });
  } else {
    // 默认人格：轻松自然，避免工具式僵硬回应
    arr.push({
      role: 'system',
      content: '你是一位贴心的聊天伙伴，说话自然口语化、有网感，像朋友一样交流。回应简洁直接，不说教、不过度正式、不堆砌免责声明。用户发表情包时像朋友斗图一样接梗。'
    });
  }
  // 表情包能力目录（非创作模式）：AI 可用 [表情:标签] 发表情
  if (session?.mode !== 'drama' && STICKER_LIBRARY.length) {
    const catalog = STICKER_TAGS
      .map((t) => {
        const one = STICKER_LIBRARY.find((s) => s.tag === t);
        return `${t}（${one.desc}）`;
      })
      .join('、');
    arr.push({
      role: 'system',
      content: `【你的表情包】你有一套"抹茶旦旦"小鳄鱼表情包，可以像真人一样在回复里用 [表情:标签] 发出来（界面上会直接显示成表情图）。可用标签：${catalog}。使用规则：情绪到了就用（比如被逗笑、无语、想撒娇、鼓励对方、告别时），不必每条都用；可以只发一个表情当回复，也可以夹在文字里；必须从上面的标签里选，不要编造新标签。`
    });
  }
  const identity = [];
  if (settings.nickname) identity.push(`TA的昵称是「${settings.nickname}」`);
  if (settings.userProfile) identity.push(`关于TA：${settings.userProfile}`);
  if (identity.length) {
    arr.push({
      role: 'system',
      content: `【用户信息】你正在和一位朋友聊天，${identity.join('；')}。记住这些信息并在对话中自然运用，让回应贴合TA的说话习惯和喜好，但不要每句话都刻意提起这些信息。`
    });
  }
  return arr;
}

export default function App() {
  // 会话列表（仅在内存中，用户未选择本地持久化）
  const [sessions, setSessions] = useState(() => [createSession()]);
  const [activeId, setActiveId] = useState(() => sessions[0].id);
  const [input, setInput] = useState('');
  const [streaming, setStreaming] = useState(false);
  const [settings, setSettings] = useState(null);
  const [showSettings, setShowSettings] = useState(false);
  const [toast, setToast] = useState(null);
  const [pendingImages, setPendingImages] = useState([]); // 待发送 dataURL
  const [pendingStickers, setPendingStickers] = useState([]); // 待发送表情包（暂存，与文字一起或单独发送）
  const [pendingDocs, setPendingDocs] = useState([]); // 待发送文档附件（主进程已提取文本）
  const [pickingFiles, setPickingFiles] = useState(false); // 附件对话框打开中
  const [dragging, setDragging] = useState(false);
  const [deviceId, setDeviceId] = useState('');
  const messagesEndRef = useRef(null);
  // 用 ref 保存当前活跃会话 id，避免流式回调里的闭包过期
  // （否则新建/切换会话后，AI 增量会写进旧会话，表现为"不回复"）
  const activeIdRef = useRef(activeId);
  // 用户主动点击"停止"时为 true，用于区分"主动中断"与"模型空回复"
  const stopRequestedRef = useRef(false);

  useEffect(() => {
    activeIdRef.current = activeId;
  }, [activeId]);

  // 加载设置 + 设备 ID
  useEffect(() => {
    (async () => {
      const s = await window.electronAPI.settings.get();
      setSettings(s);
      if (!s.apiKey) setShowSettings(true);
      setDeviceId(await window.electronAPI.device.getId());
    })();

    window.electronAPI.chat.onDelta((delta) => appendDeltaToActive(delta));
    window.electronAPI.chat.onReasoning((delta) => appendReasoningToActive(delta));
    window.electronAPI.chat.onDone((full) => {
      setStreaming(false);
      // 清理既无正文也无思考过程的空 assistant 消息
      setSessions((prev) =>
        prev.map((s) => {
          if (s.id !== activeIdRef.current) return s;
          const msgs = s.messages.filter(
            (m) => !(m.role === 'assistant' && !m.content && !m.reasoning)
          );
          return { ...s, messages: msgs };
        })
      );
      // 模型没返回任何正文时给出明确提示（主动中断的情况除外）
      if (String(full || '').trim() === '' && !stopRequestedRef.current) {
        showToast('模型本次没有返回内容，可以再发一次试试', true);
      }
      stopRequestedRef.current = false;
    });
    window.electronAPI.chat.onError((err) => {
      setStreaming(false);
      stopRequestedRef.current = false;
      showToast('出错了：' + err, true);
      // 移除空的流式占位消息，避免留下"（无内容）"的空壳
      // （已输出部分内容的消息保留原样）
      setSessions((prev) =>
        prev.map((s) => {
          if (s.id !== activeIdRef.current) return s;
          const msgs = s.messages.filter(
            (m) => !(m.role === 'assistant' && m.streaming && !m.content)
          );
          return { ...s, messages: msgs };
        })
      );
    });
  }, []);

  // 滚动到底部
  useEffect(() => {
    messagesEndRef.current?.scrollIntoView({ behavior: 'smooth' });
  }, [sessions, activeId]);

  const showToast = useCallback((msg, isError = false) => {
    setToast({ msg, isError });
    setTimeout(() => setToast(null), 3500);
  }, []);

  function createSession(mode = 'chat') {
    return {
      id: Date.now().toString(36) + Math.random().toString(36).slice(2, 6),
      title: mode === 'drama' ? '新剧本项目' : '新对话',
      messages: [],
      createdAt: Date.now(),
      mode,
      // 短剧项目配置（创作模式专用）
      drama: mode === 'drama'
        ? { genre: '霸道总裁', audience: '女频', tone: '爽', episodes: 80, ending: 'HE（好结局）' }
        : null
    };
  }

  function newChat() {
    const s = createSession('chat');
    setSessions((prev) => [s, ...prev]);
    setActiveId(s.id);
    setInput('');
    setPendingImages([]);
    setPendingDocs([]);
  }

  function newDramaProject() {
    const s = createSession('drama');
    setSessions((prev) => [s, ...prev]);
    setActiveId(s.id);
    setInput('');
    setPendingImages([]);
    setPendingDocs([]);
  }

  // 更新当前创作项目的配置（题材/受众/调性/集数/结局）
  function updateDramaConfig(partial) {
    setSessions((prev) =>
      prev.map((s) => (s.id === activeId ? { ...s, drama: { ...s.drama, ...partial } } : s))
    );
  }

  function deleteSession(id) {
    setSessions((prev) => {
      const next = prev.filter((s) => s.id !== id);
      if (next.length === 0) {
        const fresh = createSession();
        setActiveId(fresh.id);
        return [fresh];
      }
      if (id === activeId) setActiveId(next[0].id);
      return next;
    });
  }

  function appendDeltaToActive(delta) {
    // 通过 ref 读取最新活跃会话 id（闭包中的 activeId 是挂载时的旧值）
    const currentId = activeIdRef.current;
    setSessions((prev) =>
      prev.map((s) => {
        if (s.id !== currentId) return s;
        const msgs = [...s.messages];
        const last = msgs[msgs.length - 1];
        if (last && last.role === 'assistant' && last.streaming) {
          msgs[msgs.length - 1] = { ...last, content: last.content + delta };
        }
        return { ...s, messages: msgs };
      })
    );
  }

  // 思维链增量：追加到 assistant 消息的 reasoning 字段
  function appendReasoningToActive(delta) {
    const currentId = activeIdRef.current;
    setSessions((prev) =>
      prev.map((s) => {
        if (s.id !== currentId) return s;
        const msgs = [...s.messages];
        const last = msgs[msgs.length - 1];
        if (last && last.role === 'assistant' && last.streaming) {
          msgs[msgs.length - 1] = {
            ...last,
            reasoning: (last.reasoning || '') + delta
          };
        }
        return { ...s, messages: msgs };
      })
    );
  }

  // ============ 附件处理（图片 + 文档） ============
  // 主进程解析结果 → 分拣进待发送区：图片压缩后进 pendingImages，文档进 pendingDocs
  async function ingestFilePayloads(payloads) {
    let docCount = 0;
    for (const p of payloads || []) {
      if (!p) continue;
      if (p.error) {
        showToast(`「${p.name}」${p.error}`, true);
        continue;
      }
      if (p.kind === 'image' && p.dataUrl) {
        try {
          const compressed = await compressImage(p.dataUrl);
          setPendingImages((prev) => [...prev, compressed]);
        } catch (e) {
          showToast(`图片「${p.name}」处理失败：${e.message}`, true);
        }
      } else if (p.kind === 'doc') {
        setPendingDocs((prev) => [
          ...prev,
          {
            id: Date.now().toString(36) + Math.random().toString(36).slice(2, 6),
            name: p.name,
            text: p.text || '',
            truncated: !!p.truncated,
            size: p.size || 0,
            emptyNote: p.text ? '' : (p.note || '未能提取到文本内容')
          }
        ]);
        docCount++;
      }
    }
    if (docCount > 0) showToast(`已添加 ${docCount} 个文档附件`);
  }

  // 文件选择对话框（📎 按钮）
  async function pickFiles() {
    if (pickingFiles) return;
    setPickingFiles(true);
    try {
      const payloads = await window.electronAPI.files.pick();
      await ingestFilePayloads(payloads);
    } catch (e) {
      showToast('文件选择失败：' + e.message, true);
    } finally {
      setPickingFiles(false);
    }
  }

  // 拖拽 / 粘贴进来的 File 对象
  async function handleFiles(files) {
    const arr = Array.from(files || []);
    if (arr.length === 0) return;
    const paths = [];
    const blobs = [];
    for (const f of arr) {
      // Electron 中来自磁盘的拖拽文件带本地路径；粘贴的截图等是内存 Blob
      if (f.path) paths.push(f.path);
      else blobs.push(f);
    }
    const imageBlobs = blobs.filter((f) => f.type && f.type.startsWith('image/'));
    if (blobs.length > imageBlobs.length) {
      showToast('仅支持拖拽/粘贴图片，文档请用 📎 按钮选择', true);
    }
    if (imageBlobs.length > 0) {
      try {
        const dataUrls = await Promise.all(imageBlobs.map(fileToDataUrl));
        const compressed = await Promise.all(dataUrls.map((u) => compressImage(u)));
        setPendingImages((prev) => [...prev, ...compressed]);
      } catch (e) {
        showToast('图片读取失败：' + e.message, true);
      }
    }
    if (paths.length > 0) {
      try {
        const payloads = await window.electronAPI.files.read(paths);
        await ingestFilePayloads(payloads);
      } catch (e) {
        showToast('文件读取失败：' + e.message, true);
      }
    }
  }

  function removePendingImage(idx) {
    setPendingImages((prev) => prev.filter((_, i) => i !== idx));
  }

  function removePendingDoc(id) {
    setPendingDocs((prev) => prev.filter((d) => d.id !== id));
  }

  function onPaste(e) {
    const items = e.clipboardData?.items;
    if (!items) return;
    const files = [];
    for (const it of items) {
      if (it.kind === 'file') {
        const f = it.getAsFile();
        if (f) files.push(f);
      }
    }
    if (files.length > 0) {
      e.preventDefault();
      handleFiles(files);
    }
  }

  function onDrop(e) {
    e.preventDefault();
    setDragging(false);
    if (e.dataTransfer?.files?.length) handleFiles(e.dataTransfer.files);
  }

  function onDragOver(e) {
    e.preventDefault();
    setDragging(true);
  }

  function onDragLeave(e) {
    e.preventDefault();
    setDragging(false);
  }

  // ============ 发送 ============
  // stageKey 传入时为"阶段指令"发送：注入阶段提示词（界面以紧凑卡片显示，不刷屏）
  // 注意：只有合法的阶段 key 字符串才走阶段分支——避免把鼠标事件等真值误当阶段
  async function sendMessage(stageKey) {
    const validStage =
      typeof stageKey === 'string' && STAGES.some((s) => s.key === stageKey) ? stageKey : '';
    const text = input.trim();
    const hasImages = pendingImages.length > 0;
    const hasStickers = pendingStickers.length > 0;
    const hasDocs = pendingDocs.length > 0;
    if (validStage) {
      if (streaming) return false;
    } else if ((!text && !hasImages && !hasStickers && !hasDocs) || streaming) {
      return false;
    }
    if (!settings?.apiKey) {
      setShowSettings(true);
      showToast('请先在设置中填入 API Key', true);
      return false;
    }

    const targetSessionId = activeId;
    const activeSession = sessions.find((s) => s.id === targetSessionId);

    let content, stage = undefined;
    if (validStage) {
      // 阶段指令 = 阶段提示词模板 + 项目设定 + 用户补充输入
      content = buildStageInstruction(validStage, activeSession?.drama, text);
      stage = validStage;
    } else {
      if (text) {
        content = text;
      } else if (hasStickers && !hasImages && !hasDocs) {
        content = ''; // 纯表情包斗图，无需文字
      } else if (hasDocs && hasImages) {
        content = '请分析附件中的文档和图片。';
      } else if (hasDocs && hasStickers) {
        content = '结合附件文档聊聊。';
      } else if (hasDocs) {
        content = '请阅读附件文档并总结要点。';
      } else {
        content = '请描述这张图片。';
      }
    }

    const images = !stage && hasImages ? [...pendingImages] : undefined;
    const stickers = !stage && hasStickers ? [...pendingStickers] : undefined;
    const docs = !stage && hasDocs ? [...pendingDocs] : undefined;
    const userMsg = { role: 'user', content, images, stickers, docs, stage };
    const aiPlaceholder = { role: 'assistant', content: '', streaming: true };

    setSessions((prev) =>
      prev.map((s) => {
        if (s.id !== targetSessionId) return s;
        const msgs = [...s.messages, userMsg, aiPlaceholder];
        const fallbackTitle = hasStickers
          ? '表情包'
          : hasDocs
            ? `文档：${pendingDocs[0].name}`
            : '识别图片';
        const newTitle =
          s.messages.length === 0
            ? (stage
                ? '剧本项目·' + (s.drama?.genre || '未定题材')
                : (text || fallbackTitle).slice(0, 20) + ((text || fallbackTitle).length > 20 ? '…' : ''))
            : s.title;
        return { ...s, messages: msgs, title: newTitle };
      })
    );

    setInput('');
    setPendingImages([]);
    setPendingStickers([]);
    setPendingDocs([]);
    setStreaming(true);
    stopRequestedRef.current = false;

    // 构造 API messages：系统提示词（含用户身份记忆）
    const apiMessages = buildSystemMessages(activeSession, settings);
    for (const m of activeSession.messages) {
      if (
        m.role &&
        (m.content ||
          (m.images && m.images.length) ||
          m.sticker ||
          (m.stickers && m.stickers.length) ||
          (m.docs && m.docs.length))
      ) {
        apiMessages.push(buildApiMessage(m, settings.nickname));
      }
    }
    apiMessages.push(buildApiMessage(userMsg, settings.nickname));

    // 含图片（本条或历史中的图片/表情包）则统一用视觉模型，避免 image_url 发给纯文本模型报错
    const historyHasVisual = apiMessages.some(
      (m) => Array.isArray(m.content) && m.content.some((p) => p.type === 'image_url')
    );
    const useModel = images || stickers || historyHasVisual ? settings.visionModel : settings.model;

    try {
      const res = await window.electronAPI.chat.stream({
        messages: apiMessages,
        model: useModel
      });
      if (!res.ok) {
        showToast(res.error || '发送失败', true);
        setSessions((prev) =>
          prev.map((s) => {
            if (s.id !== targetSessionId) return s;
            const msgs = s.messages.filter(
              (m) => !(m.role === 'assistant' && m.streaming && !m.content)
            );
            return { ...s, messages: msgs };
          })
        );
      }
    } catch (e) {
      showToast('请求异常：' + e.message, true);
    } finally {
      setSessions((prev) =>
        prev.map((s) => {
          if (s.id !== targetSessionId) return s;
          const msgs = s.messages.map((m) =>
            m.streaming ? { ...m, streaming: false } : m
          );
          return { ...s, messages: msgs };
        })
      );
      setStreaming(false);
    }
    // 返回 true 表示消息已进入发送流程（供 UI 收起表情面板等后续动作判断）
    return true;
  }

  // 表情包暂存：点击表情不立即发送，进入待发送区（可搭配文字一起发送，或直接点发送）
  function addPendingSticker(sticker) {
    if (streaming) return;
    setPendingStickers((prev) =>
      prev.some((s) => s.id === sticker.id) ? prev : [...prev, sticker]
    );
  }

  function removePendingSticker(id) {
    setPendingStickers((prev) => prev.filter((s) => s.id !== id));
  }

  async function stopStreaming() {
    stopRequestedRef.current = true;
    await window.electronAPI.chat.abort();
    setStreaming(false);
    setSessions((prev) =>
      prev.map((s) => {
        if (s.id !== activeId) return s;
        const msgs = s.messages.map((m) =>
          m.streaming ? { ...m, streaming: false } : m
        );
        return { ...s, messages: msgs };
      })
    );
  }

  // 导出当前会话为 Markdown 文件（剧本交付）
  async function exportDrama() {
    const s = sessions.find((x) => x.id === activeId);
    if (!s || s.messages.length === 0) {
      showToast('当前会话没有可导出的内容', true);
      return;
    }
    const lines = [
      `# ${s.title}`,
      '',
      `> 导出时间：${new Date().toLocaleString('zh-CN')}`
    ];
    if (s.drama) {
      lines.push(
        `> 题材：${s.drama.genre} | 受众：${s.drama.audience} | 调性：${s.drama.tone} | 集数：${s.drama.episodes} | 结局：${s.drama.ending}`
      );
    }
    lines.push('', '---', '');
    for (const m of s.messages) {
      if (m.role === 'user') {
        const docNote = m.docs?.length ? `（附件：${m.docs.map((d) => d.name).join('、')}）` : '';
        lines.push(`## 🧑 ${m.stage ? `阶段指令（${STAGES.find((x) => x.key === m.stage)?.label || m.stage}）` : '用户'}${docNote}`, '', m.content, '');
      } else if (m.role === 'assistant' && m.content) {
        lines.push('## 🤖 DeepSeek', '', m.content, '');
      }
    }
    const res = await window.electronAPI.export.markdown({
      title: s.title.replace(/[\\/:*?"<>|]/g, '_'),
      content: lines.join('\n')
    });
    if (res.ok) showToast('已导出：' + res.path);
    else if (!res.canceled) showToast('导出失败：' + (res.error || '未知错误'), true);
  }

  async function saveSettings(partial) {
    const next = await window.electronAPI.settings.set(partial);
    setSettings(next);
    setShowSettings(false);
    showToast('设置已保存');
  }

  function onKeyDown(e) {
    if (e.key === 'Enter' && !e.shiftKey) {
      e.preventDefault();
      sendMessage();
    }
  }

  const activeSession = sessions.find((s) => s.id === activeId);
  const canSend =
    input.trim().length > 0 ||
    pendingImages.length > 0 ||
    pendingStickers.length > 0 ||
    pendingDocs.length > 0;

  return (
    <div className="app">
      <Sidebar
        sessions={sessions}
        activeId={activeId}
        onSelect={setActiveId}
        onNew={newChat}
        onNewDrama={newDramaProject}
        onDelete={deleteSession}
        onOpenSettings={() => setShowSettings(true)}
      />
      <ChatArea
        session={activeSession}
        model={settings?.model}
        input={input}
        setInput={setInput}
        onSend={sendMessage}
        onStop={stopStreaming}
        streaming={streaming}
        onKeyDown={onKeyDown}
        onPaste={onPaste}
        onDrop={onDrop}
        onDragOver={onDragOver}
        onDragLeave={onDragLeave}
        dragging={dragging}
        pendingImages={pendingImages}
        pendingStickers={pendingStickers}
        pendingDocs={pendingDocs}
        pickingFiles={pickingFiles}
        onPickFile={pickFiles}
        onRemoveImage={removePendingImage}
        onRemoveDoc={removePendingDoc}
        onRemoveSticker={removePendingSticker}
        canSend={canSend}
        messagesEndRef={messagesEndRef}
        apiKeyReady={!!settings?.apiKey}
        onOpenSettings={() => setShowSettings(true)}
        onUpdateDrama={updateDramaConfig}
        onExport={exportDrama}
        onAddSticker={addPendingSticker}
      />
      {showSettings && (
        <SettingsModal settings={settings} deviceId={deviceId} onClose={() => setShowSettings(false)} onSave={saveSettings} />
      )}
      {toast && <div className={'toast' + (toast.isError ? ' error' : '')}>{toast.msg}</div>}
    </div>
  );
}

/* ============ 侧边栏 ============ */
function Sidebar({ sessions, activeId, onSelect, onNew, onNewDrama, onDelete, onOpenSettings }) {
  return (
    <aside className="sidebar">
      <div className="sidebar-header">
        <div className="logo">
          <img className="logo-img" src={AI_AVATAR} alt="旦旦" />
          DeepSeek Chat <span className="badge">桌面版</span>
        </div>
      </div>
      <button className="new-chat-btn" onClick={onNew}>+ 新建对话</button>
      <button className="new-drama-btn" onClick={onNewDrama}>🎬 新建剧本项目</button>
      <div className="session-list">
        {sessions.map((s) => (
          <div
            key={s.id}
            className={'session-item' + (s.id === activeId ? ' active' : '')}
            onClick={() => onSelect(s.id)}
          >
            {s.mode === 'drama' && <span className="drama-dot" title="剧本项目">🎬</span>}
            <span className="title" title={s.title}>{s.title}</span>
            <button
              className="del"
              title="删除会话"
              onClick={(e) => {
                e.stopPropagation();
                onDelete(s.id);
              }}
            >×</button>
          </div>
        ))}
      </div>
      <div className="sidebar-footer">
        <button className="settings-btn" onClick={onOpenSettings}>⚙ 设置</button>
      </div>
    </aside>
  );
}

/* ============ 主聊天区 ============ */
function ChatArea(props) {
  const {
    session, model, input, setInput, onSend, onStop, streaming, onKeyDown,
    onPaste, onDrop, onDragOver, onDragLeave, dragging,
    pendingImages, pendingStickers, pendingDocs, pickingFiles,
    onPickFile, onRemoveImage, onRemoveDoc, onRemoveSticker,
    canSend, messagesEndRef, apiKeyReady, onOpenSettings, onUpdateDrama, onExport,
    onAddSticker
  } = props;

  const isDrama = session.mode === 'drama';
  const drama = session.drama || {};

  const textareaRef = useRef(null);
  const [showStickers, setShowStickers] = useState(false);
  const [stickerFilter, setStickerFilter] = useState('全部');

  // 高度跟随 input 值自动重算：输入时随内容增长，发送清空后回落到单行
  // （之前只在 onInput 里设置，发送清空不触发该事件，导致输入框一直保持撑大状态）
  useEffect(() => {
    const el = textareaRef.current;
    if (!el) return;
    el.style.height = 'auto';
    el.style.height = Math.min(el.scrollHeight, 200) + 'px';
  }, [input]);

  const isEmpty = session.messages.length === 0;

  // 发送后自动收起表情面板（↑ 按钮 / Enter / 阶段按钮统一走这里）
  // onSend 返回 false 表示未实际发送（空消息/正在流式输出等），此时保持面板不动
  async function handleSend(...args) {
    const sent = await onSend(...args);
    if (sent !== false) setShowStickers(false);
    return sent;
  }

  function handleKeyDown(e) {
    if (e.key === 'Enter' && !e.shiftKey) {
      e.preventDefault();
      Promise.resolve(onSend()).then((sent) => {
        if (sent !== false) setShowStickers(false);
      });
      return;
    }
    onKeyDown(e);
  }

  return (
    <main className="chat-area">
      <div className="chat-header">
        {isDrama ? '🎬 短剧剧本创作' : 'DeepSeek Chat'}
        {model && <span className="model-tag">{model}</span>}
        {pendingImages.length > 0 && <span className="model-tag">视觉模式</span>}
        {isDrama && (
          <button className="export-btn" onClick={onExport} title="导出为 Markdown 文件">⬇ 导出剧本</button>
        )}
      </div>

      {isDrama && (
        <DramaToolbar
          drama={drama}
          onUpdate={onUpdateDrama}
          onRunStage={(key) => handleSend(key)}
          streaming={streaming}
        />
      )}

      {isEmpty ? (
        <EmptyState
          apiKeyReady={apiKeyReady}
          onOpenSettings={onOpenSettings}
          isDrama={isDrama}
        />
      ) : (
        <div className="messages">
          {session.messages.map((m, i) => (
            <Message
              key={i}
              role={m.role}
              content={m.content}
              images={m.images}
              docs={m.docs}
              reasoning={m.reasoning}
              streaming={m.streaming}
              stage={m.stage}
              sticker={m.sticker}
              stickers={m.stickers}
            />
          ))}
          <div ref={messagesEndRef} />
        </div>
      )}

      <div className="input-area">
        <div
          className={'input-wrap' + (dragging ? ' dragging' : '')}
          onDrop={onDrop}
          onDragOver={onDragOver}
          onDragLeave={onDragLeave}
        >
          {showStickers && (
            <div className="sticker-panel">
              <div className="sticker-panel-title">
                抹茶旦旦表情包
                <span className="sticker-count">{STICKER_LIBRARY.length} 张 · 已标注含义</span>
                <button className="sticker-close" title="关闭" onClick={() => setShowStickers(false)}>×</button>
              </div>
              <div className="sticker-tags">
                {['全部', ...STICKER_TAGS].map((t) => (
                  <button
                    key={t}
                    className={'tag-chip' + (stickerFilter === t ? ' active' : '')}
                    onClick={() => setStickerFilter(t)}
                  >{t}</button>
                ))}
              </div>
              <div className="sticker-grid">
                {STICKER_LIBRARY
                  .filter((s) => stickerFilter === '全部' || s.tag === stickerFilter)
                  .map((s) => (
                    <button
                      key={s.id}
                      className="sticker-item"
                      title={`点击暂存「${s.tag}」，可搭配文字一起发送`}
                      disabled={streaming}
                      onClick={() => onAddSticker(s)}
                    >
                      <img src={s.src} alt={s.desc || s.tag} loading="lazy" />
                      <span className="sticker-tag">{s.tag}</span>
                    </button>
                  ))}
              </div>
            </div>
          )}
          {(pendingImages.length > 0 || pendingStickers.length > 0 || pendingDocs.length > 0) && (
            <div className="attachments">
              {pendingStickers.map((s) => (
                <div className="att sticker-att" key={s.id} title={`${s.tag}：${s.desc}`}>
                  <img src={s.src} alt={`表情 ${s.tag}`} />
                  <span className="att-tag">{s.tag}</span>
                  <button className="remove" title="移除" onClick={() => onRemoveSticker(s.id)}>×</button>
                </div>
              ))}
              {pendingImages.map((url, i) => (
                <div className="att" key={'img' + i}>
                  <img src={url} alt="待发送" />
                  <button className="remove" title="移除" onClick={() => onRemoveImage(i)}>×</button>
                </div>
              ))}
              {pendingDocs.map((d) => (
                <div
                  className="att doc-att"
                  key={d.id}
                  title={d.truncated ? `${d.name}（内容过长已截断）` : d.name}
                >
                  <span className="doc-icon">📄</span>
                  <span className="doc-meta">
                    <span className="doc-name">{d.name}</span>
                    <span className="doc-size">{fmtSize(d.size)}{d.truncated ? ' · 已截断' : ''}</span>
                  </span>
                  <button className="remove" title="移除" onClick={() => onRemoveDoc(d.id)}>×</button>
                </div>
              ))}
            </div>
          )}
          <div className="input-row">
            <button
              className={'upload-btn' + (showStickers ? ' active' : '')}
              title="抹茶旦旦表情包"
              onClick={() => setShowStickers((v) => !v)}
            >🐊</button>
            <button
              className="upload-btn"
              title="上传文件（文档 / 图片）"
              disabled={pickingFiles}
              onClick={onPickFile}
            >📎</button>
            <textarea
              ref={textareaRef}
              rows={1}
              value={input}
              placeholder={apiKeyReady
                ? (isDrama
                    ? '补充要求（可选），点击上方阶段按钮执行；Enter 直接对话'
                    : '输入消息，Enter 发送，Shift+Enter 换行；可发图片 / 文档 / 表情包')
                : '请先在设置中配置 API Key'}
              onChange={(e) => setInput(e.target.value)}
              onKeyDown={handleKeyDown}
              onPaste={onPaste}
            />
            {streaming ? (
              <button className="send-btn stop" title="停止" onClick={onStop}>■</button>
            ) : (
              <button className="send-btn" title="发送" onClick={() => handleSend()} disabled={!canSend}>↑</button>
            )}
          </div>
        </div>
        <div className="input-hint">内容由 AI 生成，请甄别使用。对话仅保存在内存，关闭软件后清空。</div>
      </div>
    </main>
  );
}

/* ============ AI 回复中的 [表情:标签] 解析渲染 ============ */
// 完整标记：[表情:开心] / [表情：开心]（容忍冒号全半角与空格）
const STICKER_RE = /\[表情[:：]\s*([^\][]{1,8})\]/g;

// 把回复拆成 文本段 / 表情段；流式时隐藏末尾未完成的标记前缀（如 "[表情:开"）
function renderWithStickers(content) {
  const nodes = [];
  let last = 0;
  let m;
  STICKER_RE.lastIndex = 0;
  let segIdx = 0;
  while ((m = STICKER_RE.exec(content))) {
    if (m.index > last) {
      nodes.push(
        <ReactMarkdown key={'t' + segIdx++} remarkPlugins={[remarkGfm]}>
          {content.slice(last, m.index)}
        </ReactMarkdown>
      );
    }
    const sticker = findStickerByTag(m[1].trim(), content);
    if (sticker) {
      nodes.push(
        <img
          key={'s' + segIdx++}
          className="sticker-img ai-sticker"
          src={sticker.src}
          alt={sticker.tag}
          title={sticker.desc}
        />
      );
    }
    // 标签不存在时静默丢弃标记，不显示原文
    last = m.index + m[0].length;
  }
  let tail = content.slice(last);
  // 流式输出中：末尾可能是未收完的标记，先藏起来避免闪现半截文字
  tail = tail.replace(/\[表情[:：][^\]]{0,10}$/, '');
  if (tail) {
    nodes.push(
      <ReactMarkdown key={'t' + segIdx++} remarkPlugins={[remarkGfm]}>
        {tail}
      </ReactMarkdown>
    );
  }
  return nodes;
}

function Message({ role, content, images, docs, reasoning, streaming, stage, sticker, stickers }) {
  const isUser = role === 'user';
  const showCursor = streaming && !content;
  // 阶段指令消息：紧凑卡片显示，点击展开完整提示词
  const [stageOpen, setStageOpen] = useState(false);
  const stageInfo = stage ? STAGES.find((s) => s.key === stage) : null;
  return (
    <div className={'message ' + role}>
      <div className="avatar">
        <img src={isUser ? USER_AVATAR : AI_AVATAR} alt={isUser ? '我' : '旦旦'} />
      </div>
      <div className="bubble">
        <div className="role">{isUser ? '你' : '抹茶旦旦'}</div>
        {!isUser && reasoning && (
          <ReasoningBlock reasoning={reasoning} streaming={streaming} />
        )}
        {sticker ? (
          // 表情包消息（旧版单张）：只显示表情图
          <img className="sticker-img" src={sticker} alt="抹茶旦旦表情包" />
        ) : (
          <>
            {docs && docs.length > 0 && (
              // 用户上传的文档附件：以文件卡片展示
              <div className="doc-chips">
                {docs.map((d) => (
                  <span
                    className="doc-chip"
                    key={d.id}
                    title={d.truncated ? `${d.name}（内容过长已截断）` : d.name}
                  >📄 {d.name}</span>
                ))}
              </div>
            )}
            {stickers && stickers.length > 0 && (
              // 表情包消息（新版）：表情图 + 可选文字
              <div className="sticker-msg">
                <div className="sticker-msg-imgs">
                  {stickers.map((s) => (
                    <img key={s.id} className="sticker-img" src={s.src} alt={s.tag} title={`${s.tag}：${s.desc}`} />
                  ))}
                </div>
                {content && <div className="content">{content}</div>}
              </div>
            )}
            {images && images.length > 0 && (
              <div className="images">
                {images.map((url, i) => (
                  <img key={i} src={url} alt={'图片' + (i + 1)} />
                ))}
              </div>
            )}
            {stageInfo ? (
          <div className="stage-msg">
            <button className="stage-msg-toggle" onClick={() => setStageOpen(!stageOpen)}>
              <span className="stage-msg-label">▸ 已执行阶段指令：{stageInfo.label} — {stageInfo.desc}</span>
              <span className="stage-msg-arrow">{stageOpen ? '▾' : '▸'}</span>
            </button>
            {stageOpen && <div className="stage-msg-body">{content}</div>}
          </div>
        ) : isUser ? (
          !(stickers && stickers.length) && (
            <div className={'content' + (showCursor ? ' empty' : '')}>
              {content}
              {streaming && content && <span className="cursor" />}
            </div>
          )
        ) : (
          // AI 回复：Markdown 渲染（标题/表格/列表/粗体/代码块）+ [表情:标签] 转表情图
          <div className="content markdown-body">
            {content ? renderWithStickers(content) : (streaming ? '' : '（无内容）')}
            {streaming && <span className="cursor" />}
          </div>
        )}
            {streaming && !content && !stageInfo && <span className="cursor" />}
          </>
        )}
      </div>
    </div>
  );
}

/* ============ 创作模式工具栏：项目配置 + 六大阶段 ============ */
function DramaToolbar({ drama, onUpdate, onRunStage, streaming }) {
  return (
    <div className="drama-toolbar">
      <div className="drama-config">
        <label>题材
          <select value={drama.genre} onChange={(e) => onUpdate({ genre: e.target.value })}>
            {GENRES.map((g) => <option key={g} value={g}>{g}</option>)}
          </select>
        </label>
        <label>受众
          <select value={drama.audience} onChange={(e) => onUpdate({ audience: e.target.value })}>
            {AUDIENCES.map((a) => <option key={a} value={a}>{a}</option>)}
          </select>
        </label>
        <label>调性
          <select value={drama.tone} onChange={(e) => onUpdate({ tone: e.target.value })}>
            {TONES.map((t) => <option key={t} value={t}>{t}</option>)}
          </select>
        </label>
        <label>集数
          <select value={drama.episodes} onChange={(e) => onUpdate({ episodes: parseInt(e.target.value) })}>
            {EPISODE_OPTIONS.map((n) => <option key={n} value={n}>{n} 集</option>)}
          </select>
        </label>
        <label>结局
          <select value={drama.ending} onChange={(e) => onUpdate({ ending: e.target.value })}>
            {ENDINGS.map((x) => <option key={x} value={x}>{x}</option>)}
          </select>
        </label>
      </div>
      <div className="stage-bar">
        {STAGES.map((s) => (
          <button
            key={s.key}
            className="stage-btn"
            title={s.desc}
            disabled={streaming}
            onClick={() => onRunStage(s.key)}
          >
            {s.label}
          </button>
        ))}
      </div>
    </div>
  );
}

/* 思考过程可折叠区块 */
function ReasoningBlock({ reasoning, streaming }) {
  const [open, setOpen] = useState(false);
  return (
    <div className="reasoning">
      <button className="reasoning-toggle" onClick={() => setOpen(!open)}>
        <span className="reasoning-label">
          {streaming ? '思考中…' : '已深度思考'}
        </span>
        <span className="reasoning-arrow">{open ? '▾' : '▸'}</span>
      </button>
      {open && (
        <div className="reasoning-body">{reasoning}</div>
      )}
    </div>
  );
}

function EmptyState({ apiKeyReady, onOpenSettings, isDrama }) {
  if (isDrama) {
    return (
      <div className="empty-state">
        <img className="mascot" src={MASCOT_DRAMA} alt="抹茶旦旦" />
        <div className="title">🎬 短剧剧本创作工作台</div>
        <div className="sub">
          先在上方选择题材 / 受众 / 调性 / 集数 / 结局，然后点击阶段按钮开始创作。
          六大阶段循序渐进：立项 → 大纲 → 人物 → 分场 → 写集 → 审查，全程可自由对话修改。
        </div>
        <div className="features">
          <div className="feat"><span className="icon">🎯</span><span>DTG 爽点理论</span></div>
          <div className="feat"><span className="icon">🪝</span><span>五种结尾钩子</span></div>
          <div className="feat"><span className="icon">📈</span><span>节奏曲线四幕结构</span></div>
          <div className="feat"><span className="icon">😈</span><span>四层反派体系</span></div>
        </div>
        {!apiKeyReady && (
          <div className="hint">
            尚未配置 API Key，请点击
            <button className="btn btn-secondary" style={{ marginLeft: 8 }} onClick={onOpenSettings}>
              打开设置
            </button>
          </div>
        )}
      </div>
    );
  }
  return (
    <div className="empty-state">
      <img className="mascot" src={MASCOT_CHAT} alt="抹茶旦旦" />
      <div className="title">抹茶旦旦已就位，开始你的第一个对话吧</div>
      <div className="sub">基于 DeepSeek V4 模型的本地桌面聊天客户端，支持多会话、流式输出与图片识别。</div>
      <div className="features">
        <div className="feat"><span className="icon">💬</span><span>多会话</span></div>
        <div className="feat"><span className="icon">⚡</span><span>流式输出</span></div>
        <div className="feat"><span className="icon">🖼️</span><span>图片识别</span></div>
        <div className="feat"><span className="icon">📄</span><span>文档解析</span></div>
      </div>
      {!apiKeyReady && (
        <div className="hint">
          尚未配置 API Key，请点击
          <button className="btn btn-secondary" style={{ marginLeft: 8 }} onClick={onOpenSettings}>
            打开设置
          </button>
        </div>
      )}
    </div>
  );
}

/* ============ 设置弹窗 ============ */
function SettingsModal({ settings, deviceId, onClose, onSave }) {
  const [form, setForm] = useState(settings || {
    apiKey: '',
    baseUrl: 'https://api.deepseek.com/v1',
    model: 'deepseek-v4-flash',
    visionModel: 'deepseek-v4-flash-vision-exp',
    thinking: true,
    reasoningEffort: 'high',
    temperature: 0.7,
    systemPrompt: '',
    nickname: '',
    userProfile: ''
  });

  function update(key, value) {
    setForm((prev) => ({ ...prev, [key]: value }));
  }

  return (
    <div className="modal-overlay" onClick={onClose}>
      <div className="modal" onClick={(e) => e.stopPropagation()}>
        <h2>设置</h2>
        <div className="field">
          <label>DeepSeek API Key</label>
          <input
            type="password"
            value={form.apiKey || ''}
            placeholder="sk-xxxxxxxxxxxx"
            onChange={(e) => update('apiKey', e.target.value)}
          />
          <div className="helper">
            获取地址：
            <a href="https://platform.deepseek.com/api_keys" target="_blank" rel="noreferrer">
              platform.deepseek.com/api_keys
            </a>
            （本地加密存储，不会上传）
          </div>
        </div>
        <div className="field">
          <label>API Base URL</label>
          <input
            value={form.baseUrl}
            placeholder="https://api.deepseek.com/v1"
            onChange={(e) => update('baseUrl', e.target.value)}
          />
        </div>
        <div className="field">
          <label>对话模型（纯文本）</label>
          <select value={form.model} onChange={(e) => update('model', e.target.value)}>
            {MODEL_OPTIONS.map((o) => (
              <option key={o.value} value={o.value}>{o.label}</option>
            ))}
          </select>
        </div>
        <div className="field">
          <label>视觉模型（图片识别）</label>
          <select value={form.visionModel} onChange={(e) => update('visionModel', e.target.value)}>
            {VISION_MODEL_OPTIONS.map((o) => (
              <option key={o.value} value={o.value}>{o.label}</option>
            ))}
          </select>
          <div className="helper">当消息含图片时自动切换到该模型。</div>
        </div>
        <div className="field">
          <label>深度思考模式</label>
          <select
            value={form.thinking ? (form.reasoningEffort || 'high') : 'off'}
            onChange={(e) => {
              const v = e.target.value;
              if (v === 'off') {
                update('thinking', false);
              } else {
                update('thinking', true);
                update('reasoningEffort', v);
              }
            }}
          >
            <option value="off">关闭（响应更快）</option>
            <option value="high">开启 · 强度 high（日常推荐）</option>
            <option value="max">开启 · 强度 max（复杂问题更聪明）</option>
          </select>
          <div className="helper">开启后模型先输出思维链再回答，回答更准确但稍慢；思考过程显示在回答上方的折叠区。</div>
        </div>
        <div className="field">
          <label>Temperature ({form.temperature})</label>
          <input
            type="range"
            min="0"
            max="2"
            step="0.1"
            value={form.temperature}
            onChange={(e) => update('temperature', parseFloat(e.target.value))}
          />
          <div className="helper">注：深度思考模式下该参数不生效（API 兼容性设计）。</div>
        </div>
        <div className="field">
          <label>系统提示词（可选）</label>
          <input
            value={form.systemPrompt || ''}
            placeholder="例如：你是一位耐心的编程助手"
            onChange={(e) => update('systemPrompt', e.target.value)}
          />
        </div>

        <div className="settings-section-title">用户身份（让旦旦认识你）</div>
        <div className="field">
          <label>我的昵称</label>
          <input
            value={form.nickname || ''}
            placeholder="例如：小抹茶（AI 会用这个名字称呼你）"
            onChange={(e) => update('nickname', e.target.value)}
          />
        </div>
        <div className="field">
          <label>关于我的说明（可选）</label>
          <textarea
            className="profile-textarea"
            rows={3}
            value={form.userProfile || ''}
            placeholder="例如：喜欢二次元和短剧，说话喜欢用梗，正在学剪辑，讨厌说教式的回答…"
            onChange={(e) => update('userProfile', e.target.value)}
          />
          <div className="helper">这些信息仅保存在本机，会让 AI 的回应更懂你，包括理解你发的表情包。</div>
        </div>
        <div className="field">
          <label>设备 ID</label>
          <input value={deviceId || '…'} readOnly className="device-id-input" />
          <div className="helper">本机唯一标识。多台设备共用同一 API Key 时，各自的数据与请求完全隔离，不会串流。</div>
        </div>

        <div className="modal-actions">
          <button className="btn btn-secondary" onClick={onClose}>取消</button>
          <button className="btn btn-primary" onClick={() => onSave(form)}>保存</button>
        </div>
      </div>
    </div>
  );
}
