/**
 * 列出所有会话数据
 * GET /api/auth/listSessions - 列出所有现存的会话
 */

import { getDatabase } from '../../utils/databaseAdapter.js';

export async function onRequestGet(context) {
    const { env } = context;

    const result = {
        timestamp: new Date().toISOString(),
        sessionPrefix: 'manage@session@',
        sessions: [],
        summary: {
            total: 0,
            validCount: 0,
            expiredCount: 0,
        },
        error: null,
    };

    try {
        const db = getDatabase(env);
        
        // 列出所有会话键
        const listResult = await db.list({
            prefix: 'manage@session@',
            limit: 100, // 最多显示 100 个
        });

        if (listResult.keys && listResult.keys.length > 0) {
            for (const keyObj of listResult.keys) {
                try {
                    const sessionKey = keyObj.name;
                    const sessionData = await db.get(sessionKey);

                    if (sessionData) {
                        const parsed = JSON.parse(sessionData);
                        const now = Date.now();
                        const isExpired = now > parsed.expiresAt;
                        
                        if (isExpired) {
                            result.summary.expiredCount++;
                        } else {
                            result.summary.validCount++;
                        }

                        result.sessions.push({
                            key: sessionKey,
                            authType: parsed.authType,
                            username: parsed.username || '',
                            createdAt: new Date(parsed.createdAt).toISOString(),
                            expiresAt: new Date(parsed.expiresAt).toISOString(),
                            isExpired: isExpired,
                            expiresIn: isExpired ? 'expired' : Math.round((parsed.expiresAt - now) / 1000) + 's',
                            ttl: keyObj.metadata?.ttl || 'unknown',
                        });
                    }
                } catch (e) {
                    result.sessions.push({
                        key: keyObj.name,
                        error: e.message,
                    });
                }
            }
        }

        result.summary.total = result.sessions.length;

    } catch (error) {
        result.error = error.message;
    }

    return new Response(JSON.stringify(result, null, 2), {
        status: 200,
        headers: { 'Content-Type': 'application/json' },
    });
}
