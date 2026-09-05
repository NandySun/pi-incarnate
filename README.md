# pi-incarnate

让角色进入 Pi Agent 的对话现场：通过可编辑角色卡、稳定的人格层、会话内 mood 和持久 TUI ASCII 头像，让非 coding 对话拥有更强的在场感，同时保留 Pi 原有工具、安全边界和任务完成能力。

当前版本为 `0.1.0`，已在 Pi `0.85.0` 验证，要求 Node.js `>=22.19.0`。第一版不做世界书、自动长期记忆或隐式角色切换。

## 安装与启动

在仓库中安装开发依赖并验证：

```bash
npm install
npm run verify
```

临时加载扩展进行开发：

```bash
pi -e ./extensions/index.ts
```

把当前工作区作为本地 Pi 包安装：

```bash
pi install /home/revmsonwe/Projects/pi-incarnate
```

从 npm registry 安装正式版本：

```bash
pi install npm:pi-incarnate
```

如果 npm registry 中尚未提供目标版本，请先使用上面的本地路径安装方式。

本地包由 Pi 设置管理；需要移除时运行：

```bash
pi remove /home/revmsonwe/Projects/pi-incarnate
```

## 命令

```text
/incarnate list
/incarnate use <character-id>
/incarnate status
/incarnate mood <preset>
/incarnate avatar auto|full|compact|off
/incarnate off
```

角色、mood 和头像模式只对当前 Pi session 有效。头像默认为 `auto`：宽终端显示靠右的完整 `avatar.txt`，头像尾行与左侧角色状态同行；窄终端只显示角色与 mood 状态行。`full` 和 `compact` 可手动固定模式，旧命令 `avatar on` 仍作为 `auto` 的别名。`/new`、`/resume` 或 `/fork` 后角色模式会关闭，避免人格层意外影响另一段会话。角色切换会先完整加载新角色，失败时保留原状态。

仓库内置原创示例角色 `mira`：

```text
/incarnate use mira
/incarnate mood focused
```

## 编写角色卡

在 `characters/` 下创建直属目录。目录名就是 character ID，只允许小写 ASCII 字母、数字和内部连字符：

```text
characters/
└── my-character/
    ├── CHARACTER.md
    ├── avatar.txt          # 可选
    └── forms/              # 可选
```

`CHARACTER.md` 必须使用 UTF-8，包含一级标题角色名，以及以下四个非空二级章节：

```markdown
# 角色名

## Identity
角色身份与和用户的关系。

## Personality
性格、偏好、缺点和价值判断。

## Speech Style
称呼、节奏、口癖和至少三个示例对话。

## Behavior
赞同、质疑、关心、兴奋、失望、道歉和诚实边界。
```

可选 mood 使用固定格式；默认值必须对应一个非空预设：

```markdown
## Current Mood
Default: warm

### warm
更有耐心，批评保持柔和。

### focused
减少闲聊，先给结论和证据。
```

可选表单只支持角色目录内的相对路径：

```markdown
## Tools and Forms
- 游戏偏好：`forms/games.md`
- 影视偏好：`forms/films.md`
```

扩展只解析这些显式列表项并检查路径，不读取、不复制、不缓存表单内容。绝对路径、`..` 穿越、目录以及解析到角色目录外的符号链接都会被标为无效。

`avatar.txt` 会去除 ANSI 和终端控制序列，tab 展开为空格，最多显示 12 行、每行 48 个终端列。头像损坏或不可读时只降级为角色状态行，不会关闭已经启用的人格。

## 故障排查

- `No valid characters found`：确认角色位于包内 `characters/<id>/CHARACTER.md`，目录 ID 合法。
- `missing required non-empty sections`：补齐四个必需的二级章节，并确保正文非空。
- `Current Mood ...`：检查 `Default:`、三级标题 preset ID 和对应正文。
- `Forms: n/m available`：运行 `/incarnate status` 后检查缺失文件；表单路径必须留在角色目录内。
- 命令没有出现：开发时确认使用 `pi -e ./extensions/index.ts`；本地安装后可用 `pi list` 和 `pi config` 检查资源状态。
- 项目本地扩展未加载：Pi 只从受信任项目自动加载 `.pi/extensions`；本项目的显式 `-e` 和本地包安装不依赖该目录。

## 开发结构

```text
extensions/index.ts       Pi 扩展入口和生命周期
src/character-loader.ts   角色发现、UTF-8 与章节验证
src/session-state.ts      当前 session 的角色/mood/avatar 状态
src/persona.ts            有界人格 prompt 组合
src/commands.ts           /incarnate 命令
src/avatar.ts             ASCII 清理、裁剪和 widget 内容
src/mood.ts               mood 预设解析和 prompt 片段
src/forms.ts              表单声明解析与路径边界校验
characters/mira/          原创示例角色与三份空白表单
tests/                    Node 原生测试
```

发布前运行完整检查：

```bash
npm run release:check
```

项目采用 [MIT License](./LICENSE)。版本变化记录见 [CHANGELOG.md](./CHANGELOG.md)，安全边界与报告方式见 [SECURITY.md](./SECURITY.md)。

## 项目文档

- [项目开发方向](</home/revmsonwe/Documents/Obsidian Vault/Projects/pi-incarnate/项目开发方向.md>)
- [开发流程](</home/revmsonwe/Documents/Obsidian Vault/Projects/pi-incarnate/开发流程.md>)
- [架构决策记录](</home/revmsonwe/Documents/Obsidian Vault/Projects/pi-incarnate/架构决策记录.md>)
- [任务看板](</home/revmsonwe/Documents/Obsidian Vault/Projects/pi-incarnate/任务看板.md>)
- [验证清单](</home/revmsonwe/Documents/Obsidian Vault/Projects/pi-incarnate/验证清单.md>)
- [会话记录](</home/revmsonwe/Documents/Obsidian Vault/Projects/pi-incarnate/会话记录.md>)
