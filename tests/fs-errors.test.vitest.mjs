/**
 *
 *	@Project: @cldmv/lib-process
 *	@Filename: /tests/fs-errors.test.vitest.mjs
 *	@Date: 2026-11-21T10:50:04-08:00 (1795287004)
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
 * hold() and close() when the filesystem misbehaves, with node:fs/promises partly replaced.
 */
import { readdir } from "node:fs/promises";
import path from "node:path";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { cleanup, scratch } from "./helpers/env.mjs";

/** @type {Record<string, (...args: any[]) => Promise<unknown>>} */
let overrides = {};

vi.mock("node:fs/promises", async (original) => {
	const real = /** @type {Record<string, any>} */ (await original());
	const wrapped = { ...real };
	for (const name of ["link", "mkdir", "unlink", "rmdir"])
		wrapped[name] = (/** @type {any[]} */ ...args) => (overrides[name] ?? real[name])(...args);
	return wrapped;
});

const { hold, check, holdFolder } = await import("../src/alive.mjs");

/** @param {string} code */
const fail = (code) => async () => Promise.reject(Object.assign(new Error(code), { code }));

describe("filesystem errors", () => {
	/** @type {string} */
	let dir;

	beforeEach(async () => {
		dir = await scratch();
		overrides = {};
	});

	afterEach(async () => {
		overrides = {};
		await cleanup(dir);
	});

	it("cleans up and rethrows when link() isn't possible", async () => {
		overrides.link = fail("EPERM");
		await expect(hold(path.join(dir, "run"))).rejects.toMatchObject({ code: "EPERM" });
		expect(await readdir(path.join(dir, "run"))).toEqual([]);
		expect(await check(path.join(dir, "run"))).toBe("unknown");
	});

	it("retries when the folder disappears while it's being made", async () => {
		const { mkdir } = /** @type {any} */ (await vi.importActual("node:fs/promises"));
		let calls = 0;
		overrides.mkdir = async (...args) => (++calls === 1 ? fail("ENOENT")() : mkdir(...args));
		const holder = await hold(path.join(dir, "run"));
		expect(await check(path.join(dir, "run"))).toBe("alive");
		await holder.close();
	});

	it("gives up when the folder keeps disappearing", async () => {
		overrides.mkdir = fail("ENOENT");
		await expect(hold(path.join(dir, "run"))).rejects.toMatchObject({ code: "ENOENT" });
	});

	it("passes on an unlink() error from close()", async () => {
		const holder = await hold(path.join(dir, "run"));
		overrides.unlink = fail("EPERM");
		await expect(holder.close()).rejects.toMatchObject({ code: "EPERM" });
		overrides = {};
		expect(await check(path.join(dir, "run"))).not.toBe("alive");
	});

	it("ignores a lock folder that's already gone, and passes on other rmdir() errors", async () => {
		const gone = await holdFolder(path.join(dir, "a.lock"), { removeDir: true });
		overrides.rmdir = fail("ENOENT");
		await expect(gone.close()).resolves.toBeUndefined();

		const busy = await holdFolder(path.join(dir, "b.lock"), { removeDir: true });
		overrides.rmdir = fail("EBUSY");
		await expect(busy.close()).rejects.toMatchObject({ code: "EBUSY" });
		expect(await check(path.join(dir, "b.lock"))).toBe("unknown");
	});
});
