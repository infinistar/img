/**
 * 完整登录流程测试端点
 * 模拟真实的登录 → 验证会话流程
 * POST /api/auth/fullLoginTest
 * 请求体: { "password": "your-password", "type": "user" | "admin" }
 */

import { fetchSecurityConfig } from '../../utils/sysConfig.js';
import { verifyPassword } from '../../utils/auth/passwordHash.js';
import { createSession, validateSession } from '../../utils/auth/sessionManager.js';
import { getDatabase } from '../../utils/databaseAdapter.js';

export async function onRequestPost(context) {
    const { request, env } = context;

    let body;
    try {
        body = await request.json();
    } catch {
        return new Response(JSON.stringify({ error: 'Invalid JSON' }), {
            status: 400,
            headers: { 'Content-Type': 'application/json' },
        });
    }

    const { password, type = 'user' } = body;
    if (!password) {
        return new Response(JSON.stringify({ error: 'Missing password' }), {
            status: 400,
            headers: { 'Content-Type': 'application/json' },
        });
    }

    const simulation = {
        timestamp: new Date().toISOString(),
        testType: type,
        steps: [],
        timeline: [],
    };

    try {
        // Step 1: 获取配置
        simulation.steps.push({ 
            step: 'fetch-config', 
            status: 'in-progress',
            description: '读取安全配置'
        });
        
        const config = await fetchSecurityConfig(env);
        let storedPassword;
        
        if (type === 'user') {
            storedPassword = config.auth?.user?.authCode;
        } else if (type === 'admin') {
            storedPassword = config.auth?.admin?.adminPassword;
        }
        
        if (!storedPassword) {
            simulation.steps[simulation.steps.length - 1].status = 'error';
            simulation.steps[simulation.steps.length - 1].error = `${type} password not configured`;
            return new Response(JSON.stringify(simulation), {
                status: 400,
                headers: { 'Content-Type': 'application/json' },
            });
        }
        
        simulation.steps[simulation.steps.length - 1].status = 'success';
        simulation.timeline.push({ timestamp: Date.now(), event: 'config-loaded' });

        // Step 2: 验证密码
        simulation.steps.push({ 
            step: 'verify-password', 
            status: 'in-progress',
            description: '验证用户输入的密码'
        });
        
        const isPasswordValid = await verifyPassword(password, storedPassword);
        
        simulation.steps[simulation.steps.length - 1].status = 'success';
        simulation.steps[simulation.steps.length - 1].result = isPasswordValid;
        simulation.timeline.push({ timestamp: Date.now(), event: 'password-verified', result: isPasswordValid });
        
        if (!isPasswordValid) {
            simulation.steps[simulation.steps.length - 1].error = 'Password mismatch';
            simulation.finalResult = 'AUTHENTICATION_FAILED';
            return new Response(JSON.stringify(simulation), {
                status: 401,
                headers: { 'Content-Type': 'application/json' },
            });
        }

        // Step 3: 创建会话
        simulation.steps.push({ 
            step: 'create-session', 
            status: 'in-progress',
            description: '创建会话令牌'
        });
        
        const sessionResult = await createSession(env, type);
        
        simulation.steps[simulation.steps.length - 1].status = 'success';
        simulation.steps[simulation.steps.length - 1].token = sessionResult.token.substring(0, 20) + '...';
        simulation.steps[simulation.steps.length - 1].cookieHeaderLength = sessionResult.cookie.length;
        simulation.steps[simulation.steps.length - 1].cookieAttributes = sessionResult.cookie.split(';').map(c => c.trim());
        simulation.timeline.push({ timestamp: Date.now(), event: 'session-created' });

        // Step 4: 验证会话数据是否在数据库中
        simulation.steps.push({ 
            step: 'verify-session-storage', 
            status: 'in-progress',
            description: '验证会话数据是否成功存储在 Redis 中'
        });
        
        const db = getDatabase(env);
        const sessionKey = `manage@session@${sessionResult.token}`;
        const storedSessionStr = await db.get(sessionKey);
        
        simulation.steps[simulation.steps.length - 1].status = 'success';
        simulation.steps[simulation.steps.length - 1].sessionKey = sessionKey;
        simulation.steps[simulation.steps.length - 1].dataFound = !!storedSessionStr;
        
        if (storedSessionStr) {
            simulation.steps[simulation.steps.length - 1].dataPreview = storedSessionStr.substring(0, 100) + '...';
            try {
                const parsed = JSON.parse(storedSessionStr);
                simulation.steps[simulation.steps.length - 1].dataValid = true;
                simulation.steps[simulation.steps.length - 1].dataContent = {
                    authType: parsed.authType,
                    createdAt: new Date(parsed.createdAt).toISOString(),
                    expiresAt: new Date(parsed.expiresAt).toISOString(),
                };
            } catch (e) {
                simulation.steps[simulation.steps.length - 1].dataValid = false;
                simulation.steps[simulation.steps.length - 1].parseError = e.message;
            }
        } else {
            simulation.steps[simulation.steps.length - 1].warning = '⚠️ SESSION DATA NOT FOUND IN REDIS!';
        }
        simulation.timeline.push({ timestamp: Date.now(), event: 'session-verified' });

        // Step 5: 模拟会话验证（如 sessionCheck 端点会做的事）
        simulation.steps.push({ 
            step: 'validate-session', 
            status: 'in-progress',
            description: '模拟后续请求验证会话（如 sessionCheck 接口）'
        });
        
        // 构造模拟的 Request 对象
        const mockRequest = {
            headers: {
                get: (key) => {
                    if (key.toLowerCase() === 'cookie') {
                        return `${type === 'admin' ? 'admin_session' : 'user_session'}=${sessionResult.token}`;
                    }
                    return null;
                }
            }
        };
        
        const validationResult = await validateSession(env, mockRequest, type);
        
        simulation.steps[simulation.steps.length - 1].status = 'success';
        simulation.steps[simulation.steps.length - 1].sessionValid = validationResult.valid;
        
        if (validationResult.session) {
            simulation.steps[simulation.steps.length - 1].sessionData = {
                authType: validationResult.session.authType,
                createdAt: new Date(validationResult.session.createdAt).toISOString(),
                expiresAt: new Date(validationResult.session.expiresAt).toISOString(),
                expiresIn: Math.round((validationResult.session.expiresAt - Date.now()) / 1000) + 's',
            };
        }
        
        if (!validationResult.valid) {
            simulation.steps[simulation.steps.length - 1].error = '❌ Session validation failed in subsequent request!';
        }
        simulation.timeline.push({ timestamp: Date.now(), event: 'session-validation-complete', result: validationResult.valid });

        simulation.finalResult = validationResult.valid ? 'LOGIN_SUCCESSFUL' : 'SESSION_LOST_AFTER_LOGIN';

    } catch (error) {
        simulation.error = error.message;
        simulation.errorStack = error.stack;
        simulation.finalResult = 'PROCESS_ERROR';
    }

    return new Response(JSON.stringify(simulation, null, 2), {
        status: 200,
        headers: { 'Content-Type': 'application/json' },
    });
}
