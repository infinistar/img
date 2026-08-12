# 诊断工作流程：登录后立即显示"请认证"

## 问题描述
1. ✅ 输入密码后，API 返回"登录成功"(200)
2. ❌ 但前端立即显示"请认证"
3. ✗ 无法保持登录状态

这说明**会话创建可能成功，但会话验证失败**。

---

## 🔧 完整诊断流程

### 第1步：验证系统配置
```bash
curl https://your-domain/api/auth/testLogin
```

预期结果：
```json
{
  "configStatus": {
    "loaded": true,           // ✅ 配置已加载
    "authConfigured": {
      "user": true,           // ✅ 用户密码已配置
      "admin": true
    }
  },
  "passwordFormats": {
    "user": "PBKDF2"          // ✅ 密码格式正确
  }
}
```

**如果失败**: 检查 Redis 连接或配置数据完整性

---

### 第2步：完整登录流程模拟

这是关键的诊断步骤！

```bash
curl -X POST https://your-domain/api/auth/fullLoginTest \
  -H "Content-Type: application/json" \
  -d '{
    "password": "your-password",
    "type": "user"
  }'
```

**分析返回结果**：

```json
{
  "steps": [
    {
      "step": "verify-password",
      "result": true           // ✅ 密码验证成功
    },
    {
      "step": "create-session",
      "status": "success"      // ✅ 会话创建成功
    },
    {
      "step": "verify-session-storage",
      "dataFound": true,       // ⚠️ 关键：是否在 Redis 中找到？
      "dataValid": true        // ⚠️ 关键：数据格式是否有效？
    },
    {
      "step": "validate-session",
      "sessionValid": true     // ⚠️ 关键：会话验证是否通过？
    }
  ],
  "finalResult": "LOGIN_SUCCESSFUL"  // ✅ 或 SESSION_LOST_AFTER_LOGIN
}
```

**关键检查点及解决方案**：

#### 检查点 A: `dataFound: false` ❌
**问题**: 会话数据未保存到 Redis

**诊断命令**:
```bash
# 测试 Redis 写入能力
curl -X POST https://your-domain/api/auth/sessionDebug
```

查看 `"step": "database-connectivity"` 中的 `writeSuccess`

**解决方案**:
- [ ] 检查 UPSTASH_REDIS_REST_URL 和 UPSTASH_REDIS_REST_TOKEN
- [ ] 验证 Upstash Redis 配额未超限
- [ ] 查看 Vercel 部署日志中的错误
- [ ] 尝试 `git push` 重新部署

#### 检查点 B: `dataValid: false` ❌
**问题**: 会话数据格式损坏

**诊断命令**:
```bash
# 查看 Redis 中的原始数据
curl 'https://your-domain/api/auth/redisRawData?key=manage@sysConfig@security'
```

查看 `redis.valueAnalysis` 部分的 `parseError`

**解决方案**:
- [ ] 检查 JSON 序列化是否有问题
- [ ] 检查编码是否为 'utf8'
- [ ] 重新部署应用

#### 检查点 C: `sessionValid: false` ❌
**问题**: 会话验证失败（虽然数据存在）

**诊断命令**:
```bash
# 列出所有会话
curl https://your-domain/api/auth/listSessions
```

查看是否有最近创建的会话，以及是否已过期

**可能原因**:
1. 会话 TTL 设置过短（数据被立即删除）
2. 会话验证代码中的 authType 不匹配
3. Cookie 名称不一致

**解决方案**:
```javascript
// 检查 sessionManager.js 中的 Cookie 名称
const COOKIE_NAMES = {
    admin: 'admin_session',   // ✅ 确认这些是正确的
    user: 'user_session',
};
```

---

### 第3步：检查浏览器端的 Cookie

登录前，打开浏览器开发者工具：

1. **F12 → Network → 登录请求**
2. **查看 Response Headers**:
   ```
   Set-Cookie: user_session=<token>; Path=/; HttpOnly; SameSite=Strict; Max-Age=1209600; Secure
   ```

**检查清单**:
- [ ] Set-Cookie 头存在吗？
- [ ] Cookie 名称是 `user_session` 或 `admin_session` 吗？
- [ ] Token 看起来有效吗？（长字符串）
- [ ] Max-Age 是正数吗？（不是 0）
- [ ] 是否包含 `Secure` 标志？（HTTPS 下必须）

**常见问题**:

| 问题 | 症状 | 解决方案 |
|------|------|--------|
| Cookie 完全缺失 | Set-Cookie 头不存在 | 会话创建失败，见检查点 A |
| Max-Age=0 | Cookie 被立即删除 | TTL 设置为 0，检查 sessionConfig.js |
| 缺少 Secure | HTTPS 下浏览器拒绝 | 更新代码设置 Secure 标志 |
| 缺少 HttpOnly | JavaScript 可以修改 Cookie | 安全风险（非关键问题） |

3. **F12 → Application → Cookies**
   - [ ] 刷新后，`user_session` Cookie 仍然存在吗？
   - [ ] Cookie 值是否与登录时相同？

---

### 第4步：检查后续请求中的 Cookie

1. **F12 → Network → 任何登录后的请求**（如 GET `/api/manage/list`）
2. **查看 Request Headers**:
   ```
   Cookie: user_session=<same-token>
   ```

**可能的问题**:
- [ ] Cookie 没有被发送（浏览器问题或 SameSite 设置）
- [ ] Cookie 值不同（多个会话冲突）
- [ ] 只有一部分 Cookie 被发送

---

## 📋 完整诊断检查清单

按顺序执行，每一项都应该是 ✅：

```
验证配置
  [ ] GET /api/auth/testLogin → loaded: true
  [ ] GET /api/auth/testLogin → authConfigured: { user: true, admin: true }
  [ ] GET /api/auth/testLogin → passwordFormats.user: PBKDF2

验证完整登录流程
  [ ] POST /api/auth/fullLoginTest → verify-password: true
  [ ] POST /api/auth/fullLoginTest → create-session: success
  [ ] POST /api/auth/fullLoginTest → dataFound: true
  [ ] POST /api/auth/fullLoginTest → dataValid: true
  [ ] POST /api/auth/fullLoginTest → sessionValid: true
  [ ] POST /api/auth/fullLoginTest → finalResult: LOGIN_SUCCESSFUL

验证 Redis 连接
  [ ] POST /api/auth/sessionDebug → database-connectivity: success
  [ ] POST /api/auth/sessionDebug → writeSuccess: true
  [ ] POST /api/auth/sessionDebug → readSuccess: true

验证浏览器行为
  [ ] F12 Network → Set-Cookie 头存在
  [ ] F12 Network → Max-Age 是正数
  [ ] F12 Cookies → user_session 被保存
  [ ] F12 Cookies → 刷新后 Cookie 仍存在
  [ ] F12 Network → 后续请求中发送了 Cookie

验证登录功能
  [ ] 手动登录 → 显示登录成功
  [ ] 显示登录成功 → 页面保持登录状态（不显示"请认证"）
  [ ] 刷新页面 → 仍保持登录状态
```

---

## 🚨 故障排查决策树

```
登录后显示"请认证"
├─ fullLoginTest 返回 SESSION_LOST_AFTER_LOGIN
│  ├─ dataFound: false
│  │  └─ → Redis 写入失败（见检查点 A）
│  ├─ dataValid: false
│  │  └─ → JSON 序列化问题（见检查点 B）
│  └─ sessionValid: false
│     └─ → 会话验证逻辑问题（见检查点 C）
├─ fullLoginTest 返回 LOGIN_SUCCESSFUL
│  └─ 但浏览器还是显示"请认证"
│     ├─ F12 没有看到 Set-Cookie
│     │  └─ → Cookie 设置有问题，需要检查 Cookie 属性
│     ├─ F12 看到 Set-Cookie，但之后请求中没有发送
│     │  └─ → 浏览器因 SameSite/Secure 等原因拒绝保存
│     └─ F12 请求中有 Cookie，但 sessionCheck 返回 invalid
│        └─ → 会话读取失败，可能是 Redis 连接问题
```

---

## 🔄 快速修复流程

如果诊断发现问题：

1. **Redis 问题** (`dataFound: false`)
   ```bash
   git push  # 重新部署
   # 等待部署完成
   curl https://your-domain/api/diagnose  # 验证 Redis 连接
   ```

2. **JSON 序列化问题** (`dataValid: false`)
   ```bash
   # 查看原始 Redis 数据
   curl 'https://your-domain/api/auth/redisRawData?key=manage@sysConfig@security'
   git push  # 重新部署
   ```

3. **会话验证问题** (`sessionValid: false`)
   ```bash
   # 列出所有会话查看是否有效
   curl https://your-domain/api/auth/listSessions
   # 检查会话是否已过期或被删除
   ```

4. **浏览器 Cookie 问题**
   ```bash
   # F12 → 清除所有存储数据
   # 在隐私模式/无痕模式下重新测试
   # 检查浏览器是否有特殊的 Cookie 政策设置
   ```

