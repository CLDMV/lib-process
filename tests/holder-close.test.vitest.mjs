/**
 *
 *	@Project: @cldmv/lib-process
 *	@Filename: /tests/holder-close.test.vitest.mjs
 *	@Date: 2026-11-21T10:44:58-08:00 (1795286698)
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
 * Holder.close() around the mutex: without it the holder still stops listening and reports the
 * error, and when another process takes the folder over before the cleanup gets the mutex, the
 * cleanup leaves that newer holder's live socket alone.
 */
import path from "node:path";
import { afterEach, describe, expect, it, vi } from "vitest";
import { cleanup, scratch } from "./helpers/env.mjs";

let failMutex = false;
/** When set, the next withMutex() call waits for this promise before it runs. */
/** @type {Promise<void> | null} */
let gate = null;

vi.mock("../src/mutex.mjs", async (original) => {
	const real = /** @type {typeof import("../src/mutex.mjs")} */ (await original());
	return {
		...real,
		withMutex: (/** @type {string} */ key, /** @type {() => Promise<unknown>} */ fn, /** @type {any} */ options) => {
			if (failMutex) return Promise.reject(Object.assign(new Error("busy"), { code: "ERR_LIB_PROCESS_MUTEX_TIMEOUT" }));
			const wait = gate ?? Promise.resolve();
			gate = null;
			return wait.then(() => real.withMutex(key, fn, options));
		}
	};
});

const { hold, check } = await import("../src/alive.mjs");

describe("Holder.close without the mutex", () => {
	/** @type {string} */
	let dir;

	afterEach(async () => {
		failMutex = false;
		gate = null;
		await cleanup(dir);
	});

	it("stops listening and rethrows", async () => {
		dir = await scratch();
		const holder = await hold(path.join(dir, "run"));
		failMutex = true;
		await expect(holder.close()).rejects.toMatchObject({ code: "ERR_LIB_PROCESS_MUTEX_TIMEOUT" });
		expect(await check(path.join(dir, "run"))).not.toBe("alive");
	});

	it("leaves a newer holder's live socket alone when the cleanup runs after a takeover", async () => {
		dir = await scratch();
		const run = path.join(dir, "run");
		const first = await hold(run);
		/** @type {() => void} */
		let open = () => {};
		gate = new Promise((resolve) => (open = () => resolve(undefined)));
		// close() stops listening at once; its cleanup is the next withMutex() call, so it waits.
		const closing = first.close();
		// Meanwhile another holder takes over the now-dead socket.
		const second = await hold(run);
		open();
		await closing;
		expect(await check(run)).toBe("alive");
		await second.close();
		expect(await check(run)).not.toBe("alive");
	});
});
