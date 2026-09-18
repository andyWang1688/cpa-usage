# Changelog

## 0.2.3

- fix: plugin configuration (`db_path`) was never applied when the host delivered the payload wrapped in a `result` envelope; the plugin silently fell back to its built-in default path. Both payload shapes are now handled, and the default path is `~/.cli-proxy-api/usage-report.sqlite`.

## 0.2.2

- Dashboard "更新于" (updated at) now reflects the freshness timestamp of each refresh instead of the last received request time, so it no longer looks frozen during idle periods.

## 0.2.1

- Dashboard: drop the obsolete standalone-service settings dialog, the "sync usage" button and the terminal setup notice; the page auto-refreshes and the footer shows the plugin version.
- Frontend: build with `base: "./"` and relative API paths so assets resolve from the plugin resource route.
- Release: the plugin version is injected at build time (`-ldflags -X main.version=$VERSION`).

## 0.2.0

- Rework the project into a CLIProxyAPI native plugin (`plugin/`): usage collected in real time via the `usage.handle` callback; dashboard and data API served inside the CPA process via `management_api`.
- Publish installable releases through the plugin store (`plugin-store/registry.json`); one-click install from the CPA management panel.
- Automated multi-platform plugin builds on tag (darwin/arm64, linux/amd64, linux/arm64) with `checksums.txt`.
- Dashboard assets are built from `frontend/` and embedded into the plugin.
- Remove the former standalone Python service (`report.py`, `cli.py`, `install.sh` and related tests/scripts); the plugin replaces it.

## 0.1.1

- Default application home is now `~/.cpa-usage/`.
- Add `cpa-usage migrate` for legacy installations, preserving configuration, SQLite history, logs and versions; rebuild the virtual environment and restart safely.
- Refuse existing migration targets, preserve custom directories and external databases, and restore the old service on failed startup.
- Emphasize local-first storage and lightweight, single-process operation in the dashboard and documentation.

## 0.1.0

- Real shadcn/ui dashboard with calendar ranges, stacked trend, model filtering and anonymized key/request tables.
- Local SQLite collector; fix out-of-order buckets, inclusive end dates, zero-token request counts and hidden collector errors.
- Versioned, checksummed release installation and command-line service management.
- Update preserves configuration/database and rolls back the program on failed startup.
- Automated tests and prebuilt releases on macOS/Linux CI.
