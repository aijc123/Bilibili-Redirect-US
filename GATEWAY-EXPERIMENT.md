# Bili 电脑中转原型 · aijc123

**可选研发路线，需要电脑在线。手机仍使用 Bilibili 官方 App 和 Loon，手机无需安装新 App。** 原型已完成本机 HTTP 集成验证，尚未在真实 iPhone 上验证安装、协议兼容性和播放提速；不能承诺解决 4K / 1.5 倍速卡顿。独立发布，不替换已有手机 Range 插件。

## 为什么值得试

手机插件通过 Loon `$httpClient` 回调拿到完整分片，再拼接整个 Range，最快的分片必须等待最慢的分片才能交给播放器。公开 API 未提供流式回调或中止子请求的方法。32 个 HTTP 任务也不等于 32 条物理 TCP 连接。

本路线把下载放到同 Wi-Fi 的电脑：持久 HTTP Agent 复用连接，按顺序边下载边转发，具备取消、背压和进程内并发预算。Loon 只修改请求目标，不在脚本中接收整个媒体块。其潜在价值是**提前交付有效前缀、复用连接、及时取消拖动进度条后的旧请求**；仍受海外出口、CDN、电脑到手机 Wi-Fi 和官方 App 行为约束。

原始 Range 从首字节起按序转发，后续片必须通过实体与区间校验。后续片实体不一致时会中断当前响应，绝不把错误片拼进去；已经交付的前缀不能撤回。首片未交付任何字节时，可换候选或回到原始服务器。

## 获取与运行

电脑安装 Node.js 24，获取本仓库；不需要 npm 依赖或 GitHub Packages 账户。先查看代码和文档，服务默认只监听电脑本机：

```sh
node gateway/server.mjs
```

要供同 Wi-Fi 的手机访问，手动运行：

```sh
node gateway/server.mjs --listen-lan
```

服务端端口默认 9190，上游任务总预算默认 16。可通过 `BILI_GATEWAY_PORT`、`BILI_GATEWAY_THREADS` 环境变量调整；任务预算仅接受 4 / 8 / 16 / 32。`gateway/.runtime/session.json` 保存自动生成的私钥，该目录已被 Git 忽略。启动日志不会打印私钥或视频链接。用编辑器打开文件，复制 `token` 到手机插件。

这是**私有可信局域网 HTTP 中转**：电脑会临时收到原始签名视频地址，局域网传输未加密。私钥仅用于鉴权，不能替代 TLS。勿转发路由器端口、公开部署、把私钥或带有私钥的 Loon 配置上传 GitHub。Windows 如要求防火墙放行，只允许自己使用的专用网络；这里不自动修改防火墙或设置开机自启。

插件长期地址：

```text
https://raw.githubusercontent.com/aijc123/Bilibili-Redirect-US/main/dist/gateway/BiliBili.Range.Gateway.plugin
```

1. 手机和电脑连接同一 Wi-Fi，确认电脑服务已启动。
2. 在 Loon 中添加上述插件，停用其他 B 站 Redirect / Range 插件，开启复写、脚本并信任 MITM 证书。
3. 填写电脑内网地址，例如 `http://192.168.0.50:9190`，以及本地生成的私钥。仅接受 10/8、172.16/12、192.168/16 范围的 IPv4 地址和明确端口。
4. 开启「启用电脑中转」。默认每请求 8 路、最小片 128 KiB；服务总预算为 16。要试 1 MiB 的 32 片，需要最小片改为 32 KiB，电脑任务总预算也设为 32。
5. 播放后在 Loon 插件的脚本中手动运行「Bili 电脑中转诊断」。摘要只输出计数、公开 CDN 名、首次写出和总耗时，不包含私钥、原始视频地址或电脑 IP。

插件先做鉴权健康检查，成功结果最多缓存 5 秒；没有配置、检查失败或服务繁忙时放行原始请求。**改写后连接失败不会由请求脚本再次自动恢复**，可能由播放器重试；若出现新问题，先关闭此插件。退出服务用 Ctrl+C；不要同时启用手机 Range 和电脑中转。

## 当前能力与边界

- 有限单 Range，1 字节至 8 MiB；支持已知 UPOS、香港和 Akamai `/upgcxcode/` 请求。带 Cookie、Authorization、条件 Header 或不支持的路径均不转发；没有额外视频权限。
- 默认候选 `08c / hwo1 / hw / ali`。复用 BTR 的候选与失败分类，基于电脑实际请求交付更新分数，少量已有媒体请求探索候选，不额外下载测速媒体。每个 Range 只用一个节点，避免混合实体。
- 每请求最多 32 个 HTTP 任务，单进程最多 4 个前台 Range，声明范围总量不超过 8 MiB。预算对电脑进程有效；不是对播放器缓存的控制。
- 可信重定向最多两次，完整保留已校验路径和查询签名，禁止外域、降级、非许可端口与路径包装变化。上游 HTTPS 使用证书校验。
- 持久 HTTP/1 连接；系统 DNS 查询缓存 60 秒，失败时失效。没有更快 IP 的实测排名，也没有修改手机全局 DNS。
- 统计仅反映电脑上游和服务写出。首次写出不是 CDN 真实 TTFB，不能说明手机已收到或播放器没有卡顿。
- 获取公开测速文档不会获得你的线路；GitHub Runner 的 DNS/TLS 快照不能取代宾州家中测速。

## 验证与维护

```sh
node scripts/build-gateway.mjs
node --test tests/gateway.test.mjs tests/gateway-loon.test.mjs
```

本机验证覆盖字节校验和、首字节提前交付、真实 HTTP socket 复用、上游并发预算、可信重定向、实体冲突停止、首字节前故障切换、超时取消与排队清理，以及 Loon 模拟参数和私钥隔离。媒体使用生成的本机数据，**不是 Bilibili 实测速率，也不是手机运行结果**。CI 重新构建与执行相同检查。

订阅文件随 main 更新，脚本指向固定 `gateway-v0.1.0-experimental` 标签；服务端应使用同一版本。若升级协议，先整体验证再更新订阅及服务器。

## 来源与贡献

原项目 [Biliverse/Redirect](https://github.com/Biliverse/Redirect) 由 VirgilClyne 等贡献者提供重定向基础。[Bilibili-thread-ripper](https://github.com/MrTangLuyao/Bilibili-thread-ripper) 提供已验证的 Range、CDN 解析及取消感知 Semaphore：这里固定其 `0302b345cdfe367ac599b52dc6874e3f7967e220` 版本，保留未修改源文件、哈希与 MIT 许可；Semaphore 仅加载已审阅部分，不伪造浏览器播放器缓冲数据。

**aijc123 的新增工作**是私有电脑流式传输、Loon 改写适配、取消与预算、实体安全、鉴权、隔离诊断、测试和独立订阅发布；不是简单重贴上游脚本。

候选节点参考 [chrisliu298 的测速文档](https://github.com/chrisliu298/bilibili-cdn-fix/blob/main/benchmarks.md)，2026-06-11 的美国单线路数据只作候选依据，不保证当前线路排名；未复制其未标明许可的实现代码。整个 fork 保留 Apache-2.0，BTR 文件单独遵守 MIT，详见 NOTICE 与 vendor 许可。
