/**
 *
 *	@Project: @cldmv/lib-process
 *	@Filename: /tests/fixtures/contend.mjs
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

// Contends for the lock in argv[2] argv[3] times. Inside the lock it creates a marker file
// with O_EXCL: if another process were inside at the same time the create would fail.
// Prints a JSON summary: { entered, overlaps }.
import { open, unlink } from "node:fs/promises";
import path from "node:path";
import { setTimeout as sleep } from "node:timers/promises";
import { lock } from "../../src/index.mjs";

const [lockPath, rounds] = [process.argv[2], Number(process.argv[3])];
const marker = path.join(path.dirname(lockPath), "inside");
let entered = 0;
let overlaps = 0;
for (let round = 0; round < rounds; round++) {
	const held = await lock(lockPath, { wait: 60_000, retryInterval: 1 });
	try {
		const handle = await open(marker, "wx").catch(() => null);
		if (!handle) overlaps++;
		entered++;
		await sleep(Math.random() * 3);
		if (handle) {
			await handle.close();
			await unlink(marker);
		}
	} finally {
		await held.release();
	}
}
process.stdout.write(JSON.stringify({ entered, overlaps }) + "\n");
