/**
 *
 *	@Project: @cldmv/lib-process
 *	@Filename: /tests/namespace/real-processes.test.vitest.mjs
 *	@Date: 2026-11-21T10:45:49-08:00 (1795286749)
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
 * Real processes and real signals. These run only inside a PID namespace (see
 * IN_PID_NAMESPACE in tests/helpers/env.mjs), where a wrong kill can only reach this test
 * run's own processes. Run them with k3s-test:
 *
 *   k3s-test -- 'npm ci && LIB_PROCESS_TEST_NAMESPACE=1 npm test'
 */
import { spawn } from "node:child_process";
import { readdir, writeFile } from "node:fs/promises";
import path from "node:path";
import { setTimeout as sleep } from "node:timers/promises";
import { fileURLToPath } from "node:url";
import { Worker } from "node:worker_threads";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { alive, CODES, lock, safeKill } from "@cldmv/lib-process";
import { cleanup, IN_PID_NAMESPACE, scratch } from "../helpers/env.mjs";

const fixtures = fileURLToPath(new URL("../fixtures/", import.meta.url));

/**
 * Starts a fixture and resolves with the child and its first line of output.
 * @param {string} name - Fixture file name.
 * @param {string[]} args - Its arguments.
 * @returns {Promise<{ child: import("node:child_process").ChildProcess, line: string }>}
 */
function start(name, args) {
	const child = spawn(process.execPath, [path.join(fixtures, name), ...args], { stdio: ["ignore", "pipe", "inherit"] });
	return new Promise((resolve, reject) => {
		let out = "";
		child.stdout?.on("data", (chunk) => {
			out += chunk;
			const newline = out.indexOf("\n");
			if (newline !== -1) resolve({ child, line: out.slice(0, newline) });
		});
		child.once("error", reject);
		child.once("exit", (code) => reject(new Error(`${name} exited (${code}) before printing`)));
	});
}

/**
 * Runs a fixture to the end and resolves with all of its output.
 * @param {string} name - Fixture file name.
 * @param {string[]} args - Its arguments.
 * @returns {Promise<string>}
 */
function run(name, args) {
	const child = spawn(process.execPath, [path.join(fixtures, name), ...args], { stdio: ["ignore", "pipe", "inherit"] });
	let out = "";
	child.stdout.on("data", (chunk) => (out += chunk));
	return new Promise((resolve, reject) => {
		child.once("error", reject);
		child.once("exit", (code) => (code === 0 ? resolve(out) : reject(new Error(`${name} exited ${code}: ${out}`))));
	});
}

/**
 * Resolves once `child` has exited.
 * @param {import("node:child_process").ChildProcess} child
 */
const exited = (child) =>
	child.exitCode !== null || child.signalCode !== null ? Promise.resolve() : new Promise((resolve) => child.once("exit", resolve));

/**
 * Whether a pid still names a running (non-zombie) process.
 * @param {number} pid
 */
async function running(pid) {
	const { readFile } = await import("node:fs/promises");
	try {
		const stat = await readFile(`/proc/${pid}/stat`, "utf8");
		return stat.slice(stat.lastIndexOf(")") + 2, stat.lastIndexOf(")") + 3) !== "Z";
	} catch {
		return false;
	}
}

/** Waits until `pid` is no longer running, up to 5 s. */
async function gone(/** @type {number} */ pid) {
	for (let i = 0; i < 500 && (await running(pid)); i++) await sleep(10);
	return !(await running(pid));
}

describe.runIf(IN_PID_NAMESPACE)("in a PID namespace", () => {
	/** @type {string} */
	let dir;
	/** @type {import("node:child_process").ChildProcess[]} */
	let children;

	beforeEach(async () => {
		dir = await scratch();
		children = [];
	});

	afterEach(async () => {
		await safeKill(
			children.map((child) => /** @type {number} */ (child.pid)),
			{ signal: "SIGKILL" }
		);
		await Promise.all(children.map(exited));
		await cleanup(dir);
	});

	describe("alive", () => {
		it("reads a SIGKILLed holder as dead, and a new holder takes over", async () => {
			const target = path.join(dir, "run");
			const { child } = await start("hold.mjs", [target]);
			children.push(child);
			expect(await alive.check(target)).toBe("alive");
			await expect(alive.hold(target)).rejects.toMatchObject({ code: CODES.HELD });

			child.kill("SIGKILL");
			await exited(child);
			expect(await alive.check(target)).toBe("dead");

			const holder = await alive.hold(target);
			expect(await alive.check(target)).toBe("alive");
			await holder.close();
		});

		it("reads a stopped (SIGSTOP) holder as alive", async () => {
			const target = path.join(dir, "run");
			const { child } = await start("hold.mjs", [target]);
			children.push(child);
			child.kill("SIGSTOP");
			try {
				expect(await alive.check(target)).toBe("alive");
			} finally {
				child.kill("SIGCONT");
			}
		});
	});

	describe("lock", () => {
		it("takes over a SIGKILLed holder's lock without waiting", async () => {
			const lockPath = path.join(dir, "app.lock");
			const { child } = await start("lock.mjs", [lockPath]);
			children.push(child);
			await expect(lock(lockPath)).rejects.toMatchObject({ code: CODES.HELD });

			child.kill("SIGKILL");
			await exited(child);
			const held = await lock(lockPath);
			expect(await alive.check(lockPath)).toBe("alive");
			await held.release();
		});

		it("never lets two processes in at once", async () => {
			const lockPath = path.join(dir, "app.lock");
			const results = await Promise.all(Array.from({ length: 6 }, () => run("contend.mjs", [lockPath, "40"])));
			const summaries = results.map((out) => JSON.parse(out));
			expect(summaries.reduce((sum, s) => sum + s.entered, 0)).toBe(6 * 40);
			expect(summaries.reduce((sum, s) => sum + s.overlaps, 0)).toBe(0);
		});

		it("lets exactly one of many contenders take over a dead lock", async () => {
			for (let round = 0; round < 10; round++) {
				const lockPath = path.join(dir, `dead-${round}.lock`);
				const go = path.join(dir, `go-${round}`);
				const { child } = await start("lock.mjs", [lockPath]);
				child.kill("SIGKILL");
				await exited(child);
				expect(await alive.check(lockPath)).toBe("dead");

				const contenders = Array.from({ length: 8 }, () => run("takeover.mjs", [lockPath, go]));
				await sleep(150);
				await writeFile(go, "");
				const outcomes = (await Promise.all(contenders)).map((out) => out.trim());
				expect(outcomes.filter((outcome) => outcome === "won")).toHaveLength(1);
				expect(outcomes.filter((outcome) => outcome !== "won")).toEqual(Array(7).fill(CODES.HELD));
			}
		});
	});

	describe("safeKill", () => {
		it("kills a child and a grandchild", async () => {
			const { child, line } = await start("tree.mjs", []);
			children.push(child);
			const grandchild = Number(line);
			const result = await safeKill([grandchild, /** @type {number} */ (child.pid)], { signal: "SIGKILL" });
			expect(result).toEqual({ killed: [grandchild, child.pid], skipped: [] });
			await exited(child);
			expect(await gone(grandchild)).toBe(true);
		});

		it("refuses pid 0, -1, 1, a group id, itself and its ancestors, and they survive", async () => {
			const { child } = await start("hold.mjs", [path.join(dir, "run")]);
			children.push(child);
			const result = await safeKill([0, -1, 1, -(/** @type {number} */ (child.pid)), process.pid, process.ppid], { signal: "SIGKILL" });
			expect(result.killed).toEqual([]);
			expect(result.skipped.map((entry) => entry.reason)).toEqual(["invalid", "invalid", "init", "invalid", "self", "ancestor"]);
			await sleep(50);
			expect(await running(/** @type {number} */ (child.pid))).toBe(true);
			expect(await running(process.ppid)).toBe(true);
		});

		it("refuses its own worker thread's id", async () => {
			const worker = new Worker("setInterval(() => {}, 1 << 30)", { eval: true });
			await new Promise((resolve) => worker.once("online", resolve));
			try {
				const tids = (await readdir(`/proc/${process.pid}/task`)).map(Number).filter((tid) => tid !== process.pid);
				const result = await safeKill(tids, { signal: "SIGKILL" });
				expect(result.killed).toEqual([]);
				expect(new Set(result.skipped.map((entry) => entry.reason))).toEqual(new Set(["thread"]));
			} finally {
				await worker.terminate();
			}
		});

		it("kills a reparented process only when it was reported and started after `since`", async () => {
			const before = Date.now();
			await sleep(50);
			const orphan = Number(await run("orphan.mjs", []));
			try {
				expect((await safeKill([orphan])).skipped).toEqual([{ pid: orphan, reason: "not-descendant" }]);
				expect((await safeKill([orphan], { reported: { since: Date.now() + 60_000 } })).skipped).toEqual([
					{ pid: orphan, reason: "started-before" }
				]);
				expect(await running(orphan)).toBe(true);
				expect((await safeKill([orphan], { reported: { since: before }, signal: "SIGKILL" })).killed).toEqual([orphan]);
				expect(await gone(orphan)).toBe(true);
			} finally {
				await safeKill([orphan], { reported: { since: before }, signal: "SIGKILL" });
			}
		});

		it("reports a pid that exited as gone", async () => {
			const { child } = await start("hold.mjs", [path.join(dir, "run")]);
			const pid = /** @type {number} */ (child.pid);
			await safeKill([pid], { signal: "SIGKILL" });
			await exited(child);
			expect((await safeKill([pid])).skipped).toEqual([{ pid, reason: "gone" }]);
		});
	});
});
