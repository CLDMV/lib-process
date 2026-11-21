/**
 *
 *	@Project: @cldmv/lib-process
 *	@Filename: /src/errors.mjs
 *	@Date: 2026-11-21T10:39:57-08:00 (1795286397)
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
 * @fileoverview The error class every lib-process failure uses, and its codes.
 * @module @cldmv/lib-process/errors
 */

/**
 * Error codes thrown by lib-process. Each one is set on `error.code`.
 * @readonly
 */
export const CODES = Object.freeze({
	/** `alive.hold()` or `lock()` found a live holder already in the folder. */
	HELD: "ERR_LIB_PROCESS_HELD",
	/** The folder's socket path is longer than the platform allows for a Unix socket. */
	PATH_TOO_LONG: "ERR_LIB_PROCESS_PATH_TOO_LONG",
	/** Something other than a socket sits at the socket path, so it is left alone. */
	NOT_SOCKET: "ERR_LIB_PROCESS_NOT_SOCKET",
	/** The socket exists but its state can't be read (for example, no permission). */
	UNKNOWN_STATE: "ERR_LIB_PROCESS_UNKNOWN_STATE",
	/** The short internal mutex that serializes takeovers wasn't free in time. */
	MUTEX_TIMEOUT: "ERR_LIB_PROCESS_MUTEX_TIMEOUT",
	/** The function isn't available on this platform. */
	UNSUPPORTED_PLATFORM: "ERR_LIB_PROCESS_UNSUPPORTED_PLATFORM",
	/** `/proc` belongs to a different PID namespace than this process, so its pids can't be trusted. */
	PROC_MISMATCH: "ERR_LIB_PROCESS_PROC_MISMATCH",
	/** An argument has the wrong type or value. */
	INVALID_ARGUMENT: "ERR_LIB_PROCESS_INVALID_ARGUMENT"
});

/**
 * An error raised by lib-process. `code` is one of {@link CODES}.
 */
export class LibProcessError extends Error {
	/**
	 * @param {string} code - One of {@link CODES}.
	 * @param {string} message - What went wrong, in a sentence.
	 * @param {{ cause?: unknown }} [options] - The underlying error, when there is one.
	 */
	constructor(code, message, options) {
		super(message, options);
		this.name = "LibProcessError";
		/** @type {string} */
		this.code = code;
	}
}

/**
 * Throws {@link CODES.UNSUPPORTED_PLATFORM} unless the process runs on one of `platforms`.
 * @param {string} name - The public function's name, for the message.
 * @param {readonly string[]} platforms - The platforms the function supports.
 * @returns {void}
 */
export function assertPlatform(name, platforms) {
	if (!platforms.includes(process.platform)) {
		throw new LibProcessError(
			CODES.UNSUPPORTED_PLATFORM,
			`@cldmv/lib-process: ${name}() isn't supported on ${process.platform} (supported: ${platforms.join(", ")}).`
		);
	}
}
