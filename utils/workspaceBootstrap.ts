import { APIConfig } from '../types';
import { fsBridge } from './fsBridge';
import { buildAgentsTemplate, buildBootstrapTemplate, buildHeartbeatTemplate, buildMemoryTemplate } from './workspaceTemplates';
import { buildAgentSoulMarkdown, buildUserMarkdownFromProfile } from './profileFiles';

const hasFile = (items: { name: string; type: string }[], target: string) =>
    items.some(item => item.type === 'file' && item.name.toLowerCase() === target.toLowerCase());

const ensureFolder = async (rootPath: string, folderPath: string, allowGlobal: boolean) => {
    try {
        await fsBridge.createFolder(rootPath, folderPath, allowGlobal);
    } catch { }
};

export const bootstrapWorkspaceFiles = async (apiConfig: APIConfig): Promise<void> => {
    const rootPath = apiConfig.nativeWorkspacePath?.trim();
    if (!rootPath) return;
    const allowGlobal = !!apiConfig.securityPolicy?.allowGlobalFileAccess;

    try {
        await fsBridge.createFolder(rootPath, '.', allowGlobal);
    } catch { }

    const items = await fsBridge.readDir(rootPath, '/', allowGlobal).catch(() => []);

    if (!hasFile(items, 'AGENTS.md')) {
        await fsBridge.writeFile(rootPath, 'AGENTS.md', buildAgentsTemplate(), allowGlobal);
    }
    if (!hasFile(items, 'BOOTSTRAP.md')) {
        await fsBridge.writeFile(rootPath, 'BOOTSTRAP.md', buildBootstrapTemplate(), allowGlobal);
    }
    if (!hasFile(items, 'HEARTBEAT.md')) {
        await fsBridge.writeFile(rootPath, 'HEARTBEAT.md', buildHeartbeatTemplate(), allowGlobal);
    }
    if (!hasFile(items, 'MEMORY.md')) {
        await fsBridge.writeFile(rootPath, 'MEMORY.md', buildMemoryTemplate(), allowGlobal);
    }
    if (!hasFile(items, 'Agent_Soul.md')) {
        await fsBridge.writeFile(rootPath, 'Agent_Soul.md', buildAgentSoulMarkdown({ name: 'Agent' }), allowGlobal);
    }
    if (!hasFile(items, 'USER.md')) {
        await fsBridge.writeFile(rootPath, 'USER.md', buildUserMarkdownFromProfile({ name: 'User' }), allowGlobal);
    }

    await ensureFolder(rootPath, 'memory', allowGlobal);
    await ensureFolder(rootPath, 'skills', allowGlobal);
    await ensureFolder(rootPath, 'temp', allowGlobal);
    await ensureFolder(rootPath, 'temp/documents', allowGlobal);
    await ensureFolder(rootPath, 'temp/audio', allowGlobal);
    await ensureFolder(rootPath, 'temp/archives', allowGlobal);
    await ensureFolder(rootPath, 'temp/others', allowGlobal);
    await ensureFolder(rootPath, 'voice_cache', allowGlobal);
    await ensureFolder(rootPath, 'voice_cache/user', allowGlobal);
    await ensureFolder(rootPath, 'voice_cache/agent', allowGlobal);

    // Profile files are created in the onboarding steps to ensure user-provided values.
};

export const ensureGalleryFolder = async (apiConfig: APIConfig): Promise<void> => {
    const galleryRoot = apiConfig.galleryWorkspacePath?.trim();
    if (!galleryRoot) return;
    const allowGlobal = !!apiConfig.securityPolicy?.allowGlobalFileAccess;
    try {
        await fsBridge.createFolder(galleryRoot, '.', allowGlobal);
    } catch { }
};
