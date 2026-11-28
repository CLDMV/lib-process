/**
 *
 *	@Project: @cldmv/lib-process
 *	@Filename: /tests/lock.test.vitest.mjs
 *	@Date: 2026-11-21T10:50:43-08:00 (1795287043)
 *	@Author: Nate Corcoran <CLDMV>
 *	@Email: <Shinrai@users.noreply.github.com>
 *	-----
 *	@Last modified by: Nate Corcoran <CLDMV> (Shinrai@users.noreply.github.com)
 *	@Last modified time: 2026-11-21T11:06:10-08:00 (1795287970)
 *	-----
 *	@Copyright: Copyright (c) 2013-2026 Catalyzed Motivation Inc. All rights reserved.
 *
 */

import { spawnSync } from "node:child_process";
import { access, mkdir, writeFile } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { alive, CODES, lock, Lock } from "@cldmv/lib-process";
import { cleanup, makeDeadSocket, scratch } from "./helpers/env.mjs";

const takeOnce = fileURLToPath(new URL("./fixtures/take-once.mjs", import.meta.url));

/**
 * Runs the take-once fixture synchronously, the way a process blocks right after releasing.
 * @param {"lock" | "hold"} how - Which API the child uses.
 * @param {string} target - The folder it takes.
 * @returns {{ status: number | null, out: string }} The child's exit status and output.
 */
const takeInChildNow = (how, target) => {
	const res = spawnSync(process.execPath, [takeOnce, how, target], { encoding: "utf8", timeout: 30_000 });
	return { status: res.status, out: res.stdout.trim() };
};

describe("lock", () => {
	/** @type {string} */
	let dir;
	/** @type {string} */
	let lockPath;
	/** @type {Lock[]} */
	let locks;

	beforeEach(async () => {
		dir = await scratch();
		lockPath = path.join(dir, "app.lock");
		locks = [];
	});

	afterEach(async () => {
		await Promise.all(locks.map((held) => held.release()));
		await cleanup(dir);
	});

	/** @param {Parameters<typeof lock>[1]} [options] */
	const take = async (options) => {
		const held = await lock(lockPath, options);
		locks.push(held);
		return held;
	};

	it("takes a free lock and releases it", async () => {
		const held = await take();
		expect(held).toBeInstanceOf(Lock);
		expect(held.path).toBe(lockPath);
		expect(held.released).toBe(false);
		expect(await alive.check(lockPath)).toBe("alive");

		await held.release();
		expect(held.released).toBe(true);
		await expect(access(lockPath)).rejects.toMatchObject({ code: "ENOENT" });
	});

	it("fails at once while another holder is alive", async () => {
		await take();
		await expect(lock(lockPath)).rejects.toMatchObject({ code: CODES.HELD });
	});

	it("gives up after `wait` when the holder stays alive", async () => {
		await take();
		const started = Date.now();
		await expect(lock(lockPath, { wait: 120, retryInterval: 20 })).rejects.toMatchObject({ code: CODES.HELD });
		expect(Date.now() - started).toBeGreaterThanOrEqual(100);
	});

	it("waits for a release", async () => {
		const first = await take();
		setTimeout(() => void first.release(), 60);
		const second = await take({ wait: 5000, retryInterval: 10 });
		expect(await alive.check(second.path)).toBe("alive");
	});

	it("takes over a dead holder's lock straight away", async () => {
		await take().then((held) => held.release());
		// Rebuild what a crashed holder leaves: the folder and a socket nobody listens on.
		await mkdir(lockPath);
		await makeDeadSocket(path.join(lockPath, alive.SOCKET_NAME));
		expect(await alive.check(lockPath)).toBe("dead");
		await take();
		expect(await alive.check(lockPath)).toBe("alive");
	});

	it("keeps the folder when something else was put in it", async () => {
		const held = await take();
		await writeFile(path.join(lockPath, "note.txt"), "mine");
		await held.release();
		await expect(access(path.join(lockPath, "note.txt"))).resolves.toBeUndefined();
		expect(await alive.check(lockPath)).toBe("unknown");
	});

	it("passes on errors other than a live holder", async () => {
		await writeFile(path.join(dir, "file"), "");
		await expect(lock(path.join(dir, "file", "x.lock"), { wait: 1000 })).rejects.toMatchObject({ code: "ENOTDIR" });
	});

	it.each([
		["", {}],
		[undefined, {}],
		["/tmp/x.lock", { wait: -1 }],
		["/tmp/x.lock", { wait: Number.NaN }],
		["/tmp/x.lock", { retryInterval: 0 }]
	])("rejects bad arguments (%j, %j)", async (target, options) => {
		await expect(lock(/** @type {any} */ (target), options)).rejects.toMatchObject({ code: CODES.INVALID_ARGUMENT });
	});

	// #6: release() bound the takeover mutex before it returned and only let it go once the
	// event loop ran again. A process that released and then blocked (spawnSync of the next
	// process) left that child waiting on the mutex until MUTEX_TIMEOUT. Now release() stops
	// holding before it returns, so the child takes the lock straight away.
	it("is free the moment release() returns, even while the releaser then blocks", async () => {
		const held = await lock(lockPath);
		const releasing = held.release();
		const { status, out } = takeInChildNow("lock", lockPath);
		await releasing;
		expect(out).toMatch(/^\d+$/);
		expect(status).toBe(0);
		expect(Number(out)).toBeLessThan(2000);
	});

	it("frees a held folder the moment close() returns, even while the holder then blocks", async () => {
		const runDir = path.join(dir, "run");
		const holder = await alive.hold(runDir);
		const closing = holder.close();
		const { status, out } = takeInChildNow("hold", runDir);
		await closing;
		expect(out).toMatch(/^\d+$/);
		expect(status).toBe(0);
		expect(Number(out)).toBeLessThan(2000);
	});

	it("leaves a newer holder's socket alone when cleanup runs after a takeover", async () => {
		const runDir = path.join(dir, "run");
		const first = await alive.hold(runDir);
		const closing = first.close();
		const second = await alive.hold(runDir);
		await closing;
		expect(await alive.check(runDir)).toBe("alive");
		await second.close();
	});
});
