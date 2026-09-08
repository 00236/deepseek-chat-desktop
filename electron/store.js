const { app, safeStorage } = require('electron');
const path = require('path');
const fs = require('fs');
const crypto = require('crypto');

// 使用 Electron 的 safeStorage（基于系统凭证管理：Windows DPAPI）
// fallback 到普通 JSON 文件（带明文，控制台会输出警告）
const SETTINGS_FILE = () =>
  path.join(app.getPath('userData'), 'settings.json');

const DEVICE_FILE = () =>
  path.join(app.getPath('userData'), 'device.json');

const DEFAULT_SETTINGS = {
  apiKey: '',
  baseUrl: 'https://api.deepseek.com/v1',
  model: 'deepseek-v4-flash',
  visionModel: 'deepseek-v4-flash-vision-exp',
  thinking: true,            // 思考模式开关
  reasoningEffort: 'high',   // 思考强度：high / max
  temperature: 0.7,
  systemPrompt: '',
  nickname: '',              // 用户昵称（空则用默认"朋友"）
  userProfile: ''            // 关于用户的说明（让 AI 了解用户，纯本地存储）
};

/**
 * 设备唯一 ID：首次启动生成 UUID，永久保存在本机。
 * 用途：
 * 1. 多设备共用同一 API Key 时，请求 user 字段按设备区分（服务端可识别来源）
 * 2. 本地数据天然按设备隔离（每台设备各自的 userData 目录）
 */
function getDeviceId() {
  try {
    const raw = fs.readFileSync(DEVICE_FILE(), 'utf8');
    const obj = JSON.parse(raw);
    if (obj && obj.deviceId) return obj.deviceId;
  } catch (e) { /* 首次启动或文件损坏，重新生成 */ }
  const deviceId = crypto.randomUUID();
  try {
    fs.writeFileSync(DEVICE_FILE(), JSON.stringify({ deviceId, createdAt: Date.now() }), 'utf8');
  } catch (e) {
    console.warn('[store] 设备 ID 写入失败：', e.message);
  }
  return deviceId;
}

function readRaw() {
  try {
    const buf = fs.readFileSync(SETTINGS_FILE());
    // 文件可能为加密二进制（safeStorage）或明文 JSON（fallback）
    const text = buf.toString('utf8');
    if (text.trim().startsWith('{')) {
      // 明文 fallback
      return JSON.parse(text);
    }
    // 尝试解密
    if (safeStorage.isEncryptionAvailable()) {
      const decrypted = safeStorage.decryptString(buf);
      return JSON.parse(decrypted);
    }
    return {};
  } catch (e) {
    return {};
  }
}

function writeRaw(obj) {
  const data = JSON.stringify(obj);
  if (safeStorage.isEncryptionAvailable()) {
    const enc = safeStorage.encryptString(data);
    fs.writeFileSync(SETTINGS_FILE(), enc);
  } else {
    console.warn('[store] safeStorage 不可用，API Key 将以明文存储。');
    fs.writeFileSync(SETTINGS_FILE(), data, 'utf8');
  }
}

function getSettings() {
  const raw = readRaw();
  return { ...DEFAULT_SETTINGS, ...raw };
}

function setSettings(partial) {
  const current = getSettings();
  const next = { ...current, ...partial };
  writeRaw(next);
  return next;
}

module.exports = { getSettings, setSettings, getDeviceId, DEFAULT_SETTINGS };
