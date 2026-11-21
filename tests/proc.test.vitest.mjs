/**
 *
 *	@Project: @cldmv/lib-process
 *	@Filename: /tests/proc.test.vitest.mjs
 *	@Date: 2026-11-21T10:44:21-08:00 (1795286661)
 *	@Author: Nate Corcoran <CLDMV>
 *	@Email: <Shinrai@users.noreply.github.com>
 *	-----
 *	@Last modified by: Nate Corcoran <CLDMV> (Shinrai@users.noreply.github.com)
 *	@Last modified time: 2026-11-21T11:06:10-08:00 (1795287970)
 *	-----
 *	@Copyright: Copyright (c) 2013-2026 Catalyzed Motivation Inc. All rights reserved.
 *
 */

import { afterEach, describe, expect, it, vi } from "vitest";
import { CODES } from "../src/errors.mjs";
import { assertProcMatches, bootTimeMs, CLOCK_TICKS_PER_SECOND, parseStat, parseTgid, readProcess } from "../src/proc.mjs";

describe("proc", () => {
	afterEach(() => {
		vi.doUnmock("node:fs/promises");
		vi.resetModules();
	});

	it("parses stat lines, including command names with spaces and parentheses", () => {
		const fields = Array.from({ length: 50 }, (_, index) => String(index));
		fields[1] = "4321"; // ppid
		fields[19] = "987654"; // starttime
		expect(parseStat(`77 (weird) name (x)) S ${fields.slice(1).join(" ")}`)).toEqual({ ppid: 4321, startTicks: 987654 });
	});

	it("reads the Tgid line, or NaN without one", () => {
		expect(parseTgid("Name:\tnode\nTgid:\t123\nPid:\t124\n")).toBe(123);
		expect(parseTgid("Name:\tnode\n")).toBeNaN();
	});

	it("reads this process", async () => {
		const boot = await bootTimeMs();
		expect(boot).toBeLessThan(Date.now());
		const self = await readProcess(process.pid, boot);
		expect(self).toMatchObject({ pid: process.pid, tgid: process.pid, ppid: process.ppid });
		// The start time agrees with when Node says this process began, give or take the tick size.
		expect(Math.abs((self?.startMs ?? 0) - performance.timeOrigin)).toBeLessThan(2000);
		expect(CLOCK_TICKS_PER_SECOND).toBe(100);
	});

	it("returns null for a pid that doesn't exist", async () => {
		expect(await readProcess(2 ** 30, await bootTimeMs())).toBeNull();
	});

	it("accepts a /proc that matches this process", async () => {
		await expect(assertProcMatches()).resolves.toBeUndefined();
	});

	it("rejects a /proc from another PID namespace", async () => {
		vi.doMock("node:fs/promises", async (original) => ({ ...(await original()), readlink: async () => "1" }));
		const proc = await import("../src/proc.mjs");
		await expect(proc.assertProcMatches()).rejects.toMatchObject({ code: CODES.PROC_MISMATCH });
	});

	it("rejects a /proc it can't read", async () => {
		vi.doMock("node:fs/promises", async (original) => ({
			...(await original()),
			readlink: async () => Promise.reject(Object.assign(new Error("nope"), { code: "ENOENT" }))
		}));
		const proc = await import("../src/proc.mjs");
		await expect(proc.assertProcMatches()).rejects.toMatchObject({ code: CODES.PROC_MISMATCH });
	});

	it.each(["ESRCH", "EACCES"])("treats %s from /proc as gone only when it means gone", async (code) => {
		vi.doMock("node:fs/promises", async (original) => ({
			...(await original()),
			readFile: async () => Promise.reject(Object.assign(new Error(code), { code }))
		}));
		const proc = await import("../src/proc.mjs");
		if (code === "ESRCH") expect(await proc.readProcess(5, 0)).toBeNull();
		else await expect(proc.readProcess(5, 0)).rejects.toMatchObject({ code });
	});
});
