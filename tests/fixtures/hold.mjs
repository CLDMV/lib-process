/**
 *
 *	@Project: @cldmv/lib-process
 *	@Filename: /tests/fixtures/hold.mjs
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

// Holds the folder in argv[2], says "ready", then waits to be killed.
import { alive } from "../../src/index.mjs";

await alive.hold(process.argv[2]);
process.stdout.write("ready\n");
setInterval(() => {}, 1 << 30);
