# 🚀 快速诊断参考卡片

## 问题症状
```
✅ 输入密码 → 显示"登录成功"
❌ 立即显示"请认证"
✗ 无法保持登录状态
```

## 诊断工具快速链接

| 工具 | 链接 | 用途 |
|------|------|------|
| 配置检查 | `/api/auth/testLogin` | 检查系统配置 |
| 登录模拟 | `POST /api/auth/fullLoginTest` | 模拟完整登录 |
| 会话诊断 | `/api/auth/sessionDebug` | 检查会话状态 |
| Redis 数据 | `/api/auth/redisRawData` | 查看原始数据 |
| 会话列表 | `/api/auth/listSessions` | 列出所有会话 |

---

## 一键诊断脚本

保存为 `diagnose.sh`，然后运行：
```bash
#!/bin/bash

DOMAIN="https://your-domain"
PASSWORD="your-password"

echo "=== 1. 检查配置 ==="
curl "$DOMAIN/api/auth/testLogin" | jq .configStatus

echo -e "\n=== 2. 完整登录流程 ==="
curl -X POST "$DOMAIN/api/auth/fullLoginTest" \
  -H "Content-Type: application/json" \
  -d "{\"password\": \"$PASSWORD\", \"type\": \"user\"}" | jq '.finalResult, .steps[] | select(.step | contains("verify") or contains("valid"))'

echo -e "\n=== 3. Redis 连接测试 ==="
curl -X POST "$DOMAIN/api/auth/sessionDebug" | jq '.steps[] | select(.step == "database-connectivity")'

echo -e "\n=== 4. 当前会话列表 ==="
curl "$DOMAIN/api/auth/listSessions" | jq '.summary'
```

---

## 最可能的问题及解决方案

### 问题 1: `dataFound: false` (Redis 未保存)
**标志**: POST fullLoginTest 返回 SESSION_LOST_AFTER_LOGIN

**快速修复**:
```bash
# 1. 检查环境变量
echo $UPSTASH_REDIS_REST_URL
echo $UPSTASH_REDIS_REST_TOKEN

# 2. 重新部署
git push

# 3. 验证
curl https://your-domain/api/auth/testLogin
```

---

### 问题 2: `dataValid: false` (JSON 问题)
**标志**: 数据存在但无法解析

**快速修复**:
```bash
# 查看原始数据
curl 'https://your-domain/api/auth/redisRawData?key=manage@sysConfig@security' | jq '.redis'

# 如果有 parseError，重新部署
git push
```

---

### 问题 3: `sessionValid: false` (会话验证失败)
**标志**: 数据存在且有效，但验证失败

**快速修复**:
```bash
# 查看所有会话
curl https://your-domain/api/auth/listSessions

# 如果会话已过期，检查 TTL 设置
# 查看 sessionConfig.js 中的 MAX_SESSION_MAX_AGE_DAYS

git push
```

---

### 问题 4: 浏览器 Cookie 问题
**标志**: fullLoginTest 返回 LOGIN_SUCCESSFUL，但浏览器还显示"请认证"

**快速诊断**:
```
1. F12 → Network → 登录请求
2. Response Headers 中查找 Set-Cookie
3. 应该看到: Set-Cookie: user_session=...; ... Secure
```

**解决**:
```
1. F12 → Application → Cookies → 删除所有
2. 在隐私模式下重新测试
3. 检查浏览器是否禁用了第三方 Cookie
```

---

## 完整测试步骤（5分钟）

### 步骤 1: 部署修复代码
```bash
git push
# 等待 Vercel 部署完成
```

### 步骤 2: 验证系统（1分钟）
```bash
# 应该显示 loaded: true
curl https://your-domain/api/auth/testLogin | jq .configStatus
```

### 步骤 3: 模拟登录（1分钟）
```bash
# 替换为实际密码和类型
curl -X POST https://your-domain/api/auth/fullLoginTest \
  -H "Content-Type: application/json" \
  -d '{"password": "test123", "type": "user"}' | jq .finalResult
```

**结果应该是**: `"LOGIN_SUCCESSFUL"`

### 步骤 4: 清理浏览器（1分钟）
```
1. F12 → Application → Storage → Clear All
2. 关闭所有 Tab（确保没有缓存）
3. 刷新页面
```

### 步骤 5: 实际测试登录（1分钟）
```
1. 输入密码登录
2. 应该显示登录成功并保持状态
3. 刷新页面，应该仍保持登录状态
```

---

## 诊断端点简明说明

### GET `/api/auth/testLogin`
查看配置和密码格式
```bash
curl https://your-domain/api/auth/testLogin
```

响应:
- `loaded` = 配置是否加载
- `authConfigured` = 是否配置了密码
- `passwordFormats` = 密码存储格式

---

### POST `/api/auth/testLogin`
测试密码验证
```bash
curl -X POST https://your-domain/api/auth/testLogin \
  -H "Content-Type: application/json" \
  -d '{"password": "your-password", "type": "user"}'
```

响应:
- `finalResult` = PASSWORD_CORRECT 或 PASSWORD_INCORRECT

---

### POST `/api/auth/fullLoginTest`
完整登录流程模拟 (最重要!)
```bash
curl -X POST https://your-domain/api/auth/fullLoginTest \
  -H "Content-Type: application/json" \
  -d '{"password": "your-password", "type": "user"}'
```

响应:
- `finalResult` = LOGIN_SUCCESSFUL 或 SESSION_LOST_AFTER_LOGIN
- 详细的每一步的结果

---

### POST `/api/auth/sessionDebug`
测试会话创建和 Redis 连接
```bash
curl -X POST https://your-domain/api/auth/sessionDebug
```

响应:
- 会话创建是否成功
- Redis 读写是否正常
- 会话是否能被读取

---

### GET `/api/auth/redisRawData?key=<key>`
查看 Redis 中的原始数据
```bash
# 查看安全配置
curl 'https://your-domain/api/auth/redisRawData?key=manage@sysConfig@security'

# 查看会话 (需要实际的 token)
curl 'https://your-domain/api/auth/redisRawData?key=manage@session@<token>'
```

---

### GET `/api/auth/listSessions`
列出所有活跃会话
```bash
curl https://your-domain/api/auth/listSessions
```

响应:
- 当前所有会话的列表
- 每个会话的过期时间
- 是否已过期

---

## 常见错误消息速查

| 错误 | 原因 | 解决方案 |
|------|------|--------|
| Security config unavailable | Redis 连接失败 | 检查 UPSTASH 环境变量 |
| PASSWORD_INCORRECT | 密码不匹配 | 确认输入的密码正确 |
| SESSION_LOST_AFTER_LOGIN | 会话验证失败 | 检查 Redis 和 TTL 设置 |
| parseError | JSON 序列化失败 | 检查数据编码 |
| dataFound: false | Redis 写入失败 | 检查连接和配额 |

---

## 获取帮助

如果诊断工具无法解决问题，收集以下信息：

1. **诊断输出**:
   ```bash
   curl https://your-domain/api/auth/fullLoginTest -X POST \
     -d '{"password": "test", "type": "user"}' > diagnosis.json
   ```

2. **浏览器信息**:
   - 浏览器类型和版本
   - F12 Console 中的错误消息
   - F12 Network 中登录请求的完整截图

3. **服务器日志**:
   - Vercel 部署日志
   - 部署时间

