/**
 *
 *	@Project: @cldmv/lib-process
 *	@Filename: /src/mutex.mjs
 *	@Date: 2026-11-21T10:40:07-08:00 (1795286407)
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
 * @fileoverview A short cross-process mutex that serializes changes to one folder's socket.
 * @module @cldmv/lib-process/mutex
 *
 * @description
 * Replacing a dead socket is "check, then remove, then bind". Two processes doing that at
 * the same time could both decide the old socket is dead, and the slower one would then
 * remove the faster one's new, live socket. Running those steps under this mutex makes them
 * one step as far as other lib-process users are concerned.
 *
 * On Linux the mutex is a listening socket in the abstract namespace (a name that starts
 * with a NUL byte and has no file). Binding it is atomic, and the kernel frees it the moment
 * the process dies, so a crash can never leave it stuck. Abstract names are per network
 * namespace: processes in different network namespaces that share a folder aren't
 * serialized against each other. On other platforms there's no such name, so the steps run
 * without a mutex.
 */

import { createHash } from "node:crypto";
import { setTimeout as sleep } from "node:timers/promises";
import { CODES, LibProcessError } from "./errors.mjs";
import { listen } from "./listen.mjs";

const PREFIX = "\0@cldmv/lib-process:";

/** Whether this platform has an abstract socket namespace. */
export const HAS_MUTEX = process.platform === "linux";

/**
 * Runs `fn` while holding the mutex for `key`.
 * @template T
 * @param {string} key - What the mutex guards, normally a folder's real path.
 * @param {() => Promise<T>} fn - The critical section. Keep it short.
 * @param {{ timeout?: number }} [options] - How long to wait for the mutex, in ms (default 10000).
 * @returns {Promise<T>} Whatever `fn` returns.
 */
export async function withMutex(key, fn, { timeout = 10_000 } = {}) {
	/* v8 ignore next -- no abstract socket namespace off Linux; CI only runs on Linux. */
	if (!HAS_MUTEX) return fn();
	const name = PREFIX + createHash("sha256").update(key).digest("hex");
	const server = await acquire(name, Date.now() + timeout);
	try {
		return await fn();
	} finally {
		server.close();
	}
}

/**
 * Binds the abstract name, retrying while another process holds it.
 * @param {string} name - The abstract socket name, leading NUL included.
 * @param {number} deadline - Epoch ms after which it gives up.
 * @returns {Promise<import("node:net").Server>} The bound server; closing it frees the mutex.
 */
async function acquire(name, deadline) {
	for (;;) {
		try {
			return await listen(name);
		} catch (error) {
			if (/** @type {NodeJS.ErrnoException} */ (error).code !== "EADDRINUSE") throw error;
			if (Date.now() >= deadline) {
				throw new LibProcessError(
					CODES.MUTEX_TIMEOUT,
					"@cldmv/lib-process: timed out waiting for another process to finish replacing a socket.",
					{
						cause: error
					}
				);
			}
			await sleep(2 + Math.random() * 8);
		}
	}
}
