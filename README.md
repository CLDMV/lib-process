# @cldmv/lib-process

Process safety for Node: liveness checks a crash can't leave stale, locks that release when their holder dies, and kills that only ever reach your own processes.

[![npm version]][npm_version_url] [![npm downloads]][npm_downloads_url] [![Last commit]][last_commit_url] [![coverage]][coverage_url]

---

## ✨ What's New

### Latest: v0.1.0 (November 2026)

- **First release** — `alive.hold()` / `alive.check()` give a liveness check through a Unix socket that a crash can't leave stale, `lock()` is an exclusive lock that a dead holder's successor takes over at once, and `safeKill()` only signals the caller's own descendants (or reported processes that started after a given time) ([#2](https://github.com/CLDMV/lib-process/pull/2)). `lock()` and `safeKill()` are Linux only for now.
- [View full v0.1.0 Changelog](https://github.com/CLDMV/lib-process/blob/master/docs/changelog/v0/v0.1.0.md)

---

Pid files lie. A pid in a file can belong to an unrelated process by the time you read it, and inside a PID namespace a live process outside it looks dead. `process.kill(pid)` trusts whatever pid it gets, so a computed 0 or -1 signals a whole process group or every process you own.

This package replaces those patterns with three small tools:

- **`alive`**: a holder listens on a Unix socket in a folder. Anyone can connect to find out whether it is still running. The kernel closes the socket the moment the holder exits, however it exits.
- **`lock`**: an exclusive lock built on `alive`. A dead holder's lock is taken over straight away, and two contenders never both win.
- **`safeKill`**: signals only the caller's own descendants (or processes it was told about that started after a given time), and never pid 0, pid 1, a group, itself or its ancestors.

## Install

```bash
npm install @cldmv/lib-process
```

ESM and CommonJS both work (`require()` needs Node.js ^20.19.0 or >=22.13.0).

## `alive`

```js
import { alive } from "@cldmv/lib-process";

// In the process that owns the folder:
const holder = await alive.hold("/tmp/my-run");
// ... work ...
await holder.close();

// Anywhere else:
const state = await alive.check("/tmp/my-run"); // "alive" | "dead" | "unknown"
```

| `check()` says | Meaning                                                                                                  |
| -------------- | -------------------------------------------------------------------------------------------------------- |
| `"alive"`      | The holder's socket accepted a connection. It is running (a stopped, SIGSTOPped process counts too).     |
| `"dead"`       | The socket file is there but nothing listens on it. The holder crashed or was killed.                    |
| `"unknown"`    | There is no socket: never held, closed cleanly, or not started yet. Decide yourself, e.g. by folder age. |

- The socket is `alive.sock` inside the folder (`alive.SOCKET_NAME`). Unix socket paths are short: 107 bytes on Linux, 103 on macOS (`alive.MAX_SOCKET_PATH_BYTES`). A longer path throws `ERR_LIB_PROCESS_PATH_TOO_LONG`, so keep folders near the root of `/tmp` or `$XDG_RUNTIME_DIR`.
- `hold()` creates the folder, replaces a dead socket, and throws `ERR_LIB_PROCESS_HELD` when a live process already holds it. It leaves a non-socket file at the socket path alone (`ERR_LIB_PROCESS_NOT_SOCKET`).
- The socket doesn't keep your process running, and child processes don't inherit it.
- Connecting works across PID namespaces, because the socket is a file. Processes only need to see the same folder.
- On Windows there are no Unix sockets in folders: `hold()` returns a handle with `unsupported: true` that holds nothing, and `check()` always says `"unknown"`.

## `lock`

```js
import { lock } from "@cldmv/lib-process";

const held = await lock("/tmp/my-app.lock", { wait: 5000 });
try {
	// ... only one process at a time gets here ...
} finally {
	await held.release();
}
```

- The lock is a folder that this function creates and removes. Its socket must fit the limit above.
- `wait` (ms, default 0) is how long to keep trying while a live holder has it; `Infinity` waits indefinitely. When it runs out, it throws `ERR_LIB_PROCESS_HELD`. `retryInterval` (default 50 ms) is the pause between tries.
- A holder that crashed or was SIGKILLed leaves a dead socket. The next `lock()` takes it over at once, with no stale timeout to wait out.
- Taking over a dead lock runs under a short mutex: a listening socket in Linux's abstract namespace, which the kernel frees when its process dies. So two contenders never both win, and a crash can't leave the mutex stuck. Contenders must share a network namespace (abstract sockets are per network namespace). Separate PID or user namespaces are fine.
- Linux only for now. Elsewhere it throws `ERR_LIB_PROCESS_UNSUPPORTED_PLATFORM`.

## `safeKill`

```js
import { safeKill } from "@cldmv/lib-process";

const { killed, skipped } = await safeKill([worker.pid], { signal: "SIGTERM" });
// skipped: [{ pid, reason }] for everything it refused
```

It never signals:

| Reason           | What                                                                   |
| ---------------- | ---------------------------------------------------------------------- |
| `invalid`        | Anything that isn't a positive integer: 0, -1, negative (group) ids.   |
| `init`           | pid 1.                                                                 |
| `self`           | The calling process.                                                   |
| `ancestor`       | Any of the caller's ancestors.                                         |
| `thread`         | A thread id (it would signal the whole process the thread belongs to). |
| `gone`           | A pid that no longer exists, or was reused before the signal.          |
| `not-descendant` | Any other process, unless `reported` is given.                         |
| `started-before` | With `reported`: a non-descendant that started before `since`.         |
| `denied`         | The kernel refused (EPERM).                                            |

What it does signal: the caller's descendants. With `reported: { since }` it also signals other processes that started at or after `since` (a `Date` or epoch ms). That covers a grandchild that was reparented when its parent exited and whose pid a child reported. Because its start time is after `since`, it can't be an older process that happens to reuse the pid.

```js
const started = Date.now();
// ... spawn work; a child reports a grandchild's pid ...
await safeKill([reportedPid], { reported: { since: started } });
```

Right before each signal it reads the process's start time again, so a pid that was reused in between isn't signalled. Linux only: it reads `/proc`. It refuses to run (`ERR_LIB_PROCESS_PROC_MISMATCH`) when `/proc` belongs to another PID namespace, as after `unshare -p` without `--mount-proc`.

## Errors

Every error is a `LibProcessError` with a `code` from `CODES`:

| Code                                   | When                                                       |
| -------------------------------------- | ---------------------------------------------------------- |
| `ERR_LIB_PROCESS_HELD`                 | A live process holds the folder or lock.                   |
| `ERR_LIB_PROCESS_PATH_TOO_LONG`        | The socket path is over the platform limit.                |
| `ERR_LIB_PROCESS_NOT_SOCKET`           | Something other than a socket sits at the socket path.     |
| `ERR_LIB_PROCESS_UNKNOWN_STATE`        | The socket exists but can't be connected to (permissions). |
| `ERR_LIB_PROCESS_MUTEX_TIMEOUT`        | The takeover mutex stayed busy for 10 s.                   |
| `ERR_LIB_PROCESS_UNSUPPORTED_PLATFORM` | `lock()` or `safeKill()` off Linux.                        |
| `ERR_LIB_PROCESS_PROC_MISMATCH`        | `/proc` can't be trusted for this process's pids.          |
| `ERR_LIB_PROCESS_INVALID_ARGUMENT`     | A bad argument.                                            |

## Development

```bash
npm test          # unit tests, then the CJS and dist checks
npm run coverage  # the same with coverage (100% required)
```

Tests that fork processes or send real signals only run inside a PID namespace, so a wrong kill can only reach the test run's own processes. They're skipped unless `LIB_PROCESS_TEST_NAMESPACE=1` is set and pid 1 isn't a host init. Run them in a throwaway container, for example:

```bash
LIB_PROCESS_TEST_NAMESPACE=1 npm test
```

The rest of the suite (the kill decisions with a made-up process table, and `safeKill` with `/proc` and `process.kill` replaced) runs anywhere and covers every line.

In a checkout, the `lib-process-dev` export condition loads `src/` instead of `dist/`.

## License

Apache-2.0. See [LICENSE](LICENSE).

[npm version]: https://img.shields.io/npm/v/%40cldmv%2Flib-process.svg?style=for-the-badge&logo=npm&logoColor=white&labelColor=CB3837
[npm_version_url]: https://www.npmjs.com/package/@cldmv/lib-process
[npm downloads]: https://img.shields.io/npm/dm/%40cldmv%2Flib-process.svg?style=for-the-badge&logo=npm&logoColor=white&labelColor=CB3837
[npm_downloads_url]: https://www.npmjs.com/package/@cldmv/lib-process
[last commit]: https://img.shields.io/github/last-commit/CLDMV/lib-process?style=for-the-badge&logo=github&logoColor=white&labelColor=181717
[last_commit_url]: https://github.com/CLDMV/lib-process/commits
[coverage]: https://img.shields.io/endpoint?url=https%3A%2F%2Fraw.githubusercontent.com%2FCLDMV%2Flib-process%2Fbadges%2Fcoverage.json&style=for-the-badge&logo=vitest&logoColor=white
[coverage_url]: https://github.com/CLDMV/lib-process/blob/badges/coverage.json
