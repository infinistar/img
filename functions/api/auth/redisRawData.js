/**
 * Redis 原始数据检查端点
 * 直接查看 Redis 中存储的数据（不经过任何反序列化）
 * GET /api/auth/redisRawData?key=<key-name>
 */

import { getDatabase } from '../../utils/databaseAdapter.js';

export async function onRequestGet(context) {
    const { request, env } = context;
    
    const url = new URL(request.url);
    const keyParam = url.searchParams.get('key');

    if (!keyParam) {
        return new Response(JSON.stringify({
            error: 'Missing key parameter',
            usage: '/api/auth/redisRawData?key=manage@sysConfig@security',
            examples: [
                'manage@sysConfig@security',
                'manage@session@<token>',
                'imgbed:manage@sysConfig@security'
            ]
        }), {
            status: 400,
            headers: { 'Content-Type': 'application/json' },
        });
    }

    const result = {
        timestamp: new Date().toISOString(),
        key: keyParam,
        database: null,
        redis: null,
    };

    try {
        // 获取数据库实例
        const db = getDatabase(env);
        result.database = db.constructor.name;

        // 尝试用标准的 get 方法
        try {
            const standardData = await db.get(keyParam);
            result.standardGet = {
                found: !!standardData,
                type: typeof standardData,
                length: standardData ? String(standardData).length : 0,
                preview: standardData ? String(standardData).substring(0, 200) : null,
            };

            // 尝试解析为 JSON
            if (standardData) {
                try {
                    const parsed = JSON.parse(standardData);
                    result.standardGet.parsed = parsed;
                } catch (e) {
                    result.standardGet.parseError = e.message;
                }
            }
        } catch (e) {
            result.standardGet = { error: e.message };
        }

        // 如果使用 Upstash，尝试获取原始哈希数据
        if (db.constructor.name === 'UpstashKVAdapter') {
            try {
                // 直接访问 Redis 对象
                const fullKey = db.getKey(keyParam);
                const rawHashData = await db.redis.hgetall(fullKey);
                
                result.redis = {
                    fullKey: fullKey,
                    found: !!rawHashData && Object.keys(rawHashData).length > 0,
                    rawHashData: rawHashData,
                };

                // 检查哈希中的每个字段
                if (rawHashData && Object.keys(rawHashData).length > 0) {
                    result.redis.fields = Object.keys(rawHashData);
                    
                    // 分析 value 字段
                    if (rawHashData.value) {
                        result.redis.valueAnalysis = {
                            type: typeof rawHashData.value,
                            length: rawHashData.value.length,
                            encoding: rawHashData.encoding,
                            preview: rawHashData.value.substring(0, 200),
                            // 尝试解析
                        };

                        // 根据 encoding 字段尝试反序列化
                        const encoding = rawHashData.encoding || 'utf8';
                        try {
                            if (encoding === 'json') {
                                const parsed = JSON.parse(rawHashData.value);
                                result.redis.valueAnalysis.parsed = parsed;
                            }
                        } catch (e) {
                            result.redis.valueAnalysis.parseError = e.message;
                        }
                    }

                    // 分析 metadata 字段
                    if (rawHashData.metadata) {
                        try {
                            result.redis.metadata = JSON.parse(rawHashData.metadata);
                        } catch (e) {
                            result.redis.metadata = { parseError: e.message };
                        }
                    }
                }
            } catch (e) {
                result.redis = { error: e.message };
            }
        }

    } catch (error) {
        result.error = error.message;
        result.errorStack = error.stack;
    }

    return new Response(JSON.stringify(result, null, 2), {
        status: 200,
        headers: { 'Content-Type': 'application/json' },
    });
}
