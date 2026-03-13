import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';
import fs from 'fs';
import path from 'path';
import { exec } from 'child_process';

function fsProxyPlugin() {
  return {
    name: 'fs-proxy',
    configureServer(server: any) {
      server.middlewares.use('/api/fs', (req: any, res: any, next: any) => {
        if (req.method !== 'POST') return next();

        let body = '';
        req.on('data', (chunk: any) => { body += chunk.toString(); });
        req.on('end', async () => {
          try {
            const { action, rootPath, filePath, content, allowGlobal, newPath } = JSON.parse(body);

            // If allowGlobal is true, filePath can be an absolute path anywhere on the disk.
            // If allowGlobal is false, filePath is treated as relative to rootPath.
            let fullPath = '';

            // Special Sandbox Routing: @agent_apps/
            if (filePath.startsWith('@agent_apps/')) {
              const relativeSubPath = filePath.replace('@agent_apps/', '');
              fullPath = path.normalize(path.join(__dirname, 'apps', 'agent_apps', relativeSubPath));
              // Ensure it doesn't escape the sandbox
              if (!fullPath.startsWith(path.normalize(path.join(__dirname, 'apps', 'agent_apps')))) {
                res.statusCode = 403;
                return res.end(JSON.stringify({ error: 'Sandbox traversal detected' }));
              }
            } else if (allowGlobal && path.isAbsolute(filePath)) {
              fullPath = path.normalize(filePath);
            } else {
              fullPath = path.normalize(path.join(rootPath, filePath));
              // Security check: ensure the resolved path stays within the intended root
              if (!fullPath.startsWith(path.normalize(rootPath))) {
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
              if (!newPath || typeof newPath !== 'string') {
                res.statusCode = 400;
                return res.end(JSON.stringify({ success: false, error: 'newPath is required' }));
              }

              let fullNewPath = '';
              if (newPath.startsWith('@agent_apps/')) {
                const relativeSubPath = newPath.replace('@agent_apps/', '');
                fullNewPath = path.normalize(path.join(__dirname, 'apps', 'agent_apps', relativeSubPath));
                if (!fullNewPath.startsWith(path.normalize(path.join(__dirname, 'apps', 'agent_apps')))) {
                  res.statusCode = 403;
                  return res.end(JSON.stringify({ error: 'Sandbox traversal detected' }));
                }
              } else if (allowGlobal && path.isAbsolute(newPath)) {
                fullNewPath = path.normalize(newPath);
              } else {
                fullNewPath = path.normalize(path.join(rootPath, newPath));
                if (!fullNewPath.startsWith(path.normalize(rootPath))) {
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
    }
  },
  build: {
    outDir: 'dist',
    assetsDir: 'assets',
  }
});
