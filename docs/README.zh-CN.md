[English](../README.md) · **简体中文**

# pi-session-title

两条实时底栏状态：这个会话是干嘛的、现在正在干嘛。

```
◆ 重构登录模块 · Last 3: switch to docker compose deploy
```

- **`◆ 主题`** —— 从第一条用户消息提炼；`/topic <名称>` 改名，`/topic clear`
  清除；resume 时自动恢复
- **`Last 3:`** —— 每轮结束后用便宜模型把最近几轮问答总结成一个主题短语，
  随话题漂移更新

走 `ctx.ui.setStatus()`，与任何自定义底栏共存。pi-cc-extensions 可独占一行：

```jsonc
{ "footerLine3Keys": ["session-topic", "recent-topic"] }
```

## 总结模型 —— 显式指定，零意外花费

选择顺序：

1. `PI_TOPIC_SUMMARY_MODELS="provider/id,provider/id"` —— 显式候选，首个已配置者生效
2. 兜底：当前会话模型（本来就在用，零额外成本）

扩展绝不从模型注册表里自动挑选——启发式可能悄悄选中你从未打算付费调用的模型。

网络失败退化为启发式（最后一条用户消息），状态条永不中断。

## 配置

| 环境变量 | 默认值 | 说明 |
|---|---|---|
| `PI_TOPIC_SUMMARY_MODELS` | — | 逗号分隔 `provider/id` 候选 |
| `PI_TOPIC_ROUNDS` | `3` | 参与总结的问答轮数（1–10） |

## 说明

- 主题**绝不持久化为会话名** —— pi 会把会话名写进终端标签页标题，本扩展
  不污染标签页
- 总结调用禁用 prompt 缓存并使用全新 session id
- 会话替换安全（`/new`、`/fork`、`/switch`、reload）：进行中的摘要在
  `session_shutdown` 时作废

## 安装

```bash
pi install npm:pi-session-topics
```

## 许可证

0BSD — 随便用，不用署名。
