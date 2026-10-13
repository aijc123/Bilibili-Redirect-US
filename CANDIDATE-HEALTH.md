# 候选更新与 GitHub Actions

aijc123 的候选清单保存在 [data/cdn-candidates.json](data/cdn-candidates.json)，自动版、独立对照工具与定期探测读取同一清单。目前有15个候选：hwo1、08c、hw、ali、08h、bos、alib、cos、bd、14b、estgoss、cosov、aliov、香港01-01和01-03。0.1.14自动版使用全部候选，无需选择地区，初始08c、优先复用成功节点，再失败回退；仅对照工具保留地区与手动首选参数。不在初次播放逐个测速，也不因云端DNS/TLS排名改变手机选择。详见[自动策略](LAB-EXPERIMENT.md)。

[CDN candidate health](https://github.com/aijc123/Bilibili-Redirect-US/actions/workflows/cdn-health.yml) 每天09:17 UTC定期运行，也可手动运行。它对公开主机做DNS查询与严格证书验证的HTTPS HEAD，最多两个主机并行，自动更新 [最新快照](https://raw.githubusercontent.com/aijc123/Bilibili-Redirect-US/main/data/cdn-health.json)。不需要B站登录，不下载视频，不上传Cookie、签名播放地址、DNS返回IP或原始错误文本，不改变播放默认节点。

这里的DNS耗时是Runner自身的查询；TLS耗时包括它的解析、连接、握手和等待HEAD响应。即便HEAD返回403或其他拒绝状态，也只证明该探测收到了响应，媒体是否可用仍为unknown。不能把这些毫秒当成下载Mbps，或推断宾州iPhone使用同一CDN会更快。

本次尝试从桌面公共B站接口获取公开示例视频信息时，接口返回HTTP412，未获取到可用的全新媒体样本。本项目没有绕过它，也没有把用户手机的签名视频地址上传给GitHub。**此工作流目前做的是候选DNS/TLS健康探测，尚未实现定期媒体吞吐测速。** 快照明确包含 `mediaBenchmarkAvailable=false`、`mediaMbps=null`、`changesPlaybackDefault=false`。

手机会继续依据实际接管结果选择CDN。若未来加入Runner媒体测速，必须使用获准的公开样本、明确标注线路和方法，验证206/Range/长度与有界下载，再决定如何给初始候选排序。手机已有的成功记录应优先于云端线路排名；GitHub排名不能替代本机证据。

候选参考 [chrisliu298 的历史测速](https://github.com/chrisliu298/bilibili-cdn-fix/blob/main/benchmarks.md)、[CDN主机参考](https://github.com/chrisliu298/bilibili-cdn-fix/blob/main/cdn-reference.md) 与 [BTR](https://github.com/MrTangLuyao/Bilibili-thread-ripper)。前者未附代码许可，本项目只参考方法与公开主机事实，没有复制其probe.js。健康探测与Loon适配由aijc123实现；BTR的范围/SIDX核心仍按固定MIT版本直接复用。
