/**
 * 密码验证诊断端点
 * 用于调试密码哈希和验证的过程
 * POST /api/auth/debugPassword
 * 请求体: { "password": "test", "storedHash": "..." }
 */

import { hashPassword, verifyPassword } from '../../utils/auth/passwordHash.js';

export async function onRequestPost(context) {
    const { request } = context;
    const body = await request.json();
    const { password, storedHash } = body;

    if (!password || !storedHash) {
        return new Response(JSON.stringify({
            error: 'Missing password or storedHash',
        }), {
            status: 400,
            headers: { 'Content-Type': 'application/json' },
        });
    }

    const diagnostics = {
        timestamp: new Date().toISOString(),
        inputPassword: password,
        storedHash: storedHash,
        analysis: {},
    };

    // 分析存储的哈希格式
    if (storedHash.startsWith('$pbkdf2$')) {
        diagnostics.analysis.format = 'PBKDF2';
        const parts = storedHash.split('$');
        diagnostics.analysis.parts = {
            total: parts.length,
            part0: parts[0],
            part1: parts[1],
            part2: parts[2] ? `${parts[2].substring(0, 16)}... (length: ${parts[2].length})` : undefined,
            part3: parts[3] ? `${parts[3].substring(0, 16)}... (length: ${parts[3].length})` : undefined,
        };
        
        if (parts.length !== 4) {
            diagnostics.analysis.error = `Invalid PBKDF2 format: expected 4 parts, got ${parts.length}`;
        }
    } else if (storedHash.startsWith('$sha256$')) {
        diagnostics.analysis.format = 'SHA256';
    } else {
        diagnostics.analysis.format = 'plaintext';
    }

    // 尝试验证密码
    try {
        const isValid = await verifyPassword(password, storedHash);
        diagnostics.verifyResult = isValid;
        
        if (!isValid) {
            // 尝试用相同的盐值重新哈希，看是否能匹配
            if (storedHash.startsWith('$pbkdf2$')) {
                const parts = storedHash.split('$');
                if (parts.length === 4) {
                    const salt = parts[2];
                    try {
                        const rehashed = await hashPassword(password, salt);
                        diagnostics.analysis.rehashComparison = {
                            stored: storedHash,
                            rehashed: rehashed,
                            match: rehashed === storedHash,
                        };
                    } catch (err) {
                        diagnostics.analysis.rehashError = err.message;
                    }
                }
            }
        }
    } catch (error) {
        diagnostics.verifyError = error.message;
        diagnostics.verifyErrorStack = error.stack;
    }

    return new Response(JSON.stringify(diagnostics, null, 2), {
        status: 200,
        headers: { 'Content-Type': 'application/json' },
    });
}
