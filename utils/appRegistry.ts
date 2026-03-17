/**
 * AppRegistry — App 目录感知注册表（感知层 1）
 * 
 * 静态注册表 + 动态 agent_apps 扫描。
 * 为 Agent 提供"小手机里有哪些 App、各自做什么"的地图。
 */

import { INSTALLED_APPS } from '../constants';

interface AppInfo {
    id: string;
    name: string;
    description: string;
}

/**
 * 内置 App 的功能描述映射
 * Agent 通过这张表了解每个 App 的用途（而非代码）
 */
const APP_DESCRIPTIONS: Record<string, string> = {
    'chat': '聊天消息 — 和用户进行即时通讯聊天',
    'checkphone': '查手机 — 查看管理面板(仪表盘/印象/记忆/日程/工作区等子功能)',
    'schedule': '时光契约 — 纪念日和重要日期管理',
    'journal': '交换日记 — 用户和Agent互相写日记，可以查看对方的日记',
    'date': '见面 — 模拟线下约会见面场景',
    'user': '个人档案 — 查看和编辑用户/Agent的头像、昵称等信息',
    'gallery': '相册 — 存储和浏览图片，Agent可以存取图片',
    'thememaker': '气泡工坊 — 自定义聊天气泡主题样式',
    'appearance': '外观 — 调整手机壁纸和界面外观',
    'study': '自习室 — 学习辅助工具',
    'freeroam': '自由活动 — 自由探索和活动',
    'music': '音乐 — 音乐播放功能(开发中)',
    'browser': '浏览器 — 网页搜索(搜索能力已集成到Chat)',
    'settings': '设置 — API配置、感知配置、数据导入导出等系统设置',
};

/**
 * 获取完整的 App 注册表（含内置 + 动态 Agent Apps）
 */
export const AppRegistry = {

    /**
     * 获取所有已安装 App 的信息列表
     */
    getAll(): AppInfo[] {
        const apps: AppInfo[] = INSTALLED_APPS.map(app => ({
            id: String(app.id),
            name: app.name,
            description: APP_DESCRIPTIONS[String(app.id)] || app.name,
        }));

        // 未来: 动态扫描 agent_apps/ 并追加
        // 目前 agent_apps 通过 Launcher 的 import.meta.glob 已自动加载
        // 此处可扩展为读取 agent_apps 的元数据

        return apps;
    },

    /**
     * 生成极简的 App 清单文本，用于 System Prompt 注入
     * 格式：AppName(功能简述), AppName(功能简述), ...
     */
    getAppListForPrompt(): string {
        return this.getAll()
            .map(a => `${a.name}(${a.description.split('—')[1]?.trim() || a.description})`)
            .join(', ');
    },

    /**
     * 根据 App ID 获取描述
     */
    getDescription(appId: string): string {
        return APP_DESCRIPTIONS[appId] || '未知应用';
    }
};
