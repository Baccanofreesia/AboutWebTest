export interface AgentSoulData {
    name: string;
    nickname?: string;
    avatar?: string;
    identity?: string;
    persona?: string;
    core?: string;
}

export interface UserProfileData {
    name?: string;
    nickname?: string;
    bio?: string;
    avatar?: string;
}

export const DEFAULT_AGENT_PERSONA = [
    '温和而清晰，表达简洁直接，必要时提供结构化步骤。',
    '以解决问题为优先，先确认目标与约束，再给出可执行方案。',
    '遇到不确定的信息先提问，不编造。',
    '尊重隐私与边界，涉及风险操作先提醒再执行。'
].join('\n');

export const DEFAULT_AGENT_CORE = [
    '优先完成用户目标，必要时提出澄清问题。',
    '输出以可执行性为第一原则，给出步骤或选项。',
    '不臆造事实，不夸大能力。',
    '涉及系统改动或风险操作，先提示再行动。'
].join('\n');

const matchLine = (content: string, label: string): string => {
    const regex = new RegExp(`^\\s*(?:-\\s*)?${label}:\\s*(.+)$`, 'mi');
    const match = content.match(regex);
    return match?.[1]?.trim() || '';
};

const normalizeValue = (value: string): string => {
    const trimmed = (value || '').trim();
    if (!trimmed) return '';
    const lowered = trimmed.toLowerCase();
    if (['default', 'n/a', 'na', 'none', 'null'].includes(lowered)) return '';
    return trimmed;
};

const extractSection = (content: string, heading: string): string => {
    const regex = new RegExp(`^##\\s+${heading}\\s*$([\\s\\S]*?)(?=^##\\s+|\\s*$)`, 'mi');
    const match = content.match(regex);
    return (match?.[1] || '').trim();
};

const extractNotesBlock = (content: string): string => {
    if (!content) return '';
    const lines = content.split(/\r?\n/);
    const fieldRe = /^\s*-\s*(Name|Preferred name|Avatar|Notes)\s*:/i;
    for (let i = 0; i < lines.length; i++) {
        const match = lines[i].match(/^\s*-\s*Notes\s*:\s*(.*)$/i) || lines[i].match(/^\s*Notes\s*:\s*(.*)$/i);
        if (!match) continue;
        const collected: string[] = [];
        const first = (match[1] || '').trim();
        if (first) collected.push(first);
        for (let j = i + 1; j < lines.length; j++) {
            const line = lines[j];
            if (fieldRe.test(line)) break;
            if (/^##\s+/.test(line)) break;
            collected.push(line);
        }
        const normalized = collected
            .map(line => line.replace(/^\s{0,2}/, ''))
            .join('\n')
            .trim();
        return normalized;
    }
    return '';
};

export const parseAgentSoulMarkdown = (content: string): AgentSoulData | null => {
    if (!content || typeof content !== 'string') return null;
    const name = matchLine(content, 'Name');
    const nickname = normalizeValue(matchLine(content, 'Nickname'));
    const avatar = normalizeValue(matchLine(content, 'Avatar'));
    const identity = extractSection(content, 'Identity');
    const persona = extractSection(content, 'Persona');
    const core = extractSection(content, 'Core Instructions') || extractSection(content, 'Core');
    if (!name && !nickname && !persona && !core && !identity && !avatar) return null;
    return {
        name: name || 'Agent',
        nickname: nickname || undefined,
        avatar: avatar || undefined,
        identity: identity || undefined,
        persona: persona || undefined,
        core: core || undefined
    };
};

export const buildAgentSoulMarkdown = (data: AgentSoulData): string => {
    const name = (data.name || 'Agent').trim();
    const nickname = (data.nickname || '').trim();
    const avatarRaw = (data.avatar || '').trim();
    const avatar = avatarRaw.startsWith('data:') || avatarRaw.startsWith('http') || avatarRaw.startsWith('blob:') ? '' : avatarRaw;
    const identity = (data.identity || '').trim();
    const persona = (data.persona || '').trim();
    const core = (data.core || '').trim();
    const lines = [
        '# Agent_Soul.md',
        '',
        `Name: ${name}`,
        `Nickname: ${nickname || 'N/A'}`,
        `Avatar: ${avatar || 'default'}`,
        '',
        '## Persona',
        persona || DEFAULT_AGENT_PERSONA,
        '',
        '## Core Instructions',
        core || DEFAULT_AGENT_CORE,
        '',
        '## AI Optimize Prompt',
        '这是一个角色设定，需要你在不新增事实的前提下优化表达，使其更清晰、可执行、风格统一。',
        '输出要求：',
        '- 保持原意，不添加新设定',
        '- 输出纯文本，不要标题',
        '- 结果可直接替换 Persona 或 Core Instructions 段落',
        ''
    ];
    if (identity) {
        lines.splice(6, 0, '## Identity', identity, '');
    }
    return lines.join('\n');
};

export const buildAgentSystemPromptFromSoul = (data: AgentSoulData): string => {
    const name = (data.name || 'Agent').trim();
    const nickname = (data.nickname || '').trim();
    const identity = (data.identity || '').trim();
    const persona = (data.persona || '').trim();
    const core = (data.core || '').trim();
    const lines: string[] = [];
    lines.push(`[Identity]`);
    lines.push(`Name: ${name}`);
    if (nickname) lines.push(`Nickname: ${nickname}`);
    if (identity) {
        lines.push('');
        lines.push('[Identity Notes]');
        lines.push(identity);
    }
    if (persona) {
        lines.push('');
        lines.push('[Persona]');
        lines.push(persona);
    }
    if (core) {
        lines.push('');
        lines.push('[Core Instructions]');
        lines.push(core);
    }
    return lines.join('\n');
};

export const parseUserProfileMarkdown = (content: string): UserProfileData | null => {
    if (!content || typeof content !== 'string') return null;
    const name = matchLine(content, 'Name');
    const nickname = normalizeValue(matchLine(content, 'Nickname') || matchLine(content, 'Preferred name'));
    const avatar = normalizeValue(matchLine(content, 'Avatar'));
    const persona = extractSection(content, 'Persona') || extractSection(content, 'Notes');
    const notesLine = matchLine(content, 'Notes');
    const notesBlock = extractNotesBlock(content);
    const bio = persona || notesBlock || notesLine;
    if (!name && !nickname && !avatar && !bio) return null;
    return {
        name: name || undefined,
        nickname: nickname || undefined,
        avatar: avatar || undefined,
        bio: bio || undefined
    };
};

export const buildUserProfileMarkdown = (data: UserProfileData): string => {
    const name = (data.name || 'User').trim();
    const nickname = (data.nickname || '').trim();
    const avatar = (data.avatar || '').trim();
    const bio = (data.bio || '').trim();
    return [
        '# User_Profile.md',
        '',
        `Name: ${name}`,
        `Nickname: ${nickname || 'N/A'}`,
        `Avatar: ${avatar || 'default'}`,
        '',
        '## Persona',
        bio || '- (placeholder) 偏好、习惯、边界、称呼',
        '',
        '## AI Optimize Prompt',
        '这是一个用户画像文档，请在不新增事实的前提下优化表达，使其更清晰、可读、可执行。',
        '输出要求：',
        '- 保持原意，不添加新设定',
        '- 输出纯文本，不要标题',
        '- 结果可直接替换 Persona 段落',
        ''
    ].join('\n');
};

export const buildUserMarkdownFromProfile = (data: UserProfileData): string => {
    const name = (data.name || 'User').trim();
    const nickname = (data.nickname || '').trim();
    const avatarRaw = (data.avatar || '').trim();
    const avatar = avatarRaw.startsWith('data:') || avatarRaw.startsWith('http') || avatarRaw.startsWith('blob:') ? '' : avatarRaw;
    const bio = (data.bio || '').trim();
    const hasBioLines = bio.includes('\n');
    const bioLines = hasBioLines ? bio.split(/\r?\n/) : [];
    return [
        '# USER.md',
        '',
        `- Name: ${name}`,
        `- Preferred name: ${nickname || name}`,
        `- Avatar: ${avatar || 'default'}`,
        ...(hasBioLines
            ? ['- Notes:', ...bioLines.map(line => `  ${line}`)]
            : [`- Notes: ${bio || '(placeholder) 用户偏好与边界'}`]),
        ''
    ].join('\n');
};

export const buildIdentityMarkdownFromSoul = (data: AgentSoulData): string => {
    const name = (data.name || 'Agent').trim();
    const identity = (data.identity || '').trim();
    return [
        '# IDENTITY.md',
        '',
        `- Name: ${name}`,
        `- Notes: ${identity || '(placeholder) 角色身份/风格/表情'}`,
        '',
        '> This file is derived from Agent_Soul.md. Edit Agent_Soul.md as the source of truth.',
        ''
    ].join('\n');
};
