import { DB, WorkspaceFile } from './db';
import { fsBridge } from './fsBridge';
import { APIConfig } from '../types';

let isSyncing = false;

async function ensureTempFolders(apiConfig: APIConfig) {
    const root = apiConfig.nativeWorkspacePath;
    if (!root) return;
    const allowGlobal = !!apiConfig.securityPolicy?.allowGlobalFileAccess;
    const folders = ['temp', 'temp/documents', 'temp/audio', 'temp/archives', 'temp/others', 'voice_cache', 'voice_cache/user', 'voice_cache/agent'];
    for (const folder of folders) {
        try {
            await fsBridge.createFolder(root, folder, allowGlobal);
        } catch { }
    }
}

export async function syncWorkspaceFromDisk(apiConfig: APIConfig) {
    if (!apiConfig.nativeWorkspacePath) {
        console.log("[Boot Sync] Skipping: No nativeWorkspacePath configured.");
        return;
    }

    if (isSyncing) {
        console.log("[Boot Sync] Already syncing, skipping duplicate call...");
        return;
    }
    isSyncing = true;

    try {
        console.log("[Boot Sync] Starting deep scan of physical workspace...");
        await ensureTempFolders(apiConfig);

        // 1. Wipe the current IndexedDB workspace cache (SSOT is the disk)
        await DB.clearWorkspaceFiles();

        // 2. We can seed the default folders if we want, but since they exist on disk, we just read them.
        // If the disk is entirely empty, we should let `CheckPhoneApp` or db seed it if needed, or we seed here:
        // Actually, if disk is empty, we probably want to create default folders ON DISK.
        // For now, let's just sync whatever is on disk.

        const now = Date.now();
        // The root folder itself isn't strictly needed as a file entry, but useful for mapping

        const traverseAndSync = async (currentPath: string) => {
            try {
                const items = await fsBridge.readDir(apiConfig.nativeWorkspacePath!, currentPath);

                for (const item of items) {
                    const fileId = `ws-${Date.now()}-${Math.random().toString(36).slice(2, 6)}`;

                    const newFile: WorkspaceFile = {
                        id: fileId,
                        name: item.name,
                        path: currentPath,
                        type: item.type,
                        size: item.size || 0,
                        createdAt: item.createdAt || Date.now(),
                        updatedAt: item.updatedAt || Date.now()
                    };

                    await DB.saveWorkspaceFile(newFile);

                    if (item.type === 'folder') {
                        const nextPath = currentPath === '/' ? `/${item.name}/` : `${currentPath}${item.name}/`;
                        await traverseAndSync(nextPath);
                    }
                }
            } catch (err) {
                console.warn(`[Boot Sync] Could not read directory ${currentPath}`, err);
            }
        };

        await traverseAndSync('/');
        console.log("[Boot Sync] Complete. IndexedDB is now a mirror of the physical disk.");

    } catch (e) {
        console.error("[Boot Sync] Failed to sync workspace from disk:", e);
    } finally {
        isSyncing = false;
    }
}
