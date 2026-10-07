# dsh-ccswitch

在 DeepSeek Harness（DSH）中直接使用 [CC Switch](https://github.com/farion1231/cc-switch) 已配置的 Claude、Codex/GPT 和 Gemini 模型。

插件会自动读取当前设备上的 CC Switch 配置，不需要在 DSH 中重复填写 API key 或登录信息。模型选择器中还会增加模型名称搜索。

支持 macOS、Windows 和 Linux。

## 使用前准备

1. 安装并打开 CC Switch。
2. 在 CC Switch 中添加可用的 provider，并确认模型可以正常使用。
3. 安装 DeepSeek Harness。

## 安装插件

macOS、Windows PowerShell 和 Linux 都可以执行：

```bash
dsh plugin --profile web add github:upJiang/dsh-ccswitch
```

安装完成后重启 DSH。前台运行时先按 `Ctrl+C` 停止，再重新启动：

```bash
dsh web --host 127.0.0.1 --port 3080
```

重新打开或刷新 DSH 页面后，就可以在模型选择器中看到 CC Switch 的 provider 和模型。

## 选择模型

打开 DSH 的模型选择器：

1. 找到名称以 CC Switch provider 显示的模型分组。
2. 直接选择需要的模型。
3. 模型较多时，在顶部的“搜索模型”输入框中输入模型名称。

插件会自动读取 CC Switch 后续的配置变化。添加、删除或修改 provider 后，通常不需要重新安装插件。

## 模型列表和上下文大小

启动时插件会请求每个 provider 的模型接口（中转站通常是 `/models`），并把返回的模型合并进选择器。

- 接口返回的模型会**替换** CC Switch 里配置的模型列表，所以中转站目录里那些你没有配置过的模型也会出现。
- 模型自己的思考等级、以及它在 CC Switch 中声明的上下文大小，会保留下来。
- 上下文大小按顺序取值：接口返回的字段 → CC Switch 模型表中的 `contextWindow` → Codex 配置 TOML 中的 `model_context_window` → 默认 262144。
- 中转站通常不返回上下文字段，此时就以你在 Codex TOML 里写的 `model_context_window` 为准。

只使用自己在 CC Switch 中配置的模型，不允许接口扩充列表：

macOS/Linux：

```bash
DSH_CCSWITCH_DISCOVER=0 dsh web --host 127.0.0.1 --port 3080
```

Windows PowerShell：

```powershell
$env:DSH_CCSWITCH_DISCOVER = '0'
dsh web --host 127.0.0.1 --port 3080
```

`DSH_CCSWITCH_DISCOVER` 接受 `0/1`、`false/true`、`off/on`、`no/yes`、`never/always`，默认开启。

## 只显示部分 provider

默认显示 CC Switch 中所有可用 provider。如果只想使用其中一部分，可以创建配置文件。

macOS/Linux：

```text
~/.dsh/ccswitch-providers.json
```

Windows：

```text
%USERPROFILE%\.dsh\ccswitch-providers.json
```

文件内容：

```json
{
  "include": [
    "my-codex-provider",
    "ccswitch/claude/*"
  ]
}
```

可以填写 CC Switch 中显示的 provider 名称，也可以使用 `*` 通配符。保存文件后，DSH 会自动刷新可用模型。

## CC Switch 使用了自定义目录

正常情况下不需要设置路径，插件会自动查找当前用户的 CC Switch 数据库。

如果在 CC Switch 中使用了自定义数据目录、便携目录或同步盘，需要告诉插件数据库的位置。

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

## 在多台设备上使用

在每台设备上分别安装 CC Switch、DSH 和本插件即可。

- Mac 会读取 Mac 上的 CC Switch 配置；
- Windows 会读取 Windows 上的 CC Switch 配置；
- 两台设备可以使用不同的 provider 和模型；
- 插件不会在设备之间同步数据库、API key 或登录信息。

## 没有看到模型

按顺序检查：

1. CC Switch 中是否已经添加并启用了 provider。
2. CC Switch 中的模型是否可以正常请求。
3. 安装插件后是否重启并刷新了 DSH。
4. 是否配置了错误的 `ccswitch-providers.json` 筛选条件。
5. 使用自定义 CC Switch 目录时，`DSH_CCSWITCH_DB` 是否指向正确的 `cc-switch.db` 文件。

## 会话提示上下文溢出，或压缩一直失败

如果 DSH 认为模型的上下文窗口比实际小，会话变长后触发压缩时会一直报 `context overflow`，该轮会被中断。

检查顺序：

1. Codex 的 TOML 里是否写了 `model_context_window`（例如 `1000000`）；插件会把它作为该 provider 所有模型的默认窗口。
2. CC Switch 模型表中的 `contextWindow` 是否写错（它优先于 TOML）。
3. 中转站 `/models` 返回的上下文字段是否明显偏小（接口的值优先于以上两者）。

如果市场提示 `@google/genai` 或 `protobufjs` 的构建脚本被 pnpm 拦截，请更新到 `dsh-ccswitch` `0.1.1` 或更高版本后重新安装。新版会使用 DSH 已提供的运行时依赖，不需要为这两个包单独放行构建脚本。
