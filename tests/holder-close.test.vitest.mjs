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
 * A Holder whose close() can't get the mutex still stops listening, and reports the error.
 */
import path from "node:path";
import { afterEach, describe, expect, it, vi } from "vitest";
import { cleanup, scratch } from "./helpers/env.mjs";

let failMutex = false;

vi.mock("../src/mutex.mjs", async (original) => {
	const real = /** @type {typeof import("../src/mutex.mjs")} */ (await original());
	return {
		...real,
		withMutex: (/** @type {string} */ key, /** @type {() => Promise<unknown>} */ fn, /** @type {any} */ options) =>
			failMutex
				? Promise.reject(Object.assign(new Error("busy"), { code: "ERR_LIB_PROCESS_MUTEX_TIMEOUT" }))
				: real.withMutex(key, fn, options)
	};
});

const { hold, check } = await import("../src/alive.mjs");

describe("Holder.close without the mutex", () => {
	/** @type {string} */
	let dir;

	afterEach(async () => {
		failMutex = false;
		await cleanup(dir);
	});

	it("stops listening and rethrows", async () => {
		dir = await scratch();
		const holder = await hold(path.join(dir, "run"));
		failMutex = true;
		await expect(holder.close()).rejects.toMatchObject({ code: "ERR_LIB_PROCESS_MUTEX_TIMEOUT" });
		expect(await check(path.join(dir, "run"))).not.toBe("alive");
	});
});
