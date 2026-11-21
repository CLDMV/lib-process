/**
 *
 *	@Project: @cldmv/lib-process
 *	@Filename: /tests/kill-plan.test.vitest.mjs
 *	@Date: 2026-11-21T10:44:36-08:00 (1795286676)
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
 * planKill() decides which pids may be signalled. It is pure: it reads processes through the
 * function it is given and signals nothing, so these tests use a made-up process table.
 */
import { describe, expect, it } from "vitest";
import { planKill } from "../src/kill.mjs";

/**
 * Builds a reader over a fake process table.
 * @param {Record<number, { ppid: number, tgid?: number, startMs?: number }>} table - pid → facts.
 */
const reader = (table) => async (/** @type {number} */ pid) => {
	const entry = table[pid];
	if (!entry) return null;
	return { pid, tgid: entry.tgid ?? pid, ppid: entry.ppid, startTicks: pid * 10, startMs: entry.startMs ?? 1000 };
};

// 1 (init) → 10 (shell) → 20 (caller) → 30 (child) → 40 (grandchild)
//                                    ↘ 31 (child)
// 1 → 50 (unrelated, started at 500) ; 1 → 60 (orphan, started at 5000) ; 41 is a thread of 40
const TABLE = {
	1: { ppid: 0 },
	10: { ppid: 1 },
	20: { ppid: 10 },
	30: { ppid: 20 },
	31: { ppid: 20 },
	40: { ppid: 30 },
	41: { ppid: 30, tgid: 40 },
	50: { ppid: 1, startMs: 500 },
	60: { ppid: 1, startMs: 5000 },
	70: { ppid: 99 }
};

const plan = (/** @type {unknown[]} */ pids, /** @type {number} [since] */ since) =>
	planKill(pids, { self: 20, read: reader(TABLE), since });
const allowedPids = async (/** @type {unknown[]} */ pids, /** @type {number} [since] */ since) =>
	(await plan(pids, since)).allowed.map((info) => info.pid);

describe("planKill", () => {
	it("allows the caller's children and grandchildren", async () => {
		expect(await allowedPids([30, 31, 40])).toEqual([30, 31, 40]);
	});

	it.each([[0], [-1], [-20], [1.5], [Number.NaN], [Infinity], ["30"], [null], [undefined], [2 ** 53]])("never allows %p", async (pid) => {
		expect(await plan([pid])).toEqual({ allowed: [], skipped: [{ pid, reason: "invalid" }] });
	});

	it("never allows pid 1, the caller, or its ancestors", async () => {
		const { allowed, skipped } = await plan([1, 20, 10]);
		expect(allowed).toEqual([]);
		expect(skipped).toEqual([
			{ pid: 1, reason: "init" },
			{ pid: 20, reason: "self" },
			{ pid: 10, reason: "ancestor" }
		]);
	});

	it("never allows a thread id, even of a descendant", async () => {
		expect((await plan([41])).skipped).toEqual([{ pid: 41, reason: "thread" }]);
	});

	it("skips pids that don't exist", async () => {
		expect((await plan([999])).skipped).toEqual([{ pid: 999, reason: "gone" }]);
	});

	it("skips other processes without `reported`", async () => {
		expect((await plan([50, 60, 70])).skipped.map((entry) => entry.reason)).toEqual(["not-descendant", "not-descendant", "not-descendant"]);
	});

	it("with `reported`, allows other processes that started at or after `since`", async () => {
		const { allowed, skipped } = await plan([50, 60], 1000);
		expect(allowed.map((info) => info.pid)).toEqual([60]);
		expect(skipped).toEqual([{ pid: 50, reason: "started-before" }]);
		expect(await allowedPids([60], 5000)).toEqual([60]);
	});

	it("still refuses pid 1, the caller and ancestors with `reported`", async () => {
		expect(await allowedPids([1, 10, 20], 0)).toEqual([]);
	});

	it("handles each pid once", async () => {
		const { allowed, skipped } = await plan([30, 30, 0, 0]);
		expect(allowed.map((info) => info.pid)).toEqual([30]);
		expect(skipped).toEqual([{ pid: 0, reason: "invalid" }]);
	});

	it("works when the caller is its namespace's pid 1", async () => {
		const table = { 1: { ppid: 0 }, 5: { ppid: 1 }, 6: { ppid: 5 } };
		const { allowed, skipped } = await planKill([1, 5, 6], { self: 1, read: reader(table) });
		expect(allowed.map((info) => info.pid)).toEqual([5, 6]);
		expect(skipped).toEqual([{ pid: 1, reason: "init" }]);
	});

	it("stops at a parent loop instead of walking forever", async () => {
		const table = { 1: { ppid: 0 }, 20: { ppid: 1 }, 80: { ppid: 81 }, 81: { ppid: 80 } };
		expect((await planKill([80], { self: 20, read: reader(table) })).skipped).toEqual([{ pid: 80, reason: "not-descendant" }]);
	});

	it("copes with a caller whose own facts can't be read", async () => {
		expect((await planKill([30], { self: 20, read: reader({ 30: { ppid: 20 } }) })).allowed.map((info) => info.pid)).toEqual([30]);
	});
});
