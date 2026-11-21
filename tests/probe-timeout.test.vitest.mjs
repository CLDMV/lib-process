/**
 *
 *	@Project: @cldmv/lib-process
 *	@Filename: /tests/probe-timeout.test.vitest.mjs
 *	@Date: 2026-11-21T11:09:41-08:00 (1795288181)
 *	@Author: Nate Corcoran <CLDMV>
 *	@Email: <Shinrai@users.noreply.github.com>
 *	-----
 *	@Last modified by: Nate Corcoran <CLDMV> (Shinrai@users.noreply.github.com)
 *	@Last modified time: 2026-11-21T11:09:43-08:00 (1795288183)
 *	-----
 *	@Copyright: Copyright (c) 2013-2026 Catalyzed Motivation Inc. All rights reserved.
 *
 */

/**
 * check() when the connect neither succeeds nor fails in time: something is bound there, so it
 * counts as alive. node:net is replaced with a socket that never answers.
 */
import { EventEmitter } from "node:events";
import net from "node:net";
import path from "node:path";
import { afterEach, describe, expect, it, vi } from "vitest";
import { cleanup, scratch } from "./helpers/env.mjs";

vi.mock("node:net", async (original) => {
	const real = /** @type {typeof import("node:net")} */ (await original());
	const silent = () => Object.assign(new EventEmitter(), { destroy: vi.fn() });
	return { ...real, default: { ...real, connect: vi.fn(silent) }, connect: vi.fn(silent) };
});

const { check, SOCKET_NAME } = await import("../src/alive.mjs");

describe("check() timeout", () => {
	/** @type {string} */
	let dir;

	afterEach(() => cleanup(dir));

	it("says alive when the connect doesn't finish in time", async () => {
		dir = await scratch();
		// A real socket file so check() gets as far as connecting (bound via the real net).
		const { makeDeadSocket } = await import("./helpers/env.mjs");
		await makeDeadSocket(path.join(dir, SOCKET_NAME));
		expect(await check(dir, { timeout: 20 })).toBe("alive");
		expect(vi.mocked(net.connect)).toHaveBeenCalledWith(path.join(dir, SOCKET_NAME));
	});
});
