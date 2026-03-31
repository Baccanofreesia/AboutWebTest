import { ToolGateway } from './toolGateway';

export interface ActionDispatchInput {
    actionTag: string;
    payload?: any;
    callerAppId?: string;
}

const normalizeTag = (tag: string) => String(tag || '').trim().toUpperCase();
const normalizeCapability = (cap: string) => String(cap || '').trim().toLowerCase();
const capabilityToTagSuffix = (capability: string) =>
    normalizeCapability(capability).replace(/[^a-z0-9]+/g, '_').toUpperCase();
const appIdToTagPrefix = (appId: string) =>
    String(appId || '').trim().replace(/[^a-zA-Z0-9]+/g, '_').toUpperCase();
const APP_SCOPED_ACTIONS: Record<string, string[]> = {};

const ACTION_TO_CAPABILITY: Record<string, string> = {
    DIARY_READ: 'read_diary',
    DIARY_LIST: 'list_diary',
    GALLERY_SCAN: 'list_gallery',
    GALLERY_READ: 'read_gallery_item',
    XHS_SEARCH: 'xhs_search',
    XHS_BROWSE: 'xhs_browse',
    XHS_POST: 'xhs_post',
    XHS_DETAIL: 'xhs_detail',
    XHS_COMMENT: 'xhs_comment',
    XHS_REPLY: 'xhs_reply',
    XHS_LIKE: 'xhs_like',
    XHS_FAV: 'xhs_fav',
    XHS_MY_PROFILE: 'xhs_my_profile',
    TOOL_QUERY_INDEX: 'query_index',
    TOOL_READ_REF: 'read_ref',
    TOOL_SEARCH: 'search',
    TOOL_RESOLVE_FILE: 'resolve_file',
};

export const ActionDispatcher = {
    registerAction(actionTag: string, capability: string) {
        const tag = normalizeTag(actionTag);
        const cap = normalizeCapability(capability);
        if (!tag || !cap) return;
        ACTION_TO_CAPABILITY[tag] = cap;
    },

    getCapabilityForAction(actionTag: string): string | null {
        const tag = normalizeTag(actionTag);
        if (!tag) return null;
        const mapped = ACTION_TO_CAPABILITY[tag];
        if (mapped) return mapped;
        if (tag.startsWith('TOOL_')) {
            const inferred = normalizeCapability(tag.slice('TOOL_'.length).replace(/_/g, '_'));
            return inferred || null;
        }
        return null;
    },

    registerCapabilitiesForApp(appId: string, capabilities: string[]) {
        const appPrefix = appIdToTagPrefix(appId);
        if (!appPrefix) return;
        const previousTags = APP_SCOPED_ACTIONS[appPrefix] || [];
        for (const tag of previousTags) {
            delete ACTION_TO_CAPABILITY[tag];
        }
        const scopedTags: string[] = [];
        const list = Array.isArray(capabilities) ? capabilities : [];
        for (const rawCap of list) {
            const cap = normalizeCapability(rawCap);
            if (!cap) continue;
            const suffix = capabilityToTagSuffix(cap);
            if (!suffix) continue;
            ACTION_TO_CAPABILITY[`TOOL_${suffix}`] = cap;
            const scopedTag = `${appPrefix}_${suffix}`;
            ACTION_TO_CAPABILITY[scopedTag] = cap;
            scopedTags.push(scopedTag);
        }
        APP_SCOPED_ACTIONS[appPrefix] = scopedTags;
    },

    unregisterApp(appId: string) {
        const appPrefix = appIdToTagPrefix(appId);
        if (!appPrefix) return;
        const scopedTags = APP_SCOPED_ACTIONS[appPrefix] || [];
        for (const tag of scopedTags) {
            delete ACTION_TO_CAPABILITY[tag];
        }
        delete APP_SCOPED_ACTIONS[appPrefix];
    },

    async dispatch(input: ActionDispatchInput): Promise<any> {
        const capability = this.getCapabilityForAction(input.actionTag);
        if (!capability) {
            throw new Error(`No capability mapping found for action "${input.actionTag}"`);
        }
        return ToolGateway.invoke({
            callerAppId: input.callerAppId,
            capability,
            payload: input.payload,
        });
    },
};
