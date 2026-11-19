// The test page's script: the SSH core as the browser build carries it, where the tests reach it.
import * as ssh from "../src/ssh.ts";

Object.assign(globalThis, { ssh });
