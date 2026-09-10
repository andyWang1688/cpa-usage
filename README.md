# CPA Usage

A local-first **CLIProxyAPI usage dashboard** with real shadcn/ui components, a stacked Token trend, and command-line lifecycle management.

**状态：v0.1.0 / macOS 与 Linux。MIT 开源。** 无需 Docker、Node.js 或数据库服务，客户端仅需 Python 3.10+、curl 与系统自带的 ps/tail。

## 安装

```sh
curl -fsSL https://raw.githubusercontent.com/andyWang1688/cpa-usage/main/install.sh | sh
```

安装脚本从 GitHub Release 下载预构建包、验证 SHA-256、创建 Python 虚拟环境，默认命令位于 `~/.local/bin/cpa-usage`。如果这个目录不在 PATH，请先将它加入 PATH，或使用命令的绝对路径。

```sh
cpa-usage configure  # 交互输入 CPA 地址、management key 和页面端口
cpa-usage start      # 后台启动，默认 http://127.0.0.1:8899
cpa-usage status
cpa-usage logs
cpa-usage restart
cpa-usage stop
cpa-usage version
cpa-usage update    # 下载最新版本，校验后切换；原先运行则自动重启
cpa-usage update v0.1.0  # 指定版本（已经安装过的版本不会覆盖）
```

`start` 为当前用户启动后台服务，不修改系统服务或开机启动配置；电脑重启后需再次运行。Python 3.10+ 找不到时可指定 `PYTHON=/absolute/path/to/python3`。自定义安装位置使用 `CPA_USAGE_HOME` 和 `CPA_USAGE_BIN`；自定义 BIN 更新时需设置同一变量。

## 界面

- shadcn/ui Card、Calendar、Popover、Tabs、Table、Select、Dialog、Tooltip 等官方组件源码，浅色/深色主题。
- 今天、近 7/30 天与自定义日期范围；模型筛选同时作用于 KPI、趋势和明细。
- 缓存输入 / 净输入 / 输出堆叠趋势，小时 / 天 / 月粒度。
- 模型、匿名 Key、请求三个视角；搜索、排序与分页。
- 全部请求参与成功率统计，包括零 Token 失败；输入含缓存，输出含推理，不重复相加。
- 错误、空数据和采集异常明确显示，不把空白或旧数据当实时成功。
- 不预置价格，不把未知模型的用量伪装成实际账单。

## 数据与安全

默认目录 `~/.local/share/cpa-usage`：

```text
config.env          # CPA 连接配置，权限 0600
usage.sqlite        # 历史用量，更新不覆盖
service.log         # 后台日志
venv/               # 无第三方 Python 依赖的隔离运行时
releases/0.1.0/     # 不可变版本目录
current -> releases/0.1.0
```

仅监听 `127.0.0.1`，拒绝非本机 Host 和跨站 Origin，不开放 CORS。management key 不进入网页或 URL，API Key 在 API 返回前转换为稳定的匿名分组。原始事件仅保存在本地 SQLite（可能包含 Key），不要将数据库、配置或日志公开上传。**本机其他进程仍可访问此服务，它不是多用户鉴权系统。**

采集线程与 HTTP 服务同进程，每 15 秒读取 `/v0/management/usage-queue`，一次最多 600 批，每批立即提交 SQLite 并按事件内容去重。队列接口需由你的 CPA 版本提供；不兼容时显示错误。此接口可能是消费式读取，不应同时运行两个采集器。

采集依赖服务持续运行；CPA 队列保留时长由 CPA 配置决定，停机过久或队列读取后进程突然退出仍可能丢数据。程序不会保证绝对不丢失，也不会删除无法解析时间戳的原始记录。无效记录计数显示在页面。

旧报表迁移：先停止旧采集进程，用 SQLite backup 备份原 `usage.sqlite`，再复制到新数据目录（同名表 `usage_events`，无需改表）；将原配置写入新 `config.env`，确认 DB_PATH 指向保留的数据后再启动。不要在两个采集器同时运行时迁移。

更新只切换程序目录，不改变数据库结构或配置。启动验证失败会切回旧版本并尝试恢复原服务；老版本目录保留用于排查。checksum 验证用于检查下载完整性，信任来源仍是 GitHub 仓库及 HTTPS，不等于独立数字签名。

## 本地开发与验证

```sh
python3 -m venv .venv
.venv/bin/python -m unittest discover -s tests -v
cd frontend
npm ci
npm test
npm run build
cd ..
cp -R frontend/dist dist
CPA_USAGE_HOME=/tmp/cpa-usage-dev .venv/bin/python report.py --no-collector
```

`--no-collector` 仅用于隔离预览和测试，避免测试时消费真实 CPA 队列。页面仍读取该数据目录下的 SQLite；不要将模拟数据当作真实流量。

## 版本迭代

1. 功能分支提交 PR 到 `main`；CI 在 macOS / Linux 运行后端、命令生命周期测试与前端构建/数据测试。
2. 更新 `VERSION`、`frontend/package.json` 与 lockfile 版本，修改 `CHANGELOG.md`，合并到 `main`。
3. 打版本标签并推送：

```sh
git tag v0.1.0
git push origin v0.1.0
```

4. Release 流水线验证标签匹配 `VERSION` 且来自 `main`，测试通过才上传预构建 tar.gz 和 SHA256SUMS。
5. 客户端 `cpa-usage update` 下载新版本，保留本地配置和历史，原先运行则自动重启。

流水线不需要仓库存储额外发布密钥，使用 GitHub 提供的短期 GITHUB_TOKEN。安装包采用显式文件白名单，不打包整个开发目录。

## License

[MIT](LICENSE)。`frontend/src/components/ui` 来自 [shadcn/ui](https://github.com/shadcn-ui/ui)，保留其 MIT 许可于 [THIRD_PARTY_NOTICES.md](THIRD_PARTY_NOTICES.md)。
