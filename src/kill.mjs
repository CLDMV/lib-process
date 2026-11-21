/**
 *
 *	@Project: @cldmv/lib-process
 *	@Filename: /src/kill.mjs
 *	@Date: 2026-11-21T10:42:14-08:00 (1795286534)
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
 * @fileoverview A kill that only reaches the caller's own processes.
 * @module @cldmv/lib-process/kill
 *
 * @description
 * `process.kill(pid)` trusts the pid. A pid read from a stale file may belong to someone else
 * by now; a computed one may be 0 or negative (a whole process group) or -1 (every process
 * the user owns). `safeKill()` checks every pid before signalling it and skips the ones it
 * can't prove are safe, saying why.
 *
 * Never signalled: anything that isn't a positive integer (0, negative and group ids, -1),
 * pid 1, the caller itself, any of the caller's ancestors, and threads (a thread id would
 * signal its whole process). Signalled: the caller's descendants, and, only when the caller
 * passes `reported`, other processes that started at or after `reported.since` (for example
 * a grandchild that was reparented when its parent exited, and whose pid a child reported).
 * Right before each signal the process's start time is read again, so a pid that was reused
 * in the meantime isn't signalled.
 */

import os from "node:os";
import { assertPlatform, CODES, LibProcessError } from "./errors.mjs";
import { assertProcMatches, bootTimeMs, readProcess } from "./proc.mjs";

/** The longest parent chain followed before giving up. */
const MAX_DEPTH = 4096;

/**
 * Why a pid was skipped.
 * @typedef {"invalid" | "init" | "self" | "ancestor" | "thread" | "gone" | "not-descendant" | "started-before" | "denied"} SkipReason
 */

/**
 * @typedef {object} KillResult
 * @property {number[]} killed - Pids that were sent the signal.
 * @property {{ pid: unknown, reason: SkipReason }[]} skipped - Pids that weren't, and why.
 */

/**
 * @typedef {object} PlanOptions
 * @property {number} self - The caller's pid.
 * @property {(pid: number) => Promise<import("./proc.mjs").ProcessInfo | null>} read - Reads a process's facts.
 * @property {number} [since] - Epoch ms; with it, non-descendants that started at or after it are allowed.
 */

/**
 * Collects the caller's ancestors' pids.
 * @param {number} self - The caller's pid.
 * @param {PlanOptions["read"]} read - Reads a process's facts.
 * @returns {Promise<Set<number>>} Every ancestor's pid.
 */
async function ancestorsOf(self, read) {
	const ancestors = new Set();
	let info = await read(self);
	for (let depth = 0; info && info.ppid > 0 && depth < MAX_DEPTH; depth++) {
		ancestors.add(info.ppid);
		info = await read(info.ppid);
	}
	return ancestors;
}

/**
 * Whether the process `info` describes has `self` somewhere up its parent chain.
 * @param {import("./proc.mjs").ProcessInfo} info - The candidate.
 * @param {number} self - The caller's pid.
 * @param {PlanOptions["read"]} read - Reads a process's facts.
 * @returns {Promise<boolean>} True for a descendant of `self`.
 */
async function isDescendant(info, self, read) {
	let ppid = info.ppid;
	for (let depth = 0; ppid > 0 && depth < MAX_DEPTH; depth++) {
		if (ppid === self) return true;
		// Reaching pid 1 means the chain left the caller's subtree (orphans are reparented to it).
		if (ppid === 1) return false;
		const parent = await read(ppid);
		if (!parent) return false;
		ppid = parent.ppid;
	}
	return false;
}

/**
 * Decides, without signalling anything, which pids may be signalled.
 * @param {unknown[]} pids - The candidates.
 * @param {PlanOptions} options - Who the caller is and how to read processes.
 * @returns {Promise<{ allowed: import("./proc.mjs").ProcessInfo[], skipped: KillResult["skipped"] }>} The decision.
 */
export async function planKill(pids, { self, read, since }) {
	const ancestors = await ancestorsOf(self, read);
	/** @type {import("./proc.mjs").ProcessInfo[]} */
	const allowed = [];
	/** @type {KillResult["skipped"]} */
	const skipped = [];
	const seen = new Set();

	for (const pid of pids) {
		if (seen.has(pid)) continue;
		seen.add(pid);
		/** @param {SkipReason} reason */
		const skip = (reason) => skipped.push({ pid, reason });

		if (typeof pid !== "number" || !Number.isSafeInteger(pid) || pid <= 0) {
			skip("invalid");
			continue;
		}
		if (pid === 1) {
			skip("init");
			continue;
		}
		if (pid === self) {
			skip("self");
			continue;
		}
		if (ancestors.has(pid)) {
			skip("ancestor");
			continue;
		}
		const info = await read(pid);
		if (!info) {
			skip("gone");
			continue;
		}
		if (info.tgid !== pid) {
			skip("thread");
			continue;
		}
		if (await isDescendant(info, self, read)) {
			allowed.push(info);
			continue;
		}
		if (since === undefined) skip("not-descendant");
		else if (info.startMs >= since) allowed.push(info);
		else skip("started-before");
	}
	return { allowed, skipped };
}

/**
 * Checks `signal` is a signal name or number Node knows.
 * @param {unknown} signal - The signal to check.
 * @returns {string | number} The signal.
 */
function validateSignal(signal) {
	if (typeof signal === "string" && Object.hasOwn(os.constants.signals, signal)) return signal;
	if (typeof signal === "number" && Number.isInteger(signal) && signal >= 0) return signal;
	throw new LibProcessError(CODES.INVALID_ARGUMENT, `@cldmv/lib-process: safeKill() got an unknown signal ${String(signal)}.`);
}

/**
 * Reads `reported.since` as epoch ms.
 * @param {unknown} reported - The `reported` option.
 * @returns {number | undefined} The cutoff, or undefined without `reported`.
 */
function validateSince(reported) {
	if (reported === undefined) return undefined;
	const since = /** @type {{ since?: unknown }} */ (reported)?.since;
	const ms = since instanceof Date ? since.getTime() : since;
	if (typeof ms !== "number" || !Number.isFinite(ms)) {
		throw new LibProcessError(
			CODES.INVALID_ARGUMENT,
			"@cldmv/lib-process: safeKill() `reported.since` must be a Date or epoch milliseconds."
		);
	}
	return ms;
}

/**
 * Sends `signal` to each pid in `pids` that is provably safe to signal, and skips the rest.
 * Linux only: it reads `/proc`, and refuses to run when `/proc` belongs to another PID
 * namespace (an `unshare -p` without `--mount-proc`).
 *
 * @param {Iterable<number>} pids - The processes to signal.
 * @param {object} [options]
 * @param {string | number} [options.signal="SIGTERM"] - Signal name or number.
 * @param {{ since: Date | number }} [options.reported] - Also allow pids that aren't the
 *   caller's descendants when they started at or after `since`. Without it only descendants
 *   are signalled.
 * @returns {Promise<KillResult>} Which pids got the signal and which were skipped, with reasons.
 * @throws {LibProcessError} `ERR_LIB_PROCESS_UNSUPPORTED_PLATFORM` off Linux,
 *   `ERR_LIB_PROCESS_PROC_MISMATCH` when `/proc` can't be trusted,
 *   `ERR_LIB_PROCESS_INVALID_ARGUMENT` for a bad signal or `reported.since`.
 * @example
 * const started = Date.now();
 * // ... spawn workers; one of them reports a grandchild's pid ...
 * const { killed, skipped } = await safeKill([worker.pid, reportedPid], { reported: { since: started } });
 */
export async function safeKill(pids, { signal = "SIGTERM", reported } = {}) {
	assertPlatform("safeKill", ["linux"]);
	if (pids === null || typeof pids !== "object" || typeof (/** @type {any} */ (pids)[Symbol.iterator]) !== "function") {
		throw new LibProcessError(CODES.INVALID_ARGUMENT, "@cldmv/lib-process: safeKill() needs an array (or other iterable) of pids.");
	}
	const validSignal = validateSignal(signal);
	const since = validateSince(reported);
	await assertProcMatches();

	const bootMs = await bootTimeMs();
	/** @param {number} pid */
	const read = (pid) => readProcess(pid, bootMs);
	const { allowed, skipped } = await planKill([...pids], { self: process.pid, read, since });

	/** @type {number[]} */
	const killed = [];
	for (const info of allowed) {
		// Read it again right before signalling: if the pid now belongs to a process that
		// started at another time, the original is gone and the pid was reused.
		const now = await read(info.pid);
		if (!now || now.startTicks !== info.startTicks) {
			skipped.push({ pid: info.pid, reason: "gone" });
			continue;
		}
		try {
			process.kill(info.pid, validSignal);
			killed.push(info.pid);
		} catch (error) {
			const code = /** @type {NodeJS.ErrnoException} */ (error).code;
			if (code === "ESRCH") skipped.push({ pid: info.pid, reason: "gone" });
			else if (code === "EPERM") skipped.push({ pid: info.pid, reason: "denied" });
			else throw error;
		}
	}
	return { killed, skipped };
}
