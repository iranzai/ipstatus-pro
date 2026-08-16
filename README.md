# ipstatuspro

ipstatuspro 是 ipstatus 的 Chrome Manifest V3 扩展。点击扩展图标时，它会沿用 Chrome 当前代理路径读取出口 IP，并调用 ipstatus API 显示 ASN、组织、国家、城市、经纬度与时区。弹窗可直接进入流媒体检测页。

扩展同时作为流媒体检测页的受限网络桥。平台清单、检测规则和结果判定均由网站维护，更新检测规则不需要重新安装扩展。

## 安装方式

### Chrome 扩展（开发者模式）

从项目仓库下载文件包：

https://github.com/iranzai/ipstatus-pro

下载 ZIP 后解压，再按以下步骤加载：

1. 打开 `chrome://extensions/`。
2. 开启右上角“开发者模式”。
3. 点击“加载已解压的扩展程序”。
4. 选择解压目录中的 `chrome-extension` 文件夹。
5. 打开 `https://ipstatus.net/streaming.html`，或本地开发地址 `http://127.0.0.1:8081/streaming.html`。
6. 页面提示未连接时，点击“重新连接”；扩展代码更新后，在扩展卡片上点击“重新加载”，再刷新检测页。

### Tampermonkey 用户脚本

如果只需要流媒体检测接口，可以从 [Greasy Fork](https://greasyfork.org/zh-CN) 安装油猴脚本。安装后刷新 `streaming.html` 即可；脚本在页面开始加载时建立通信桥，避免错过检测页的首次连接握手。用户脚本不会读取或修改 Chrome 代理设置，只为检测页提供跨平台请求桥；需要完整的出口 IP、代理状态和扩展弹窗功能时，请使用 Chrome 扩展版本。

扩展申请 `proxy` 权限只为读取当前 Chrome 代理状态；它不会调用 `chrome.proxy.settings.set` 修改配置。`https://*/*` 权限用于出口探测、IP API 与流媒体平台请求，后台请求会沿用 Chrome 当前代理路径。本地开发地址权限仅用于访问 `127.0.0.1:8081` 或 `localhost:8081` 的 ipstatus API。

## 通信边界

- 内容脚本只允许注入 ipstatus 正式域名和本地开发页面。
- 页面只能调用 `PING`、`GET_PROXY_STATE`、`PROXY_FETCH` 三个固定命令。
- 网络桥仅允许公开 HTTPS 域名，拒绝本机、私网 IP、URL 凭据和非 GET/POST/HEAD 方法。
- 请求不会携带浏览器 Cookie，只允许少量安全请求头；请求体不超过 32 KiB，响应文本最多返回 384 KiB。
- 检测结果不写入扩展存储。

浏览器扩展无法完全复刻 Bash 脚本的 `curl -4/-6`、自定义 TLS、DNS 覆盖与本地 Cookie 模板。网站会明确区分“可用”“受限”“出口信息”“有限判断”和“无法判定”，避免把主页可访问误报为播放解锁。
