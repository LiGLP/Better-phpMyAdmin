# Better phpMyAdmin

A modern, self-hosted web interface that talks **directly** to MySQL / MariaDB — a full
replacement for phpMyAdmin, not a reskin. Built with Node.js + Express on the backend and a
dependency-free vanilla JS frontend (works fully offline, no CDNs).

Designed to run alongside **XAMPP** (or any MySQL/MariaDB server) on **port 8009**, with an
optional **remote mode** so other PCs on your network can use it too.

![port 8009](https://img.shields.io/badge/port-8009-6366f1) ![license MIT](https://img.shields.io/badge/license-MIT-22c55e)

---

## Features

- 🔐 **Login with your MySQL credentials** (host / port / user / password) — session-based, nothing stored on disk
- 🗂 **Database & table browser** — collapsible sidebar tree with live filter
- 🔎 **Row browser** — pagination, click-to-sort columns, full-text search across all columns
- ✏️ **Inline editing** — insert / edit / delete rows with NULL handling
- 🧱 **Structure view** — columns, keys, indexes and the raw `CREATE TABLE`
- ⚡ **SQL console** — run any query, `Ctrl+Enter` to execute, results in a grid (global, per-DB, or per-table)
- ➕ **Create / drop / truncate** databases and tables (visual table builder)
- ⬇️ **Export** — full SQL dump (streamed) of a database or single table, plus CSV export
- ⬆️ **Import** — upload and execute a `.sql` file
- 🌓 **Dark / light theme**
- 🌐 **Remote mode** — bind to all interfaces so other machines can connect

---

## Requirements

- [Node.js](https://nodejs.org/) 18 or newer
- A running MySQL / MariaDB server (e.g. the one bundled with **XAMPP**)

## Quick start

```bash
git clone https://github.com/LiGLP/Better-phpMyAdmin.git
cd Better-phpMyAdmin
npm install
npm start
```

Then open **http://localhost:8009**.

On Windows you can also just double-click **`start.bat`** (it runs `npm install` on first launch).

### Logging in

The login screen is pre-filled with the typical **XAMPP** defaults:

| Field    | Default     |
|----------|-------------|
| Host     | `127.0.0.1` |
| Port     | `3306`      |
| User     | `root`      |
| Password | *(empty)*   |

Start MySQL in the XAMPP control panel first, then connect.

---

## Remote access (other PCs)

Remote mode is **on by default** — the server listens on `0.0.0.0:8009`, so any device on your
network can reach it at:

```
http://<your-computers-LAN-IP>:8009
```

The exact URL is printed in the console when the server starts.

On Windows you may need to open the port in the firewall once (run in an **admin** terminal):

```powershell
netsh advfirewall firewall add rule name="Better phpMyAdmin" dir=in action=allow protocol=TCP localport=8009
```

To restrict it back to **localhost only**, set the host to `127.0.0.1` (see Configuration).

> ⚠️ **Security note:** this tool is built for trusted/offline LAN use. The only access control
> is your MySQL login. Don't expose port 8009 directly to the public internet — put it behind a
> VPN or reverse proxy with HTTPS if you need that.

---

## Configuration

Edit [`config.json`](config.json), or override per-machine with a `config.local.json`
(git-ignored), or via environment variables:

| Setting              | `config.json` path             | Env var               | Default     |
|----------------------|--------------------------------|-----------------------|-------------|
| Port                 | `server.port`                  | `BPMA_PORT`           | `8009`      |
| Bind host            | `server.host`                  | `BPMA_HOST`           | `0.0.0.0`   |
| Session secret       | `server.sessionSecret`         | `BPMA_SESSION_SECRET` | *(change!)* |
| Session timeout      | `server.sessionTimeoutMinutes` | —                     | `120`       |
| Default login host   | `defaults.host`                | —                     | `127.0.0.1` |
| Rows per page        | `limits.rowsPerPage`           | —                     | `50`        |
| Max import file size | `limits.maxImportSizeMB`       | —                     | `64`        |

**Localhost only** example:

```bash
BPMA_HOST=127.0.0.1 npm start
```

---

## Project structure

```
server.js              Express entry point — config, sessions, routing, startup
config.json            Defaults (port, bind host, connection defaults, limits)
src/
  db.js                Connection-pool cache + raw connections
  util.js              Identifier quoting, auth middleware, async wrapper
  routes/
    auth.js            login / logout / session / defaults
    schema.js          databases, tables, structure, create/drop/truncate
    rows.js            browse (paginate/sort/search) + row insert/update/delete
    query.js           arbitrary SQL execution
    transfer.js        SQL dump export, CSV export, .sql import
public/
  index.html           SPA shell (login + app)
  css/style.css        Dark/light theme
  js/app.js            All frontend logic (no dependencies)
```

## Tech & security notes

- SQL **values** always go through parameterized queries (`?` placeholders).
- SQL **identifiers** (db / table / column names) are validated and backtick-quoted via `quoteId`.
- Credentials live only in the server-side session; connection pools are cached in memory and
  reused per connection signature.

## License

MIT © LiGLP
