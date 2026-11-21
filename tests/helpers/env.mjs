/**
 *
 *	@Project: @cldmv/lib-process
 *	@Filename: /tests/helpers/env.mjs
 *	@Date: 2026-11-21T10:43:26-08:00 (1795286606)
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
 * @fileoverview Shared test helpers: scratch folders, dead sockets, and the PID-namespace guard.
 */

import { existsSync, readFileSync } from "node:fs";
import { mkdtemp, rename, rm } from "node:fs/promises";
import net from "node:net";
import os from "node:os";
import path from "node:path";

/**
 * Tests that fork processes or send real signals only run inside a PID namespace, where a
 * wrong kill can only reach the test run's own processes. Two things must both hold:
 * - LIB_PROCESS_TEST_NAMESPACE=1 is set (the k3s-test command line sets it), and
 * - pid 1 isn't a host init (systemd, init, launchd), so this really is a separate namespace.
 * On a developer machine or a GitHub runner the namespace suite is skipped.
 */
export const IN_PID_NAMESPACE = (() => {
	if (process.platform !== "linux" || process.env.LIB_PROCESS_TEST_NAMESPACE !== "1") return false;
	try {
		const init = readFileSync("/proc/1/comm", "utf8").trim();
		return !["systemd", "init", "launchd"].includes(init);
	} catch {
		return false;
	}
})();

/** True when the tests run as root, where permission-based cases can't be produced. */
export const IS_ROOT = typeof process.getuid === "function" && process.getuid() === 0;

/**
 * Makes a short scratch folder (socket paths have to stay short) and returns it.
 * @returns {Promise<string>} The folder.
 */
export async function scratch() {
	const base = existsSync("/tmp") ? "/tmp" : os.tmpdir();
	return mkdtemp(path.join(base, "lp-"));
}

/**
 * Removes a scratch folder.
 * @param {string} dir - The folder.
 * @returns {Promise<void>}
 */
export function cleanup(dir) {
	return rm(dir, { recursive: true, force: true });
}

/**
 * Leaves a dead socket at `socketPath`: a socket file whose listener is gone, the way a
 * crashed holder leaves it. The socket is bound at a temporary name, renamed into place, and
 * then closed (closing unlinks only the temporary name, which no longer exists).
 * @param {string} socketPath - Where the dead socket should be.
 * @returns {Promise<void>}
 */
export async function makeDeadSocket(socketPath) {
	const temp = `${socketPath}.tmp`;
	const server = net.createServer();
	await new Promise((resolve, reject) => {
		server.once("error", reject);
		server.listen(temp, () => resolve(undefined));
	});
	await rename(temp, socketPath);
	await new Promise((resolve) => server.close(() => resolve(undefined)));
}
