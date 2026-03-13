
/**
 * StickerCleaner utility handles the normalization of external sticker sources.
 * It extracts URLs and descriptive text from various document formats and 
 * generates standardized .txt stickers sets.
 */

export class StickerCleaner {
    /**
     * Extracts all sticker-like URLs from a string.
     * Looks for images, gifs, and common sticker hosting patterns.
     */
    static extractStickers(content: string): { name: string, url: string }[] {
        const stickers: { name: string, url: string }[] = [];
        // Regex: Matches http(s) URLs ending in image extensions or having 'sticker' in path
        const urlPat = /(https?:\/\/[^\s"'<>]+(?:\.(?:png|jpg|jpeg|gif|webp)|sticker|v-sticker)[^\s"'<>]*)/gi;
        
        const lines = content.split(/\r?\n/).filter(l => l.trim());
        
        for (const line of lines) {
            let match;
            while ((match = urlPat.exec(line)) !== null) {
                const url = match[0];
                // Try to find a name: usually before or after the URL on the same line
                let name = line.replace(url, '').trim()
                    .replace(/[\[\]\(\):：\s-]+/g, ' ') // Clean punctuation
                    .trim();
                
                if (!name || name.length < 2) {
                    // Fallback to filename
                    const parts = url.split('/');
                    const filename = parts[parts.length - 1] || '';
                    name = filename.split(/[.?#]/)[0] || '未命名表情';
                }
                
                // Limit name length
                if (name.length > 20) name = name.slice(0, 20) + '...';
                
                stickers.push({ name, url });
            }
        }
        
        // Deduplicate by URL
        const seen = new Set();
        return stickers.filter(s => {
            if (seen.has(s.url)) return false;
            seen.add(s.url);
            return true;
        });
    }

    /**
     * Converts the extracted stickers into a standard .txt format.
     */
    static toStandardTxt(stickers: { name: string, url: string }[]): string {
        return stickers.map(s => `${s.name}: ${s.url}`).join('\n');
    }

    /**
     * Placeholder for .doc/.docx cleaning. 
     * In a real environment, this might call a backend service or use a library like mammoth.
     * Currently extracts URLs from the raw text if possible.
     */
    static async cleanDocument(filename: string, content: string): Promise<string> {
        // If content looks like binary but we have no library, we can only do so much.
        // For .txt and .md, this works great.
        const stickers = this.extractStickers(content);
        if (stickers.length === 0) {
            throw new Error(`在文件 "${filename}" 中未找到有效的表情链接。请确保文件包含 http(s) 链接。`);
        }
        return this.toStandardTxt(stickers);
    }
}
