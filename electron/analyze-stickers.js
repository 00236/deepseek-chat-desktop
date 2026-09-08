/**
 * 表情包语义标注脚本（离线一次性运行，不创建窗口）
 * 运行方式：ANALYZE_STICKERS=1 npx electron .
 *
 * 使用已配置的 DeepSeek 视觉模型，为 src/assets/stickers 下每张表情包
 * 分析情绪标签和描述，结果写入 annotations.json（供前端导入）。
 */
const fs = require('fs');
const path = require('path');
const Store = require('./store');
const { streamChat } = require('./deepseek');

const STICKER_DIR = path.join(__dirname, '..', 'src', 'assets', 'stickers');
const OUT_FILE = path.join(STICKER_DIR, 'annotations.json');

const PROMPT = `这是一张"抹茶旦旦"小鳄鱼表情包（含文字的话请读出文字）。请严格只输出如下 JSON，不要任何其他内容：
{"tag":"情绪标签","desc":"一句话描述"}
要求：
- tag 是 2-4 个字的中文情绪/含义词，优先从这些里选：开心、大笑、无语、生气、委屈、哭哭、震惊、疑惑、坏笑、得意、摆烂、睡觉、困、加油、冲、赞、OK、谢谢、比心、抱抱、亲亲、求求、可怜、叹气、emo、发疯、可爱、问号、叉、警告、吃、饿了、冷、热、累、兴奋、害怕、举手、点头、摇头、安静、听我说、收到、明白、不懂、告辞、来了、好的、不、行、可以、没问题
- 如果图上文字本身就是常用短语（如"OK""谢谢""告辞"），tag 直接用该短语（2-4字）
- desc 一句话描述小鳄鱼的动作神态和这个表情包想表达的意思（20字内）`;

function extractJson(text) {
  if (!text) return null;
  let t = text.trim();
  t = t.replace(/```json/gi, '').replace(/```/g, '').trim();
  const m = t.match(/\{[\s\S]*\}/);
  if (!m) return null;
  try {
    const obj = JSON.parse(m[0]);
    if (obj && typeof obj.tag === 'string' && obj.tag) {
      return {
        tag: obj.tag.slice(0, 6),
        desc: typeof obj.desc === 'string' ? obj.desc.slice(0, 40) : ''
      };
    }
  } catch (e) { /* fallthrough */ }
  return null;
}

function analyzeOne(dataUrl, apiKey, model) {
  return new Promise((resolve) => {
    let full = '';
    streamChat({
      apiKey,
      baseUrl: 'https://api.deepseek.com/v1',
      model,
      thinking: false,
      messages: [
        {
          role: 'user',
          content: [
            { type: 'text', text: PROMPT },
            { type: 'image_url', image_url: { url: dataUrl } }
          ]
        }
      ],
      onDelta: (d) => { full += d; },
      onDone: () => resolve(full),
      onError: () => resolve('')
    }).catch(() => resolve(''));
  });
}

async function main() {
  const settings = Store.getSettings();
  if (!settings.apiKey) {
    console.error('[analyze] 未配置 API Key，无法标注。');
    process.exit(1);
  }
  const model = settings.visionModel || 'deepseek-v4-flash-vision-exp';
  const files = fs.readdirSync(STICKER_DIR).filter((f) => /\.jpe?g$/i.test(f)).sort();
  console.log(`[analyze] 共 ${files.length} 张，模型 ${model}`);

  const results = [];
  for (let i = 0; i < files.length; i++) {
    const f = files[i];
    const id = path.basename(f, path.extname(f));
    const b64 = fs.readFileSync(path.join(STICKER_DIR, f)).toString('base64');
    const dataUrl = `data:image/jpeg;base64,${b64}`;

    let parsed = null;
    for (let attempt = 1; attempt <= 2 && !parsed; attempt++) {
      const raw = await analyzeOne(dataUrl, settings.apiKey, model);
      parsed = extractJson(raw);
    }
    const item = parsed || { tag: '表情', desc: '' };
    results.push({ id, tag: item.tag, desc: item.desc });
    console.log(`[analyze] ${i + 1}/${files.length} ${id} -> ${item.tag} ${item.desc}`);
    await new Promise((r) => setTimeout(r, 300));
  }

  fs.writeFileSync(OUT_FILE, JSON.stringify(results, null, 2), 'utf8');
  const tags = [...new Set(results.map((r) => r.tag))];
  console.log(`[analyze] 完成，写入 ${OUT_FILE}，标签：${tags.join('、')}`);
}

module.exports = { main };
