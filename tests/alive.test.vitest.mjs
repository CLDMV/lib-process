/**
 *
 *	@Project: @cldmv/lib-process
 *	@Filename: /tests/alive.test.vitest.mjs
 *	@Date: 2026-11-21T10:43:47-08:00 (1795286627)
 *	@Author: Nate Corcoran <CLDMV>
 *	@Email: <Shinrai@users.noreply.github.com>
 *	-----
 *	@Last modified by: Nate Corcoran <CLDMV> (Shinrai@users.noreply.github.com)
 *	@Last modified time: 2026-11-21T11:06:10-08:00 (1795287970)
 *	-----
 *	@Copyright: Copyright (c) 2013-2026 Catalyzed Motivation Inc. All rights reserved.
 *
 */

import { chmod, lstat, mkdir, rename, symlink, writeFile } from "node:fs/promises";
import path from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { alive, CODES } from "@cldmv/lib-process";
import { cleanup, IS_ROOT, makeDeadSocket, scratch } from "./helpers/env.mjs";

const { hold, check, SOCKET_NAME, MAX_SOCKET_PATH_BYTES } = alive;

describe("alive", () => {
	/** @type {string} */
	let dir;
	/** @type {import("@cldmv/lib-process").Holder[]} */
	let holders;

	beforeEach(async () => {
		dir = await scratch();
		holders = [];
	});

	afterEach(async () => {
		await Promise.all(holders.map((holder) => holder.close()));
		await chmod(dir, 0o755).catch(() => {});
		await cleanup(dir);
	});

	/** @param {string} target */
	const held = async (target) => {
		const holder = await hold(target);
		holders.push(holder);
		return holder;
	};

	it("exposes the socket name and the platform's path limit", () => {
		expect(SOCKET_NAME).toBe("alive.sock");
		expect(MAX_SOCKET_PATH_BYTES).toBe(107);
		expect(Object.isFrozen(alive)).toBe(true);
	});

	it("says unknown for a folder that doesn't exist or has no socket", async () => {
		expect(await check(path.join(dir, "missing"))).toBe("unknown");
		expect(await check(dir)).toBe("unknown");
	});

	it("says unknown when the socket path runs through a file", async () => {
		await writeFile(path.join(dir, "file"), "");
		expect(await check(path.join(dir, "file"))).toBe("unknown");
	});

	it("says unknown when something other than a socket sits at the socket path", async () => {
		await writeFile(path.join(dir, SOCKET_NAME), "not a socket");
		expect(await check(dir)).toBe("unknown");
	});

	it("says alive while held and unknown after close", async () => {
		const holder = await held(path.join(dir, "run"));
		expect(holder.socketPath).toBe(path.join(dir, "run", SOCKET_NAME));
		expect(holder.unsupported).toBe(false);
		expect(holder.closed).toBe(false);
		expect(await check(path.join(dir, "run"))).toBe("alive");

		await holder.close();
		expect(holder.closed).toBe(true);
		expect(await check(path.join(dir, "run"))).toBe("unknown");
	});

	it("still says alive when the connect doesn't finish within the timeout", async () => {
		await held(dir);
		expect(await check(dir, { timeout: 0 })).toBe("alive");
	});

	it("returns the same promise from a second close()", async () => {
		const holder = await held(dir);
		const first = holder.close();
		expect(holder.close()).toBe(first);
		await first;
	});

	it("says dead for a socket left behind by a holder that's gone", async () => {
		await makeDeadSocket(path.join(dir, SOCKET_NAME));
		expect(await check(dir)).toBe("dead");
	});

	it("creates the folder it holds", async () => {
		const holder = await held(path.join(dir, "a", "b"));
		expect((await lstat(holder.dir)).isDirectory()).toBe(true);
	});

	it("refuses a second holder while the first is alive", async () => {
		await held(dir);
		await expect(hold(dir)).rejects.toMatchObject({ code: CODES.HELD, name: "LibProcessError" });
	});

	it("treats two spellings of one folder as the same folder", async () => {
		const real = path.join(dir, "real");
		await mkdir(real);
		await symlink(real, path.join(dir, "link"));
		const holder = await held(path.join(dir, "link"));
		expect(holder.dir).toBe(real);
		await expect(hold(real)).rejects.toMatchObject({ code: CODES.HELD });
		await expect(hold(path.join(dir, "real", "..", "real"))).rejects.toMatchObject({ code: CODES.HELD });
	});

	it("replaces a dead socket", async () => {
		await makeDeadSocket(path.join(dir, SOCKET_NAME));
		await held(dir);
		expect(await check(dir)).toBe("alive");
	});

	it("leaves a file that isn't a socket alone", async () => {
		await writeFile(path.join(dir, SOCKET_NAME), "keep me");
		await expect(hold(dir)).rejects.toMatchObject({ code: CODES.NOT_SOCKET });
	});

	it("doesn't remove a newer holder's socket on close", async () => {
		const first = await hold(dir);
		// Someone moves the first holder's socket aside; a second holder then binds a new one.
		await rename(path.join(dir, SOCKET_NAME), path.join(dir, "moved.sock"));
		await held(dir);
		await first.close();
		expect(await check(dir)).toBe("alive");
	});

	it("rejects a socket path over the platform limit", async () => {
		const long = path.join(dir, "x".repeat(MAX_SOCKET_PATH_BYTES));
		await expect(check(long)).rejects.toMatchObject({ code: CODES.PATH_TOO_LONG });
		await expect(hold(long)).rejects.toMatchObject({ code: CODES.PATH_TOO_LONG });
	});

	it("accepts a socket path exactly at the limit", async () => {
		const room = MAX_SOCKET_PATH_BYTES - Buffer.byteLength(path.join(dir, "", SOCKET_NAME)) - 1;
		const target = path.join(dir, "y".repeat(room));
		expect(Buffer.byteLength(path.join(target, SOCKET_NAME))).toBe(MAX_SOCKET_PATH_BYTES);
		await held(target);
		expect(await check(target)).toBe("alive");
	});

	describe.skipIf(IS_ROOT)("permissions", () => {
		it("says unknown when the folder can't be read", async () => {
			await held(path.join(dir, "locked"));
			await chmod(path.join(dir, "locked"), 0o000);
			try {
				expect(await check(path.join(dir, "locked"))).toBe("unknown");
			} finally {
				await chmod(path.join(dir, "locked"), 0o755);
			}
		});

		it("still closes when the socket can't be looked at, leaving it dead", async () => {
			const holder = await hold(path.join(dir, "shut"));
			await chmod(path.join(dir, "shut"), 0o000);
			try {
				await expect(holder.close()).resolves.toBeUndefined();
			} finally {
				await chmod(path.join(dir, "shut"), 0o755);
			}
			expect(await check(path.join(dir, "shut"))).toBe("dead");
		});

		it("refuses to replace a socket it can't connect to", async () => {
			await makeDeadSocket(path.join(dir, SOCKET_NAME));
			await chmod(path.join(dir, SOCKET_NAME), 0o000);
			expect(await check(dir)).toBe("unknown");
			await expect(hold(dir)).rejects.toMatchObject({ code: CODES.UNKNOWN_STATE });
		});

		it("passes on other errors from reading the socket path", async () => {
			await mkdir(path.join(dir, "sealed"));
			await chmod(path.join(dir, "sealed"), 0o000);
			try {
				await expect(hold(path.join(dir, "sealed"))).rejects.toMatchObject({ code: "EACCES" });
			} finally {
				await chmod(path.join(dir, "sealed"), 0o755);
			}
		});
	});
});
