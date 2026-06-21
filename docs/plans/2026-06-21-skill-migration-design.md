# 技能迁移（Copy）功能设计

> 日期: 2026-06-21 | 关联: Agent.md v0.1.4 `⬜ 跨来源移动`

## 需求摘要

在 SkillManager 中实现跨来源 skill 复制功能，允许用户将一个 skill 从来源 A 复制到来源 B，源保留副本。

## 范围决策

| 决策点 | 选择 | 理由 |
|--------|------|------|
| 操作类型 | 仅复制（Copy） | 用户确认 |
| 目标限制 | 无限制（任意来源→任意来源） | 用户确认 |
| 格式兼容 | 全目录型，无需转换 | 当前 7 个来源均为目录型（`skill-name/SKILL.md`） |
| 批量支持 | 单 skill 操作 | 用户确认 |
| 冲突处理 | 弹窗三选一（覆盖/跳过/重命名） | 两步式冲突检测 |
| 目标选择 UI | 下拉选择器 | 用户确认 |

## 后端 API

### `POST /api/skills/copy/check`

检测冲突。无冲突时直接执行复制并返回。

**请求：**
```json
{
  "skill_name": "my-skill",
  "source_id": "workbuddy",
  "target_id": "trae"
}
```

**无冲突返回（已执行复制）：**
```json
{
  "conflict": false,
  "success": true,
  "action": "copied",
  "skill_name": "my-skill",
  "target_path": "C:/Users/31585/.trae-cn/skills/my-skill"
}
```

**有冲突返回：**
```json
{
  "conflict": true,
  "existing_skill": {
    "name": "my-skill",
    "source_id": "trae",
    "path": "C:/Users/31585/.trae-cn/skills/my-skill",
    "file_count": 3,
    "size_kb": 12
  }
}
```

### `POST /api/skills/copy`

执行复制（带冲突策略）。

**请求：**
```json
{
  "skill_name": "my-skill",
  "source_id": "workbuddy",
  "target_id": "trae",
  "strategy": "overwrite"
}
```

**参数说明：**
- `strategy`：`"overwrite"` | `"skip"` | `"rename"`
- `rename` 时追加 `_copy` 后缀，冲突则递增 `_copy2`, `_copy3` ...

**返回：**
```json
{
  "success": true,
  "action": "copied",
  "renamed_to": null,
  "skill_name": "my-skill",
  "target_path": "C:/Users/31585/.trae-cn/skills/my-skill"
}
```

### 校验规则

- `source_id` 和 `target_id` 必须存在于 config
- `source_id` ≠ `target_id`
- `target_id` 对应来源必须 `writable: true`
- source skill 必须存在且可读

### 复制实现

```
def copy_skill(source_id, target_id, skill_name, strategy):
    1. 定位源 skill 目录
    2. 计算目标路径
    3. 检测冲突 → 按 strategy 处理
    4. shutil.copytree(src_dir, dst_dir)
    5. 返回结果
```

当前 7 个来源均为目录型（子目录 + SKILL.md），无需格式转换。未来若引入单文件型来源，再扩展转换逻辑。

## 前端 UI

### 入口

skill 详情面板（右侧）标题栏，删除按钮旁新增「复制到…」按钮。

- 仅对非当前来源的 skill 显示
- 目标来源不可写时按钮禁用

### 交互流程

```
点击「复制到…」
  → 弹窗①：选择目标来源（<select>）
  → POST /api/skills/copy/check
  → 无冲突：toast 成功，刷新列表
  → 有冲突：弹窗② 三选一（覆盖/跳过/重命名）
     → POST /api/skills/copy + strategy
     → toast 结果，刷新列表
```

### 状态处理

| 状态 | 行为 |
|------|------|
| 目标只读 | 下拉中灰显 + tooltip |
| 复制中 | 按钮 loading，禁止重复操作 |
| 复制失败 | toast 错误详情 |
| 源=目标 | 该来源不在下拉中出现 |

## 变更清单

- `main.py`：新增 `POST /api/skills/copy/check` 和 `POST /api/skills/copy` 端点
- `static/app.js`：新增复制按钮、双弹窗交互逻辑
- `static/style.css`：新增弹窗、loading 态样式
- `Agent.md`：更新功能清单、API 端点、变更记录
