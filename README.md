# CPA Usage

**本地优先，轻量运行。** A local-first, lightweight **CLIProxyAPI usage dashboard**.

- **本地优先**：配置与历史用量保存在本机，不上传第三方分析平台；仅连接你配置的 CPA。
- **轻量运行**：两种形态任选——CLIProxyAPI 原生插件（随 CPA 进程运行，无需额外服务），或独立版（单 Python 进程 + 嵌入式 SQLite，仅标准库）。
- 真实 shadcn/ui 界面，Token 趋势、模型/Key 明细与筛选齐全。

**状态：v0.2.0。MIT 开源。** 插件版支持 macOS / Linux（随 CPA 支持的平台）；独立版支持 macOS / Linux，客户端仅需 Python 3.10+。

## 两种形态

| | 插件版（推荐） | 独立版（Python） |
|---|---|---|
| 运行方式 | 随 CLIProxyAPI 进程内运行（`.dylib`/`.so`） | 独立后台服务 `cpa-usage` |
| 采集方式 | `usage.handle` 回调，请求完成即入库（实时，无轮询） | 每 15 秒轮询 CPA `usage-queue` |
| 安装 | CPA 插件商店一键安装 | `install.sh` 安装脚本 |
| 页面地址 | `http://127.0.0.1:8317/v0/resource/plugins/usage-report/report` | `http://127.0.0.1:8899` |
| 数据文件 | CPA 配置的 `db_path`（默认 `~/.cli-proxy-api/usage-report/usage.sqlite`） | `~/.cpa-usage/usage.sqlite` |
| 依赖 | 无（CPA 加载动态库） | Python 3.10+、curl |

两种形态界面完全一致（独立版前端即插件所附带的同一套构建产物），数据互不影响，可同时安装。

## 插件版安装（推荐）

1. 在 `cliproxyapi.conf` 中添加插件商店源：

```yaml
plugins:
  enabled: true
  store-sources:
    - "https://gist.githubusercontent.com/andyWang1688/dd3211dbf2af7e9c3c05f4319014ec99/raw/registry.json"
  configs:
    usage-report:
      enabled: true
      db_path: "~/.cli-proxy-api/usage-report/usage.sqlite"
```

2. 重启 CLIProxyAPI，打开管理面板 → **插件商店** → 找到 **CPA Usage Report** → 安装。
3. 打开 **插件 → Usage Report**（或访问 `/v0/resource/plugins/usage-report/report`）。

> 商店列表会查询 GitHub API；若遇到 rate limit，可为 CPA 进程配置 `GITHUB_TOKEN` 环境变量并添加 `store-auth`（`type: github-token`、`token-env: GITHUB_TOKEN`）。

手动安装（离线场景）：

```bash
cd plugin
go build -buildmode=c-shared -o usage-report.dylib .
mkdir -p <plugins-dir>/<goos>/<goarch>
cp usage-report.dylib <plugins-dir>/<goos>/<goarch>/
```

## 独立版安装（Python）

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
cpa-usage update v0.2.0  # 指定版本（已经安装过的版本不会覆盖）
```

`start` 为当前用户启动后台服务，不修改系统服务或开机启动配置；电脑重启后需再次运行。Python 3.10+ 找不到时可指定 `PYTHON=/absolute/path/to/python3`。自定义安装位置使用 `CPA_USAGE_HOME` 和 `CPA_USAGE_BIN`；自定义 BIN 更新时需设置同一变量。

## 从旧目录迁移（独立版）

v0.1.0 默认安装在 `~/.local/share/cpa-usage/`。先升级取得迁移命令，再迁移：

```sh
cpa-usage update
cpa-usage migrate
```

迁移会暂停原服务，用 SQLite backup 复制数据库与配置、日志和程序版本到 `~/.cpa-usage/`，重建虚拟环境、更新命令入口，并恢复原先运行的服务。原目录保留为停止运行的迁移时点副本，不要同时启动两个采集器；迁移后新增记录仅写入新目录。

目标目录已存在时拒绝覆盖；新服务启动失败时恢复原命令入口和原服务。用户自定义的 `CPA_USAGE_HOME` 不会被自动迁移，外部自定义数据库路径也保持不变。新安装直接使用 `~/.cpa-usage/`，无需执行迁移。

## 界面

- shadcn/ui Card、Calendar、Popover、Tabs、Table、Select、Dialog、Tooltip 等官方组件源码，浅色/深色主题。
- 今天、近 7/30 天与自定义日期范围；模型筛选同时作用于 KPI、趋势和明细。
- 缓存输入 / 净输入 / 输出堆叠趋势，小时 / 天 / 月粒度。
- 模型、匿名 Key、请求三个视角；搜索、排序与分页。
- 全部请求参与成功率统计，包括零 Token 失败；输入含缓存，输出含推理，不重复相加。
- 错误、空数据和采集异常明确显示，不把空白或旧数据当实时成功。
- 不预置价格，不把未知模型的用量伪装成实际账单。

## 数据与安全

- 插件版：仅保存 CPA 配置中 `db_path` 指向的 SQLite；由 CPA 进程按插件配置读写。
- 独立版：默认目录 `~/.cpa-usage/`：

```text
config.env          # CPA 连接配置，权限 0600
usage.sqlite        # 历史用量，更新不覆盖
service.log         # 后台日志
venv/               # 无第三方 Python 依赖的隔离运行时
releases/0.2.0/     # 不可变版本目录
current -> releases/0.2.0
```

独立版仅监听 `127.0.0.1`，拒绝非本机 Host 和跨站 Origin，不开放 CORS。management key 不进入网页或 URL，API Key 在 API 返回前转换为稳定的匿名分组。原始事件仅保存在本地 SQLite（可能包含 Key），不要将数据库、配置或日志公开上传。**本机其他进程仍可访问独立版服务，它不是多用户鉴权系统。**

采集依赖进程或 CPA 持续运行；CPA 队列保留时长由 CPA 配置决定。插件版实时采集不依赖队列窗口；独立版停机过久（超过队列保留时长）或队列读取后进程突然退出仍可能丢数据。程序不会保证绝对不丢失，也不会删除无法解析时间戳的原始记录。

旧报表迁移（独立版）：先停止旧采集进程，用 SQLite backup 备份原 `usage.sqlite`，再复制到新数据目录（同名表 `usage_events`，无需改表）；将原配置写入新 `config.env`，确认 DB_PATH 指向保留的数据后再启动。不要在两个采集器同时运行时迁移。插件版与独立版共用同一 `usage_events` 表结构，可在停止采集进程后用 SQLite backup 互相迁移数据。

更新只切换程序目录，不改变数据库结构或配置。启动验证失败会切回旧版本并尝试恢复原服务；老版本目录保留用于排查。checksum 验证用于检查下载完整性，信任来源仍是 GitHub 仓库及 HTTPS，不等于独立数字签名。

## 插件开发（plugin/）

插件为 Go 编写的原生动态库（C ABI），实现 `usage_plugin`（实时用量回调）与 `management_api`（页面与 API 路由）两项能力。

```sh
cd plugin
GOPROXY=https://goproxy.cn,direct go test ./...       # 本地单元测试
go build -buildmode=c-shared -o usage-report.dylib .  # macOS；Linux 为 .so
```

页面资源位于 `plugin/web/`，来自本仓库 `frontend/` 的构建产物：

```sh
cd frontend && npm ci && npm run build
cp dist/index.html ../plugin/web/index.html
cp dist/assets/* ../plugin/web/assets/
```

> 替换前端后需同步更新 `plugin/main.go` 中 embed 的文件名与 `management.register` 的资源路由（构建产物带 hash 文件名）。

发布新版本（插件商店）：

```sh
cp usage-report.dylib /tmp/usage-report-v0.2.1.dylib && cd /tmp
zip usage-report_0.2.1_darwin_arm64.zip usage-report-v0.2.1.dylib
shasum -a 256 usage-report_0.2.1_darwin_arm64.zip > checksums.txt
gh release create v0.2.1 --repo andyWang1688/cpa-usage usage-report_0.2.1_darwin_arm64.zip checksums.txt
# 更新插件商店 registry 中的 version 字段
```

## 本地开发与验证（独立版）

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
git tag v0.2.0
git push origin v0.2.0
```

4. Release 流水线验证标签匹配 `VERSION` 且来自 `main`，测试通过才上传预构建 tar.gz 和 SHA256SUMS；插件二进制资产按上文手动附加到同一 Release。
5. 客户端 `cpa-usage update` 下载新版本，保留本地配置和历史，原先运行则自动重启。

流水线不需要仓库存储额外发布密钥，使用 GitHub 提供的短期 GITHUB_TOKEN。安装包采用显式文件白名单，不打包整个开发目录。

## License

[MIT](LICENSE)。`frontend/src/components/ui` 来自 [shadcn/ui](https://github.com/shadcn-ui/ui)，保留其 MIT 许可于 [THIRD_PARTY_NOTICES.md](THIRD_PARTY_NOTICES.md)。
