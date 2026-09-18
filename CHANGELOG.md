# Changelog

## 0.2.0

- Add the CLIProxyAPI plugin form (`plugin/`): a native dynamic library that implements `usage_plugin` (real-time collection via the `usage.handle` callback) and `management_api` (dashboard page and data API served inside the CPA process).
- Add the plugin store registry (`plugin-store/registry.json`); install with one click from the CPA Plugin Store.
- Dashboard assets are built from the same `frontend/` sources and bundled into the plugin.
- Standalone (Python) distribution continues from the same source tree without functional changes; its release assets are attached to the same tag.

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
