# Loon 并发 Range 实验版

目标是在 **iPhone + Bilibili 官方 App + 现有 Loon** 中，针对单连接下载瓶颈增加并发下载，无需安装新 App。此版本已完成协议测试和本地限速 HTTP 实验，**真实 iPhone 的可用性和提速幅度仍待验证**。

## 安装与对照测试

实验订阅：

```text
https://raw.githubusercontent.com/aijc123/Bilibili-Redirect-US/main/dist/BiliBili.Range.Experimental.plugin
```

1. 保留原订阅以便回退，但**停用现有 Redirect 和其他 B 站 CDN 复写插件**，避免先改写地址或抢占脚本。
2. 添加实验订阅，保持 Loon 3.5.1+、脚本与复写启用、MITM 证书已信任。
3. 首先选 `AutoCDN=false`、同一个 `PreferredCDN`，分别设置 `Connections=1`、`2`、`4`。1 是相同传输引擎的单路对照，不是原始 App 直连。
4. 使用同一 Wi-Fi、同一视频、同一清晰度和编码；最好准备 3 个冷门视频，每种设置播放 1～2 分钟。每轮重开播放或跳到未缓存位置，交替测试顺序，避免缓存影响。
5. 记录起播等待、卡顿次数、拖动后恢复时间，以及脚本列表中 **Bili Range 诊断** 的摘要。也可临时开启 Debug 查看每次接管的耗时。
6. 完成并发对照后，再启用 `AutoCDN` 测试本机候选选择。异常时停用实验插件，恢复原 Redirect。

诊断仅在本机保存汇总：接管/放行次数、原因、目标主机、字节量、传输耗时与并发数。不保存或上传 Cookie、视频标识、完整下载 URL 或签名。请只分享摘要，不要公开抓包里的完整媒体地址。

## 第一性原理与手机约束

如果单条下载连接吞吐量为 r，而总线路容量 B 高于 r，n 条并行连接有机会接近 min(B,n×r)。如果所有连接都共享同一个带宽瓶颈，并发不会创造带宽，还可能增加开销。

BTR 和原生播放器加速分支能够将分块数据持续送入播放器，同时控制预取、取消和缓冲。Loon 的公开脚本 API 提供二进制 HTTP 请求与直接返回响应，但没有公开的持续流式响应接口，也没有此处所需的可靠请求取消接口。因此本实现只接管 **256 KiB 至默认 4 MiB 的明确单一 Range**，等各块完成后拼接返回。它不能冒充一个完整 BTR 播放器内核。

每个请求默认 2 路、可选 4 路。硬性范围上限 8 MiB；原始子块和拼接数据都会占内存，真实峰值还包含 Loon 的缓冲与复制。通过短期本地租约尽量限制同时接管的请求数为 2；存储没有原子锁，因此这是尽力限制，不是严格全局并发保证。服务器若忽略 Range 返回完整文件，HTTP 客户端可能在校验前接收超出预期的数据；无法把范围上限解释为绝对内存上限。

## 实际接管流程

1. 检查 GET、许可的 Bilibili 媒体主机、有限单一 Range、签名剩余时间。
2. 从 hwo1、08c、hw、ali 四个候选中选择一个主机，保留原路径和完整签名查询。
3. **同一请求的所有子块使用同一主机**，并发获取不同字节范围，不同时重复下载同一段。
4. 检查 HTTP 206、Content-Range、实际长度、总长度、编码及响应类型；存在 ETag/Last-Modified 时要求一致。
5. 按原位置重组二进制，返回正确的 206、Content-Range、Content-Length。
6. 根据真实传输吞吐量在本机记录候选表现；首次探索未测节点，之后使用较优候选，10 分钟后重新探索，网络变化时清除评分。它是被动传输学习，不是每次播放前额外下载所有节点测速。

HTTP 客户端显式请求 h1、二进制响应、identity 编码，不跟随重定向、不接受无效 TLS 证书。h1 与异步请求并不保证 Loon 真机一定分配独立 TCP 连接，须实测确认。

任意子块失败时，等待其余回调后丢弃整批，让 App 的原始请求继续。失败候选暂时冷却 60 秒，不混合不同主机的失败重试字节。回退会产生额外等待和流量，必须纳入实际体验评价。默认子请求超时 2.5 秒，脚本配置超时 8 秒；Loon 极端情况下如何处理运行时整体超时仍需真机确认。

以下请求直接放行：无 Range、开放范围（如 `bytes=0-`）、后缀/多段 Range、过大/过小范围、非 GET、携带 Cookie/Authorization/条件请求头、签名即将过期、非支持主机。特殊 MCDN/PCDN 代理未在首版接管。诊断的放行原因将决定下一步扩展，不能因为源码存在并发功能就宣称 App 已加速。

## 已验证与尚未验证

协议检查覆盖准确字节拼接、签名保留、真实并发发起、各种错误/实体不一致拒绝、回退等待、候选评分、Loon 对象参数、二进制响应、网络变化重置和本地存储隐私。

[本地 HTTP 实验结果](benchmarks/range-fixture.json)：真实 HTTP 连接到回环测试服务器，服务器按每连接 16 KiB/16 ms 节流，下载固定 2 MiB 数据，每种并发 3 轮。该模型刻意模拟单连接瓶颈，**不是 Bilibili CDN、iPhone 或用户宽带测速**。

首轮测量中位耗时：单路 3298 ms，2 路 1720 ms，4 路 943 ms，对应约 1.92× 和 3.50×。所有输出均与原始字节严格相等。主机运行计时器有调度误差，因此名义节流值不是实测速率。

真实媒体 API 在当前测试环境返回 HTTP 412，未获得可用媒体地址，未把合成实验包装成真实 CDN 结果。尚待用户真机确认：脚本是否命中、范围分布、二进制直返兼容、真实并发、内存、拖动与后台行为、视频/音频连续播放表现及相对 CDN 重定向的净收益。

## 构建

```sh
node scripts/build-range.mjs
node --test tests/range.test.mjs tests/us-bundle.test.mjs
node scripts/benchmark-range.mjs
```

源代码是独立的 Apache-2.0 实现，不复制参考项目播放器或下载器源码。

## 参考与致谢

- [Bilibili-thread-ripper](https://github.com/MrTangLuyao/Bilibili-thread-ripper)，参考提交 `0302b345cdfe367ac599b52dc6874e3f7967e220`：分块、校验、下载调度思想。感谢 MrTangLuyao 与贡献者。
- [PiliPlus 加速分支](https://github.com/nishuodedui1145-del/PiliPlus)，参考提交 `3988e6d081a26120ca79f1e654fe1a3422b7282f`：本地代理、范围处理与原生播放器约束。
- [MyTVB-Speed-Boost](https://github.com/nitansde/MyTVB-Speed-Boost) 及 [MyTVB](https://github.com/qianxuntudou-ops/MyTVB)：原生客户端加速与设置设计参考。
- [Biliverse/Redirect](https://github.com/Biliverse/Redirect)：现有重定向版本的基础项目。
- [Loon Script API](https://nsloon.app/docs/Script/script_api/) 与 [脚本配置](https://nsloon.app/docs/Script/script_v2/)：运行接口与参数语法。
- [公开美国 CDN 基准](https://github.com/chrisliu298/bilibili-cdn-fix/blob/main/benchmarks.md)：候选来源，历史数据不等于手机实时排名。
