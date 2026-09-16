/**
 * 文件上传解析（主进程）
 * 统一处理"附件选择对话框"与"拖拽文件路径"两种入口：
 * - 图片 → base64 dataUrl（交给视觉模型）
 * - PDF / DOCX / XLSX → 提取文本
 * - 纯文本 / 代码 / Markdown 等 → 直接读取文本
 * 返回 payload 数组：{ name, path, kind, mime, dataUrl, text, truncated, size, error }
 */
const fs = require('fs');
const path = require('path');

const IMAGE_EXTS = ['png', 'jpg', 'jpeg', 'gif', 'webp', 'bmp'];
const IMAGE_MIME = {
  png: 'image/png',
  jpg: 'image/jpeg',
  jpeg: 'image/jpeg',
  gif: 'image/gif',
  webp: 'image/webp',
  bmp: 'image/bmp'
};

// 直接按文本读取的扩展名（代码 / 文档 / 配置 / 字幕等）
const TEXT_EXTS = [
  'txt', 'md', 'markdown', 'json', 'jsonl', 'csv', 'tsv', 'log',
  'js', 'jsx', 'ts', 'tsx', 'mjs', 'cjs', 'vue', 'svelte',
  'py', 'java', 'c', 'h', 'cpp', 'hpp', 'cs', 'go', 'rs', 'rb', 'php',
  'swift', 'kt', 'kts', 'scala', 'dart', 'r', 'm', 'lua', 'pl', 'groovy',
  'html', 'htm', 'css', 'scss', 'less', 'xml', 'svg', 'yml', 'yaml',
  'sql', 'sh', 'bash', 'bat', 'cmd', 'ps1', 'ini', 'toml', 'conf', 'env',
  'tex', 'srt', 'ass', 'lrc', 'properties', 'gradle', 'cmake', 'dockerfile',
  'gitignore', 'gitattributes', 'editorconfig', 'npmrc', 'babelrc', 'eslintrc'
];

// 文本提取上限（字符），超出截断并标记
const MAX_TEXT_CHARS = 150000;
// 各类型文件大小上限（字节）
const MAX_IMAGE_BYTES = 25 * 1024 * 1024;
const MAX_PDF_BYTES = 50 * 1024 * 1024;
const MAX_DOCX_BYTES = 30 * 1024 * 1024;
const MAX_TEXT_BYTES = 10 * 1024 * 1024;
const MAX_XLSX_BYTES = 30 * 1024 * 1024;

// 附件选择对话框过滤器
const FILE_FILTERS = [
  {
    name: '文档与图片',
    extensions: [
      ...IMAGE_EXTS, 'pdf', 'docx', 'xlsx', 'txt', 'md', 'markdown',
      'json', 'csv', 'tsv', 'log', 'html', 'css', 'xml', 'yml', 'yaml',
      'js', 'jsx', 'ts', 'tsx', 'py', 'java', 'c', 'cpp', 'cs', 'go',
      'rs', 'rb', 'php', 'vue', 'swift', 'kt', 'sql', 'sh', 'bat', 'ps1',
      'ini', 'toml', 'conf', 'tex', 'srt', 'lrc'
    ]
  },
  { name: '图片', extensions: IMAGE_EXTS },
  { name: 'PDF 文档', extensions: ['pdf'] },
  { name: 'Word 文档', extensions: ['docx'] },
  { name: 'Excel 表格', extensions: ['xlsx'] },
  { name: '所有文件', extensions: ['*'] }
];

function extOf(p) {
  return path.extname(p).slice(1).toLowerCase();
}

function truncate(text) {
  if (text.length <= MAX_TEXT_CHARS) return { text, truncated: false };
  return { text: text.slice(0, MAX_TEXT_CHARS), truncated: true };
}

let _pdfjs = null;
function pdfjsLazy() {
  if (!_pdfjs) _pdfjs = require('pdfjs-dist/legacy/build/pdf.js');
  return _pdfjs;
}

let _mammoth = null;
function mammothLazy() {
  if (!_mammoth) _mammoth = require('mammoth');
  return _mammoth;
}

let _xlsx = null;
function xlsxLazy() {
  if (!_xlsx) _xlsx = require('xlsx');
  return _xlsx;
}

// 用 pdfjs-dist 逐页提取文本（DOMMatrix/Path2D 警告仅影响渲染，不影响文本提取）
async function readPdf(filePath, stat) {
  if (stat.size > MAX_PDF_BYTES) {
    return { error: `PDF 超过 ${Math.round(MAX_PDF_BYTES / 1024 / 1024)}MB，暂不支持` };
  }
  const pdfjs = pdfjsLazy();
  const data = new Uint8Array(fs.readFileSync(filePath));
  const doc = await pdfjs.getDocument({
    data,
    useSystemFonts: true,
    disableFontFace: true,
    isEvalSupported: false
  }).promise;
  const chunks = [];
  const maxPages = Math.min(doc.numPages, 300);
  for (let i = 1; i <= maxPages; i++) {
    const page = await doc.getPage(i);
    const tc = await page.getTextContent();
    let pageText = '';
    for (const it of tc.items) {
      pageText += it.str + (it.hasEOL ? '\n' : ' ');
    }
    if (pageText.trim()) chunks.push(pageText.trim());
  }
  const raw = chunks.join('\n\n').replace(/\u0000/g, '').trim();
  const truncatedPages = doc.numPages > maxPages;
  if (!raw) {
    return { kind: 'doc', text: '', truncated: false, note: '该 PDF 未提取到文字（可能是扫描件，暂不支持 OCR）' };
  }
  const { text, truncated } = truncate(raw);
  return { kind: 'doc', text, truncated: truncated || truncatedPages };
}

async function readDocx(filePath, stat) {
  if (stat.size > MAX_DOCX_BYTES) {
    return { error: `Word 文档超过 ${Math.round(MAX_DOCX_BYTES / 1024 / 1024)}MB，暂不支持` };
  }
  const result = await mammothLazy().extractRawText({ path: filePath });
  const { text, truncated } = truncate((result.value || '').trim());
  return { kind: 'doc', text, truncated };
}

function readXlsx(filePath, stat) {
  if (stat.size > MAX_XLSX_BYTES) {
    return { error: `Excel 表格超过 ${Math.round(MAX_XLSX_BYTES / 1024 / 1024)}MB，暂不支持` };
  }
  const wb = xlsxLazy().readFile(filePath);
  const chunks = [];
  for (const name of wb.SheetNames) {
    const csv = xlsxLazy().utils.sheet_to_csv(wb.Sheets[name]);
    if (csv.trim()) chunks.push(`【工作表：${name}】\n${csv.trim()}`);
  }
  const { text, truncated } = truncate(chunks.join('\n\n'));
  return { kind: 'doc', text, truncated };
}

function readTextFile(filePath, stat) {
  if (stat.size > MAX_TEXT_BYTES) {
    return { error: `文本文件超过 ${Math.round(MAX_TEXT_BYTES / 1024 / 1024)}MB，暂不支持` };
  }
  const buf = fs.readFileSync(filePath);
  // 二进制嗅探：前 8KB 出现空字节视为二进制文件
  const sample = buf.subarray(0, 8192);
  if (sample.includes(0)) {
    return { error: '暂不支持该文件类型（二进制文件）' };
  }
  const { text, truncated } = truncate(buf.toString('utf8'));
  return { kind: 'doc', text, truncated };
}

function readImage(filePath, stat, ext) {
  if (stat.size > MAX_IMAGE_BYTES) {
    return { error: `图片超过 ${Math.round(MAX_IMAGE_BYTES / 1024 / 1024)}MB，暂不支持` };
  }
  const b64 = fs.readFileSync(filePath).toString('base64');
  return { kind: 'image', mime: IMAGE_MIME[ext], dataUrl: `data:${IMAGE_MIME[ext]};base64,${b64}` };
}

async function readFilePayload(filePath) {
  const name = path.basename(filePath);
  const base = { name, path: filePath, size: 0 };
  try {
    const stat = fs.statSync(filePath);
    if (!stat.isFile()) return { ...base, error: '不是有效的文件' };
    base.size = stat.size;

    const ext = extOf(filePath);
    if (IMAGE_EXTS.includes(ext)) {
      return { ...base, ...readImage(filePath, stat, ext) };
    }
    if (ext === 'pdf') {
      return { ...base, ...(await readPdf(filePath, stat)) };
    }
    if (ext === 'docx') {
      return { ...base, ...(await readDocx(filePath, stat)) };
    }
    if (ext === 'xlsx' || ext === 'xlsm') {
      return { ...base, ...readXlsx(filePath, stat) };
    }
    if (TEXT_EXTS.includes(ext)) {
      return { ...base, ...readTextFile(filePath, stat) };
    }
    // 未知扩展名：嗅探是否为纯文本（无空字节即按文本处理）
    if (stat.size <= MAX_TEXT_BYTES) {
      const buf = fs.readFileSync(filePath);
      if (!buf.subarray(0, 8192).includes(0)) {
        const { text, truncated } = truncate(buf.toString('utf8'));
        return { ...base, kind: 'doc', text, truncated };
      }
    }
    return { ...base, error: '暂不支持该文件类型' };
  } catch (e) {
    return { ...base, error: '读取失败：' + e.message };
  }
}

function readFilePayloads(paths) {
  return Promise.all((paths || []).map((p) => readFilePayload(p)));
}

module.exports = { readFilePayloads, readFilePayload, FILE_FILTERS };
