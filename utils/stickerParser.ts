import { fsBridge } from './fsBridge';
import { StickerUsageRecord } from '../types';
import { StickerCleaner } from './stickerCleaner';

export interface StickerItem {
    name: string;
    url: string;
    category: string;
}

export interface StickerSet {
    category: string;
    aliases?: string[];
    items: StickerItem[];
}

export class StickerParser {
    /**
     * Lists all category names based on .txt files in stickers/ and existence of collection/
     */
    static async listCategories(workspaceRoot: string): Promise<string[]> {
        if (!workspaceRoot) return ['收藏'];

        const stickerDir = 'stickers/';
        const categories = new Set<string>(['收藏']);

        try {
            const items = await fsBridge.readDir(workspaceRoot, stickerDir, true);
            for (const item of items) {
                if (item.type === 'file' && item.name.endsWith('.txt')) {
                    categories.add(item.name.replace(/\.txt$/i, ''));
                }
            }
        } catch (e) {
            // Directory might not exist yet
            try { await fsBridge.createFolder(workspaceRoot, stickerDir, true); } catch (err) { }
        }

        return Array.from(categories);
    }

    /**
     * Loads a specific sticker set by category.
     */
    static async loadStickerSet(workspaceRoot: string, category: string): Promise<StickerSet> {
        if (!workspaceRoot) return { category, items: [] };

        if (category === '收藏') {
            const collectionDir = 'stickers/collection/';
            let items: StickerItem[] = [];
            try {
                const results = await fsBridge.readDir(workspaceRoot, collectionDir, true);
                for (const res of results) {
                    if (res.type === 'file' && this.isImageFile(res.name)) {
                        items.push({
                            name: res.name.replace(/\.[^/.]+$/, ""),
                            url: `local://${collectionDir}${res.name}`,
                            category: '收藏'
                        });
                    }
                }
            } catch (e) { }
            return { category: '收藏', items };
        }

        const filePath = `stickers/${category}.txt`;
        try {
            const content = await fsBridge.readFile(workspaceRoot, filePath, true);
            const aliasMatch = content.match(/^@别名:\s*(.+)$/m);
            const aliases = aliasMatch 
                ? aliasMatch[1].split(/[,，、]+/).map(s => s.trim()).filter(Boolean)
                : [];

            return {
                category,
                aliases,
                items: this.parseContent(content, category)
            };
        } catch (e) {
            return { category, items: [] };
        }
    }

    /**
     * Deletes a category (.txt file) from the stickers/ directory.
     */
    static async deleteCategory(workspaceRoot: string, category: string): Promise<boolean> {
        if (!workspaceRoot || category === '收藏') return false;
        try {
            await fsBridge.deleteFile(workspaceRoot, `stickers/${category}.txt`, true);
            return true;
        } catch (e) {
            return false;
        }
    }

    /**
     * Legacy/Fallback: Scans the stickers/ directory in the workspace and parses all valid files.
     * Use sparingly for global RAG indexing.
     */
    static async loadAllStickers(workspaceRoot: string): Promise<StickerSet[]> {
        const categories = await this.listCategories(workspaceRoot);
        const sets: StickerSet[] = [];
        for (const cat of categories) {
            sets.push(await this.loadStickerSet(workspaceRoot, cat));
        }
        return sets;
    }

    /**
     * Favorites a sticker by downloading and saving it to the collection/ directory.
     */
    static async favoriteSticker(workspaceRoot: string, name: string, url: string, allowGlobal: boolean = true): Promise<boolean> {
        if (!workspaceRoot || !url) return false;

        const collectionDirRelative = 'stickers/collection';
        const collectionDirFull = 'stickers/collection/';
        try {
            try {
                await fsBridge.readDir(workspaceRoot, collectionDirFull, allowGlobal);
            } catch (e) {
                await fsBridge.createFolder(workspaceRoot, collectionDirRelative, allowGlobal);
            }

            let ext = url.split('.').pop()?.split(/[?#]/)[0]?.toLowerCase() || 'png';
            if (!['png', 'jpg', 'jpeg', 'gif', 'webp'].includes(ext)) ext = 'png';

            const safeName = name.replace(/[\\/:*?"<>|]/g, '_').trim() || 'unnamed_sticker';
            const fileName = `${safeName}.${ext}`;
            const filePath = `${collectionDirRelative}/${fileName}`;

            const response = await fetch(url);
            if (!response.ok) throw new Error(`Download failed: ${response.status}`);
            const blob = await response.blob();
            const base64 = await new Promise<string>((resolve, reject) => {
                const reader = new FileReader();
                reader.onload = () => {
                    const data = String(reader.result || '');
                    resolve(data.includes(',') ? data.split(',')[1] : data);
                };
                reader.onerror = reject;
                reader.readAsDataURL(blob);
            });

            await fsBridge.writeFileBase64(workspaceRoot, filePath, base64, allowGlobal);
            return true;
        } catch (e) {
            console.error('Failed to favorite sticker:', e);
            return false;
        }
    }

    /**
     * Deletes a specific favorite sticker by its URL.
     */
    static async deleteFavorite(workspaceRoot: string, url: string): Promise<boolean> {
        if (!workspaceRoot || !url.startsWith('local://')) return false;
        try {
            const relPath = url.replace('local://', '');
            await fsBridge.deleteFile(workspaceRoot, relPath, true);
            return true;
        } catch (e) {
            return false;
        }
    }

    private static parseContent(content: string, category: string): StickerItem[] {
        const stickers = StickerCleaner.extractStickers(content);
        return stickers.map(s => ({ ...s, category }));
    }

    /**
     * Cleans and saves a document as a normalized sticker set.
     */
    static async normalizeAndSave(workspaceRoot: string, fileName: string, content: string): Promise<string> {
        try { await fsBridge.createFolder(workspaceRoot, 'stickers', true); } catch (e) { }

        // Basic sanity check for binary vs text (StickerCleaner will handle extraction)
        const cleanTxt = await StickerCleaner.cleanDocument(fileName, content);

        const cleanName = fileName.replace(/\.(txt|doc|docx|md)$/i, '') + '.txt';
        const path = `stickers/${cleanName}`;
        await fsBridge.writeFile(workspaceRoot, path, cleanTxt, true);
        return path;
    }

    static searchRelevantStickers(allSets: StickerSet[], prompt: string, limit = 15): StickerItem[] {
        return this.searchRelevantStickersWithCategory(allSets, prompt, limit);
    }

    /**
     * Build a compact index for prompting: category + a few sample stickers.
     */
    static buildStickerIndex(allSets: StickerSet[], maxPerCategory = 4, maxCategories = 12): string {
        const validSets = allSets
            .filter(s => s.items && s.items.length > 0)
            .sort((a, b) => b.items.length - a.items.length);

        const sliced = validSets.slice(0, maxCategories);
        const lines = sliced.map(set => {
            const samples = set.items.slice(0, maxPerCategory).map(i => i.name).join('、');
            const suffix = set.items.length > maxPerCategory ? `…共${set.items.length}个` : '';
            const aliasStr = set.aliases && set.aliases.length > 0 ? ` (也叫: ${set.aliases.join(', ')})` : '';
            return `[${set.category}${aliasStr}]: ${samples}${suffix}`;
        });

        const remaining = validSets.length - sliced.length;
        if (remaining > 0) lines.push(`…还有${remaining}个分类`);
        return lines.join('\n');
    }

    /**
     * Search relevant stickers, optionally preferring a category.
     */
    static searchRelevantStickersWithCategory(
        allSets: StickerSet[],
        prompt: string,
        limit = 15,
        preferCategory?: string,
        usageMap?: Map<string, StickerUsageRecord>
    ): StickerItem[] {
        const normalizedPrompt = String(prompt || '').toLowerCase();
        const keywords = normalizedPrompt
            .split(/[\s，,。.!?;:|/\\]+/)
            .map(k => k.trim())
            .filter(k => k.length > 0);

        const search = (sets: StickerSet[]) => {
            const flattened = sets.flatMap(set => set.items);
            if (keywords.length === 0) {
                // Return recently used if no keywords when usageMap is available, otherwise normal slice
                if (!usageMap) return flattened.slice(0, limit);
                return flattened.map(item => {
                    const usage = usageMap.get(item.name);
                    return { item, score: usage ? usage.count + (1000000000000 / (Date.now() - usage.lastUsedAt + 1)) : 0 };
                }).sort((a, b) => b.score - a.score).map(s => s.item).slice(0, limit);
            }

            const scored = flattened.map(item => {
                let score = 0;
                const parentSet = sets.find(s => s.category === item.category);
                const tagAliases = parentSet?.aliases || [];
                const target = (item.name + ' ' + item.category + ' ' + tagAliases.join(' ')).toLowerCase();
                
                for (const kw of keywords) {
                    if (target.includes(kw)) score += kw.length >= 2 ? 3 : 1;
                }

                if (score > 0 && usageMap) {
                    const usage = usageMap.get(item.name);
                    if (usage) {
                        score += (usage.count * 0.5);
                        const hoursSinceUse = (Date.now() - usage.lastUsedAt) / (1000 * 60 * 60);
                        if (hoursSinceUse <= 24) score += 1;
                        else if (hoursSinceUse <= 72) score += 0.5;
                    }
                }

                return { item, score };
            });

            return scored
                .filter(s => s.score > 0)
                .sort((a, b) => b.score - a.score)
                .slice(0, limit)
                .map(s => s.item);
        };

        if (preferCategory) {
            const primary = search(allSets.filter(s => s.category === preferCategory));
            if (primary.length > 0) return primary;
        }

        return search(allSets);
    }

    private static isImageFile(name: string): boolean {
        return /\.(jpg|jpeg|png|gif|webp)$/i.test(name);
    }
}
