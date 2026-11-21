/**
 *
 *	@Project: @cldmv/lib-process
 *	@Filename: /tests/kill-mocked.test.vitest.mjs
 *	@Date: 2026-11-21T10:44:54-08:00 (1795286694)
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
 * safeKill() with /proc and process.kill() both replaced, so nothing real is read or signalled.
 * The real thing runs in tests/namespace/, inside a PID namespace only.
 */
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

/** @type {Map<number, { ppid: number, startTicks: number, startMs: number }>} */
const table = new Map();
/** @type {Map<number, number>} start ticks returned on the second read, to fake a reused pid */
const replacedOnRecheck = new Map();
const reads = new Map();

vi.mock("../src/proc.mjs", () => ({
	assertProcMatches: vi.fn(async () => {}),
	bootTimeMs: vi.fn(async () => 0),
	readProcess: vi.fn(async (/** @type {number} */ pid) => {
		const entry = table.get(pid);
		if (!entry) return null;
		const count = (reads.get(pid) ?? 0) + 1;
		reads.set(pid, count);
		const startTicks = count > 1 && replacedOnRecheck.has(pid) ? /** @type {number} */ (replacedOnRecheck.get(pid)) : entry.startTicks;
		if (count > 1 && replacedOnRecheck.get(pid) === -1) return null;
		return { pid, tgid: pid, ppid: entry.ppid, startTicks, startMs: entry.startMs };
	})
}));

const { safeKill } = await import("../src/kill.mjs");
const { CODES } = await import("../src/errors.mjs");

const SELF = process.pid;

describe("safeKill (mocked)", () => {
	/** @type {import("vitest").MockInstance} */
	let kill;

	beforeEach(() => {
		table.clear();
		replacedOnRecheck.clear();
		reads.clear();
		table.set(SELF, { ppid: 0, startTicks: 1, startMs: 0 });
		table.set(100001, { ppid: SELF, startTicks: 2, startMs: 10 });
		table.set(100002, { ppid: SELF, startTicks: 3, startMs: 10 });
		table.set(100003, { ppid: 1, startTicks: 4, startMs: 5000 });
		kill = vi.spyOn(process, "kill").mockImplementation(() => true);
	});

	afterEach(() => {
		kill.mockRestore();
	});

	it("signals descendants with SIGTERM by default", async () => {
		expect(await safeKill([100001, 100002])).toEqual({ killed: [100001, 100002], skipped: [] });
		expect(kill.mock.calls).toEqual([
			[100001, "SIGTERM"],
			[100002, "SIGTERM"]
		]);
	});

	it("passes the signal through, by name or number", async () => {
		await safeKill([100001], { signal: "SIGKILL" });
		await safeKill(new Set([100002]), { signal: 0 });
		expect(kill.mock.calls).toEqual([
			[100001, "SIGKILL"],
			[100002, 0]
		]);
	});

	it("never signals what it skips", async () => {
		const result = await safeKill([0, -1, 1, SELF, 100003, 424242]);
		expect(result.killed).toEqual([]);
		expect(result.skipped.map((entry) => entry.reason)).toEqual(["invalid", "invalid", "init", "self", "not-descendant", "gone"]);
		expect(kill).not.toHaveBeenCalled();
	});

	it("takes `reported.since` as a Date or as epoch ms", async () => {
		expect((await safeKill([100003], { reported: { since: new Date(4000) } })).killed).toEqual([100003]);
		reads.clear();
		expect((await safeKill([100003], { reported: { since: 6000 } })).skipped).toEqual([{ pid: 100003, reason: "started-before" }]);
	});

	it("skips a pid that exited before the signal", async () => {
		replacedOnRecheck.set(100001, -1);
		expect(await safeKill([100001])).toEqual({ killed: [], skipped: [{ pid: 100001, reason: "gone" }] });
		expect(kill).not.toHaveBeenCalled();
	});

	it("skips a pid that was reused before the signal", async () => {
		replacedOnRecheck.set(100001, 999);
		expect(await safeKill([100001])).toEqual({ killed: [], skipped: [{ pid: 100001, reason: "gone" }] });
		expect(kill).not.toHaveBeenCalled();
	});

	it.each([
		["ESRCH", "gone"],
		["EPERM", "denied"]
	])("reports %s from kill() as %s", async (code, reason) => {
		kill.mockImplementation(() => {
			throw Object.assign(new Error(code), { code });
		});
		expect(await safeKill([100001])).toEqual({ killed: [], skipped: [{ pid: 100001, reason }] });
	});

	it("passes on other errors from kill()", async () => {
		kill.mockImplementation(() => {
			throw Object.assign(new Error("odd"), { code: "EINVAL" });
		});
		await expect(safeKill([100001])).rejects.toMatchObject({ code: "EINVAL" });
	});

	it.each([null, undefined, 5, "1,2", {}])("rejects %p as the pid list", async (pids) => {
		await expect(safeKill(/** @type {any} */ (pids))).rejects.toMatchObject({ code: CODES.INVALID_ARGUMENT });
	});

	it.each(["SIGNOPE", -1, 1.5, null, {}])("rejects the signal %p", async (signal) => {
		await expect(safeKill([], { signal: /** @type {any} */ (signal) })).rejects.toMatchObject({ code: CODES.INVALID_ARGUMENT });
	});

	it.each([{}, { since: "yesterday" }, { since: Number.NaN }, { since: new Date(Number.NaN) }, null])(
		"rejects reported %p",
		async (reported) => {
			await expect(safeKill([], { reported: /** @type {any} */ (reported) })).rejects.toMatchObject({ code: CODES.INVALID_ARGUMENT });
		}
	);
});
