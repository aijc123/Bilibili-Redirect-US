# Bili Range · iPhone 官方 App 自动加速

**aijc123 为海外 iPhone 用户开发的 Loon 适配：不用换 B 站 App，不用逐个调 CDN 和线程，打开一个开关即可使用。**

[导入自动版](https://raw.githubusercontent.com/aijc123/Bilibili-Redirect-US/main/dist/lab/BiliBili.Range.Lab.plugin) · [使用与反馈](docs/USAGE.md) · [发布记录](https://github.com/aijc123/Bilibili-Redirect-US/releases) · [反馈问题](https://github.com/aijc123/Bilibili-Redirect-US/issues)

## 直接使用

1. 把上方 `.plugin` 地址导入 Loon，完成 Loon 要求的 MitM 证书设置。
2. 只启用这一份 B 站 CDN/Range 插件，保持“启用加速”打开。
3. 回到 Bilibili 官方 App 正常看视频。更新继续使用同一个订阅地址。

当前 **0.1.14-experimental** 只有一个设置开关。以前保存的32路、试验模式、节点组等参数不会继续控制自动版。无需再填写节点、并发、DNS或倍速。插件需要 Loon 3.5.1；DNS功能需要Build 988+。

## aijc123 做了什么

- **完整适配官方 App 的请求路径**：把合格的有界 Range 请求拆开并发、校验后拼回，路径和签名查询保持原样；失败时交还原请求。
- **本机选节点**：15个候选包含 BTR 的大陆/海外清单，08c作为初始候选，优先复用近期成功节点，再失败回退。没有把GitHub机房排名当成你手机的最快节点。
- **自动控制开销**：常规上限8个HTTP任务，按大小缩减分片；在途负载较高或近期同节点网络错误达到门槛时收缩至4。共享任务与缓冲预算，避免一个小请求占满32任务。小于256 KiB的请求直接放行。
- **容易反馈的诊断**：日常摘要说明实际处理脚本的版本、近期事件、成功/失败、样本是否过期。完整分布与DNS细节单独查看。
- **可维护的长期订阅**：所有插件和脚本托管在你的仓库，运行脚本固定到版本标签；源码、构建、验证与许可可追溯。

这些是 Loon 适配、调度和体验上的贡献。范围/SIDX基础模块直接复用原作者代码，避免重新实现已有工具。

## 效果与限制

已有真实 iPhone 成功接管记录，用户在同视频、同清晰度、同Wi-Fi对比中反馈更流畅、加载更快；没有量化因果倍数。近期观察更支持8路/128 KiB，而不是盲目增加到32。**0.1.14的自动收缩和新版体验仍需要真机反馈，不能保证4K/1.5倍速无卡顿。**

Loon需要等整个Range完成才能返回，不能完全复现电脑BTR的流式交付、播放器缓冲控制和取消竞速。8个HTTP任务也不等于8条已确认TCP连接。诊断不含直接放行的流量，无法读取官方App实际清晰度、倍速、缓冲或卡顿次数。[自动策略与验证范围](LAB-EXPERIMENT.md)

出现问题时，播放30–60秒后立即运行 **Bili Range 诊断**，复制摘要，并说明清晰度、倍速和实际卡顿表现。不要仅用累计接管次数判断效果；小请求放行是正常行为。[完整反馈方法](docs/USAGE.md)

## 来源与 credit

感谢 **VirgilClyne / Biliverse/Redirect** 提供开源项目基础，感谢 **MrTangLuyao / Bilibili-thread-ripper** 提供MIT范围/SIDX核心及节点和调度思路。aijc123负责Loon运行适配、预算、自动策略、诊断、中文文档与独立发布。

候选来源之一为[chrisliu298 的 benchmarks.md](https://github.com/chrisliu298/bilibili-cdn-fix/blob/main/benchmarks.md)：**2026-06-11美国单线路历史数据**，当时hwo1/08c排名较高；不能保证当前宾州、其他线路或签名媒体同样可用。本项目引用主机和数据来源，没有复制其无代码许可的测速实现。[BTR项目](https://github.com/MrTangLuyao/Bilibili-thread-ripper)也明确建议依据实际播放效果调整。

原项目沿用Apache-2.0；BTR固定文件保留MIT许可，见[LICENSE](LICENSE)、[NOTICE](NOTICE)、[BTR许可](vendor/btr-0302b345/LICENSE)。[上游增加节点Issue #12](https://github.com/Biliverse/Redirect/issues/12)已提交，尚不代表上游采纳。这是aijc123独立维护的非官方版本。

## 仓库与维护

[代码结构与构建](docs/ARCHITECTURE.md) · [候选健康探测](CANDIDATE-HEALTH.md) · [版本与其他路线](docs/VERSIONS.md)

使用Node.js 24，无需安装npm依赖或GitHub Packages凭据：

```sh
node scripts/check-range.mjs
```

当前167项检查覆盖自动策略、真实业务参数、字节一致性、失败回退、预算、诊断隐私和旧对照工具，并含17项可选电脑中转检查。合成检查不是手机播放性能证据。CI额外检查构建产物可复现；上游依赖私有包的整套测试不宣称已通过。

觉得它方便的话，欢迎Star或分享订阅；带有真实清晰度、线路和播放现象的反馈更能帮助改进。
