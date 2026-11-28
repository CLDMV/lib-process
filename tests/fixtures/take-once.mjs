// Takes the folder in argv[3] once, with lock() or alive.hold() as argv[2] says, prints how
// long that took in ms, releases it and exits. A failure prints the error code and exits 1.
import { alive, lock } from "../../src/index.mjs";

const [, , how, target] = process.argv;
const started = Date.now();
try {
	const handle = how === "lock" ? await lock(target) : await alive.hold(target);
	process.stdout.write(`${Date.now() - started}\n`);
	await (how === "lock" ? handle.release() : handle.close());
} catch (error) {
	process.stdout.write(`${error.code ?? error.message}\n`);
	process.exit(1);
}
