# dsh-ccswitch

将 DSH 所在设备当前用户的 [CC Switch](https://github.com/farion1231/cc-switch) provider、模型和认证配置以只读方式接入 DeepSeek Harness（DSH）。插件不绑定特定用户、provider、目录或操作系统；它会在每台设备上读取该设备自己的 CC Switch 数据，并把可用 provider 注册为独立的 DSH 模型路由。

Web 端同时会在 DSH 模型选择列表中增加“搜索模型”输入框。搜索只匹配模型名称，不区分大小写，并会隐藏没有匹配模型的 provider 分组。

## 平台与多设备

插件支持 CC Switch 与 DSH 可运行的 macOS、Windows 和 Linux 环境。默认路径由 Node.js 的用户主目录和当前操作系统路径规则生成，不使用固定盘符、固定用户名或开发者电脑路径。

| 平台 | 默认 CC Switch 数据库 | provider 选择文件 |
| --- | --- | --- |
| macOS/Linux | `$HOME/.cc-switch/cc-switch.db` | `$HOME/.dsh/ccswitch-providers.json` |
| Windows PowerShell | `$HOME\.cc-switch\cc-switch.db` | `$HOME\.dsh\ccswitch-providers.json` |
| Windows cmd | `%USERPROFILE%\.cc-switch\cc-switch.db` | `%USERPROFILE%\.dsh\ccswitch-providers.json` |

在两台或更多设备上使用时，需要在每台运行 DSH 的设备上分别安装插件：

- 每台设备只读取该设备当前用户的 CC Switch 数据库和凭据，不依赖其他设备在线；
- macOS 与 Windows 可以使用不同的 provider、模型、数据库目录和筛选配置；
- CC Switch 使用自定义数据目录、便携目录或同步盘时，在对应设备上单独设置 `DSH_CCSWITCH_DB`；
- provider 选择文件和 `DSH_CCSWITCH_PROVIDERS` 也是设备级配置，不要求两台设备保持一致；
- 插件不会上传、复制或同步 API key、OAuth token 和 CC Switch 数据库。跨设备支持表示同一插件可在不同设备独立运行，不表示从一台设备远程读取另一台设备的凭据。

## 安装

从源码安装（将 `<owner>` 替换为实际 GitHub 仓库所有者）：

前置条件：Node.js `>=22.19.0`、pnpm 11，以及已安装并可执行的 DSH。以下命令在 macOS、Linux 和 Windows PowerShell 中均可使用；PowerShell 不要使用 Bash 的反斜杠换行语法。

```bash
git clone https://github.com/<owner>/dsh-ccswitch.git
cd dsh-ccswitch
pnpm install
pnpm build
dsh plugin --profile web add .
```

安装或更新插件后重启当前 DSH profile。前台运行时先按 `Ctrl+C` 停止旧进程，再重新执行启动命令：

```bash
dsh web --host 127.0.0.1 --port 3080
```

如果旧进程是在后台运行：

macOS/Linux：

```bash
pid=$(lsof -t -iTCP:3080 -sTCP:LISTEN | head -1)
[ -z "$pid" ] || kill "$pid"
dsh web --host 127.0.0.1 --port 3080
```

Windows PowerShell：

```powershell
$connection = Get-NetTCPConnection -LocalPort 3080 -State Listen -ErrorAction SilentlyContinue
if ($connection) { Stop-Process -Id $connection.OwningProcess -Force }
dsh web --host 127.0.0.1 --port 3080
```

## 配置

默认读取：

```text
~/.cc-switch/cc-switch.db
```

这里的 `~` 表示 DSH 进程所属用户的主目录。可以通过 `DSH_CCSWITCH_DB` 指定当前设备上 `cc-switch.db` 的完整路径。

macOS/Linux：

```bash
DSH_CCSWITCH_DB='/path/to/cc-switch.db' \
  dsh web --host 127.0.0.1 --port 3080
```

Windows PowerShell：

```powershell
$env:DSH_CCSWITCH_DB = 'D:\path\to\cc-switch.db'
dsh web --host 127.0.0.1 --port 3080
```

插件默认每 2 秒读取一次当前设备的数据库，路由变化会原子刷新到 DSH，不需要再次安装插件。

### 选择 provider

默认注册所有有可用配置的 CC Switch provider。需要限制范围时，可以使用环境变量：

```bash
DSH_CCSWITCH_PROVIDERS='my-codex-provider,ccswitch/claude/*' \
  dsh web --host 127.0.0.1 --port 3080
```

Windows PowerShell：

```powershell
$env:DSH_CCSWITCH_PROVIDERS = 'my-codex-provider,ccswitch/claude/*'
dsh web --host 127.0.0.1 --port 3080
```

也可以在当前设备创建用户级文件 `~/.dsh/ccswitch-providers.json`，插件会轮询它的变化。具体平台路径见上方表格：

```json
{
  "include": [
    "my-codex-provider",
    "ccswitch/claude/*"
  ]
}
```

选择项支持 provider 名称、CC Switch UUID、完整 DSH 路由和 `*` 通配符；环境变量优先于文件。选择为空数组时不注册任何 CC Switch provider，文件不存在时注册全部 provider。变更会自动刷新路由；安装或更新插件本身仍需重启 DSH profile。

支持：

- Claude provider 的 API key 和 `ANTHROPIC_AUTH_TOKEN`；
- Codex 的 OpenAI-compatible API key，以及 CC Switch 的 Codex OAuth 文件（缺少托管文件时只读回退用户主目录下的 `.codex/auth.json`）；
- Gemini API key 和用户主目录下 `.gemini/oauth_creds.json` OAuth；Gemini OAuth 使用 Bearer-only 请求，不会把 access token 当成 `x-goog-api-key`；
- Claude Messages、OpenAI Completions、OpenAI Responses、Gemini Generative AI 协议；
- `/models`、Gemini `/v1beta/models` 和 Codex OAuth models endpoint 的模型发现。
- Claude、Codex/GPT 和 Gemini 路由的图片输入；图片会通过 DSH 的持久化附件服务读取并按目标协议转换。
- Codex 路由中 `gpt-5*`、`o1/o3/o4*` 和 `codex*` 模型的 `minimal`、`low`、`medium`、`high` 推理档位，默认使用 `minimal` 以减少首字等待。可用 `DSH_CCSWITCH_CODEX_REASONING=provider` 保留上游默认，或将变量设为任一支持档位。

发现模型是增强功能。网络不可用、端点不支持列表接口或 OAuth 过期时，插件继续使用 CC Switch 数据库中的默认模型，并在配置变化或后续定时重试时再次发现。

## 安全边界

- 以 SQLite `readOnly` 模式打开 CC Switch 数据库，不写入 provider、密钥或 OAuth 文件；
- API key 和 token 只在单次请求前解析，保存在进程内最小范围，不写入 DSH settings、session 或日志；
- OAuth 刷新 token 只保存在本进程内存，重新登录仍由 CC Switch 完成；
- 发送请求时保留 DSH attribution headers，并为 Codex/Gemini OAuth 添加必要的账号和 Bearer headers。

## 本地开发

```bash
pnpm install
pnpm typecheck
pnpm test
pnpm build
```

插件源码位于 `src/`，入口是 `src/index.ts`。适配器使用 DSH `llm-pi-ai` 的上下文、replay 和 stream 转换实现，避免破坏工具调用、图片附件、上下文溢出和错误分类语义。
