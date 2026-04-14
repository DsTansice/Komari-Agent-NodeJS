# Komari-Agent-NodeJS
Komari-Agent-NodeJS is a Komari monitoring agent written in Node.js. It is suitable for any environment where the execution of binary probes is restricted, yet Node.js can be run.

Komari-Agent-NodeJS 是一个使用 NodeJS 语言编写的 komari 监控 Agent，适用于限制执行二进制探针但是能跑NodeJS的任何环境！



## 使用说明
## 最简单使用方法
使用请修改71行主控网址及72行Token参数，当然也可以环境变量里设置

KOMARI_HTTP_SERVER || '改成你的主控端网站'

KOMARI_TOKEN || '改成你的Token'

## 命令行选项

| 参数 | 描述 |
|------|------|
| `--http-server <url>` | **服务器地址**（必须）。也可通过环境变量 `KOMARI_HTTP_SERVER` 设置 |
| `--token <token>` | **认证令牌**（必须）。也可通过环境变量 `KOMARI_TOKEN` 设置 |
| `--interval <sec>` | 实时数据上报间隔，单位为秒（默认：`1.0`）。可通过 `KOMARI_INTERVAL` 设置 |
| `--log-level <level>` | 日志级别：<br>0 = 关闭 Debug 日志<br>1 = 基本信息<br>2 = WebSocket 传输<br>3 = 终端日志<br>4 = 网络统计日志<br>5 = 磁盘统计日志 |
| `--disable-web-ssh` | 禁用远程控制功能（远程执行和终端） |
| `--help` | 显示帮助信息 |

## 环境变量配置

| 环境变量 | 说明 | 默认值 |
|----------|------|--------|
| `KOMARI_HTTP_SERVER` | 服务器地址（与 `--http-server` 参数对应） | 空字符串 |
| `KOMARI_TOKEN` | 认证令牌（与 `--token` 参数对应） | 空字符串 |
| `KOMARI_INTERVAL` | 实时数据上报间隔（秒）（与 `--interval` 参数对应） | `1.0` |
| `KOMARI_RECONNECT_INTERVAL` | WebSocket 重连间隔（秒） | `5` |
| `KOMARI_LOG_LEVEL` | 日志级别（与 `--log-level` 参数对应） | `0` |
| `KOMARI_DISABLE_REMOTE_CONTROL` | 是否禁用远程控制功能（`true` 表示禁用） | `false` |


# 关于作者 About
作者博客：https://blog.qfff.de

<div style="display: inline-block; text-align: center; padding: 16px; border: 1px solid #e0e0e0; border-radius: 8px; background: #fafafa;">
  <img src="https://www.010085.xyz/pic/wechat.jpg" width="180" style="display: block; border-radius: 4px;" alt="赞助项目发展">
  <p style="margin: 12px 0 0 0; color: #333; font-size: 14px; font-weight: 500;">微信扫码赞赏</p>
  <p style="margin: 4px 0 0 0; color: #999; font-size: 12px;">感谢您的支持 ❤️</p>
</div>

# TG频道和群主 CHANNEL
玖玖の日常频道：https://t.me/jiujiuLife

玖玖の小窝群组：https://t.me/jiujiuHome
