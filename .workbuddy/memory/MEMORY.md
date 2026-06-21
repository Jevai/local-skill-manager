# SkillManager 项目记忆

## 工作规则

- **Git 提交规则**：每完成一个完整的工作（功能点/bug修复/重构），立即做一次 git 提交，不要累积多个改动再提交。
- 提交信息用中文简要描述改动内容。

## 技术栈

- 后端：Python 3.13 + FastAPI
- 前端：原生 HTML/CSS/JS（无框架依赖）
- 启动：`start.bat` 或 `python main.py`（端口 7788）

## 当前功能

- [x] 浏览/检索 skills（跨 7 个来源）
- [x] 来源 tab 切换，数量统计正确
- [x] 左侧文件树可点击，右侧显示文件内容（仅渲染 .md，其他纯文本）
- [x] 删除功能（二次确认，symlink 只删链接）
- [x] 技能复制功能：跨来源复制，含两步式冲突检测 + 弹窗三策略（覆盖/跳过/重命名）
- [x] 市场安装功能：skills.sh 浏览 + GitHub 拉取 + 多源并行安装（SSE 进度推送）
- [ ] 待添加：skill 创建/编辑功能

## 已知来源

| name | label | 路径 |
|---|---|---|
| agents | 全局 | C:/Users/31585/.agents/skills/ |
| trae | Trae CN | C:/Users/31585/.trae-cn/skills/ |
| codex | Codex | C:/Users/31585/.codex/skills/ |
| claude | Claude | C:/Users/31585/.claude/skills/ |
| workbuddy | WorkBuddy | C:/Users/31585/.workbuddy/skills/ |
| trae_builtin | Trae 内置 | C:/Users/31585/.trae-cn/builtin_skills/ |
| trae_builtin_global | Trae 全局内置 | C:/Users/31585/.trae-cn/builtin/global/skills/ |
