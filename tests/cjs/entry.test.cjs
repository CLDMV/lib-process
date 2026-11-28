/**
 *
 *	@Project: @cldmv/lib-process
 *	@Filename: /tests/cjs/entry.test.cjs
 *	@Date: 2026-11-21T10:46:15-08:00 (1795286775)
 *	@Author: Nate Corcoran <CLDMV>
 *	@Email: <Shinrai@users.noreply.github.com>
 *	-----
 *	@Last modified by: Nate Corcoran <CLDMV> (Shinrai@users.noreply.github.com)
 *	@Last modified time: 2026-11-21T11:06:10-08:00 (1795287970)
 *	-----
 *	@Copyright: Copyright (c) 2013-2026 Catalyzed Motivation Inc. All rights reserved.
 *
 */

"use strict";

// Checks the build itself (run by `npm run test:cjs` after `npm run build`): dist/index.cjs is a
// thin wrapper that re-exports dist/index.mjs, and the package's export targets exist.

const { test } = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const { pathToFileURL } = require("node:url");

const root = path.resolve(__dirname, "../..");
const dist = path.join(root, "dist");
const pkg = require(path.join(root, "package.json"));

const NAMES = ["CODES", "Holder", "LibProcessError", "Lock", "alive", "lock", "safeKill"];

test("dist/index.cjs re-exports dist/index.mjs", async () => {
	const esm = await import(pathToFileURL(path.join(dist, "index.mjs")).href);
	const cjs = require(path.join(dist, "index.cjs"));
	// require(esm) adds an `__esModule` marker to the namespace it returns.
	const cjsNames = Object.keys(cjs)
		.filter((key) => key !== "__esModule")
		.sort();
	assert.deepEqual(cjsNames, NAMES);
	assert.deepEqual(Object.keys(esm).sort(), NAMES);
	for (const name of NAMES) assert.equal(cjs[name], esm[name], `${name} is a different value`);
});

test("src/index.cjs is the generic shim: require() returns the module object, same keys and values as import", async () => {
	const esm = await import(pathToFileURL(path.join(root, "src", "index.mjs")).href);
	const cjs = require(path.join(root, "src", "index.cjs"));
	assert.equal(typeof cjs, "object");
	assert.deepEqual(
		Object.keys(cjs)
			.filter((key) => key !== "__esModule")
			.sort(),
		Object.keys(esm).sort()
	);
	for (const name of NAMES) assert.equal(cjs[name], esm[name], `${name} is a different value`);
});

test("dist/index.cjs is the verbatim copy of src/index.cjs", () => {
	assert.equal(fs.readFileSync(path.join(dist, "index.cjs"), "utf8"), fs.readFileSync(path.join(root, "src", "index.cjs"), "utf8"));
});

test("every export target exists", () => {
	const target = pkg.exports["."];
	for (const condition of ["import", "require"]) {
		assert.ok(fs.existsSync(path.join(root, target[condition])), `${target[condition]} is missing`);
		assert.ok(fs.existsSync(path.join(root, target["lib-process-dev"][condition])), `dev ${condition} is missing`);
	}
});

test("the package name resolves through require() with the dev condition", () => {
	// npm run test:cjs passes --conditions=lib-process-dev, so this is src/index.cjs.
	const viaName = require("@cldmv/lib-process");
	assert.equal(typeof viaName.alive.check, "function");
	assert.equal(typeof viaName.safeKill, "function");
});
