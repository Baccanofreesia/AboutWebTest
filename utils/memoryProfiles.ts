/**
 * memoryProfiles.ts — L4 Dynamic Evolution Buffer
 *
 * Sits between L3b approved proposals and the stable core files.
 * Every approved proposal is first recorded here.  Only after the same
 * observation is confirmed PROMOTION_THRESHOLD times is it written to
 * USER.md / Agent_Soul.md / MEMORY.md.
 *
 * Physical files (created on first write, never pre-created):
 *   memory/profiles/user_impression.json     ← user_profile proposals
 *   memory/profiles/relation_state.json      ← relationship_core proposals
 *   memory/profiles/agent_persona_patch.json ← about_agent proposals
 */

import { fsBridge } from './fsBridge';
import { CoreProposal, CoreProposalCategory, L4ProfileEntry, L4ProfileFile } from '../types';

// ── Constants ─────────────────────────────────────────────────────────────────

/** Approvals needed before an entry is promoted to the stable core. */
export const PROFILE_PROMOTION_THRESHOLD = 2;

const PROFILE_FILE: Record<CoreProposalCategory, string> = {
    user_profile:      'memory/profiles/user_impression.json',
    relationship_core: 'memory/profiles/relation_state.json',
    about_agent:        'memory/profiles/agent_persona_patch.json',
};

// ── Helpers ───────────────────────────────────────────────────────────────────

const makeFingerprint = (text: string): string =>
    text.toLowerCase().trim().slice(0, 50);

const makeEntryId = () =>
    `prof-${Date.now()}-${Math.random().toString(36).slice(2, 7)}`;

const emptyProfileFile = (category: CoreProposalCategory): L4ProfileFile => ({
    version: 1,
    category,
    updatedAt: 0,
    entries: [],
});

const readProfileFile = async (
    rootPath: string,
    filePath: string,
    allowGlobal: boolean,
    category: CoreProposalCategory,
): Promise<L4ProfileFile> => {
    try {
        const raw = await fsBridge.readFile(rootPath, filePath, allowGlobal);
        const parsed = JSON.parse(raw) as L4ProfileFile;
        if (!Array.isArray(parsed.entries)) parsed.entries = [];
        return parsed;
    } catch {
        return emptyProfileFile(category);
    }
};

const writeProfileFile = async (
    rootPath: string,
    filePath: string,
    allowGlobal: boolean,
    data: L4ProfileFile,
): Promise<void> => {
    data.updatedAt = Date.now();
    await fsBridge.writeFile(rootPath, filePath, JSON.stringify(data, null, 2), allowGlobal);
};

// ── Core API ──────────────────────────────────────────────────────────────────

/**
 * Records an approved proposal into the profiles/ buffer.
 *
 * Algorithm:
 *   1. Read the category's profile file (create in memory if absent — no
 *      pre-creation on disk; the file is only written when there is content).
 *   2. Look for an existing entry whose fingerprint matches the proposal text.
 *   3. If found → increment approvalCount + add proposalId to provenance.
 *   4. If not found → create a new entry with approvalCount = 1.
 *   5. If approvalCount reaches PROFILE_PROMOTION_THRESHOLD → mark promoted.
 *   6. Write the updated file back.
 *
 * Returns { promoted: boolean } — the caller uses this to decide whether to
 * also write the entry to the stable core files (USER.md / Agent_Soul.md).
 */
export const recordProfileApproval = async (
    rootPath: string,
    allowGlobal: boolean,
    proposal: CoreProposal,
): Promise<{ promoted: boolean; entry: L4ProfileEntry }> => {
    const filePath = PROFILE_FILE[proposal.category];
    const profile = await readProfileFile(rootPath, filePath, allowGlobal, proposal.category);

    const fingerprint = makeFingerprint(proposal.proposal);
    const now = Date.now();

    const existing = profile.entries.find(e => e.fingerprint === fingerprint);

    let entry: L4ProfileEntry;
    if (existing) {
        // Already seen — increment count
        existing.approvalCount += 1;
        existing.lastApprovedAt = now;
        existing.content = proposal.proposal; // take latest wording
        existing.reason = proposal.reason;
        if (!existing.sourceProposalIds.includes(proposal.id)) {
            existing.sourceProposalIds.push(proposal.id);
        }
        // Check promotion
        if (!existing.promoted && existing.approvalCount >= PROFILE_PROMOTION_THRESHOLD) {
            existing.promoted = true;
            existing.promotedAt = now;
        }
        entry = existing;
    } else {
        // First time seeing this observation
        entry = {
            id: makeEntryId(),
            category: proposal.category,
            content: proposal.proposal,
            reason: proposal.reason,
            fingerprint,
            sourceProposalIds: [proposal.id],
            firstApprovedAt: now,
            lastApprovedAt: now,
            approvalCount: 1,
            promoted: PROFILE_PROMOTION_THRESHOLD <= 1, // instant-promote if threshold is 1
            promotedAt: PROFILE_PROMOTION_THRESHOLD <= 1 ? now : undefined,
        };
        profile.entries.push(entry);
    }

    await writeProfileFile(rootPath, filePath, allowGlobal, profile);

    return { promoted: entry.promoted, entry };
};

/**
 * Returns all non-promoted (still "active observation") entries across all
 * three profile files.  Used for context injection into the chat prompt.
 */
export const readActiveProfileEntries = async (
    rootPath: string,
    allowGlobal: boolean,
): Promise<L4ProfileEntry[]> => {
    if (!rootPath) return [];
    const all: L4ProfileEntry[] = [];
    for (const [, filePath] of Object.entries(PROFILE_FILE)) {
        try {
            const raw = await fsBridge.readFile(rootPath, filePath, allowGlobal);
            const parsed = JSON.parse(raw) as L4ProfileFile;
            if (Array.isArray(parsed.entries)) {
                parsed.entries
                    .filter(e => !e.promoted)
                    .forEach(e => all.push(e));
            }
        } catch {
            // File doesn't exist yet — skip silently
        }
    }
    return all;
};

const CATEGORY_LABEL: Record<CoreProposalCategory, string> = {
    user_profile:      '用户观察',
    relationship_core: '关系观察',
    about_agent:        'Agent 观察',
};

/**
 * Builds a compact markdown blurb of active (not-yet-promoted) profile
 * entries for injection into the chat system prompt.
 *
 * Returns empty string when there are no active entries or rootPath is absent.
 */
export const buildProfilesBlurb = async (
    rootPath: string,
    allowGlobal: boolean,
): Promise<string> => {
    const entries = await readActiveProfileEntries(rootPath, allowGlobal);
    if (entries.length === 0) return '';

    const byCategory = new Map<CoreProposalCategory, L4ProfileEntry[]>();
    for (const e of entries) {
        const list = byCategory.get(e.category) ?? [];
        list.push(e);
        byCategory.set(e.category, list);
    }

    const lines: string[] = ['[近期动态观察 — 尚未写入稳定核心，供参考]'];
    for (const [cat, catEntries] of byCategory) {
        lines.push(`\n**${CATEGORY_LABEL[cat]}**`);
        catEntries
            .sort((a, b) => b.lastApprovedAt - a.lastApprovedAt)
            .slice(0, 5)
            .forEach(e => lines.push(`- ${e.content}`));
    }
    return lines.join('\n');
};
