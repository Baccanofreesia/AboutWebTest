export type ChatFileCategory = 'documents' | 'audio' | 'archives' | 'others';

const DOC_EXT = new Set(['txt', 'md', 'pdf', 'doc', 'docx', 'rtf', 'csv', 'json', 'xml', 'yaml', 'yml', 'ppt', 'pptx', 'xls', 'xlsx']);
const AUDIO_EXT = new Set(['mp3', 'wav', 'ogg', 'm4a', 'flac', 'aac']);
const ARCHIVE_EXT = new Set(['zip', 'rar', '7z', 'tar', 'gz']);
const FORBIDDEN_EXT = new Set(['png', 'jpg', 'jpeg', 'gif', 'webp', 'bmp', 'mp4', 'mov', 'mkv', 'webm', 'avi']);

export function fileExt(name: string): string {
    const idx = name.lastIndexOf('.');
    return idx === -1 ? '' : name.slice(idx + 1).toLowerCase();
}

export function splitFileName(name: string): { base: string; ext: string } {
    const idx = name.lastIndexOf('.');
    if (idx === -1) return { base: name, ext: '' };
    return { base: name.slice(0, idx), ext: name.slice(idx + 1).toLowerCase() };
}

export function sanitizeFileName(name: string): string {
    const { base, ext } = splitFileName(name);
    const safeBase = base.replace(/[\\/:*?"<>|]/g, '_').replace(/\s+/g, ' ').trim().slice(0, 80) || 'file';
    return ext ? `${safeBase}.${ext}` : safeBase;
}

export function isForbiddenMediaFile(name: string): boolean {
    return FORBIDDEN_EXT.has(fileExt(name));
}

export function classifyChatFile(file: File): ChatFileCategory {
    const ext = fileExt(file.name);
    const mime = (file.type || '').toLowerCase();
    if (mime.startsWith('audio/') || AUDIO_EXT.has(ext)) return 'audio';
    if (ARCHIVE_EXT.has(ext)) return 'archives';
    if (DOC_EXT.has(ext) || mime.startsWith('text/') || mime.includes('pdf') || mime.includes('word') || mime.includes('officedocument')) return 'documents';
    return 'others';
}

export function buildTempRelativePath(fileName: string, category: ChatFileCategory): string {
    return `temp/${category}/${sanitizeFileName(fileName)}`;
}

export function buildRenamedFileName(fileName: string, index: number): string {
    const { base, ext } = splitFileName(sanitizeFileName(fileName));
    if (index <= 0) return ext ? `${base}.${ext}` : base;
    return ext ? `${base}(${index}).${ext}` : `${base}(${index})`;
}

export async function fileToBase64(file: File): Promise<string> {
    return await new Promise((resolve, reject) => {
        const r = new FileReader();
        r.onload = () => {
            const dataUrl = (r.result || '').toString();
            const base64 = dataUrl.includes(',') ? dataUrl.split(',')[1] : dataUrl;
            resolve(base64);
        };
        r.onerror = () => reject(r.error || new Error('read file failed'));
        r.readAsDataURL(file);
    });
}

export async function extractTextPreview(file: File): Promise<string> {
    const ext = fileExt(file.name);
    const mime = (file.type || '').toLowerCase();
    if (mime.startsWith('text/') || ['txt', 'md', 'csv', 'json', 'xml', 'yaml', 'yml', 'log'].includes(ext)) {
        const text = await file.text();
        return text.slice(0, 3000);
    }
    return '';
}

export function inferMimeTypeByName(fileName: string): string {
    const ext = fileExt(fileName);
    if (AUDIO_EXT.has(ext)) return `audio/${ext === 'mp3' ? 'mpeg' : ext}`;
    if (ext === 'pdf') return 'application/pdf';
    if (ext === 'txt') return 'text/plain';
    if (ext === 'md') return 'text/markdown';
    if (ext === 'csv') return 'text/csv';
    if (ext === 'json') return 'application/json';
    if (ext === 'xml') return 'application/xml';
    if (ext === 'doc') return 'application/msword';
    if (ext === 'docx') return 'application/vnd.openxmlformats-officedocument.wordprocessingml.document';
    if (ext === 'pptx') return 'application/vnd.openxmlformats-officedocument.presentationml.presentation';
    if (ext === 'xlsx') return 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet';
    if (ARCHIVE_EXT.has(ext)) return 'application/octet-stream';
    return 'application/octet-stream';
}
