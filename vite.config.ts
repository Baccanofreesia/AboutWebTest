import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';
import fs from 'fs';
import path from 'path';
import os from 'os';
import { exec } from 'child_process';

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

function fsProxyPlugin() {
  return {
    name: 'fs-proxy',
    configureServer(server: any) {
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
            const { base64, filename, engine, model, language, noPolish } = JSON.parse(body || '{}');
            if (!base64) {
              res.statusCode = 400;
              return res.end(JSON.stringify({ success: false, error: 'missing base64' }));
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
