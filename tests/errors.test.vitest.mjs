/**
 *
 *	@Project: @cldmv/lib-process
 *	@Filename: /tests/errors.test.vitest.mjs
 *	@Date: 2026-11-21T10:45:19-08:00 (1795286719)
 *	@Author: Nate Corcoran <CLDMV>
 *	@Email: <Shinrai@users.noreply.github.com>
 *	-----
 *	@Last modified by: Nate Corcoran <CLDMV> (Shinrai@users.noreply.github.com)
 *	@Last modified time: 2026-11-21T11:06:10-08:00 (1795287970)
 *	-----
 *	@Copyright: Copyright (c) 2013-2026 Catalyzed Motivation Inc. All rights reserved.
 *
 */

import { describe, expect, it } from "vitest";
import { CODES, LibProcessError } from "@cldmv/lib-process";
import { assertPlatform } from "../src/errors.mjs";

describe("errors", () => {
	it("carries a code, a name and a cause", () => {
		const cause = new Error("under");
		const error = new LibProcessError(CODES.HELD, "held", { cause });
		expect(error).toBeInstanceOf(Error);
		expect(error).toMatchObject({ name: "LibProcessError", code: "ERR_LIB_PROCESS_HELD", message: "held", cause });
	});

	it("has frozen codes", () => {
		expect(Object.isFrozen(CODES)).toBe(true);
		expect(Object.values(CODES).every((code) => code.startsWith("ERR_LIB_PROCESS_"))).toBe(true);
	});

	it("passes on a supported platform and throws on another", () => {
		expect(() => assertPlatform("thing", [process.platform])).not.toThrow();
		expect(() => assertPlatform("thing", ["plan9"])).toThrow(expect.objectContaining({ code: CODES.UNSUPPORTED_PLATFORM }));
	});
});
