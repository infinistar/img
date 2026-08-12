# Vercel 部署登录问题分析报告

## 问题描述
- 项目在 Vercel 上部署后，设置密码后无法登录
- 数据库中的数据正常
- 使用 Upstash Redis 进行会话存储

## 可能的问题根源

### 1. **Cookie Secure 标志配置问题（最可能）**
   - **位置**: `functions/utils/auth/sessionManager.js` 第 30-31 行
   - **问题**: Vercel 上默认使用 HTTPS，但系统默认 `sessionSecure = false`
   - **影响**: 
     - 如果前端通过 HTTPS 访问，但 Cookie 没有设置 Secure 标志，某些现代浏览器可能不会接受
     - 浏览器的安全策略可能阻止了 Cookie 的设置

### 2. **SameSite 属性与跨域问题**
   - **位置**: `functions/utils/auth/sessionManager.js` 第 225 行
   - **配置**: `SameSite=Lax`
   - **问题**: 
     - 如果前端和 API 在不同域名上，SameSite=Lax 可能不够
     - 在某些跨域场景下，Cookie 无法被正确发送

### 3. **Upstash Redis 会话存储问题**
   - **位置**: `functions/utils/upstashRedisAdapter.js`
   - **问题**:
     - 当会话数据存储到 Redis 时，需要设置 TTL
     - Redis 连接失败或超时可能导致会话创建失败
     - 环境变量 `UPSTASH_REDIS_REST_URL` 和 `UPSTASH_REDIS_REST_TOKEN` 未正确配置

### 4. **密码验证失败（次要可能）**
   - **位置**: `functions/api/auth/login.js` 和 `functions/api/auth/adminLogin.js`
   - **问题**:
     - 密码哈希格式不一致（可能存储为明文，但验证时期望哈希）
     - 旧版 SHA-256 哈希升级到 PBKDF2 过程中出现问题

### 5. **缺少 CORS 头配置**
   - **问题**: 跨域请求的响应可能缺少必要的 CORS 头
   - **影响**: 浏览器无法正确处理 Cookie 设置

## 诊断步骤

### 检查项
1. [ ] Vercel 环境变量是否正确配置了 Upstash Redis 的凭证
2. [ ] 检查浏览器控制台是否有 Cookie 错误提示
3. [ ] 检查网络请求中 Set-Cookie 响应头是否存在
4. [ ] 验证 Upstash Redis 是否能够成功连接和存储数据
5. [ ] 检查密码存储格式是否为 PBKDF2 格式

## 推荐修复方案

### 立即修复
1. **启用 Secure 标志** - 在 Vercel 上自动检测 HTTPS 并启用 Secure
2. **改进 SameSite 配置** - 提供更灵活的配置选项
3. **验证 Upstash Redis 连接** - 添加连接测试端点

### 进一步改进
1. 添加详细的日志记录以诊断会话问题
2. 实现会话本地化存储回退机制
3. 提供明确的错误提示给用户

