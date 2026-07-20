# MMM-taskwarrior

A [MagicMirror²](https://magicmirror.builders/) module that displays a list of
[Taskwarrior](https://taskwarrior.org/) tasks synced from a
[TaskChampion](https://gothenburgbitfactory.org/taskchampion/) sync server.

It accepts regular Taskwarrior filters, optional sync-server credentials, a
refresh interval, and display options. Task fetching is done by shelling out to
the `task` CLI, so **any** Taskwarrior filter works exactly as it does on the
command line (virtual tags, `due.before:`, urgency ordering, boolean logic, …).

![grouped task list](docs/screenshot.png)

## Prerequisites

- **Taskwarrior 3.x installed on the mirror host** (`task --version` ≥ 3.0).
  This is the machine running MagicMirror, not necessarily your dev machine.
- The host either:
  - already has a TaskChampion sync server configured in `~/.taskrc`
    (`task sync` works from the shell), **or**
  - you supply the server details via this module's `serverUrl` / `serverPort` /
    `clientId` / `encryptionSecret` options (see below).

## Installation

```bash
cd ~/MagicMirror/modules
git clone <this-repo-url> MMM-taskwarrior
```

No `npm install` is required — the module has no runtime dependencies.

## Configuration

Add a module entry to `config/config.js`:

```js
{
  module: "MMM-taskwarrior",
  position: "top_left",
  header: "Tasks",
  config: {
    filter: "status:pending +work or +home",
    updateInterval: 10,       // minutes
    maximumEntries: 12,
    groupByProject: true

    // Optional: point at a specific sync server instead of using ~/.taskrc.
    // serverUrl: "https://tw.example.com",
    // serverPort: 8080,
    // clientId: "85038910-8fe2-480d-b6cb-6e7fabc1fa44",
    // encryptionSecret: "your-shared-secret"
  }
}
```

### Options

| Option | Default | Description |
| --- | --- | --- |
| `filter` | `"status:pending"` | Taskwarrior filter. A string (`"status:pending +work"`) or an array (`["status:pending", "+work"]`). Use an array to avoid whitespace/quoting issues. |
| `serverUrl` | `""` | TaskChampion sync server URL, incl. scheme. Maps to `sync.server.url`. Leave empty to use the host's existing config. |
| `serverPort` | `null` | Port to inject into `serverUrl` if not already present. |
| `clientId` | `""` | TaskChampion client id (the "key"). Maps to `sync.server.client_id`. Same value on every device sharing the database. |
| `encryptionSecret` | `""` | Shared encryption secret. Maps to `sync.encryption_secret`. |
| `updateInterval` | `10` | Minutes between refreshes. |
| `autoSync` | `true` | Run `task sync` before each export so the mirror shows fresh server data. Set `false` if the host syncs on its own (cron/systemd). |
| `taskCommand` | `"task"` | Path/name of the Taskwarrior binary. |
| `taskrc` | `null` | Override `TASKRC` (path to a taskrc). |
| `taskData` | `null` | Override `TASKDATA` (path to the data dir). |
| `commandTimeout` | `15000` | Milliseconds allowed per `task` invocation. |
| `fields` | `["description","project","due","tags"]` | Which task fields to render per row. |
| `groupByProject` | `true` | Group tasks under project headings. |
| `sortBy` | `"urgency"` | `"urgency"`, `"due"`, or `"description"`. Applied within each project group. |
| `maximumEntries` | `10` | Max number of tasks to display. |
| `showHeader` | `true` | Show the module header. |
| `title` | `"Tasks"` | Header text (used if `header` isn't set on the module). |
| `showCount` | `true` | Append the matching-task count to the header. |
| `highlightOverdue` | `true` | Color overdue / due-soon tasks. |
| `dueSoonDays` | `3` | Tasks due within this many days are "due soon". |
| `dateFormat` | `"relative"` | `"relative"` (e.g. "in 2 days") or a moment.js format string. |
| `fadeSpeed` | `2000` | DOM update fade duration (ms). |

## How sync overrides work

If you set any of `serverUrl` / `serverPort` / `clientId` / `encryptionSecret`,
the module writes a private taskrc (permissions `0600`) in the OS temp dir that
`include`s your existing taskrc and appends the `sync.*` settings, then runs
`task` with `TASKRC` pointing at it. The encryption secret is therefore **not**
passed as a command-line argument, keeping it out of the process list (`ps`).

If none are set, the module uses the host's existing configuration as-is.

## Verifying locally

You can exercise the backend without a running mirror (needs `task` on PATH):

```bash
node test/harness.js
```

It creates an isolated task database, adds sample tasks, drives `node_helper.js`
exactly as MagicMirror would, and prints the resulting task list.

## Troubleshooting

- **"Taskwarrior (`task`) not found"** — install Taskwarrior 3.x on the mirror,
  or set `taskCommand` to its full path.
- **Empty list** — check your `filter` from the shell:
  `task <your filter> export`. An empty result there means the filter matched
  nothing.
- **Sync not updating** — run `task sync` manually on the host to confirm the
  server/credentials work. Sync failures are logged but do **not** blank the
  list; the module keeps showing the local replica.
- **Logs** — backend messages appear in the MagicMirror server log
  (`pm2 logs mm` or the terminal running `npm start`).

## License

MIT
