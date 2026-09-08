# pi-incarnate

让角色进入 Pi Agent 的对话现场：通过可编辑角色卡、稳定的人格层和会话内 mood，让非 coding 对话拥有更强的在场感，同时保留 Pi 原有工具、安全边界和任务完成能力。头像与状态显示由可选的 `pi-incarnate-ui` 配套扩展提供。

最新 npm 版本为 `0.1.0`；当前 `main` 包含尚未发布的交互菜单和角色卡编辑功能。项目已在 Pi `0.85.0` 验证，要求 Node.js `>=22.19.0`。第一版不做世界书、自动长期记忆或隐式角色切换。

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
pi install /path/to/pi-incarnate
```

从 npm registry 安装正式版本：

```bash
pi install npm:pi-incarnate
```

如果 npm registry 中尚未提供目标版本，请先使用上面的本地路径安装方式。

本地包由 Pi 设置管理；需要移除时运行：

```bash
pi remove /path/to/pi-incarnate
```

## 命令

在 Pi 中只输入下面这条命令，会打开键盘导航菜单：

```text
/incarnate
```

使用 `↑` / `↓` 移动，`Enter` 选择，`Esc` 返回或关闭。菜单可以完成：

- 选择或关闭角色。
- 切换当前角色的 mood。
- 切换头像的 `auto`、`full`、`compact`、`off` 模式。
- 为角色导入或移除 `.ansi` / `.txt` 头像文件。
- 查看、创建或编辑角色卡已经声明的 Markdown 偏好表单。
- 查看当前状态。
- 创建新角色卡，按章节引导编辑，或直接编辑完整 Markdown。
- 修复因格式错误或缺少 `CHARACTER.md` 而从正常列表消失的个人角色。
- 重命名、归档或恢复个人角色；归档可恢复，不提供永久删除入口。
- 将角色卡、头像和已声明表单导出为可移植角色包，或从角色包安全导入。

主菜单只保留角色选择、mood、头像模式、状态、关闭角色和 `Manage character resources`。角色卡、头像文件与偏好表单操作收在资源子菜单中，避免功能增加后主菜单持续变长。

原有子命令继续保留，适合熟悉命令后直接调用或编写脚本：

```text
/incarnate list
/incarnate use <character-id>
/incarnate status
/incarnate mood <preset>
/incarnate avatar auto|full|compact|off
/incarnate off
```

角色、mood 和头像模式只对当前 Pi session 有效。核心扩展负责发现并安全清理头像资源，通过版本化事件协议交给可选的 `pi-incarnate-ui`；实际 Header、widget 和 footer 显示完全由 UI 扩展负责。未安装 UI 时人格功能仍然正常，只是不显示头像。`/new`、`/resume` 或 `/fork` 后角色模式会关闭，避免人格层意外影响另一段会话。角色切换会先完整加载新角色，失败时保留原状态。

可选的 `pi-incarnate-ui` 扩展通过版本化事件协议接收只读表现数据，并在 Pi 底部提供不超过 6 行的固定 Footer。人格、命令、角色加载和 ANSI 安全边界仍由本扩展负责；核心扩展不再绘制 Header、widget 或 Footer，因此未安装配套 UI 时不会占用界面空间。

仓库内置原创示例角色 `mira`：

```text
/incarnate use mira
/incarnate mood focused
```

## 编写角色卡

推荐直接运行 `/incarnate`，选择 `Create character card`。先输入支持中文的角色显示名，再确认仅用于目录和命令的安全 ID；ID 留空会采用自动建议值，大写字母、空格和下划线会规范化。随后 Pi 会打开带完整结构的多行模板：`Enter` 保存，`Shift+Enter` 或 `Ctrl+J` 插入换行，`Ctrl+G` 可调用外部编辑器，`Esc` 取消且不写入文件。

日常调整推荐选择 `Edit character sections`。导航菜单可以只打开显示名、`Identity`、`Personality`、`Speech Style`、`Behavior`、`Current Mood` 或 `Tools and Forms`；不需要在整篇 Markdown 中寻找位置。每次只替换选中的标题或章节正文，代码围栏中的伪标题、其他自定义章节和未选择内容保持不变。缺少可选的 mood 或表单章节时会提供起始模板。章节正文不能新增一级或二级结构标题，三级 mood 标题仍可使用；需要调整标题顺序、增加自定义章节或进行大范围重构时，选择 `Edit complete character card`。保存前仍执行整张角色卡校验，失败时原文件不变。

个人角色保存在：

```text
~/.pi/agent/pi-incarnate/characters/<character-id>/
```

设置了 `PI_CODING_AGENT_DIR` 时，以该目录代替 `~/.pi/agent`。npm 包中的 `characters/` 是只读内置角色；通过菜单编辑内置角色时，会先创建个人覆盖副本，因此升级或重装 npm 包不会抹掉修改。同 ID 的个人角色优先于内置角色。

也可以手动创建目录。目录名就是 character ID，只允许小写 ASCII 字母、数字和内部连字符：

```text
characters/
└── my-character/
    ├── CHARACTER.md
    ├── avatar.txt          # 可选，纯文本头像
    ├── avatar.ansi         # 可选，受限 ANSI 真彩头像；优先于 avatar.txt
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

扩展在正常角色加载和人格注入时只解析这些显式列表项并检查路径，不读取或缓存表单正文。绝对路径、`..` 穿越、目录以及解析到角色目录外的符号链接都会被标为无效。

运行 `/incarnate` 并选择 `Manage preference forms`，可以打开已经声明且可用的 `.md` 表单，或从模板创建尚不存在的表单。只有用户明确选择编辑时才读取正文；编辑器限制为 256 KiB、有效 UTF-8、普通文件和角色目录内路径。编辑内置角色表单时会先创建个人覆盖副本，原包文件保持不变。新增表单声明可通过 `Edit character sections` 单独修改 `Tools and Forms` 章节。

菜单保存角色卡前会执行与运行时相同的必需章节和 mood 校验。格式错误时保留原文件并显示原因；创建过程使用暂存目录，编辑过程使用同目录临时文件原子替换。

如果个人角色卡已经损坏，运行 `/incarnate` 并选择 `Repair invalid character card`。菜单只列出目录 ID 安全、位于个人角色根目录内，且属于“卡片格式错误”或“缺少卡片”的项目。格式错误的 UTF-8 卡片会在原内容上编辑；缺少卡片时会提供完整模板。无效编码、符号链接和越界目录不会在 TUI 中打开。

头像可以通过 `/incarnate` → `Manage character avatar` 导入或移除。选择角色后输入 `.ansi` 或 `.txt` 文件路径；支持绝对路径、相对当前工作目录的路径、`~/...`、`file://...`、成对引号和终端拖放常见的转义空格。导入内置角色时会先请求创建个人覆盖副本，包内资源不会被修改。

`avatar.txt` 是纯文本格式，会去除 ANSI 和终端控制序列。`avatar.ansi` 用于彩色头像，存在时优先于 `avatar.txt`；它只保留标准色、256 色、24-bit 前景/背景色及 reset，光标移动、清屏、OSC、超链接和其他控制序列一律删除。两种格式都要求 UTF-8，最大 64 KiB、16 行、每行 48 个终端列。ANSI 每行会强制 reset，防止颜色泄漏到 Pi 界面。头像损坏或不可读时只降级为角色状态行，不会关闭已经启用的人格。

菜单导入会把清理后的安全版本写入个人角色目录，并拒绝需要裁剪的资源，避免静默损失图像。导入一种格式会移除另一种格式，确保新头像立即生效；写入使用同目录临时文件替换。移除操作需要确认，只删除个人副本中的 `avatar.ansi` 和 `avatar.txt`。

个人角色还可以通过 `/incarnate` → `Rename, archive, or restore` 管理生命周期。重命名只修改安全目录 ID，不改角色卡中的显示名；如果角色正在使用，会同步更新当前会话。归档会在确认后把完整角色目录移到：

```text
~/.pi/agent/pi-incarnate/archive/<character-id>/
```

设置了 `PI_CODING_AGENT_DIR` 时仍以该目录为基准。归档会保留角色卡、头像和表单，并在归档当前角色时关闭角色模式；恢复后可选择立即启用。为了避免覆盖数据，同一 ID 只能有一个归档副本，且目标个人角色已存在时不会恢复。内置角色是只读的，不会出现在重命名或归档列表中。本版本没有永久删除角色的菜单。

## 迁移角色

运行 `/incarnate` → `Export or import character package` 可以迁移角色。导出文件采用可审阅的版本化 JSON，后缀为：

```text
<character-id>.pi-character.json
```

导出只收集 `CHARACTER.md`、运行时优先使用的一个头像，以及角色卡中已经声明且当前可用的 Markdown 表单。未知文件、未声明文件、缺失或无效表单和被另一格式遮蔽的头像不会进入角色包。确认界面会显示实际包含的头像和表单数量；偏好表单可能包含私人信息，分享前应直接打开 JSON 检查。

导入会先检查格式版本、安全 ID、UTF-8、文件数量与总大小、角色卡结构、头像安全边界，以及每份表单是否由卡片明确声明。路径穿越、重复路径、未知文件、符号链接来源和同时包含两个头像的包都会被拒绝。整个角色先在个人目录内的临时位置完成构建和加载，再整体移动到正式位置；不会覆盖已有个人角色。同 ID 只有内置角色时，导入结果会成为个人覆盖副本。导入成功后可选择立即启用。

角色包最大 1 MiB、最多 66 个文件；其中角色卡最大 512 KiB，表单和头像继续沿用各自的 256 KiB 与 64 KiB 限制。导出目标和导入来源支持与头像导入相同的绝对路径、相对路径、`~/...`、`file://...`、引号和转义空格输入。导出不会覆盖已有文件。

## 故障排查

- `No valid characters found`：确认角色位于个人目录或包内 `characters/<id>/CHARACTER.md`，目录 ID 合法。
- `missing required non-empty sections`：补齐四个必需的二级章节，并确保正文非空。
- 个人角色因格式错误未出现在列表：打开 `/incarnate`，选择 `Repair invalid character card`；修复成功后会重新进入正常角色列表。
- `Current Mood ...`：检查 `Default:`、三级标题 preset ID 和对应正文。
- `Forms: n/m available`：运行 `/incarnate status` 后检查缺失文件；表单路径必须留在角色目录内。
- 彩色头像不显示：文件名应为 `avatar.ansi` 并位于对应角色目录；任意 ANSI 动画、光标控制或终端命令不会被支持。
- 命令没有出现：开发时确认使用 `pi -e ./extensions/index.ts`；本地安装后可用 `pi list` 和 `pi config` 检查资源状态。
- 项目本地扩展未加载：Pi 只从受信任项目自动加载 `.pi/extensions`；本项目的显式 `-e` 和本地包安装不依赖该目录。

## 开发结构

```text
extensions/index.ts       Pi 扩展入口和生命周期
src/character-loader.ts   角色发现、UTF-8 与章节验证
src/character-catalog.ts  个人/内置角色合并与覆盖规则
src/character-editor.ts   模板、校验、安全创建与原子保存
src/character-section-editor.ts 单章节定位与保留式更新
src/character-lifecycle.ts 个人角色重命名、可恢复归档与恢复
src/character-bundle.ts   版本化角色包导出、验证与原子导入
src/session-state.ts      当前 session 的角色/mood/avatar 状态
src/persona.ts            有界人格 prompt 组合
src/commands.ts           /incarnate 命令
src/menu.ts               键盘导航菜单与角色卡编辑流程
src/avatar.ts             ASCII/ANSI 头像读取与安全清理
src/avatar-manager.ts     头像路径解析、安全导入与移除
src/form-editor.ts        偏好表单有界读取与原子编辑
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
