/**
 *
 *	@Project: @cldmv/lib-process
 *	@Filename: /src/index.mjs
 *	@Date: 2026-11-21T10:42:30-08:00 (1795286550)
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
 * @fileoverview Public entry of @cldmv/lib-process.
 * @module @cldmv/lib-process
 */

import { check, hold, Holder, MAX_SOCKET_PATH_BYTES, SOCKET_NAME } from "./alive.mjs";

/**
 * Liveness through a Unix socket in a folder: `hold()` it, `check()` it from anywhere.
 */
export const alive = Object.freeze({ hold, check, SOCKET_NAME, MAX_SOCKET_PATH_BYTES });

export { Holder };
export { lock, Lock } from "./lock.mjs";
export { safeKill } from "./kill.mjs";
export { CODES, LibProcessError } from "./errors.mjs";
