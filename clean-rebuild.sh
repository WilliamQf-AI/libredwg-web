#!/usr/bin/env bash
set -euo pipefail
# Navigate to javascript bindings
cd bindings/javascript

echo ">>> clean"
# remove npm deps and previous build outputs
rm -rf node_modules dist build

# Ensure build-wasm is fully cleaned to avoid stale config/objects
if [ -d ../../build-wasm ]; then
	echo ">>> cleaning ../../build-wasm"
	# remove generated configure/cache and compiled objects
	rm -rf ../../build-wasm/config.status ../../build-wasm/config.log ../../build-wasm/config.cache
	rm -rf ../../build-wasm/src || true
	rm -rf ../../build-wasm/*.o ../../build-wasm/*.lo || true
else
	mkdir -p ../../build-wasm
fi

pnpm install
echo ">>> clearing emscripten cache"
emcc --clear-cache || true

echo ">>> rebuild"
# run prepare (this calls emconfigure ../configure ... as defined in package.json)
pnpm build:prepare

# ensure any old object files inside build-wasm are removed and run make clean
if [ -d ../../build-wasm ]; then
	(cd ../../build-wasm && emmake make clean || true)
fi

# build objects, wasm, copy and package
pnpm build:obj && pnpm build:wasm && pnpm copy && pnpm build
echo ">>> done"