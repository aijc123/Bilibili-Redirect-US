# 按IP测速：先验证运行能力

目前手机媒体工具测过的是“当前路由到各CDN的同一段媒体”，还没有按Cloudflare/Google分别返回的IP下载。这里保留一个新的、**未完成真机验证**的方向，不接入日常加速。

## 已核对的公开接口

- [Loon HTTP API](https://nsloon.app/docs/Script/script_api/)可指定DIRECT、节点或策略，但没有公开的单请求连接IP覆盖字段。
- [Host Map](https://nsloon.app/docs/DNS/hostmap/)能改变域名解析；它是配置，不是某次请求的独立覆盖，缓存和现有连接也会影响对照。
- [节点server-dns](https://nsloon.app/docs/Node/)只解析代理节点自身的服务器域名，不等于普通视频域名的DNS覆盖。
- 同一官方节点文档还链接到[Custom JavaScript会话示例](https://github.com/Loon0x00/LoonExampleConfig/blob/master/Script/http.js)，其中公开`tunnelDidConnected`和`$tunnel.established`等会话API。可以研究“连接固定IP的透明TCP节点，内部仍由HTTPS客户端对原域名握手”，避免把媒体URL改成IP或关闭证书验证。

最后一项只是依据公开API提出的可行性推断：HTTP客户端是否接受完整临时节点描述、连接是否确实绑定指定IP、内层TLS与原域名是否按预期运行，都需要设备验证。没有把推断写成已经可用的能力。

## 独立能力探针

[pinned-capability.js](../src/research/pinned-capability.js)只查询和下载公开网页，不读取本地媒体样本、账号、Cookie、配置或当前策略，不保存IP，不修改全局DNS。它先读www.example.com的一个公开A记录，再进行：

1. DIRECT公开网页基线。
2. 固定IP Custom节点的相同正文对照，保留`insecure:false`。
3. 不可达文档IP的失败对照；若仍成功，不能认定node参数被执行，立即报告未证明。
4. 错误主机名证书的失败对照；若成功，同样不能通过。

新的[direct-session.js](../src/research/direct-session.js)由aijc123按公开API独立实现，没有复制官方HTTP代理的握手实现；它只接受这两个公开HTTPS控制主机，拒绝视频主机和外层TLS，不发CONNECT头，不记录session。它不作为视频传输器发布。

检查只能给“控件未通过/能力线索通过”，不是抓包证明；成功对照也可能受远端共享CDN、路由及缓存影响，不能直接推广到B站。自动检查使用模拟回调确认不会把忽略node或错误证书成功当成通过，**不证明iPhone已支持这些API组合**。

该探针没有加入日常插件或增加手机菜单，暂不要求用户安装。后续具备真实设备入口时再单独运行；如果设备确实支持，再复用现有媒体采样与逐字节验证，设计同字节、同域名SNI、同协议、按DNS返回IP固定连接的对照。失败或不支持时仍报告未知，不借用桌面结果充当手机吞吐。
