# 市场安装 Skill 功能设计

日期: 2026-06-21

## 概述

从 skills.sh 公开市场浏览并安装 skill 到本地用户来源。

## 交互流程

```
[本地/市场切换] → [浏览 market 列表] → [选中 skill 查看详情]
    → [选择目标来源（多选）] → [安装] → [进度+结果反馈] → [刷新本地列表]
```

## 入口设计

顶部"本地 / 市场"切换按钮，替代部分原有 tabs 逻辑。

- **本地**：现有 7 个来源 + 搜索 + 文件树
- **市场**：skills.sh 数据，左侧列表 + 右侧预览 + 安装面板

## 市场列表

### 数据源
`GET https://skills.sh/api/skills/all-time/{page}` — 每页 200 条，`hasMore` 控制分页，滚动加载。

数据结构：`{source: "owner/repo", skillId, name, installs, weeklyInstalls, isOfficial}`

### 搜索
客户端本地过滤（skills.sh 无服务端搜索 API）。9,590 条全量分页拉取后本地匹配。

### 三种安装状态

| 状态 | 表现 | 行为 |
|---|---|---|
| 全部未安装 | 正常显示，可点击 | 来源选择器全部可选 |
| 部分来源已有 | "已安装: agents, claude" | 已有来源置灰 |
| 全部来源已有 | 置灰，显示已安装列表 | 不可选 |

## 详情与安装面板

选中 market skill 后右侧显示：
- SKILL.md 内容预览（从 GitHub 拉取）
- 来源多选器（5 个用户来源，已有同名置灰，其余默认全选）
- 安装按钮

## 安装流程

1. 前端发送 `POST /api/market/install`，body: `{owner, repo, skillId, sources: ["agents","workbuddy"]}`
2. 后端检查 GitHub 连通性，不可达立即终止
3. GitHub 拉取 skill 文件（`GET /repos/{owner}/{repo}/contents/{skillId}/` 目录递归）
4. 逐源写入文件到目标目录
5. 返回每个来源的安装结果

### 进度反馈（SSE 或轮询）

```
正在获取 skill 文件...
└─ ✅ 已获取 3 个文件

正在安装到来源...
└─ ✅ agents         完成
└─ ✅ workbuddy      完成
└─ ❌ codex          权限不足
└─ 🔄 claude         写入中...

████████████░░░░  3/4
```

### 错误处理

| 错误类型 | 严重度 | 处理 |
|---|---|---|
| 网络不可达（DNS/连接拒绝） | 致命 | 立即终止全部，提示检查网络 |
| 网络超时 | 单源 | 当前源失败，继续其他，汇总报告 |
| GitHub 404 | 致命 | 终止全部，提示 skill 不存在 |
| GitHub 速率限制 | 致命 | 终止全部，提示等待时间 |
| 目标目录写入失败（权限） | 单源 | 当前源失败，继续其他 |
| 磁盘空间不足 | 单源 | 当前源失败，继续其他 |

### 结果展示

```
安装完成: 2 成功, 1 失败

✅ agents         安装成功
✅ workbuddy      安装成功
❌ claude         写入失败: 权限不足
```

安装完成后自动刷新本地 skill 列表。

## API 端点

| 方法 | 端点 | 用途 |
|---|---|---|
| GET | `/api/market/skills?page=&search=` | 代理 skills.sh，带回本地冲突状态 |
| GET | `/api/market/skill/{owner}/{repo}/{skillId}` | 获取详情 + SKILL.md 内容 |
| GET | `/api/market/check/{skillId}` | 检查 5 个来源中哪些已有同名 |
| POST | `/api/market/install` | 安装到选中来源，SSE 推送进度 |

## 技术要点

- GitHub API 无需认证（公开仓库），但有 token 可提速率限制 60→5000/小时
- 中国区 GitHub 连通性问题：安装前必须前置检测
- skills.sh 数据按安装量降序排列
- 安装行为参考现有复制功能的约束（文件处理、路径标准化）
