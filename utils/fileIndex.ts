import { fsBridge } from './fsBridge';

export type FileIndexScope = 'workspace' | 'gallery' | 'dynamic_app';
export type FileIndexActor = 'user' | 'agent' | 'system';

export interface FileObjectIndexEntry {
    fileId: string;
    scope: FileIndexScope;
    currentPath: string;
    status: 'active' | 'deleted';
    hash: string;
    createdAt: number;
    updatedAt: number;
    lastSeenAt: number;
}

export interface FileTombstoneEntry {
    fileId: string;
    scope: FileIndexScope;
    lastPath: string;
    hash: string;
    deletedAt: number;
    reason?: string;
    actor?: FileIndexActor;
}

export interface FileEventRecord {
    eventId: string;
    ts: number;
    dayKey: string;
    scope: FileIndexScope;
    eventType: 'created' | 'updated' | 'moved' | 'deleted' | 'restored' | 'scanned';
    fileId: string;
    path?: string;
    fromPath?: string;
    toPath?: string;
    actor: FileIndexActor;
    reason?: string;
    hash: string;
}

export interface ResolveIndexedFileInput {
    indexRootPath: string;
    allowGlobal: boolean;
    scope: FileIndexScope;
    hintPath?: string;
    hintName?: string;
    fileId?: string;
    hash?: string;
    scanRootPath?: string;
    scanAllowGlobal?: boolean;
    maxScanDepth?: number;
    maxScanFiles?: number;
}

export interface ResolveIndexedFileResult {
    status: 'active' | 'moved' | 'deleted' | 'missing';
    fileId?: string;
    path?: string;
    matchedBy?: 'file_id' | 'hash' | 'path_alias' | 'path_exact' | 'name' | 'scan' | 'tombstone';
    tombstone?: FileTombstoneEntry;
}

interface ObjectIndexDoc {
    version: number;
    updatedAt: number;
    objects: Record<string, FileObjectIndexEntry>;
}

interface PathAliasDoc {
    version: number;
    updatedAt: number;
    aliases: Record<string, string>;
}

interface TombstoneDoc {
    version: number;
    updatedAt: number;
    tombstones: Record<string, FileTombstoneEntry>;
}

const INDEX_DIR = 'memory/indexes/files';
const OBJECT_INDEX_PATH = `${INDEX_DIR}/object_index.json`;
const PATH_ALIAS_PATH = `${INDEX_DIR}/path_alias.json`;
const TOMBSTONE_PATH = `${INDEX_DIR}/tombstone.json`;
const EVENTS_ROOT = `${INDEX_DIR}/events`;

const DEFAULT_OBJECT_DOC: ObjectIndexDoc = {
    version: 1,
    updatedAt: 0,
    objects: {},
};

const DEFAULT_ALIAS_DOC: PathAliasDoc = {
    version: 1,
    updatedAt: 0,
    aliases: {},
};

const DEFAULT_TOMBSTONE_DOC: TombstoneDoc = {
    version: 1,
    updatedAt: 0,
    tombstones: {},
};

const pad = (n: number) => String(n).padStart(2, '0');

const dayKeyOf = (ts: number) => {
    const d = new Date(ts);
    return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;
};

const eventId = (ts: number) => {
    const rand = Math.random().toString(36).slice(2, 8);
    return `fidx-${ts}-${rand}`;
};

const normalizePath = (value: string): string => {
    let out = String(value || '').trim().replace(/\\/g, '/');
    if (!out) return '';
    out = out.replace(/\/+/g, '/');
    if (out.startsWith('@agent_apps/')) return out.replace(/\/$/, '');
    if (!out.startsWith('/')) out = `/${out}`;
    if (out.length > 1 && out.endsWith('/')) out = out.slice(0, -1);
    return out;
};

const normalizeHash = (value: string): string => String(value || '').trim().toLowerCase();

const fastHash = (text: string): string => {
    let hash = 5381;
    for (let i = 0; i < text.length; i += 1) {
        hash = ((hash << 5) + hash) ^ text.charCodeAt(i);
    }
    return (hash >>> 0).toString(16).padStart(8, '0');
};

const buildFileId = (scope: FileIndexScope, path: string): string => {
    const seed = `${scope}:${path}`;
    return `${scope}-${fastHash(seed)}`;
};

const buildHash = (scope: FileIndexScope, path: string, fallbackTs: number): string => {
    const seed = `${scope}:${path}:${fallbackTs}`;
    return fastHash(seed);
};

const readJsonSafe = async <T>(rootPath: string, path: string, allowGlobal: boolean, fallback: T): Promise<T> => {
    try {
        const raw = await fsBridge.readFile(rootPath, path, allowGlobal);
        const parsed = JSON.parse(raw) as T;
        return parsed || fallback;
    } catch {
        return fallback;
    }
};

const ensureBaseFolders = async (rootPath: string, allowGlobal: boolean) => {
    try { await fsBridge.createFolder(rootPath, 'memory', allowGlobal); } catch { }
    try { await fsBridge.createFolder(rootPath, 'memory/indexes', allowGlobal); } catch { }
    try { await fsBridge.createFolder(rootPath, INDEX_DIR, allowGlobal); } catch { }
    try { await fsBridge.createFolder(rootPath, EVENTS_ROOT, allowGlobal); } catch { }
};

const writeJsonSafe = async (rootPath: string, path: string, allowGlobal: boolean, value: unknown) => {
    await fsBridge.writeFile(rootPath, path, JSON.stringify(value, null, 2), allowGlobal);
};

const readAllDocs = async (rootPath: string, allowGlobal: boolean) => {
    await ensureBaseFolders(rootPath, allowGlobal);
    const [objects, aliases, tombstones] = await Promise.all([
        readJsonSafe<ObjectIndexDoc>(rootPath, OBJECT_INDEX_PATH, allowGlobal, DEFAULT_OBJECT_DOC),
        readJsonSafe<PathAliasDoc>(rootPath, PATH_ALIAS_PATH, allowGlobal, DEFAULT_ALIAS_DOC),
        readJsonSafe<TombstoneDoc>(rootPath, TOMBSTONE_PATH, allowGlobal, DEFAULT_TOMBSTONE_DOC),
    ]);
    return {
        objects: {
            version: 1,
            updatedAt: Number(objects?.updatedAt || 0),
            objects: { ...(objects?.objects || {}) },
        } as ObjectIndexDoc,
        aliases: {
            version: 1,
            updatedAt: Number(aliases?.updatedAt || 0),
            aliases: { ...(aliases?.aliases || {}) },
        } as PathAliasDoc,
        tombstones: {
            version: 1,
            updatedAt: Number(tombstones?.updatedAt || 0),
            tombstones: { ...(tombstones?.tombstones || {}) },
        } as TombstoneDoc,
    };
};

const saveDocs = async (
    rootPath: string,
    allowGlobal: boolean,
    docs: { objects: ObjectIndexDoc; aliases: PathAliasDoc; tombstones: TombstoneDoc; },
) => {
    docs.objects.updatedAt = Date.now();
    docs.aliases.updatedAt = Date.now();
    docs.tombstones.updatedAt = Date.now();
    await Promise.all([
        writeJsonSafe(rootPath, OBJECT_INDEX_PATH, allowGlobal, docs.objects),
        writeJsonSafe(rootPath, PATH_ALIAS_PATH, allowGlobal, docs.aliases),
        writeJsonSafe(rootPath, TOMBSTONE_PATH, allowGlobal, docs.tombstones),
    ]);
};

const eventFolder = (dayKey: string) => {
    const [year, month] = dayKey.split('-');
    return `${EVENTS_ROOT}/${year}/${year}-${month}`;
};

const appendEvent = async (rootPath: string, allowGlobal: boolean, event: FileEventRecord) => {
    const day = event.dayKey;
    const folder = eventFolder(day);
    try { await fsBridge.createFolder(rootPath, folder, allowGlobal); } catch { }
    const filePath = `${folder}/${day}.events.jsonl`;
    let existing = '';
    try {
        existing = await fsBridge.readFile(rootPath, filePath, allowGlobal);
    } catch {
        existing = '';
    }
    const next = `${existing}${JSON.stringify(event)}\n`;
    await fsBridge.writeFile(rootPath, filePath, next, allowGlobal);
};

const removeAliasesForFileId = (aliases: Record<string, string>, fileId: string) => {
    Object.keys(aliases).forEach(key => {
        if (aliases[key] === fileId) delete aliases[key];
    });
};

const readDirSafe = async (rootPath: string, dirPath: string, allowGlobal: boolean) => {
    try {
        return await fsBridge.readDir(rootPath, dirPath, allowGlobal);
    } catch {
        return [];
    }
};

const fileExistsAtPath = async (rootPath: string, absolutePath: string, allowGlobal: boolean): Promise<boolean> => {
    const normalized = normalizePath(absolutePath);
    if (!normalized || normalized === '/') return false;
    const slash = normalized.lastIndexOf('/');
    const parent = slash <= 0 ? '/' : normalized.slice(0, slash + 1);
    const name = normalized.slice(slash + 1);
    if (!name) return false;
    const items = await readDirSafe(rootPath, parent, allowGlobal);
    return items.some(item => item.type === 'file' && String(item.name || '').toLowerCase() === name.toLowerCase());
};

const scanFiles = async (
    rootPath: string,
    allowGlobal: boolean,
    options?: { maxDepth?: number; maxFiles?: number; },
): Promise<string[]> => {
    const maxDepth = Math.max(1, options?.maxDepth ?? 6);
    const maxFiles = Math.max(50, options?.maxFiles ?? 800);
    const found: string[] = [];

    const walk = async (dir: string, depth: number): Promise<void> => {
        if (depth > maxDepth || found.length >= maxFiles) return;
        const items = await readDirSafe(rootPath, dir, allowGlobal);
        for (const item of items) {
            if (found.length >= maxFiles) break;
            const name = String(item.name || '');
            if (!name) continue;
            const path = dir === '/' ? `/${name}` : `${dir}${name}`;
            if (item.type === 'file') {
                found.push(normalizePath(path));
            } else if (item.type === 'folder') {
                const nextDir = dir === '/' ? `/${name}/` : `${dir}${name}/`;
                await walk(nextDir, depth + 1);
            }
        }
    };

    await walk('/', 0);
    return found;
};

const pickByName = (paths: string[], name: string): string | undefined => {
    const target = String(name || '').trim().toLowerCase();
    if (!target) return undefined;
    return paths.find(p => p.toLowerCase().endsWith(`/${target}`));
};

export const FileIndex = {
    async trackFileUpsert(input: {
        indexRootPath: string;
        allowGlobal: boolean;
        scope: FileIndexScope;
        path: string;
        fileId?: string;
        hash?: string;
        actor?: FileIndexActor;
        reason?: string;
    }): Promise<FileObjectIndexEntry | null> {
        const indexRootPath = String(input.indexRootPath || '').trim();
        if (!indexRootPath) return null;
        const path = normalizePath(input.path);
        if (!path) return null;
        const now = Date.now();
        const docs = await readAllDocs(indexRootPath, input.allowGlobal);

        const existingByPath = docs.aliases.aliases[path];
        const fileId = String(input.fileId || existingByPath || buildFileId(input.scope, path)).trim();
        if (!fileId) return null;
        const hash = normalizeHash(input.hash || '') || buildHash(input.scope, path, now);

        const existing = docs.objects.objects[fileId];
        const wasDeleted = !!docs.tombstones.tombstones[fileId];
        const prevPath = existing?.currentPath;

        docs.objects.objects[fileId] = {
            fileId,
            scope: input.scope,
            currentPath: path,
            status: 'active',
            hash,
            createdAt: existing?.createdAt || now,
            updatedAt: now,
            lastSeenAt: now,
        };
        docs.aliases.aliases[path] = fileId;
        if (prevPath && prevPath !== path) {
            docs.aliases.aliases[prevPath] = fileId;
        }
        delete docs.tombstones.tombstones[fileId];

        await saveDocs(indexRootPath, input.allowGlobal, docs);
        const event: FileEventRecord = {
            eventId: eventId(now),
            ts: now,
            dayKey: dayKeyOf(now),
            scope: input.scope,
            eventType: wasDeleted ? 'restored' : existing ? 'updated' : 'created',
            fileId,
            path,
            actor: input.actor || 'system',
            reason: input.reason,
            hash,
        };
        await appendEvent(indexRootPath, input.allowGlobal, event);
        return docs.objects.objects[fileId];
    },

    async trackFileMove(input: {
        indexRootPath: string;
        allowGlobal: boolean;
        scope: FileIndexScope;
        fromPath: string;
        toPath: string;
        actor?: FileIndexActor;
        reason?: string;
    }): Promise<FileObjectIndexEntry | null> {
        const indexRootPath = String(input.indexRootPath || '').trim();
        if (!indexRootPath) return null;
        const fromPath = normalizePath(input.fromPath);
        const toPath = normalizePath(input.toPath);
        if (!fromPath || !toPath) return null;
        const now = Date.now();
        const docs = await readAllDocs(indexRootPath, input.allowGlobal);

        const fileId =
            docs.aliases.aliases[fromPath] ||
            docs.aliases.aliases[toPath] ||
            buildFileId(input.scope, toPath);
        const existing = docs.objects.objects[fileId];
        const hash = existing?.hash || buildHash(input.scope, toPath, now);

        docs.objects.objects[fileId] = {
            fileId,
            scope: input.scope,
            currentPath: toPath,
            status: 'active',
            hash,
            createdAt: existing?.createdAt || now,
            updatedAt: now,
            lastSeenAt: now,
        };
        docs.aliases.aliases[fromPath] = fileId;
        docs.aliases.aliases[toPath] = fileId;
        delete docs.tombstones.tombstones[fileId];

        await saveDocs(indexRootPath, input.allowGlobal, docs);
        const event: FileEventRecord = {
            eventId: eventId(now),
            ts: now,
            dayKey: dayKeyOf(now),
            scope: input.scope,
            eventType: 'moved',
            fileId,
            fromPath,
            toPath,
            actor: input.actor || 'system',
            reason: input.reason,
            hash,
        };
        await appendEvent(indexRootPath, input.allowGlobal, event);
        return docs.objects.objects[fileId];
    },

    async trackFileDelete(input: {
        indexRootPath: string;
        allowGlobal: boolean;
        scope: FileIndexScope;
        path?: string;
        fileId?: string;
        hash?: string;
        actor?: FileIndexActor;
        reason?: string;
    }): Promise<FileTombstoneEntry | null> {
        const indexRootPath = String(input.indexRootPath || '').trim();
        if (!indexRootPath) return null;
        const path = normalizePath(input.path || '');
        const now = Date.now();
        const docs = await readAllDocs(indexRootPath, input.allowGlobal);

        const fileId =
            String(input.fileId || '').trim() ||
            (path ? docs.aliases.aliases[path] : '') ||
            '';
        const resolvedFileId = fileId || (path ? buildFileId(input.scope, path) : '');
        if (!resolvedFileId) return null;

        const existing = docs.objects.objects[resolvedFileId];
        const lastPath = path || existing?.currentPath || '';
        const hash = normalizeHash(input.hash || existing?.hash || '') || buildHash(input.scope, lastPath || resolvedFileId, now);

        docs.objects.objects[resolvedFileId] = {
            fileId: resolvedFileId,
            scope: input.scope,
            currentPath: lastPath,
            status: 'deleted',
            hash,
            createdAt: existing?.createdAt || now,
            updatedAt: now,
            lastSeenAt: existing?.lastSeenAt || now,
        };
        removeAliasesForFileId(docs.aliases.aliases, resolvedFileId);
        const tombstone: FileTombstoneEntry = {
            fileId: resolvedFileId,
            scope: input.scope,
            lastPath,
            hash,
            deletedAt: now,
            reason: input.reason,
            actor: input.actor || 'system',
        };
        docs.tombstones.tombstones[resolvedFileId] = tombstone;

        await saveDocs(indexRootPath, input.allowGlobal, docs);
        const event: FileEventRecord = {
            eventId: eventId(now),
            ts: now,
            dayKey: dayKeyOf(now),
            scope: input.scope,
            eventType: 'deleted',
            fileId: resolvedFileId,
            path: lastPath,
            actor: input.actor || 'system',
            reason: input.reason,
            hash,
        };
        await appendEvent(indexRootPath, input.allowGlobal, event);
        return tombstone;
    },

    async resolveIndexedFile(input: ResolveIndexedFileInput): Promise<ResolveIndexedFileResult> {
        const indexRootPath = String(input.indexRootPath || '').trim();
        if (!indexRootPath) return { status: 'missing' };
        const docs = await readAllDocs(indexRootPath, input.allowGlobal);
        const hintPath = normalizePath(input.hintPath || '');
        const hintName = String(input.hintName || '').trim();
        const safeHash = normalizeHash(input.hash || '');
        const scanRootPath = String(input.scanRootPath || '').trim();
        const scanAllowGlobal = typeof input.scanAllowGlobal === 'boolean'
            ? input.scanAllowGlobal
            : input.allowGlobal;

        const byFileId = String(input.fileId || '').trim();
        if (byFileId) {
            const entry = docs.objects.objects[byFileId];
            if (entry) {
                if (entry.status === 'deleted') {
                    return {
                        status: 'deleted',
                        fileId: byFileId,
                        path: entry.currentPath,
                        matchedBy: 'file_id',
                        tombstone: docs.tombstones.tombstones[byFileId],
                    };
                }
                if (scanRootPath) {
                    const exists = await fileExistsAtPath(scanRootPath, entry.currentPath, scanAllowGlobal);
                    if (exists) return { status: 'active', fileId: byFileId, path: entry.currentPath, matchedBy: 'file_id' };
                } else {
                    return { status: 'active', fileId: byFileId, path: entry.currentPath, matchedBy: 'file_id' };
                }
            }
        }

        if (safeHash) {
            const entries = Object.values(docs.objects.objects);
            const found = entries.find(e => e.scope === input.scope && normalizeHash(e.hash) === safeHash);
            if (found) {
                if (found.status === 'deleted') {
                    return {
                        status: 'deleted',
                        fileId: found.fileId,
                        path: found.currentPath,
                        matchedBy: 'hash',
                        tombstone: docs.tombstones.tombstones[found.fileId],
                    };
                }
                return { status: 'active', fileId: found.fileId, path: found.currentPath, matchedBy: 'hash' };
            }
        }

        if (hintPath) {
            const aliasFileId = docs.aliases.aliases[hintPath];
            if (aliasFileId) {
                const entry = docs.objects.objects[aliasFileId];
                if (entry) {
                    if (entry.status === 'deleted') {
                        return {
                            status: 'deleted',
                            fileId: aliasFileId,
                            path: entry.currentPath,
                            matchedBy: 'path_alias',
                            tombstone: docs.tombstones.tombstones[aliasFileId],
                        };
                    }
                    if (entry.currentPath !== hintPath) {
                        return {
                            status: 'moved',
                            fileId: aliasFileId,
                            path: entry.currentPath,
                            matchedBy: 'path_alias',
                        };
                    }
                    if (scanRootPath) {
                        const exists = await fileExistsAtPath(scanRootPath, entry.currentPath, scanAllowGlobal);
                        if (exists) return { status: 'active', fileId: aliasFileId, path: entry.currentPath, matchedBy: 'path_exact' };
                    } else {
                        return { status: 'active', fileId: aliasFileId, path: entry.currentPath, matchedBy: 'path_exact' };
                    }
                }
            }

            const byPathEntry = Object.values(docs.objects.objects).find(
                e => e.scope === input.scope && e.currentPath === hintPath,
            );
            if (byPathEntry) {
                if (byPathEntry.status === 'deleted') {
                    return {
                        status: 'deleted',
                        fileId: byPathEntry.fileId,
                        path: byPathEntry.currentPath,
                        matchedBy: 'path_exact',
                        tombstone: docs.tombstones.tombstones[byPathEntry.fileId],
                    };
                }
                return { status: 'active', fileId: byPathEntry.fileId, path: byPathEntry.currentPath, matchedBy: 'path_exact' };
            }
        }

        if (hintName) {
            const byName = Object.values(docs.objects.objects).find(
                e =>
                    e.scope === input.scope &&
                    e.status === 'active' &&
                    e.currentPath.toLowerCase().endsWith(`/${hintName.toLowerCase()}`),
            );
            if (byName) {
                return { status: 'active', fileId: byName.fileId, path: byName.currentPath, matchedBy: 'name' };
            }
        }

        if (scanRootPath) {
            const scannedPaths = await scanFiles(scanRootPath, scanAllowGlobal, {
                maxDepth: input.maxScanDepth,
                maxFiles: input.maxScanFiles,
            });
            let scannedMatch = '';
            if (hintPath) {
                scannedMatch = scannedPaths.find(p => p.toLowerCase() === hintPath.toLowerCase()) || '';
            }
            if (!scannedMatch && hintName) {
                scannedMatch = pickByName(scannedPaths, hintName) || '';
            }
            if (!scannedMatch && hintPath) {
                const bySameName = pickByName(scannedPaths, hintPath.split('/').pop() || '');
                scannedMatch = bySameName || '';
            }
            if (scannedMatch) {
                const knownId = docs.aliases.aliases[hintPath] || buildFileId(input.scope, scannedMatch);
                await this.trackFileUpsert({
                    indexRootPath,
                    allowGlobal: input.allowGlobal,
                    scope: input.scope,
                    path: scannedMatch,
                    fileId: knownId,
                    actor: 'system',
                    reason: 'scan_backfill',
                });
                return {
                    status: hintPath && scannedMatch !== hintPath ? 'moved' : 'active',
                    fileId: knownId,
                    path: scannedMatch,
                    matchedBy: 'scan',
                };
            }
        }

        if (hintPath || hintName) {
            const tombstone = Object.values(docs.tombstones.tombstones).find(t => {
                if (t.scope !== input.scope) return false;
                if (hintPath && t.lastPath.toLowerCase() === hintPath.toLowerCase()) return true;
                if (hintName && t.lastPath.toLowerCase().endsWith(`/${hintName.toLowerCase()}`)) return true;
                return false;
            });
            if (tombstone) {
                return {
                    status: 'deleted',
                    fileId: tombstone.fileId,
                    path: tombstone.lastPath,
                    matchedBy: 'tombstone',
                    tombstone,
                };
            }
        }

        return { status: 'missing' };
    },
};

