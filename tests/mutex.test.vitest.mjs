/**
 *
 *	@Project: @cldmv/lib-process
 *	@Filename: /tests/mutex.test.vitest.mjs
 *	@Date: 2026-11-21T10:44:12-08:00 (1795286652)
 *	@Author: Nate Corcoran <CLDMV>
 *	@Email: <Shinrai@users.noreply.github.com>
 *	-----
 *	@Last modified by: Nate Corcoran <CLDMV> (Shinrai@users.noreply.github.com)
 *	@Last modified time: 2026-11-21T11:06:10-08:00 (1795287970)
 *	-----
 *	@Copyright: Copyright (c) 2013-2026 Catalyzed Motivation Inc. All rights reserved.
 *
 */

import { setTimeout as sleep } from "node:timers/promises";
import { afterEach, describe, expect, it, vi } from "vitest";
import { CODES } from "../src/errors.mjs";

describe("withMutex", () => {
	afterEach(() => {
		vi.doUnmock("../src/listen.mjs");
		vi.resetModules();
	});

	it("runs one critical section at a time per key", async () => {
		const { withMutex } = await import("../src/mutex.mjs");
		/** @type {string[]} */
		const order = [];
		const section = (/** @type {string} */ name) =>
			withMutex("key-a", async () => {
				order.push(`${name}:in`);
				await sleep(30);
				order.push(`${name}:out`);
				return name;
			});
		expect(await Promise.all([section("one"), section("two")])).toEqual(["one", "two"]);
		expect(order).toEqual(["one:in", "one:out", "two:in", "two:out"]);
	});

	it("doesn't make different keys wait for each other", async () => {
		const { withMutex } = await import("../src/mutex.mjs");
		/** @type {string[]} */
		const order = [];
		await Promise.all([
			withMutex("key-b", async () => {
				order.push("b:in");
				await sleep(40);
				order.push("b:out");
			}),
			withMutex("key-c", async () => {
				order.push("c:in");
			})
		]);
		expect(order.indexOf("c:in")).toBeLessThan(order.indexOf("b:out"));
	});

	it("frees the mutex when the section throws", async () => {
		const { withMutex } = await import("../src/mutex.mjs");
		await expect(withMutex("key-d", async () => Promise.reject(new Error("boom")))).rejects.toThrow("boom");
		expect(await withMutex("key-d", async () => "free")).toBe("free");
	});

	it("times out when the mutex stays taken", async () => {
		const { withMutex } = await import("../src/mutex.mjs");
		let release = () => {};
		const holding = withMutex("key-e", () => new Promise((resolve) => (release = () => resolve(undefined))));
		await sleep(10);
		await expect(withMutex("key-e", async () => "never", { timeout: 50 })).rejects.toMatchObject({ code: CODES.MUTEX_TIMEOUT });
		release();
		await holding;
	});

	it("passes on bind errors other than a taken name", async () => {
		vi.doMock("../src/listen.mjs", () => ({
			listen: () => Promise.reject(Object.assign(new Error("denied"), { code: "EACCES" }))
		}));
		const { withMutex } = await import("../src/mutex.mjs");
		await expect(withMutex("key-f", async () => "never")).rejects.toMatchObject({ code: "EACCES" });
	});
});
