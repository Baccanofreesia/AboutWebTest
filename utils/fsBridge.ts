import { Filesystem, Directory, Encoding } from '@capacitor/filesystem';

/**
 * fsBridge connects the web frontend to the local file system.
 * In a pure web development environment (npm run dev), it calls the Vite `/api/fs` middleware.
 * In a native mobile environment (Capacitor), it uses `@capacitor/filesystem`.
 */

export interface FsItem {
    name: string;
    type: 'file' | 'folder';
    size?: number;
    createdAt?: number;
    updatedAt?: number;
}

const isCapacitor = () => {
    return !!(window as any).Capacitor?.isNative;
};

export const fsBridge = {
    async readFile(rootPath: string, filePath: string, allowGlobal: boolean = false): Promise<string> {
        if (!rootPath) throw new Error("Root path must be provided for fs operation.");
        if (isCapacitor()) {
            // Mobile (Android / iOS) Native fallback (using Directory.Documents as base)
            const result = await Filesystem.readFile({
                path: `NovaClaw_Workspace/${filePath}`,
                directory: Directory.Documents,
                encoding: Encoding.UTF8,
            });
            return result.data as string;
        } else {
            // Web / Vite Proxy
            const res = await fetch('/api/fs', {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ action: 'readFile', rootPath, filePath, allowGlobal })
            });
            const data = await res.json();
            if (!data.success) throw new Error(data.error || 'Failed to read file');
            return data.content;
        }
    },

    async writeFile(rootPath: string, filePath: string, content: string, allowGlobal: boolean = false): Promise<void> {
        if (!rootPath) throw new Error("Root path must be provided for fs operation.");
        if (isCapacitor()) {
            await Filesystem.writeFile({
                path: `NovaClaw_Workspace/${filePath}`,
                data: content,
                directory: Directory.Documents,
                encoding: Encoding.UTF8,
                recursive: true
            });
        } else {
            const res = await fetch('/api/fs', {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ action: 'writeFile', rootPath, filePath, content, allowGlobal })
            });
            const data = await res.json();
            if (!data.success) throw new Error(data.error || 'Failed to write file');
        }
    },

    async readFileBase64(rootPath: string, filePath: string, allowGlobal: boolean = false): Promise<string> {
        if (!rootPath) throw new Error("Root path must be provided for fs operation.");
        if (isCapacitor()) {
            const result = await Filesystem.readFile({
                path: `NovaClaw_Workspace/${filePath}`,
                directory: Directory.Documents
            });
            return result.data as string;
        } else {
            const res = await fetch('/api/fs', {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ action: 'readFileBase64', rootPath, filePath, allowGlobal })
            });
            const data = await res.json();
            if (!data.success) throw new Error(data.error || 'Failed to read base64 file');
            return data.content;
        }
    },

    async writeFileBase64(rootPath: string, filePath: string, content: string, allowGlobal: boolean = false): Promise<void> {
        if (!rootPath) throw new Error("Root path must be provided for fs operation.");
        if (isCapacitor()) {
            await Filesystem.writeFile({
                path: `NovaClaw_Workspace/${filePath}`,
                data: content,
                directory: Directory.Documents,
                recursive: true
            });
        } else {
            const res = await fetch('/api/fs', {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ action: 'writeFileBase64', rootPath, filePath, content, allowGlobal })
            });
            const data = await res.json();
            if (!data.success) throw new Error(data.error || 'Failed to write base64 file');
        }
    },

    async readDir(rootPath: string, dirPath: string = '/', allowGlobal: boolean = false): Promise<FsItem[]> {
        if (!rootPath) throw new Error("Root path must be provided for fs operation.");
        if (isCapacitor()) {
            try {
                const result = await Filesystem.readdir({
                    path: `NovaClaw_Workspace${dirPath === '/' ? '' : dirPath}`,
                    directory: Directory.Documents,
                });
                return result.files.map(f => ({
                    name: f.name,
                    type: f.type === 'directory' ? 'folder' : 'file',
                    size: f.size,
                    createdAt: f.ctime || f.mtime || Date.now(),
                    updatedAt: f.mtime || Date.now()
                }));
            } catch (e: any) {
                if (e.message && e.message.includes("does not exist")) {
                    return [];
                }
                throw e;
            }
        } else {
            const res = await fetch('/api/fs', {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ action: 'readDir', rootPath, filePath: dirPath, allowGlobal })
            });
            const data = await res.json();
            if (!data.success) throw new Error(data.error || 'Failed to read dir');
            return data.items;
        }
    },

    async deleteFile(rootPath: string, filePath: string, allowGlobal: boolean = false): Promise<void> {
        if (!rootPath) throw new Error("Root path must be provided for fs operation.");
        if (isCapacitor()) {
            await Filesystem.deleteFile({
                path: `NovaClaw_Workspace/${filePath}`,
                directory: Directory.Documents
            });
        } else {
            const res = await fetch('/api/fs', {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ action: 'deleteFile', rootPath, filePath, allowGlobal })
            });
            const data = await res.json();
            if (!data.success) throw new Error(data.error || 'Failed to delete file');
        }
    },

    async createFolder(rootPath: string, folderPath: string, allowGlobal: boolean = false): Promise<void> {
        if (!rootPath) throw new Error("Root path must be provided for fs operation.");
        if (isCapacitor()) {
            await Filesystem.mkdir({
                path: `NovaClaw_Workspace/${folderPath}`,
                directory: Directory.Documents,
                recursive: true
            });
        } else {
            const res = await fetch('/api/fs', {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ action: 'createFolder', rootPath, filePath: folderPath, allowGlobal })
            });
            const data = await res.json();
            if (!data.success) throw new Error(data.error || 'Failed to create folder');
        }
    },

    async renameFile(rootPath: string, filePath: string, newPath: string, allowGlobal: boolean = false): Promise<void> {
        if (!rootPath) throw new Error("Root path must be provided for fs operation.");
        if (isCapacitor()) {
            await Filesystem.rename({
                from: `NovaClaw_Workspace/${filePath}`,
                to: `NovaClaw_Workspace/${newPath}`,
                directory: Directory.Documents
            });
        } else {
            const res = await fetch('/api/fs', {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ action: 'renameFile', rootPath, filePath, newPath, allowGlobal })
            });
            const data = await res.json();
            if (!data.success) throw new Error(data.error || 'Failed to rename file');
        }
    },

    async executeFile(rootPath: string, filePath: string, allowGlobal: boolean = false): Promise<{ stdout: string, stderr: string }> {
        if (!rootPath) throw new Error("Root path must be provided for fs operation.");
        if (isCapacitor()) {
            throw new Error("Execution of arbitrary files is not supported on Mobile Native currently.");
        } else {
            const res = await fetch('/api/fs', {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ action: 'executeFile', rootPath, filePath, allowGlobal })
            });
            const data = await res.json();
            if (!data.success) throw new Error(data.error || 'Failed to execute file');
            return { stdout: data.stdout || '', stderr: data.stderr || '' };
        }
    }
};
