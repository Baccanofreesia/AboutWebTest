import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';
import fs from 'fs';
import path from 'path';
import os from 'os';
import { exec } from 'child_process';
import crypto from 'crypto';
import zlib from 'zlib';
import WebSocket from 'ws';

const expandHome = (input: string) => {
  if (!input) return input;
  const home = process.env.USERPROFILE || process.env.HOME || '';
  if (!home) return input;
  let output = input;
  if (output === '~') return home;
  if (output.startsWith('~/') || output.startsWith('~\\')) {
    output = path.join(home, output.slice(2));
  }
  output = output.replace(/^%USERPROFILE%/i, home);
  output = output.replace(/^%HOME%/i, home);
  return output;
};

const BYTEDANCE_ENDPOINTS = {
  fast: 'wss://openspeech.bytedance.com/api/v3/sauc/bigmodel_async',
  dual: 'wss://openspeech.bytedance.com/api/v3/sauc/bigmodel',
  standard: 'wss://openspeech.bytedance.com/api/v3/sauc/bigmodel_nostream',
};

const BYTEDANCE_AUC_ENDPOINTS = {
  submit: 'https://openspeech.bytedance.com/api/v3/auc/bigmodel/submit',
  query: 'https://openspeech.bytedance.com/api/v3/auc/bigmodel/query',
};

const aucFiles = new Map<string, { path: string; createdAt: number; mime: string }>();
const AUC_FILE_TTL_MS = 10 * 60 * 1000;

const cleanupAucFiles = () => {
  const now = Date.now();
  for (const [id, info] of aucFiles.entries()) {
    if (now - info.createdAt > AUC_FILE_TTL_MS) {
      try { if (fs.existsSync(info.path)) fs.unlinkSync(info.path); } catch { }
      aucFiles.delete(id);
    }
  }
};

const buildWavBuffer = (pcm: Buffer, rate: number, bits: number, channels: number) => {
  const byteRate = rate * channels * (bits / 8);
  const blockAlign = channels * (bits / 8);
  const header = Buffer.alloc(44);
  header.write('RIFF', 0);
  header.writeUInt32LE(36 + pcm.length, 4);
  header.write('WAVE', 8);
  header.write('fmt ', 12);
  header.writeUInt32LE(16, 16);
  header.writeUInt16LE(1, 20); // PCM
  header.writeUInt16LE(channels, 22);
  header.writeUInt32LE(rate, 24);
  header.writeUInt32LE(byteRate, 28);
  header.writeUInt16LE(blockAlign, 32);
  header.writeUInt16LE(bits, 34);
  header.write('data', 36);
  header.writeUInt32LE(pcm.length, 40);
  return Buffer.concat([header, pcm]);
};

const buildBytedanceFrame = (
  messageType: number,
  flags: number,
  payload: Buffer,
  serialization: number,
  compression: number
) => {
  const header = Buffer.alloc(4);
  header[0] = (0x1 << 4) | 0x1; // version=1, header size=1 (4 bytes)
  header[1] = ((messageType & 0x0f) << 4) | (flags & 0x0f);
  header[2] = ((serialization & 0x0f) << 4) | (compression & 0x0f);
  header[3] = 0x00;

  let body = payload || Buffer.alloc(0);
  if (compression === 1 && body.length) {
    body = zlib.gzipSync(body);
  }
  const payloadSize = Buffer.alloc(4);
  payloadSize.writeUInt32BE(body.length, 0);
  return Buffer.concat([header, payloadSize, body]);
};

const parseBytedanceFrame = (data: Buffer) => {
  const headerSize = (data[0] & 0x0f) * 4;
  const messageType = (data[1] >> 4) & 0x0f;
  const flags = data[1] & 0x0f;
  const serialization = (data[2] >> 4) & 0x0f;
  const compression = data[2] & 0x0f;
  let offset = headerSize;
  let sequence: number | undefined;
  if (flags === 0x1 || flags === 0x3) {
    sequence = data.readInt32BE(offset);
    offset += 4;
  }
  const payloadSize = data.readUInt32BE(offset);
  offset += 4;
  const rawPayload = data.slice(offset, offset + payloadSize);
  let payload = rawPayload;
  if (compression === 1 && payload.length) {
    payload = zlib.gunzipSync(payload);
  }
  let json: any = null;
  if (serialization === 1 && payload.length) {
    try {
      json = JSON.parse(payload.toString('utf8'));
    } catch {
      json = null;
    }
  }
  return { messageType, flags, sequence, json };
};

const transcribeBytedance = async (opts: {
  appKey: string;
  accessKey: string;
  resourceId: string;
  mode: 'fast' | 'standard' | 'dual';
  base64: string;
  format: string;
  rate: number;
  bits: number;
  channel: number;
  language?: string;
  enablePunc?: boolean;
  enableItn?: boolean;
  enableEmotion?: boolean;
}) => {
  const endpoint = opts.mode === 'standard'
    ? BYTEDANCE_ENDPOINTS.standard
    : opts.mode === 'dual'
      ? BYTEDANCE_ENDPOINTS.dual
      : BYTEDANCE_ENDPOINTS.fast;
  const audioBuffer = Buffer.from(opts.base64, 'base64');
  const connectId = crypto.randomUUID();
  const headers = {
    'X-Api-App-Key': opts.appKey,
    'X-Api-Access-Key': opts.accessKey,
    'X-Api-Resource-Id': opts.resourceId,
    'X-Api-Connect-Id': connectId,
  };

  return await new Promise<{ text: string; emotion?: string }>((resolve, reject) => {
    let resolved = false;
    let latestText = '';
    let latestEmotion = '';
    const ws = new WebSocket(endpoint, { headers });

    const finish = () => {
      if (resolved) return;
      resolved = true;
      try { ws.close(); } catch { }
      resolve({ text: latestText, emotion: latestEmotion });
    };

    const fail = (err: any) => {
      if (resolved) return;
      resolved = true;
      try { ws.close(); } catch { }
      reject(err);
    };

    ws.on('open', () => {
      const payload = {
        user: { uid: connectId },
        audio: {
          format: opts.format,
          rate: opts.rate,
          bits: opts.bits,
          channel: opts.channel,
          language: opts.language || 'zh-CN',
          codec: opts.format === 'ogg' ? 'opus' : 'raw',
        },
        request: {
          model_name: 'bigmodel',
          enable_itn: opts.enableItn ?? true,
          enable_punc: opts.enablePunc ?? true,
          enable_emotion_detection: opts.enableEmotion ?? false,
        },
      };
      const fullReq = buildBytedanceFrame(
        0x1,
        0x0,
        Buffer.from(JSON.stringify(payload)),
        0x1,
        0x1
      );
      ws.send(fullReq);

      const chunkSize = opts.format === 'pcm'
        ? Math.max(1, Math.floor((opts.rate * 0.2) * 2))
        : 8000;
      const sendIntervalMs = 120; // 建议 100-200ms
      let offset = 0;
      const sendChunk = () => {
        if (resolved || ws.readyState !== WebSocket.OPEN) return;
        if (offset >= audioBuffer.length) return;
        const end = Math.min(offset + chunkSize, audioBuffer.length);
        const chunk = audioBuffer.slice(offset, end);
        const isLast = end >= audioBuffer.length;
        const audioReq = buildBytedanceFrame(
          0x2,
          isLast ? 0x2 : 0x0,
          chunk,
          0x0,
          0x1
        );
        ws.send(audioReq);
        offset = end;
        if (isLast && chunkTimer) {
          clearInterval(chunkTimer);
        }
      };
      const chunkTimer = setInterval(sendChunk, sendIntervalMs);
      sendChunk();
    });

    ws.on('message', (data: any) => {
      const buf = Buffer.isBuffer(data) ? data : Buffer.from(data);
      const parsed = parseBytedanceFrame(buf);
      if (parsed.messageType === 0x0f) {
        return fail(new Error(parsed.json?.message || 'ByteDance ASR error'));
      }
      const text = parsed.json?.result?.text;
      if (text) latestText = String(text).trim();

      if (parsed.json?.result?.utterances?.length) {
        const maybeEmotion = parsed.json.result.utterances.find((u: any) => u?.additions?.emotion)?.additions?.emotion;
        if (maybeEmotion) latestEmotion = maybeEmotion;
        if (parsed.json.result.utterances.some((u: any) => u?.definite)) {
          return finish();
        }
      }
      if (parsed.flags === 0x3 || parsed.flags === 0x2) {
        return finish();
      }
    });

    ws.on('error', (err: any) => fail(err));
    ws.on('close', () => {
      if (!resolved) finish();
    });

    const timeoutMs = Math.min(20000, Math.max(4000, Math.ceil(audioBuffer.length / (opts.rate * 2) * 1000 + 2500)));
    setTimeout(() => {
      if (!resolved) finish();
    }, timeoutMs);
  });
};

function fsProxyPlugin() {
  return {
    name: 'fs-proxy',
    configureServer(server: any) {
      server.middlewares.use('/api/asr/file', (req: any, res: any, next: any) => {
        if (req.method !== 'GET') return next();
        cleanupAucFiles();
        const raw = (req.url || '').split('?')[0].replace(/^\/+/, '');
        const fileId = raw;
        if (!fileId || !aucFiles.has(fileId)) {
          res.statusCode = 404;
          return res.end('Not found');
        }
        const info = aucFiles.get(fileId)!;
        try {
          res.setHeader('Content-Type', info.mime || 'audio/wav');
          fs.createReadStream(info.path).pipe(res);
        } catch {
          res.statusCode = 500;
          res.end('Read error');
        }
      });

      server.middlewares.use('/api/asr', (req: any, res: any, next: any) => {
        if (req.method !== 'POST') return next();
        let body = '';
        req.on('data', (chunk: any) => { body += chunk.toString(); });
        req.on('end', async () => {
          const tempFiles: string[] = [];
          const execAsync = (command: string) => new Promise<{ stdout: string; stderr: string }>((resolve, reject) => {
            exec(command, { windowsHide: true }, (error, stdout, stderr) => {
              if (error) reject({ error, stdout, stderr });
              else resolve({ stdout, stderr });
            });
          });
          const tryParseJson = (raw: string) => {
            const trimmed = String(raw || '').trim();
            if (!trimmed) return null;
            try { return JSON.parse(trimmed); } catch { return null; }
          };
          try {
            const { base64, pcmBase64, filename, engine, model, language, noPolish, format, rate, bits, channel, bytedance, publicBaseUrl, fileUrl } = JSON.parse(body || '{}');
            if (!base64) {
              if (engine !== 'bytedance-auc' || (!pcmBase64 && !fileUrl)) {
                res.statusCode = 400;
                return res.end(JSON.stringify({ success: false, error: 'missing base64' }));
              }
            }
            if (engine === 'bytedance') {
              if (!bytedance?.appKey || !bytedance?.accessKey || !bytedance?.resourceId) {
                res.statusCode = 400;
                return res.end(JSON.stringify({ success: false, error: 'missing bytedance credentials' }));
              }
              const result = await transcribeBytedance({
                appKey: bytedance.appKey,
                accessKey: bytedance.accessKey,
                resourceId: bytedance.resourceId,
                mode: bytedance.mode === 'standard'
                  ? 'standard'
                  : (bytedance.mode === 'dual' ? 'dual' : 'fast'),
                base64,
                format: format || 'pcm',
                rate: Number(rate) || 16000,
                bits: Number(bits) || 16,
                channel: Number(channel) || 1,
                language: bytedance.language || language,
                enablePunc: bytedance.enablePunc,
                enableItn: bytedance.enableItn,
                enableEmotion: bytedance.enableEmotion,
              });
              res.setHeader('Content-Type', 'application/json');
              return res.end(JSON.stringify({ success: true, text: result.text || '', emotion: result.emotion || '' }));
            }
            if (engine === 'bytedance-auc') {
              if (!bytedance?.appKey || !bytedance?.accessKey || !bytedance?.resourceId) {
                res.statusCode = 400;
                return res.end(JSON.stringify({ success: false, error: 'missing bytedance credentials' }));
              }
              let audioUrl = (fileUrl || '').toString().trim();
              if (!audioUrl) {
                const baseUrl = (publicBaseUrl || '').toString().trim().replace(/\/+$/, '');
                if (!baseUrl) {
                  res.statusCode = 400;
                  return res.end(JSON.stringify({ success: false, error: 'missing publicBaseUrl for AUC' }));
                }
                if (!pcmBase64) {
                  res.statusCode = 400;
                  return res.end(JSON.stringify({ success: false, error: 'missing pcmBase64' }));
                }
                const pcmBuf = Buffer.from(pcmBase64, 'base64');
                const wav = buildWavBuffer(
                  pcmBuf,
                  Number(rate) || 16000,
                  Number(bits) || 16,
                  Number(channel) || 1
                );
                const fileId = crypto.randomUUID();
                const tmpPath = path.join(os.tmpdir(), `auc_${fileId}.wav`);
                await fs.promises.writeFile(tmpPath, wav);
                aucFiles.set(fileId, { path: tmpPath, createdAt: Date.now(), mime: 'audio/wav' });
                audioUrl = `${baseUrl}/api/asr/file/${fileId}`;
              }

              const requestId = crypto.randomUUID();
              const headers = {
                'Content-Type': 'application/json',
                'X-Api-App-Key': bytedance.appKey,
                'X-Api-Access-Key': bytedance.accessKey,
                'X-Api-Resource-Id': bytedance.resourceId,
                'X-Api-Request-Id': requestId,
                'X-Api-Sequence': '-1',
              };
              const submitBody = {
                user: { uid: requestId },
                audio: {
                  url: audioUrl,
                  format: format || 'wav',
                  rate: Number(rate) || 16000,
                  bits: Number(bits) || 16,
                  channel: Number(channel) || 1,
                  language: language || 'zh-CN',
                },
                request: {
                  model_name: 'bigmodel',
                  enable_itn: bytedance.enableItn ?? true,
                  enable_punc: bytedance.enablePunc ?? false,
                  enable_emotion_detection: bytedance.enableEmotion ?? false,
                }
              };

              const submitRes = await fetch(BYTEDANCE_AUC_ENDPOINTS.submit, {
                method: 'POST',
                headers,
                body: JSON.stringify(submitBody)
              });
              const submitCode = submitRes.headers.get('x-api-status-code') || '';
              if (submitCode !== '20000000') {
                const msg = submitRes.headers.get('x-api-message') || `submit failed (${submitCode})`;
                res.statusCode = 502;
                return res.end(JSON.stringify({ success: false, error: msg }));
              }

              const startedAt = Date.now();
              let finalText = '';
              let finalEmotion = '';
              while (Date.now() - startedAt < 30000) {
                await new Promise(r => setTimeout(r, 1200));
                const queryHeaders = {
                  'Content-Type': 'application/json',
                  'X-Api-App-Key': bytedance.appKey,
                  'X-Api-Access-Key': bytedance.accessKey,
                  'X-Api-Resource-Id': bytedance.resourceId,
                  'X-Api-Request-Id': requestId,
                };
                const queryRes = await fetch(BYTEDANCE_AUC_ENDPOINTS.query, {
                  method: 'POST',
                  headers: queryHeaders,
                  body: JSON.stringify({})
                });
                const queryCode = queryRes.headers.get('x-api-status-code') || '';
                const queryMsg = queryRes.headers.get('x-api-message') || '';
                if (queryCode === '20000001' || queryCode === '20000002') {
                  continue;
                }
                if (queryCode !== '20000000') {
                  res.statusCode = 502;
                  return res.end(JSON.stringify({ success: false, error: queryMsg || `query failed (${queryCode})` }));
                }
                const data = await queryRes.json().catch(() => ({}));
                finalText = String(data?.result?.text || '').trim();
                if (data?.result?.utterances?.length) {
                  const maybeEmotion = data.result.utterances.find((u: any) => u?.additions?.emotion)?.additions?.emotion;
                  if (maybeEmotion) finalEmotion = maybeEmotion;
                }
                break;
              }

              res.setHeader('Content-Type', 'application/json');
              return res.end(JSON.stringify({ success: true, text: finalText || '', emotion: finalEmotion || '' }));
            }
            const safeName = (filename || 'audio.webm').toString().replace(/[^\w.\-]+/g, '_');
            const tmpPath = path.join(os.tmpdir(), `${Date.now()}_${Math.random().toString(36).slice(2)}_${safeName}`);
            tempFiles.push(tmpPath);
            await fs.promises.writeFile(tmpPath, Buffer.from(base64, 'base64'));
            let stdout = '';
            if (engine === 'faster-whisper') {
              const scriptPath = path.resolve(__dirname, '..', 'workspace', 'skills', 'faster-whisper', 'scripts', 'transcribe.py');
              if (!fs.existsSync(scriptPath)) {
                res.statusCode = 500;
                return res.end(JSON.stringify({ success: false, error: 'faster-whisper script not found' }));
              }
              const langArg = language ? ` --language ${language}` : '';
              const modelArg = model ? ` --model ${model}` : '';
              const cmd = `python "${scriptPath}" "${tmpPath}" --json --quiet${modelArg}${langArg}`;
              const result = await execAsync(cmd);
              stdout = result.stdout || '';
            } else {
              const modelArg = model ? ` --model ${model}` : '';
              const noPolishArg = noPolish ? ' --no-polish' : '';
              const cmd = `coli asr "${tmpPath}"${modelArg}${noPolishArg}`;
              try {
                const result = await execAsync(cmd);
                stdout = result.stdout || '';
              } catch (err: any) {
                const fallback = `coli asr "${tmpPath}"${modelArg}`;
                const result = await execAsync(fallback);
                stdout = result.stdout || '';
              }
            }
            const parsed = tryParseJson(stdout);
            const text = parsed?.text || parsed?.transcript || parsed?.result || (Array.isArray(parsed?.segments) ? parsed.segments.map((s: any) => s.text || '').join('') : '') || stdout;
            const emotion = parsed?.emotion || parsed?.meta?.emotion || '';
            res.setHeader('Content-Type', 'application/json');
            res.end(JSON.stringify({ success: true, text: String(text || '').trim(), emotion }));
          } catch (e: any) {
            res.statusCode = 500;
            res.end(JSON.stringify({ success: false, error: e?.message || 'asr failed' }));
          } finally {
            for (const f of tempFiles) {
              try { if (fs.existsSync(f)) fs.unlinkSync(f); } catch { }
            }
          }
        });
      });
      server.middlewares.use('/api/fs', (req: any, res: any, next: any) => {
        if (req.method !== 'POST') return next();

        let body = '';
        req.on('data', (chunk: any) => { body += chunk.toString(); });
        req.on('end', async () => {
          try {
            const { action, rootPath, filePath, content, allowGlobal, newPath } = JSON.parse(body);
            const safeRootPath = expandHome(rootPath || '');
            const safeFilePath = expandHome(filePath || '');
            const safeNewPath = expandHome(newPath || '');

            // If allowGlobal is true, filePath can be an absolute path anywhere on the disk.
            // If allowGlobal is false, filePath is treated as relative to rootPath.
            let fullPath = '';

            // Special Sandbox Routing: @agent_apps/
            if (safeFilePath.startsWith('@agent_apps/')) {
              const relativeSubPath = safeFilePath.replace('@agent_apps/', '');
              fullPath = path.normalize(path.join(__dirname, 'apps', 'agent_apps', relativeSubPath));
              // Ensure it doesn't escape the sandbox
              if (!fullPath.startsWith(path.normalize(path.join(__dirname, 'apps', 'agent_apps')))) {
                res.statusCode = 403;
                return res.end(JSON.stringify({ error: 'Sandbox traversal detected' }));
              }
            } else if (allowGlobal && path.isAbsolute(safeFilePath)) {
              fullPath = path.normalize(safeFilePath);
            } else {
              fullPath = path.normalize(path.join(safeRootPath, safeFilePath));
              // Security check: ensure the resolved path stays within the intended root
              if (!fullPath.startsWith(path.normalize(safeRootPath))) {
                res.statusCode = 403;
                return res.end(JSON.stringify({ error: 'Path traversal detected in sandboxed mode' }));
              }
            }

            if (action === 'readFile') {
              if (fs.existsSync(fullPath)) {
                if (fs.statSync(fullPath).isDirectory()) {
                  res.statusCode = 400;
                  return res.end(JSON.stringify({ error: 'Target is a directory' }));
                }
                const data = await fs.promises.readFile(fullPath, 'utf-8');
                res.setHeader('Content-Type', 'application/json');
                res.end(JSON.stringify({ success: true, content: data }));
              } else {
                res.setHeader('Content-Type', 'application/json');
                res.end(JSON.stringify({ success: false, error: 'File not found' }));
              }
            } else if (action === 'writeFile') {
              const dir = path.dirname(fullPath);
              if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true });
              await fs.promises.writeFile(fullPath, content, 'utf-8');
              res.setHeader('Content-Type', 'application/json');
              res.end(JSON.stringify({ success: true }));
            } else if (action === 'readFileBase64') {
              if (fs.existsSync(fullPath)) {
                if (fs.statSync(fullPath).isDirectory()) {
                  res.statusCode = 400;
                  return res.end(JSON.stringify({ error: 'Target is a directory' }));
                }
                const data = await fs.promises.readFile(fullPath, { encoding: 'base64' });
                res.setHeader('Content-Type', 'application/json');
                res.end(JSON.stringify({ success: true, content: data }));
              } else {
                res.setHeader('Content-Type', 'application/json');
                res.end(JSON.stringify({ success: false, error: 'File not found' }));
              }
            } else if (action === 'writeFileBase64') {
              const dir = path.dirname(fullPath);
              if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true });
              await fs.promises.writeFile(fullPath, content, { encoding: 'base64' });
              res.setHeader('Content-Type', 'application/json');
              res.end(JSON.stringify({ success: true }));
            } else if (action === 'createFolder') {
              if (!fs.existsSync(fullPath)) {
                await fs.promises.mkdir(fullPath, { recursive: true });
              }
              res.setHeader('Content-Type', 'application/json');
              res.end(JSON.stringify({ success: true }));
            } else if (action === 'renameFile') {
              if (!safeNewPath || typeof safeNewPath !== 'string') {
                res.statusCode = 400;
                return res.end(JSON.stringify({ success: false, error: 'newPath is required' }));
              }

              let fullNewPath = '';
              if (safeNewPath.startsWith('@agent_apps/')) {
                const relativeSubPath = safeNewPath.replace('@agent_apps/', '');
                fullNewPath = path.normalize(path.join(__dirname, 'apps', 'agent_apps', relativeSubPath));
                if (!fullNewPath.startsWith(path.normalize(path.join(__dirname, 'apps', 'agent_apps')))) {
                  res.statusCode = 403;
                  return res.end(JSON.stringify({ error: 'Sandbox traversal detected' }));
                }
              } else if (allowGlobal && path.isAbsolute(safeNewPath)) {
                fullNewPath = path.normalize(safeNewPath);
              } else {
                fullNewPath = path.normalize(path.join(safeRootPath, safeNewPath));
                if (!fullNewPath.startsWith(path.normalize(safeRootPath))) {
                  res.statusCode = 403;
                  return res.end(JSON.stringify({ error: 'Path traversal detected in sandboxed mode' }));
                }
              }

              if (!fs.existsSync(fullPath)) {
                res.setHeader('Content-Type', 'application/json');
                return res.end(JSON.stringify({ success: false, error: 'File not found' }));
              }
              const targetDir = path.dirname(fullNewPath);
              if (!fs.existsSync(targetDir)) fs.mkdirSync(targetDir, { recursive: true });
              await fs.promises.rename(fullPath, fullNewPath);
              res.setHeader('Content-Type', 'application/json');
              res.end(JSON.stringify({ success: true }));
            } else if (action === 'deleteFile') {
              if (fs.existsSync(fullPath)) {
                if (fs.statSync(fullPath).isDirectory()) {
                  await fs.promises.rm(fullPath, { recursive: true, force: true });
                } else {
                  await fs.promises.unlink(fullPath);
                }
                res.setHeader('Content-Type', 'application/json');
                res.end(JSON.stringify({ success: true }));
              } else {
                res.setHeader('Content-Type', 'application/json');
                res.end(JSON.stringify({ success: false, error: 'File not found' }));
              }
            } else if (action === 'readDir') {
              if (fs.existsSync(fullPath) && fs.statSync(fullPath).isDirectory()) {
                const items = await fs.promises.readdir(fullPath, { withFileTypes: true });
                const result = items.map(item => {
                  const itemPath = path.join(fullPath, item.name);
                  let stats = { size: 0, birthtimeMs: Date.now(), mtimeMs: Date.now() };
                  try { stats = fs.statSync(itemPath); } catch (e) { }
                  return {
                    name: item.name,
                    type: item.isDirectory() ? 'folder' : 'file',
                    size: stats.size,
                    createdAt: stats.birthtimeMs,
                    updatedAt: stats.mtimeMs
                  };
                });
                res.setHeader('Content-Type', 'application/json');
                res.end(JSON.stringify({ success: true, items: result }));
              } else {
                // Return empty instead of error if it doesn't exist yet, to be forgiving
                res.setHeader('Content-Type', 'application/json');
                res.end(JSON.stringify({ success: true, items: [] }));
              }
            } else if (action === 'executeFile') {
              if (!fs.existsSync(fullPath)) {
                res.setHeader('Content-Type', 'application/json');
                return res.end(JSON.stringify({ success: false, error: 'File not found' }));
              }
              // Map typical extensions to execution commands
              const ext = path.extname(fullPath).toLowerCase();
              let command = '';
              if (ext === '.py') command = `python "${fullPath}"`;
              else if (ext === '.js') command = `node "${fullPath}"`;
              else if (ext === '.bat' || ext === '.cmd' || ext === '.exe') command = `"${fullPath}"`;
              else command = `"${fullPath}"`; // Try execution directly for others if executable

              exec(command, { cwd: path.dirname(fullPath), timeout: 10000 }, (error, stdout, stderr) => {
                res.setHeader('Content-Type', 'application/json');
                if (error) {
                  res.end(JSON.stringify({ success: false, error: error.message, stdout, stderr }));
                } else {
                  res.end(JSON.stringify({ success: true, stdout, stderr }));
                }
              });
              return; // Exec uses callback, prevent falling through to res.end below (which doesn't exist here actually, it's just async block)
            } else {
              res.statusCode = 400;
              res.end(JSON.stringify({ error: 'Unknown action' }));
            }
          } catch (e: any) {
            res.statusCode = 500;
            res.end(JSON.stringify({ error: e.message }));
          }
        });
      });
    }
  };
}

export default defineConfig({
  plugins: [react(), fsProxyPlugin()],
  base: './', // 关键配置：使用相对路径，确保在 GitHub Pages 子目录下能找到资源
  server: {
    host: '127.0.0.1',
    port: 5176,
    proxy: {
      '/api/proxy/volcengine': {
        target: 'https://ark.cn-beijing.volces.com',
        changeOrigin: true,
        rewrite: (p) => p.replace(/^\/api\/proxy\/volcengine/, ''),
        secure: false, // 忽略 SSL 证书验证，避免自签名证书报错
        headers: {
          'Origin': 'https://ark.cn-beijing.volces.com', // 欺骗目标服务器
          'Referer': 'https://ark.cn-beijing.volces.com'
        }
      },
      '/api/proxy/minimax-coding': {
        target: 'https://api.minimaxi.com',
        changeOrigin: true,
        secure: true,
        rewrite: (p: string) => p.replace(/^\/api\/proxy\/minimax-coding/, ''),
      },
      '/api/minimax/t2a': {
        target: 'https://api.minimaxi.com',
        changeOrigin: true,
        secure: true,
        rewrite: () => '/v1/t2a_v2',
      },
      '/api/minimax/get-voice': {
        target: 'https://api.minimaxi.com',
        changeOrigin: true,
        secure: true,
        rewrite: () => '/v1/get_voice',
      },
      '/api/minimax/ws': {
        target: 'https://api.minimaxi.com',
        changeOrigin: true,
        secure: true,
        ws: true,
        rewrite: () => '/ws/v1/t2a_v2',
        configure: (proxy: any) => {
          proxy.on('proxyReqWs', (proxyReq: any, req: any) => {
            const url = new URL(req.url || '', 'http://localhost');
            const auth = url.searchParams.get('authorization') || url.searchParams.get('Authorization');
            if (auth) proxyReq.setHeader('Authorization', auth);
          });
        },
      },
    }
  },
  build: {
    outDir: 'dist',
    assetsDir: 'assets',
  }
});
