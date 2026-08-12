/**
 * 完整的登录诊断和测试端点
 * GET  /api/auth/testLogin - 获取诊断信息
 * POST /api/auth/testLogin - 测试登录流程（需要提供密码）
 */

import { fetchSecurityConfig } from '../../utils/sysConfig.js';
import { verifyPassword, hashPassword } from '../../utils/auth/passwordHash.js';
import { getDatabase } from '../../utils/databaseAdapter.js';

export async function onRequestGet(context) {
    const { env } = context;

    const diagnostics = {
        timestamp: new Date().toISOString(),
        systemInfo: {
            isVercel: !!env.VERCEL,
            hasUpstash: !!(env.UPSTASH_REDIS_REST_URL && env.UPSTASH_REDIS_REST_TOKEN),
        },
        configStatus: {
            loaded: false,
            error: null,
            authConfigured: {
                user: false,
                admin: false,
            },
        },
        passwordFormats: {
            user: null,
            admin: null,
        },
    };

    try {
        const config = await fetchSecurityConfig(env);
        diagnostics.configStatus.loaded = true;

        const userAuthCode = config.auth?.user?.authCode;
        const adminPassword = config.auth?.admin?.adminPassword;
        const adminUsername = config.auth?.admin?.adminUsername;

        diagnostics.configStatus.authConfigured.user = !!(userAuthCode && userAuthCode.trim());
        diagnostics.configStatus.authConfigured.admin = !!(adminPassword && adminPassword.trim() || adminUsername && adminUsername.trim());

        // 检查密码格式
        if (userAuthCode) {
            if (userAuthCode.startsWith('$pbkdf2$')) {
                diagnostics.passwordFormats.user = 'PBKDF2';
            } else if (userAuthCode.startsWith('$sha256$')) {
                diagnostics.passwordFormats.user = 'SHA256';
            } else {
                diagnostics.passwordFormats.user = 'plaintext';
            }
        }

        if (adminPassword) {
            if (adminPassword.startsWith('$pbkdf2$')) {
                diagnostics.passwordFormats.admin = 'PBKDF2';
            } else if (adminPassword.startsWith('$sha256$')) {
                diagnostics.passwordFormats.admin = 'SHA256';
            } else {
                diagnostics.passwordFormats.admin = 'plaintext';
            }
        }

        // 显示部分哈希用于验证
        if (userAuthCode && userAuthCode.startsWith('$pbkdf2$')) {
            const lastDollar = userAuthCode.lastIndexOf('$');
            diagnostics.passwordFormats.userHashPreview = userAuthCode.substring(0, Math.min(50, lastDollar + 16)) + '...';
        }

        if (adminPassword && adminPassword.startsWith('$pbkdf2$')) {
            const lastDollar = adminPassword.lastIndexOf('$');
            diagnostics.passwordFormats.adminHashPreview = adminPassword.substring(0, Math.min(50, lastDollar + 16)) + '...';
        }

    } catch (error) {
        diagnostics.configStatus.error = error.message;
    }

    return new Response(JSON.stringify(diagnostics, null, 2), {
        status: 200,
        headers: { 'Content-Type': 'application/json' },
    });
}

export async function onRequestPost(context) {
    const { request, env } = context;

    let body;
    try {
        body = await request.json();
    } catch {
        return new Response(JSON.stringify({ error: 'Invalid JSON body' }), {
            status: 400,
            headers: { 'Content-Type': 'application/json' },
        });
    }

    const { password, type } = body;

    if (!password || !type) {
        return new Response(JSON.stringify({
            error: 'Missing password or type',
            example: { password: 'yourpassword', type: 'user' },
        }), {
            status: 400,
            headers: { 'Content-Type': 'application/json' },
        });
    }

    const testResult = {
        timestamp: new Date().toISOString(),
        testType: type,
        steps: [],
    };

    try {
        // Step 1: 获取配置
        testResult.steps.push({ step: 'fetching-config', status: 'in-progress' });
        const config = await fetchSecurityConfig(env);
        testResult.steps[testResult.steps.length - 1].status = 'success';

        // Step 2: 获取相应的密码哈希
        testResult.steps.push({ step: 'getting-password-hash', status: 'in-progress' });
        let storedPasswordHash;
        
        if (type === 'user') {
            storedPasswordHash = config.auth?.user?.authCode;
            if (!storedPasswordHash) {
                testResult.steps[testResult.steps.length - 1].status = 'error';
                testResult.steps[testResult.steps.length - 1].error = 'User password not configured';
                return new Response(JSON.stringify(testResult), { status: 400, headers: { 'Content-Type': 'application/json' } });
            }
        } else if (type === 'admin') {
            storedPasswordHash = config.auth?.admin?.adminPassword;
            if (!storedPasswordHash) {
                testResult.steps[testResult.steps.length - 1].status = 'error';
                testResult.steps[testResult.steps.length - 1].error = 'Admin password not configured';
                return new Response(JSON.stringify(testResult), { status: 400, headers: { 'Content-Type': 'application/json' } });
            }
        } else {
            testResult.steps[testResult.steps.length - 1].status = 'error';
            testResult.steps[testResult.steps.length - 1].error = 'Invalid type (must be user or admin)';
            return new Response(JSON.stringify(testResult), { status: 400, headers: { 'Content-Type': 'application/json' } });
        }
        testResult.steps[testResult.steps.length - 1].status = 'success';
        testResult.steps[testResult.steps.length - 1].hashFormat = storedPasswordHash.startsWith('$pbkdf2$') ? 'PBKDF2' : 
                                                                      storedPasswordHash.startsWith('$sha256$') ? 'SHA256' : 'plaintext';

        // Step 3: 验证密码
        testResult.steps.push({ step: 'verifying-password', status: 'in-progress' });
        const isValid = await verifyPassword(password, storedPasswordHash);
        testResult.steps[testResult.steps.length - 1].status = 'success';
        testResult.steps[testResult.steps.length - 1].result = isValid;

        // Step 4: 如果验证失败，提供诊断信息
        if (!isValid) {
            testResult.steps.push({ step: 'diagnostic-info', status: 'info' });
            
            // 尝试重新哈希看是否能匹配
            if (storedPasswordHash.startsWith('$pbkdf2$')) {
                const lastDollarIndex = storedPasswordHash.lastIndexOf('$');
                const prefixLen = 9; // '$pbkdf2$'.length
                const salt = storedPasswordHash.substring(prefixLen, lastDollarIndex);
                
                testResult.steps[testResult.steps.length - 1].details = {
                    hashFormat: 'PBKDF2',
                    saltLength: salt.length,
                    saltIsValidHex: /^[0-9a-f]{32}$/i.test(salt),
                    saltPreview: salt.substring(0, 16) + '...',
                };

                try {
                    const rehashed = await hashPassword(password, salt);
                    testResult.steps[testResult.steps.length - 1].details.rehashMatch = rehashed === storedPasswordHash;
                    if (rehashed !== storedPasswordHash) {
                        testResult.steps[testResult.steps.length - 1].details.expectedHash = rehashed.substring(0, 50) + '...';
                        testResult.steps[testResult.steps.length - 1].details.storedHash = storedPasswordHash.substring(0, 50) + '...';
                    }
                } catch (err) {
                    testResult.steps[testResult.steps.length - 1].details.rehashError = err.message;
                }
            }
        }

        testResult.finalResult = isValid ? 'PASSWORD_CORRECT' : 'PASSWORD_INCORRECT';

    } catch (error) {
        testResult.error = error.message;
        testResult.errorStack = error.stack;
    }

    return new Response(JSON.stringify(testResult, null, 2), {
        status: 200,
        headers: { 'Content-Type': 'application/json' },
    });
}
