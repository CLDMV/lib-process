/**
 *
 *	@Project: @cldmv/lib-process
 *	@Filename: /tests/fixtures/orphan.mjs
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

// Spawns a detached grandchild that sleeps, prints its pid, and exits, so the grandchild is
// reparented away from the test process.
import { spawn } from "node:child_process";

const grandchild = spawn(process.execPath, ["-e", "setInterval(() => {}, 1 << 30)"], { stdio: "ignore", detached: true });
grandchild.unref();
process.stdout.write(`${grandchild.pid}\n`);
