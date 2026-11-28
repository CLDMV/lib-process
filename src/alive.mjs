/**
 *
 *	@Project: @cldmv/lib-process
 *	@Filename: /src/alive.mjs
 *	@Date: 2026-11-21T10:40:53-08:00 (1795286453)
 *	@Author: Nate Corcoran <CLDMV>
 *	@Email: <Shinrai@users.noreply.github.com>
 *	-----
 *	@Last modified by: Nate Corcoran <CLDMV> (Shinrai@users.noreply.github.com)
 *	@Last modified time: 2026-11-21T11:06:10-08:00 (1795287970)
 *	-----
 *	@Copyright: Copyright (c) 2013-2026 Catalyzed Motivation Inc. All rights reserved.
 *
 */

/**
 * @fileoverview Liveness through a Unix socket: a holder listens in a folder, anyone can check it.
 * @module @cldmv/lib-process/alive
 *
 * @description
 * A pid in a file can't say whether its process is still running: the pid may have been
 * reused, and inside a PID namespace a live holder outside it looks dead. A listening socket
 * can. The kernel closes it the moment the holder exits, however it exits (crash, SIGKILL,
 * OOM), so connecting gives a straight answer:
 *
 * - the connection succeeds: **alive**
 * - the connection is refused: **dead** (the socket file outlived its holder)
 * - there is no socket: **unknown** (never held, cleaned up, or not started yet); the caller
 *   decides, for example from the folder's age
 *
 * The socket is `alive.sock` inside the folder. Unix socket paths are short (107 bytes on
 * Linux, 103 on macOS), so keep the folder path short.
 */

import { randomBytes } from "node:crypto";
import { link, lstat, mkdir, realpath, rmdir, unlink } from "node:fs/promises";
import net from "node:net";
import path from "node:path";
import { CODES, LibProcessError } from "./errors.mjs";
import { listen } from "./listen.mjs";
import { withMutex } from "./mutex.mjs";

/** File name of the socket inside a held folder. */
export const SOCKET_NAME = "alive.sock";

/** Longest socket path this platform accepts, in bytes (the kernel's limit minus its NUL). */
/* v8 ignore next -- the darwin side only runs on macOS, which CI doesn't test on. */
export const MAX_SOCKET_PATH_BYTES = process.platform === "darwin" ? 103 : 107;

const DEFAULT_CHECK_TIMEOUT_MS = 2000;

/**
 * @typedef {"alive" | "dead" | "unknown"} AliveState
 */

/**
 * Error codes from `connect()` and what they say about the holder.
 * EAGAIN means the listener's backlog is full: someone is listening, so it's alive.
 * @type {Readonly<Record<string, AliveState>>}
 */
const STATE_BY_CONNECT_ERROR = Object.freeze({
	ECONNREFUSED: "dead",
	// A Unix-socket connect is queued at once and fires "connect", so a reset before that only
	// happens when the listener closed with the connection still queued: its holder just
	// stopped (close()) or died. Either way nothing holds the folder any more.
	ECONNRESET: "dead",
	EAGAIN: "alive",
	ENOENT: "unknown"
});

/**
 * Builds the socket path for `dir` and checks it fits the platform's limit.
 * @param {string} dir - An absolute folder path.
 * @returns {string} The socket path.
 */
function socketPathFor(dir) {
	const socketPath = path.join(dir, SOCKET_NAME);
	const bytes = Buffer.byteLength(socketPath);
	if (bytes > MAX_SOCKET_PATH_BYTES) {
		throw new LibProcessError(
			CODES.PATH_TOO_LONG,
			`@cldmv/lib-process: socket path ${socketPath} is ${bytes} bytes, over the ${MAX_SOCKET_PATH_BYTES}-byte limit for Unix sockets. Use a shorter folder path.`
		);
	}
	return socketPath;
}

/**
 * Connects to the socket at `socketPath` and reports what that says about its holder.
 * A connect that hasn't finished by `timeout` counts as alive: something is bound there.
 * @param {string} socketPath - Path of an existing socket file.
 * @param {number} timeout - Milliseconds to wait for the connect.
 * @returns {Promise<AliveState>} The holder's state.
 */
function probe(socketPath, timeout) {
	return new Promise((resolve) => {
		const socket = net.connect(socketPath);
		/** @param {AliveState} state */
		const done = (state) => {
			clearTimeout(timer);
			socket.destroy();
			resolve(state);
		};
		const timer = setTimeout(() => done("alive"), timeout);
		socket.once("connect", () => done("alive"));
		socket.once("error", (/** @type {NodeJS.ErrnoException} */ error) => done(STATE_BY_CONNECT_ERROR[String(error.code)] ?? "unknown"));
	});
}

/**
 * Reads the socket file at `socketPath` without following links.
 * @param {string} socketPath - Path to look at.
 * @returns {Promise<import("node:fs").Stats | null>} Its stats, or null when nothing is there.
 */
async function statSocket(socketPath) {
	try {
		return await lstat(socketPath);
	} catch (error) {
		const code = /** @type {NodeJS.ErrnoException} */ (error).code;
		if (code === "ENOENT" || code === "ENOTDIR") return null;
		throw error;
	}
}

/**
 * Creates `resolved` when needed and returns its real path, so that two spellings of one
 * folder (a symlink, `..`) share one mutex key. Retries when the folder disappears between
 * the two steps (another holder's lock being released).
 * @param {string} resolved - An absolute folder path.
 * @returns {Promise<string>} The folder's real path.
 */
async function realFolder(resolved) {
	for (let attempt = 1; ; attempt++) {
		try {
			await mkdir(resolved, { recursive: true });
			return await realpath(resolved);
		} catch (error) {
			// ENOENT here means another process removed the folder mid-way (a lock released while
			// mkdir checked what it had made, or before realpath). Try again.
			if (/** @type {NodeJS.ErrnoException} */ (error).code !== "ENOENT" || attempt >= 100) throw error;
		}
	}
}

/**
 * Listens on `socketPath` without letting libuv own that name. libuv unlinks a pipe server's
 * path when the server closes, which would delete whatever socket sits there by then, even a
 * newer holder's. So the server binds a temporary name (no longer than the real one, so it
 * fits the same limit), and a hard link puts it at `socketPath`. link() fails when the name is
 * taken, so this never replaces an existing socket. On close libuv unlinks only the
 * temporary name, which is already gone.
 * @param {string} dir - The folder.
 * @param {string} socketPath - Where the socket must end up.
 * @returns {Promise<net.Server>} The listening server.
 */
async function bindInPlace(dir, socketPath) {
	const temp = path.join(dir, `.t${randomBytes(4).toString("hex")}`);
	const server = await listen(temp);
	try {
		await link(temp, socketPath);
	} catch (error) {
		server.close();
		await unlink(temp).catch(ignoreGone);
		/* v8 ignore next 3 -- EEXIST needs a holder racing in without the mutex (macOS only). */
		if (/** @type {NodeJS.ErrnoException} */ (error).code === "EEXIST") {
			throw new LibProcessError(CODES.HELD, `@cldmv/lib-process: ${dir} was taken by another holder.`, { cause: error });
		}
		throw error;
	}
	await unlink(temp);
	return server;
}

/**
 * Checks whether a process holds `dir`.
 *
 * @param {string} dir - The folder to check.
 * @param {{ timeout?: number }} [options] - `timeout`: ms to wait for the connect (default 2000).
 * @returns {Promise<AliveState>} `"alive"` when the holder's socket answers, `"dead"` when the
 *   socket is still there but nothing listens on it, `"unknown"` when there is no socket (or it
 *   can't be read). On Windows it is always `"unknown"`.
 * @throws {LibProcessError} `ERR_LIB_PROCESS_PATH_TOO_LONG` when the socket path is over the limit.
 * @example
 * const state = await alive.check("/tmp/my-run");
 * if (state === "dead") await rm("/tmp/my-run", { recursive: true });
 */
export async function check(dir, { timeout = DEFAULT_CHECK_TIMEOUT_MS } = {}) {
	/* v8 ignore next -- Windows has no Unix sockets in folders; CI doesn't test on Windows. */
	if (process.platform === "win32") return "unknown";
	const socketPath = socketPathFor(path.resolve(dir));
	let stats;
	try {
		stats = await statSocket(socketPath);
	} catch {
		return "unknown";
	}
	if (!stats?.isSocket()) return "unknown";
	return probe(socketPath, timeout);
}

/**
 * The handle `hold()` returns. Closing it stops holding the folder.
 */
export class Holder {
	/** @type {net.Server | null} */
	#server;
	/** @type {{ dev: number, ino: number } | null} */
	#identity;
	/** @type {string} */
	#key;
	/** @type {boolean} */
	#removeDir;
	/** @type {Promise<void> | null} */
	#closing = null;

	/**
	 * @param {object} init - Internal.
	 * @param {string} init.dir - The held folder's real path.
	 * @param {string | null} init.socketPath - The socket's path, or null where sockets aren't supported.
	 * @param {net.Server | null} init.server - The listening server.
	 * @param {{ dev: number, ino: number } | null} init.identity - The socket file's device and inode.
	 * @param {string} init.key - The mutex key for the folder.
	 * @param {boolean} [init.removeDir] - Remove the folder on close when it's empty.
	 */
	constructor({ dir, socketPath, server, identity, key, removeDir = false }) {
		/** The held folder (its real path). */
		this.dir = dir;
		/** Path of the socket, or null on Windows, where holding is a no-op. */
		this.socketPath = socketPath;
		this.#server = server;
		this.#identity = identity;
		this.#key = key;
		this.#removeDir = removeDir;
	}

	/** True when this platform has no Unix sockets and the handle holds nothing (Windows). */
	get unsupported() {
		return this.socketPath === null;
	}

	/** True once `close()` has been called. */
	get closed() {
		return this.#closing !== null;
	}

	/**
	 * Stops holding: closes the socket and removes its file. The socket is closed before this
	 * returns, so the folder is free straight away, even when the caller then blocks without
	 * awaiting; the promise settles once the file is cleaned up. The file is only removed when
	 * it is still this holder's own (same inode, nothing answering), so a later holder's socket
	 * is never touched. Calling it again returns the first call's promise.
	 * @returns {Promise<void>}
	 */
	close() {
		this.#closing ??= this.#close();
		return this.#closing;
	}

	async #close() {
		const server = this.#server;
		const socketPath = this.socketPath;
		/* v8 ignore next -- only the Windows no-op handle has no server; CI doesn't test on Windows. */
		if (!server || !socketPath) return;
		this.#server = null;
		// Stop listening before close() returns: server.close() shuts the socket synchronously,
		// so the folder is free the moment this call hands back its promise, and a caller that
		// then blocks (a spawnSync of the next holder) doesn't keep anyone waiting. The mutex is
		// only taken after the first await. Taking it here, before returning, left it bound
		// until the event loop ran again (#6).
		await new Promise((resolve) => server.close(() => resolve(undefined)));
		await withMutex(this.#key, async () => {
			// Another process may have taken the folder over since the socket stopped, and its
			// socket can reuse this one's inode number (it often does). So the file is only removed
			// when it has this holder's inode and nothing answers on it: a newer holder's live
			// socket is never touched.
			const stats = await statSocket(socketPath).catch(() => null);
			if (stats && this.#identity && stats.dev === this.#identity.dev && stats.ino === this.#identity.ino) {
				if ((await probe(socketPath, DEFAULT_CHECK_TIMEOUT_MS)) !== "alive") await unlink(socketPath).catch(ignoreGone);
			}
			if (this.#removeDir) await rmdir(this.dir).catch(ignoreGoneOrNotEmpty);
		});
	}
}

/**
 * Swallows "already gone" errors.
 * @param {NodeJS.ErrnoException} error - The error.
 * @returns {void}
 */
function ignoreGone(error) {
	if (error.code !== "ENOENT") throw error;
}

/**
 * Swallows "already gone" and "someone else's files are in it" errors from rmdir.
 * @param {NodeJS.ErrnoException} error - The error.
 * @returns {void}
 */
function ignoreGoneOrNotEmpty(error) {
	if (error.code !== "ENOENT" && error.code !== "ENOTEMPTY") throw error;
}

/**
 * Starts holding `dir`: listens on `alive.sock` inside it until the handle is closed or the
 * process exits. Creates the folder when it doesn't exist. A socket left behind by a holder
 * that died is replaced. The socket doesn't keep the process running, and child processes
 * don't inherit it, so it dies with this process alone.
 *
 * On Linux, replacing a dead socket runs under a short cross-process mutex, so two processes
 * can never both end up holding the folder. On macOS that mutex doesn't exist: two `hold()`
 * calls racing on the same dead folder could both succeed, so use `lock()` (Linux) when that
 * matters. On Windows nothing is held and the handle's `unsupported` is true; `check()` then
 * says `"unknown"` for the folder.
 *
 * @param {string} dir - The folder to hold.
 * @returns {Promise<Holder>} The handle. Call `close()` to stop holding.
 * @throws {LibProcessError} `ERR_LIB_PROCESS_HELD` when a live process already holds the folder,
 *   `ERR_LIB_PROCESS_NOT_SOCKET` when something else sits at the socket path,
 *   `ERR_LIB_PROCESS_UNKNOWN_STATE` when the socket's state can't be read,
 *   `ERR_LIB_PROCESS_PATH_TOO_LONG` when the socket path is over the limit.
 * @example
 * const holder = await alive.hold("/tmp/my-run");
 * // ... work ...
 * await holder.close();
 */
export async function hold(dir) {
	return holdFolder(dir, { removeDir: false });
}

/**
 * `hold()` with the options `lock()` needs.
 * @param {string} dir - The folder to hold.
 * @param {{ removeDir: boolean }} options - `removeDir`: remove the folder on close when empty.
 * @returns {Promise<Holder>} The handle.
 */
export async function holdFolder(dir, { removeDir }) {
	const resolved = path.resolve(dir);
	/* v8 ignore start -- Windows: nothing to hold (see above); CI doesn't test on Windows. */
	if (process.platform === "win32") {
		await mkdir(resolved, { recursive: true });
		return new Holder({ dir: resolved, socketPath: null, server: null, identity: null, key: resolved });
	}
	/* v8 ignore stop */
	const real = await realFolder(resolved);
	const socketPath = socketPathFor(real);

	return withMutex(real, async () => {
		// The folder may have been removed (a lock released) since realFolder() made it.
		await mkdir(real, { recursive: true });
		const existing = await statSocket(socketPath);
		if (existing) {
			if (!existing.isSocket()) {
				throw new LibProcessError(CODES.NOT_SOCKET, `@cldmv/lib-process: ${socketPath} exists and isn't a socket, so it was left alone.`);
			}
			const state = await probe(socketPath, DEFAULT_CHECK_TIMEOUT_MS);
			if (state === "alive") throw new LibProcessError(CODES.HELD, `@cldmv/lib-process: ${real} is held by a live process.`);
			if (state === "unknown") {
				throw new LibProcessError(CODES.UNKNOWN_STATE, `@cldmv/lib-process: can't tell whether ${socketPath} still has a holder.`);
			}
			await unlink(socketPath).catch(ignoreGone);
		}
		const server = await bindInPlace(real, socketPath);
		const { dev, ino } = await lstat(socketPath);
		return new Holder({ dir: real, socketPath, server, identity: { dev, ino }, key: real, removeDir });
	});
}
