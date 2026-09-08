const https = require('https');
const http = require('http');
const crypto = require('crypto');
const { URL } = require('url');

/**
 * DeepSeek API 流式聊天
 * 兼容 OpenAI ChatCompletions 格式
 * 文档：https://api-docs.deepseek.com
 *
 * @param {Object} opts
 * @param {string} opts.apiKey
 * @param {string} opts.baseUrl  例如 https://api.deepseek.com/v1
 * @param {string} opts.model    例如 deepseek-v4-flash
 * @param {Array<{role:string,content:string}>} opts.messages
 * @param {boolean} [opts.thinking]  思考模式开关（默认 true）
 * @param {string} [opts.reasoningEffort]  思考强度：high / max
 * @param {number} [opts.temperature]  思考模式下不生效（API 兼容不报错）
 * @param {string} [opts.deviceId]  设备 ID（请求 user 字段，多设备共用 Key 时区分来源）
 * @param {AbortSignal} [opts.signal]
 * @param {(delta:string)=>void} [opts.onDelta]       正文增量回调
 * @param {(delta:string)=>void} [opts.onReasoning]   思维链增量回调
 * @param {(full:string)=>void}    [opts.onDone]       正文完整文本回调
 * @param {(err:string)=>void}    [opts.onError]      错误回调
 */
function streamChat(opts) {
  return new Promise((resolve, reject) => {
    const {
      apiKey,
      baseUrl,
      model,
      messages,
      thinking = true,
      reasoningEffort,
      temperature = 0.7,
      deviceId,
      signal,
      onDelta,
      onReasoning,
      onDone,
      onError
    } = opts;

    if (!apiKey) {
      const msg = '缺少 API Key';
      onError && onError(msg);
      return reject(new Error(msg));
    }

    const url = new URL(baseUrl.replace(/\/$/, '') + '/chat/completions');
    const lib = url.protocol === 'https:' ? https : http;

    // 思考模式参数：thinking 开关 + reasoning_effort 强度
    // 文档：thinking 参数需放请求体顶层（OpenAI SDK 中对应 extra_body）
    const payload = {
      model,
      messages,
      temperature,
      stream: true,
      thinking: { type: thinking ? 'enabled' : 'disabled' }
    };
    if (thinking && reasoningEffort) {
      payload.reasoning_effort = reasoningEffort;
    }
    // 设备标识：多设备共用同一 API Key 时，服务端按设备区分请求来源
    // （哈希处理，不暴露原始 UUID）
    if (deviceId) {
      payload.user =
        'device-' + crypto.createHash('sha256').update(deviceId).digest('hex').slice(0, 12);
    }

    const body = JSON.stringify(payload);

    const req = lib.request(
      {
        hostname: url.hostname,
        port: url.port || (url.protocol === 'https:' ? 443 : 80),
        path: url.pathname,
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          Authorization: `Bearer ${apiKey}`,
          'Accept': 'text/event-stream'
        }
      },
      (res) => {
        if (res.statusCode !== 200) {
          let errBuf = '';
          res.on('data', (c) => (errBuf += c.toString()));
          res.on('end', () => {
            const msg = `API 请求失败 (HTTP ${res.statusCode}): ${errBuf}`;
            onError && onError(msg);
            return reject(new Error(msg));
          });
          return;
        }

        let fullText = '';
        let buffer = '';

        res.setEncoding('utf8');
        res.on('data', (chunk) => {
          buffer += chunk;
          // SSE 以双换行分隔事件
          const events = buffer.split(/\r?\n\r?\n/);
          buffer = events.pop(); // 最后未完整的事件保留

          for (const evt of events) {
            const lines = evt.split(/\r?\n/);
            for (const line of lines) {
              if (!line.startsWith('data:')) continue;
              const data = line.slice(5).trim();
              if (data === '[DONE]') {
                onDone && onDone(fullText);
                return resolve();
              }
              if (!data) continue;
              try {
                const json = JSON.parse(data);
                const d = json?.choices?.[0]?.delta;
                if (!d) continue;
                // 思维链增量（reasoning_content，与 content 同级）
                if (d.reasoning_content) {
                  onReasoning && onReasoning(d.reasoning_content);
                }
                // 正文增量
                if (d.content) {
                  fullText += d.content;
                  onDelta && onDelta(d.content);
                }
              } catch (e) {
                // 单行解析失败时忽略，不中断流
              }
            }
          }
        });

        res.on('end', () => {
          if (!res.complete) {
            onError && onError('连接意外中断');
            return resolve();
          }
          onDone && onDone(fullText);
          resolve();
        });

        res.on('error', (e) => {
          onError && onError(e.message);
          reject(e);
        });
      }
    );

    req.on('error', (e) => {
      onError && onError(e.message);
      reject(e);
    });

    if (signal) {
      signal.addEventListener('abort', () => {
        req.destroy();
        onDone && onDone('');
        resolve();
      });
    }

    req.write(body);
    req.end();
  });
}

module.exports = { streamChat };
