# Vercel 部署配置指南

## 问题症状
设置密码后无法登录，但数据库数据正常。

## 原因分析
1. **Cookie Secure 标志未正确设置** - 在 HTTPS 环境下（Vercel 总是使用 HTTPS）需要设置 Secure 标志
2. **Upstash Redis 连接失败** - 环境变量配置不正确导致会话无法存储
3. **SameSite 属性过于宽松** - 改为 Strict 以增强安全性

## 修复步骤

### 1. 检查 Upstash Redis 环境变量
在 Vercel 项目的 Settings → Environment Variables 中，确保以下变量已配置：

```
UPSTASH_REDIS_REST_URL=https://YOUR-REDIS-URL
UPSTASH_REDIS_REST_TOKEN=YOUR-REDIS-TOKEN
```

**获取这些值的方法：**
- 登录 [Upstash 控制面板](https://console.upstash.com)
- 选择你的 Redis 数据库
- 复制 REST URL 和 REST Token

### 2. 验证配置
访问 `/api/diagnose` 端点检查：
```
https://your-domain.vercel.app/api/diagnose
```

预期输出：
```json
{
  "database": {
    "status": "configured",
    "type": "UpstashKVAdapter"
  },
  "redis": {
    "status": "operational",
    "canConnect": true,
    "canWrite": true,
    "canRead": true
  },
  "cookie": {
    "secure": true,
    "sameSite": "Strict"
  }
}
```

### 3. 清空浏览器 Cookie（重要！）
登录前必须清空旧的 Cookie 和本地存储：
1. 打开浏览器开发者工具 (F12)
2. 应用 → 存储 → 删除所有存储
3. 刷新页面并重新登录

### 4. 重新部署
```bash
git push  # 触发 Vercel 自动部署
# 或手动在 Vercel 控制面板点击 "Redeploy"
```

## 常见错误排查

### 错误 1: "Security config unavailable"
- **原因**: Redis 连接失败或配置不正确
- **解决**: 检查 UPSTASH_REDIS_REST_URL 和 UPSTASH_REDIS_REST_TOKEN

### 错误 2: 登录后立即返回登录页面
- **原因**: Cookie 无法正确保存
- **解决**: 
  1. 清空浏览器 Cookie
  2. 检查浏览器开发者工具的 Network 标签，查看 Set-Cookie 响应头是否存在
  3. 运行 `/api/diagnose` 检查 cookie.secure 是否为 true

### 错误 3: Redis 连接超时
- **原因**: Vercel 节点无法连接到 Upstash Redis
- **解决**: 
  1. 检查 Redis 数据库的网络规则（应该允许所有地址访问）
  2. 确保 REST API 已启用（不是 TCP 连接）
  3. 在 Upstash 控制面板测试连接

## 已修复的问题

### v2.7.6 更新
✅ 自动在 Vercel 环境检测并设置 Cookie Secure 标志
✅ 改进 SameSite 属性为 Strict（更安全）
✅ 添加 `/api/diagnose` 端点用于诊断

## 手动测试

### 测试登录流程
```bash
# 1. 获取安全配置（检查是否需要认证）
curl https://your-domain.vercel.app/api/auth/sessionCheck

# 2. 提交登录请求
curl -X POST https://your-domain.vercel.app/api/auth/login \
  -H "Content-Type: application/json" \
  -d '{"authCode":"your-password"}' \
  -v  # 使用 -v 查看响应头，确认 Set-Cookie 存在

# 3. 验证会话
curl https://your-domain.vercel.app/api/auth/sessionCheck \
  -H "Cookie: user_session=YOUR-SESSION-TOKEN"
```

## 联系支持
如果问题仍未解决，收集以下信息用于诊断：
1. `/api/diagnose` 的完整输出
2. 浏览器开发者工具的 Network 标签中，登录请求的完整截图
3. Vercel 部署日志中的任何错误信息
