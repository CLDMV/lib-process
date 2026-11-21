/**
 *
 *	@Project: @cldmv/lib-process
 *	@Filename: /tests/fixtures/takeover.mjs
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

// Waits until the file argv[3] exists (a start line for every contender), then tries the lock
// in argv[2] once, without waiting. Prints "won" or the error code, then stays alive briefly
// so a winner is still holding while the others try.
import { access } from "node:fs/promises";
import { setTimeout as sleep } from "node:timers/promises";
import { lock } from "../../src/index.mjs";

while (
	await access(process.argv[3]).then(
		() => false,
		() => true
	)
)
	await sleep(1);
try {
	await lock(process.argv[2]);
	process.stdout.write("won\n");
} catch (error) {
	process.stdout.write(`${error.code}\n`);
}
await sleep(500);
