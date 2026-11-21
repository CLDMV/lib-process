/**
 *
 *	@Project: @cldmv/lib-process
 *	@Filename: /src/lock.mjs
 *	@Date: 2026-11-21T10:41:16-08:00 (1795286476)
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
 * @fileoverview An exclusive lock that is released the moment its holder dies.
 * @module @cldmv/lib-process/lock
 *
 * @description
 * The lock is a folder held through `alive`: whoever has a live socket in it owns it. A
 * holder that crashes or is SIGKILLed leaves a dead socket, and the next `lock()` takes it
 * over straight away, with no timeout to wait out. The takeover runs under a cross-process
 * mutex (see mutex.mjs), so two contenders never both win. That mutex is Linux-only, so
 * `lock()` is too.
 */

import { setTimeout as sleep } from "node:timers/promises";
import { holdFolder } from "./alive.mjs";
import { assertPlatform, CODES, LibProcessError } from "./errors.mjs";

const DEFAULT_RETRY_INTERVAL_MS = 50;

/**
 * A held lock. Call `release()` when done.
 */
export class Lock {
	/** @type {import("./alive.mjs").Holder} */
	#holder;

	/**
	 * @param {import("./alive.mjs").Holder} holder - Internal.
	 */
	constructor(holder) {
		this.#holder = holder;
		/** The lock folder's real path. */
		this.path = holder.dir;
	}

	/** True once `release()` has been called. */
	get released() {
		return this.#holder.closed;
	}

	/**
	 * Releases the lock and removes the lock folder (unless something else was put in it).
	 * Calling it again returns the first call's promise.
	 * @returns {Promise<void>}
	 */
	release() {
		return this.#holder.close();
	}
}

/**
 * Takes an exclusive lock on `lockPath`, a folder this function creates and owns.
 *
 * @param {string} lockPath - The lock folder, for example `/run/user/1000/my-app.lock`. Keep it
 *   short: the socket inside must fit the Unix socket path limit.
 * @param {object} [options]
 * @param {number} [options.wait=0] - How long to keep trying while another live process holds
 *   the lock, in ms. 0 fails at once; `Infinity` waits for as long as it takes.
 * @param {number} [options.retryInterval=50] - Pause between attempts while waiting, in ms.
 * @returns {Promise<Lock>} The held lock.
 * @throws {LibProcessError} `ERR_LIB_PROCESS_HELD` when a live process still holds it after
 *   `wait`, `ERR_LIB_PROCESS_UNSUPPORTED_PLATFORM` off Linux, plus the errors `alive.hold()` throws.
 * @example
 * const held = await lock("/tmp/my-app.lock", { wait: 5000 });
 * try {
 * 	// ... exclusive work ...
 * } finally {
 * 	await held.release();
 * }
 */
export async function lock(lockPath, { wait = 0, retryInterval = DEFAULT_RETRY_INTERVAL_MS } = {}) {
	assertPlatform("lock", ["linux"]);
	if (typeof lockPath !== "string" || lockPath === "") {
		throw new LibProcessError(CODES.INVALID_ARGUMENT, "@cldmv/lib-process: lock() needs a folder path.");
	}
	if (!(wait >= 0)) throw new LibProcessError(CODES.INVALID_ARGUMENT, "@cldmv/lib-process: lock() `wait` must be 0 or more.");
	if (!(retryInterval > 0))
		throw new LibProcessError(CODES.INVALID_ARGUMENT, "@cldmv/lib-process: lock() `retryInterval` must be more than 0.");

	const deadline = Date.now() + wait;
	for (;;) {
		try {
			return new Lock(await holdFolder(lockPath, { removeDir: true }));
		} catch (error) {
			const remaining = deadline - Date.now();
			if (/** @type {{ code?: string }} */ (error).code !== CODES.HELD || remaining <= 0) throw error;
			await sleep(Math.min(retryInterval, remaining));
		}
	}
}
