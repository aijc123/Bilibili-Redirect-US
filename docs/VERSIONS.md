# 版本与其他路线

日常使用自动版；其他入口用于回退或开发，不需要同时安装。

| 入口 | 状态与用途 |
| --- | --- |
| [保留自动版](https://raw.githubusercontent.com/aijc123/Bilibili-Redirect-US/main/dist/lab/BiliBili.Range.Lab.plugin) | 0.1.14回退基线；旧长期地址与产物保留，不含原地址优先修正 |
| [自动调优候选](ADAPTIVE.md) | 独立0.1.19；原地址优先、同媒体失败记忆及真实媒体测速，日常一个开关，连续播放效果待验证 |
| [固定0.1.13](https://raw.githubusercontent.com/aijc123/Bilibili-Redirect-US/range-v0.1.13-experimental/dist/lab/BiliBili.Range.Lab.plugin) | 保留旧参数与行为，可用于回退 |
| [研发对照工具](https://raw.githubusercontent.com/aijc123/Bilibili-Redirect-US/main/dist/lab/BiliBili.Range.Advanced.plugin) | 同版本单独入口，保留高级参数；只供受控对照，与自动版不同时启用 |
| [0.1.3实验版](https://raw.githubusercontent.com/aijc123/Bilibili-Redirect-US/main/dist/BiliBili.Range.Experimental.plugin) | 已有同条件真机提速反馈；固定旧文件，[原说明](legacy/RANGE-0.1.3.md) |
| [0.1.4候选版](legacy/RANGE-0.1.4.md) | 独立旧候选，文件保留 |
| [原CDN Redirect](legacy/CDN-CUSTOMIZATION.md) | 固定上游v0.2.24运行逻辑，仅扩展hwo1/08c参数；不做Range并发 |
| [可选电脑中转](GATEWAY.md) | 另一条原型路线，需要电脑在线，默认关闭，实际iPhone效果未知 |

所有已发布标签保留。旧诊断累计数据可能继续保存在手机；不能把跨版本累计记录算成提速倍数。[0.1.13详细研发历史](history/LAB-0.1.13.md)与[原CDN首页](history/README-CDN-0.1.13.md)保留来源和过程。
