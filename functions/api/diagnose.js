/**
 * 诊断端点 - 检查系统配置和Redis连接
 * 使用: GET /api/diagnose
 */

import { getDatabase } from '../../utils/databaseAdapter.js';
import { fetchSecurityConfig } from '../../utils/sysConfig.js';

export async function onRequestGet(context) {
    const { env } = context;
    
    const diagnostics = {
        timestamp: new Date().toISOString(),
        environment: {
            isVercel: !!env.VERCEL,
            hasUpstashConfig: !!(env.UPSTASH_REDIS_REST_URL && env.UPSTASH_REDIS_REST_TOKEN),
            protocol: env.PROTOCOL || 'unknown',
        },
        database: {
            status: 'unknown',
            type: 'unknown',
            error: null,
        },
        security: {
            status: 'unknown',
            authConfigured: false,
            error: null,
        },
        redis: {
            status: 'unknown',
            canConnect: false,
            canWrite: false,
            canRead: false,
            error: null,
        }
    };

    // 检查数据库配置
    try {
        const db = getDatabase(env);
        if (!db) {
            diagnostics.database.status = 'not-configured';
            diagnostics.database.error = 'No database adapter found';
        } else {
            diagnostics.database.status = 'configured';
            diagnostics.database.type = db.constructor.name;

            // 测试 Redis 连接
            const testKey = `diagnose_test_${Date.now()}`;
            const testValue = { test: true, timestamp: Date.now() };
            
            try {
                // 尝试写入
                await db.put(testKey, JSON.stringify(testValue), { expirationTtl: 10 });
                diagnostics.redis.canWrite = true;
                
                // 尝试读取
                const readValue = await db.get(testKey);
                diagnostics.redis.canRead = !!readValue;
                
                // 清理测试数据
                await db.delete(testKey);
                
                diagnostics.redis.status = 'operational';
                diagnostics.redis.canConnect = true;
            } catch (err) {
                diagnostics.redis.status = 'error';
                diagnostics.redis.error = err.message;
            }
        }
    } catch (error) {
        diagnostics.database.status = 'error';
        diagnostics.database.error = error.message;
    }

    // 检查安全配置
    try {
        const securityConfig = await fetchSecurityConfig(env, { throwOnError: false });
        if (securityConfig) {
            diagnostics.security.status = 'loaded';
            diagnostics.security.authConfigured = 
                !!(securityConfig.auth?.user?.authCode || securityConfig.auth?.admin?.adminPassword);
        } else {
            diagnostics.security.status = 'unavailable';
        }
    } catch (error) {
        diagnostics.security.status = 'error';
        diagnostics.security.error = error.message;
    }

    // 检查 Cookie 安全配置
    try {
        const isVercel = !!env.VERCEL;
        const isHttps = env.PROTOCOL === 'https' || isVercel;
        diagnostics.cookie = {
            secure: isHttps,
            sameSite: 'Strict',
            httpOnly: true,
            detectReason: isVercel ? 'Vercel detected' : (isHttps ? 'HTTPS detected' : 'HTTP'),
        };
    } catch (error) {
        diagnostics.cookie = { error: error.message };
    }

    return new Response(JSON.stringify(diagnostics, null, 2), {
        status: 200,
        headers: {
            'Content-Type': 'application/json',
        },
    });
}
