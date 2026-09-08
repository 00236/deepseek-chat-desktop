/**
 * 抹茶旦旦表情包资源库
 * - 图片经 Vite assetsInlineLimit 内联为 base64 data URL（界面显示与视觉模型 API 共用）
 * - annotations.json：由视觉模型批量分析的语义标签（tag 情绪 / desc 描述），
 *   通过 ANALYZE_STICKERS=1 npx electron . 重新生成
 */
import s_03a90 from './assets/stickers/03a90.jpg';
import s_1ba78 from './assets/stickers/1ba78.jpg';
import s_216c9 from './assets/stickers/216c9.jpg';
import s_2cea8 from './assets/stickers/2cea8.jpg';
import s_327ab from './assets/stickers/327ab.jpg';
import s_41079 from './assets/stickers/41079.jpg';
import s_41330 from './assets/stickers/41330.jpg';
import s_4d44d from './assets/stickers/4d44d.jpg';
import s_4e309 from './assets/stickers/4e309.jpg';
import s_52c3e from './assets/stickers/52c3e.jpg';
import s_554e0 from './assets/stickers/554e0.jpg';
import s_5c252 from './assets/stickers/5c252.jpg';
import s_5f5a9 from './assets/stickers/5f5a9.jpg';
import s_6075f from './assets/stickers/6075f.jpg';
import s_64241 from './assets/stickers/64241.jpg';
import s_685fe from './assets/stickers/685fe.jpg';
import s_6bcd2 from './assets/stickers/6bcd2.jpg';
import s_78a16 from './assets/stickers/78a16.jpg';
import s_7e5ed from './assets/stickers/7e5ed.jpg';
import s_83b91 from './assets/stickers/83b91.jpg';
import s_84ba5 from './assets/stickers/84ba5.jpg';
import s_872a9 from './assets/stickers/872a9.jpg';
import s_915c2 from './assets/stickers/915c2.jpg';
import s_927b4 from './assets/stickers/927b4.jpg';
import s_97d9d from './assets/stickers/97d9d.jpg';
import s_a031e from './assets/stickers/a031e.jpg';
import s_a0489 from './assets/stickers/a0489.jpg';
import s_a0f68 from './assets/stickers/a0f68.jpg';
import s_a5925 from './assets/stickers/a5925.jpg';
import s_abc12 from './assets/stickers/abc12.jpg';
import s_ac597 from './assets/stickers/ac597.jpg';
import s_ada75 from './assets/stickers/ada75.jpg';
import s_avatar from './assets/stickers/avatar.jpg';
import s_c14d2 from './assets/stickers/c14d2.jpg';
import s_cdea8 from './assets/stickers/cdea8.jpg';
import s_ce627 from './assets/stickers/ce627.jpg';
import s_d3306 from './assets/stickers/d3306.jpg';
import s_d5073 from './assets/stickers/d5073.jpg';
import s_dd1 from './assets/stickers/dd1.jpg';
import s_dd10 from './assets/stickers/dd10.jpg';
import s_dd11 from './assets/stickers/dd11.jpg';
import s_dd12 from './assets/stickers/dd12.jpg';
import s_dd13 from './assets/stickers/dd13.jpg';
import s_dd14 from './assets/stickers/dd14.jpg';
import s_dd2 from './assets/stickers/dd2.jpg';
import s_dd3 from './assets/stickers/dd3.jpg';
import s_dd4 from './assets/stickers/dd4.jpg';
import s_dd5 from './assets/stickers/dd5.jpg';
import s_dd6 from './assets/stickers/dd6.jpg';
import s_dd7 from './assets/stickers/dd7.jpg';
import s_dd8 from './assets/stickers/dd8.jpg';
import s_dd9 from './assets/stickers/dd9.jpg';
import s_df44a from './assets/stickers/df44a.jpg';
import s_df74e from './assets/stickers/df74e.jpg';
import s_e28a6 from './assets/stickers/e28a6.jpg';
import annotations from './assets/stickers/annotations.json';

const FILES = {
  '03a90': s_03a90,
  '1ba78': s_1ba78,
  '216c9': s_216c9,
  '2cea8': s_2cea8,
  '327ab': s_327ab,
  '41079': s_41079,
  '41330': s_41330,
  '4d44d': s_4d44d,
  '4e309': s_4e309,
  '52c3e': s_52c3e,
  '554e0': s_554e0,
  '5c252': s_5c252,
  '5f5a9': s_5f5a9,
  '6075f': s_6075f,
  '64241': s_64241,
  '685fe': s_685fe,
  '6bcd2': s_6bcd2,
  '78a16': s_78a16,
  '7e5ed': s_7e5ed,
  '83b91': s_83b91,
  '84ba5': s_84ba5,
  '872a9': s_872a9,
  '915c2': s_915c2,
  '927b4': s_927b4,
  '97d9d': s_97d9d,
  'a031e': s_a031e,
  'a0489': s_a0489,
  'a0f68': s_a0f68,
  'a5925': s_a5925,
  'abc12': s_abc12,
  'ac597': s_ac597,
  'ada75': s_ada75,
  'avatar': s_avatar,
  'c14d2': s_c14d2,
  'cdea8': s_cdea8,
  'ce627': s_ce627,
  'd3306': s_d3306,
  'd5073': s_d5073,
  'dd1': s_dd1,
  'dd10': s_dd10,
  'dd11': s_dd11,
  'dd12': s_dd12,
  'dd13': s_dd13,
  'dd14': s_dd14,
  'dd2': s_dd2,
  'dd3': s_dd3,
  'dd4': s_dd4,
  'dd5': s_dd5,
  'dd6': s_dd6,
  'dd7': s_dd7,
  'dd8': s_dd8,
  'dd9': s_dd9,
  'df44a': s_df44a,
  'df74e': s_df74e,
  'e28a6': s_e28a6
};

/** 合并图片与语义标注，过滤缺图项 */
export const STICKER_LIBRARY = (annotations || [])
  .filter((a) => FILES[a.id])
  .map((a) => ({ id: a.id, tag: a.tag || '表情', desc: a.desc || '', src: FILES[a.id] }));

/** 所有可用标签（去重，用于面板筛选与 AI 表情目录） */
export const STICKER_TAGS = [...new Set(STICKER_LIBRARY.map((s) => s.tag))];

/** 按标签取表情（同标签多张时按内容哈希稳定选一张，表现自然） */
export function findStickerByTag(tag, seed = '') {
  const list = STICKER_LIBRARY.filter((s) => s.tag === tag);
  if (!list.length) {
    const fuzzy = STICKER_LIBRARY.filter((s) => s.tag.includes(tag) || tag.includes(s.tag));
    if (!fuzzy.length) return null;
    return fuzzy[hashSeed(seed + tag) % fuzzy.length];
  }
  return list[hashSeed(seed + tag) % list.length];
}

function hashSeed(str) {
  let h = 0;
  for (let i = 0; i < str.length; i++) h = (h * 31 + str.charCodeAt(i)) >>> 0;
  return h;
}

export const AI_AVATAR = s_915c2;    // AI 头像：抹茶旦旦（穿尿布拿奶瓶呆萌款）
export const USER_AVATAR = s_avatar; // 用户头像：抹茶蛋蛋
export const MASCOT_CHAT = s_dd1;    // 空状态吉祥物：聊天模式
export const MASCOT_DRAMA = s_dd3;   // 空状态吉祥物：创作模式
