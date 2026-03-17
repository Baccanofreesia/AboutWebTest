import { fsBridge } from './fsBridge';
import { APIConfig } from '../types';

export const workspaceFileExists = async (rootPath: string, fileName: string, allowGlobal: boolean): Promise<boolean> => {
    if (!rootPath || !fileName) return false;
    try {
        const items = await fsBridge.readDir(rootPath, '/', allowGlobal);
        return items.some(item => item.type === 'file' && item.name.toLowerCase() === fileName.toLowerCase());
    } catch {
        return false;
    }
};

export const needsProfileOnboarding = async (apiConfig: APIConfig): Promise<boolean> => {
    if (!apiConfig.nativeWorkspacePath || !apiConfig.galleryWorkspacePath) return true;
    const allowGlobal = !!apiConfig.securityPolicy?.allowGlobalFileAccess;
    const hasAgentSoul = await workspaceFileExists(apiConfig.nativeWorkspacePath, 'Agent_Soul.md', allowGlobal);
    const hasUserProfile = await workspaceFileExists(apiConfig.nativeWorkspacePath, 'USER.md', allowGlobal);
    return !hasAgentSoul || !hasUserProfile;
};
