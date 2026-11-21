/**
 *
 *	@Project: @cldmv/lib-process
 *	@Filename: /src/listen.mjs
 *	@Date: 2026-11-21T10:40:15-08:00 (1795286415)
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
 * @fileoverview Binds a listening socket that only exists to be connected to.
 * @module @cldmv/lib-process/listen
 */

import net from "node:net";

/**
 * Listens on `name` and resolves once bound. Every connection is closed straight away: a
 * successful connect is the whole message. The server doesn't keep the event loop alive,
 * and an error after it is bound is ignored (the socket is then simply gone).
 * @param {string} name - A socket path, or on Linux an abstract name starting with NUL.
 * @returns {Promise<net.Server>} The listening server.
 */
export function listen(name) {
	return new Promise((resolve, reject) => {
		const server = net.createServer((socket) => socket.destroy());
		server.once("error", reject);
		server.listen(name, () => {
			server.off("error", reject);
			/* v8 ignore next -- a bound listener has no error source we can trigger; this only keeps a stray one from crashing the process. */
			server.on("error", () => {});
			server.unref();
			resolve(server);
		});
	});
}
