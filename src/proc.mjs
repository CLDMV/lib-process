/**
 *
 *	@Project: @cldmv/lib-process
 *	@Filename: /src/proc.mjs
 *	@Date: 2026-11-21T10:41:49-08:00 (1795286509)
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
 * @fileoverview Reads process facts from Linux's `/proc`.
 * @module @cldmv/lib-process/proc
 */

import { readFile, readlink } from "node:fs/promises";
import { CODES, LibProcessError } from "./errors.mjs";

/**
 * Clock ticks per second in `/proc/<pid>/stat` (the kernel's USER_HZ). It is 100 on every
 * architecture Node supports; `sysconf(_SC_CLK_TCK)` isn't reachable from Node without a
 * child process, and a kill path shouldn't depend on spawning one.
 */
export const CLOCK_TICKS_PER_SECOND = 100;

/**
 * @typedef {object} ProcessInfo
 * @property {number} pid - The pid that was read.
 * @property {number} tgid - Its thread group id: the process it belongs to. Differs from
 *   `pid` when `pid` is a thread.
 * @property {number} ppid - Its parent's pid (0 for a namespace's pid 1).
 * @property {number} startTicks - When it started, in clock ticks since boot. Unique enough
 *   with `pid` to tell a reused pid from the original.
 * @property {number} startMs - When it started, as epoch milliseconds (about 10 ms precision).
 */

/**
 * Throws unless `/proc` shows this process under its own pid. When the process runs in a PID
 * namespace whose `/proc` wasn't remounted, `/proc` lists another namespace's pids, and
 * every pid read from it would point at a different process.
 * @returns {Promise<void>}
 */
export async function assertProcMatches() {
	let self;
	try {
		self = await readlink("/proc/self");
	} catch (error) {
		throw new LibProcessError(CODES.PROC_MISMATCH, "@cldmv/lib-process: /proc isn't readable, so pids can't be checked.", { cause: error });
	}
	if (self !== String(process.pid)) {
		throw new LibProcessError(
			CODES.PROC_MISMATCH,
			`@cldmv/lib-process: /proc shows this process as ${self} but its pid is ${process.pid}. /proc belongs to another PID namespace (remount it, e.g. unshare --mount-proc), so no pid from it can be trusted.`
		);
	}
}

/**
 * Works out when the system booted, as epoch milliseconds, from `/proc/uptime`.
 * @returns {Promise<number>} Boot time in epoch ms.
 */
export async function bootTimeMs() {
	const uptime = Number.parseFloat((await readFile("/proc/uptime", "utf8")).split(" ")[0]);
	return Date.now() - uptime * 1000;
}

/**
 * Parses the text of `/proc/<pid>/stat`.
 * The second field is the command name in parentheses and may itself contain spaces and
 * parentheses, so the fields after it are found from the last `)`.
 * @param {string} text - The file's contents.
 * @returns {{ ppid: number, startTicks: number }} The parent pid and start time.
 */
export function parseStat(text) {
	const fields = text.slice(text.lastIndexOf(")") + 2).split(" ");
	// After the command: state(0) ppid(1) pgrp(2) ... starttime(19); see proc(5), fields 3, 4 and 22.
	return { ppid: Number(fields[1]), startTicks: Number(fields[19]) };
}

/**
 * Reads the `Tgid:` line of `/proc/<pid>/status`.
 * @param {string} text - The file's contents.
 * @returns {number} The thread group id, or NaN when the line is missing.
 */
export function parseTgid(text) {
	const match = /^Tgid:\s*(\d+)$/m.exec(text);
	return match ? Number(match[1]) : Number.NaN;
}

/**
 * Reads one process's facts. Returns null when it no longer exists.
 * @param {number} pid - The pid to read.
 * @param {number} bootMs - Boot time from {@link bootTimeMs}.
 * @returns {Promise<ProcessInfo | null>} Its facts, or null when it is gone.
 */
export async function readProcess(pid, bootMs) {
	let stat;
	let status;
	try {
		[stat, status] = await Promise.all([readFile(`/proc/${pid}/stat`, "utf8"), readFile(`/proc/${pid}/status`, "utf8")]);
	} catch (error) {
		const code = /** @type {NodeJS.ErrnoException} */ (error).code;
		if (code === "ENOENT" || code === "ESRCH") return null;
		throw error;
	}
	const { ppid, startTicks } = parseStat(stat);
	return { pid, tgid: parseTgid(status), ppid, startTicks, startMs: bootMs + (startTicks * 1000) / CLOCK_TICKS_PER_SECOND };
}
