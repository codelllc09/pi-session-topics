[English](./README.md) · **简体中文**

# pi-session-title

两个实时底栏芯片，回答「这个会话是干嘛的」和「现在正在干嘛」：

```
◆ 重构登录模块 · Last 3: switch to docker compose deploy
```

- **`◆ 会话主题`** —— 从第一条用户消息提炼；`/topic <名称>` 手动改；
  resume 旧会话时从历史自动恢复
- **`Last 3: 滚动总结`** —— 每轮结束后用便宜模型把最近 3 轮问答总结成一个
  主题短语，随话题漂移更新；模型不可用时退化为启发式（最后一条用户消息）

两个芯片都走 `ctx.ui.setStatus()`，与**任何**自定义底栏共存
（pi-cc-extensions、内置底栏……）。配 pi-cc-extensions 时可独占一行：

```jsonc
// ~/.pi/agent/pi-cc-extensions.json
{ "footerLine3Keys": ["session-topic", "recent-topic"] }
```

## 设计铁律：绝不碰会话名

pi 会在启动/reload/切会话时把会话名写进终端 tab 标题。因此本扩展的主题
只存内存、绝不持久化为会话名——tab 标题保持 pi 默认短标题。（仅清除极老
版本自己写入过的残留会话名。）

## 配置

| 环境变量 | 默认值 | 说明 |
|---|---|---|
| `PI_TOPIC_SUMMARY_MODELS` | `zai-coding-cn/glm-5.3-flash,zai-coding-cn/glm-5.3-highspeed` | 总结模型候选，逗号分隔 `provider/id`，从便宜到贵；都没配置时退回当前会话模型 |

总结调用禁用 prompt 缓存并使用全新 session id，不会污染会话缓存。

## 命令

```
/topic          查看当前主题
/topic <名称>   手动设置主题
```

## 安装

```bash
pi install git:github.com/codelllc09/pi-session-title
```

## 许可证

0BSD — 随便用，不用署名。
