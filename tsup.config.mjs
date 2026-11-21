/**
 *
 *	@Project: @cldmv/lib-process
 *	@Filename: /tsup.config.mjs
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
 * @fileoverview Bundler config: builds dist/ from src/.
 *
 * One self-contained ESM bundle, dist/index.mjs. The CommonJS entry isn't built: src/index.cjs
 * is a thin require(esm) wrapper around its sibling index.mjs, and onSuccess copies it verbatim
 * into dist/, so the library never exists twice.
 */
import { copyFileSync } from "node:fs";
import { join } from "node:path";
import { defineConfig } from "tsup";

export default defineConfig({
	entry: { index: "src/index.mjs" },
	format: ["esm"],
	outDir: "dist",
	target: "node20",
	platform: "node",
	splitting: false,
	sourcemap: true,
	dts: false,
	minify: true,
	// Keep function and class names through minification (LibProcessError.name, stack traces).
	keepNames: true,
	// Keep `node:` specifiers on built-in imports (tsup strips them by default).
	removeNodeProtocol: false,
	clean: true,
	outExtension() {
		return { js: ".mjs" };
	},
	// tsup calls this on the resolved options, so `this.outDir` is the directory the build wrote to.
	onSuccess() {
		copyFileSync("src/index.cjs", join(this.outDir, "index.cjs"));
	}
});
