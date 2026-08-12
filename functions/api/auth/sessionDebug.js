/**
 * 会话流程完整诊断端点
 * GET  /api/auth/sessionDebug - 查看当前会话信息
 * POST /api/auth/sessionDebug - 测试会话创建和读取
 */

import { getDatabase } from '../../utils/databaseAdapter.js';
import { createSession, validateSession, validateAnySession } from '../../utils/auth/sessionManager.js';

export async function onRequestGet(context) {
    const { request, env } = context;

    const diagnostics = {
        timestamp: new Date().toISOString(),
        cookies: {},
        sessionData: {},
        errors: [],
    };

    // 获取所有可能的 Cookie
    const cookieHeader = request.headers.get('Cookie');
    if (cookieHeader) {
        const cookies = cookieHeader.split(';').map(c => c.trim());
        diagnostics.cookies.raw = cookieHeader;
        diagnostics.cookies.parsed = cookies;
        diagnostics.cookies.hasAdminSession = cookies.some(c => c.startsWith('admin_session='));
        diagnostics.cookies.hasUserSession = cookies.some(c => c.startsWith('user_session='));
    } else {
        diagnostics.cookies.raw = 'No cookies found';
    }

    // 尝试验证现有会话
    try {
        const adminResult = await validateSession(env, request, 'admin');
        diagnostics.sessionData.adminSession = {
            valid: adminResult.valid,
            ...adminResult.session,
        };
    } catch (error) {
        diagnostics.errors.push({ step: 'admin-session-validation', error: error.message });
    }

    try {
        const userResult = await validateSession(env, request, 'user');
        diagnostics.sessionData.userSession = {
            valid: userResult.valid,
            ...userResult.session,
        };
    } catch (error) {
        diagnostics.errors.push({ step: 'user-session-validation', error: error.message });
    }

    // 尝试验证任意会话
    try {
        const anyResult = await validateAnySession(env, request);
        diagnostics.sessionData.anySession = {
            valid: anyResult.valid,
            ...anyResult.session,
        };
    } catch (error) {
        diagnostics.errors.push({ step: 'any-session-validation', error: error.message });
    }

    return new Response(JSON.stringify(diagnostics, null, 2), {
        status: 200,
        headers: { 'Content-Type': 'application/json' },
    });
}

export async function onRequestPost(context) {
    const { env } = context;

    const testResult = {
        timestamp: new Date().toISOString(),
        steps: [],
        sessionCreatedFor: 'user', // 默认为 user
    };

    try {
        // Step 1: 获取数据库实例
        testResult.steps.push({ step: 'database-init', status: 'in-progress' });
        const db = getDatabase(env);
        if (!db) {
            testResult.steps[testResult.steps.length - 1].status = 'error';
            testResult.steps[testResult.steps.length - 1].error = 'Failed to get database adapter';
            return new Response(JSON.stringify(testResult), { 
                status: 500, 
                headers: { 'Content-Type': 'application/json' } 
            });
        }
        testResult.steps[testResult.steps.length - 1].status = 'success';
        testResult.steps[testResult.steps.length - 1].dbType = db.constructor.name;

        // Step 2: 测试数据库连接
        testResult.steps.push({ step: 'database-connectivity', status: 'in-progress' });
        const testKey = `session-test-${Date.now()}`;
        const testData = { test: true, timestamp: Date.now() };
        
        try {
            await db.put(testKey, JSON.stringify(testData), { expirationTtl: 10 });
            const readData = await db.get(testKey);
            const dataMatches = readData && JSON.parse(readData).test === true;
            
            testResult.steps[testResult.steps.length - 1].status = 'success';
            testResult.steps[testResult.steps.length - 1].writeSuccess = true;
            testResult.steps[testResult.steps.length - 1].readSuccess = !!readData;
            testResult.steps[testResult.steps.length - 1].dataMatches = dataMatches;
            
            // 清理测试数据
            await db.delete(testKey);
        } catch (err) {
            testResult.steps[testResult.steps.length - 1].status = 'error';
            testResult.steps[testResult.steps.length - 1].error = err.message;
            throw err;
        }

        // Step 3: 创建会话
        testResult.steps.push({ step: 'session-creation', status: 'in-progress' });
        let sessionResult;
        try {
            const { createSession } = await import('../../utils/auth/sessionManager.js');
            sessionResult = await createSession(env, 'user', '');
            
            testResult.steps[testResult.steps.length - 1].status = 'success';
            testResult.steps[testResult.steps.length - 1].token = sessionResult.token.substring(0, 20) + '...';
            testResult.steps[testResult.steps.length - 1].cookieHeader = sessionResult.cookie.split(';')[0];  // 只显示第一部分
        } catch (err) {
            testResult.steps[testResult.steps.length - 1].status = 'error';
            testResult.steps[testResult.steps.length - 1].error = err.message;
            throw err;
        }

        // Step 4: 验证会话数据是否在 Redis 中
        testResult.steps.push({ step: 'verify-session-in-redis', status: 'in-progress' });
        try {
            const sessionKey = `manage@session@${sessionResult.token}`;
            const sessionInRedis = await db.get(sessionKey);
            
            testResult.steps[testResult.steps.length - 1].status = 'success';
            testResult.steps[testResult.steps.length - 1].sessionKey = sessionKey;
            testResult.steps[testResult.steps.length - 1].dataFound = !!sessionInRedis;
            testResult.steps[testResult.steps.length - 1].dataPreview = sessionInRedis ? sessionInRedis.substring(0, 80) + '...' : null;
            
            if (!sessionInRedis) {
                testResult.steps[testResult.steps.length - 1].warning = 'Session data not found in Redis immediately after creation!';
            }
        } catch (err) {
            testResult.steps[testResult.steps.length - 1].status = 'error';
            testResult.steps[testResult.steps.length - 1].error = err.message;
        }

        // Step 5: 测试会话读取
        testResult.steps.push({ step: 'session-read-verification', status: 'in-progress' });
        try {
            const { validateSession } = await import('../../utils/auth/sessionManager.js');
            
            // 模拟构造请求对象
            const mockRequest = {
                headers: new Map([
                    ['Cookie', `user_session=${sessionResult.token}`]
                ]),
                headers: {
                    get: (key) => {
                        if (key.toLowerCase() === 'cookie') {
                            return `user_session=${sessionResult.token}`;
                        }
                        return null;
                    }
                }
            };
            
            const validationResult = await validateSession(env, mockRequest, 'user');
            
            testResult.steps[testResult.steps.length - 1].status = 'success';
            testResult.steps[testResult.steps.length - 1].sessionValid = validationResult.valid;
            testResult.steps[testResult.steps.length - 1].sessionData = validationResult.session;
            
            if (!validationResult.valid) {
                testResult.steps[testResult.steps.length - 1].warning = 'Session validation failed after reading from Redis!';
            }
        } catch (err) {
            testResult.steps[testResult.steps.length - 1].status = 'error';
            testResult.steps[testResult.steps.length - 1].error = err.message;
        }

        testResult.finalResult = 'SESSION_TEST_COMPLETE';

    } catch (error) {
        testResult.error = error.message;
        testResult.errorStack = error.stack;
        testResult.finalResult = 'SESSION_TEST_FAILED';
    }

    return new Response(JSON.stringify(testResult, null, 2), {
        status: 200,
        headers: { 'Content-Type': 'application/json' },
    });
}
