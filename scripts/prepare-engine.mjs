import { mkdir, copyFile, writeFile } from "node:fs/promises";
const destination = "public/engine";
await mkdir(destination, { recursive: true });
for (const name of [
  "stockfish-19-lite-single.js",
  "stockfish-19-lite-single.wasm",
]) {
  await copyFile(
    `node_modules/stockfish/bin/${name}`,
    `${destination}/${name}`,
  );
}
await copyFile(
  "node_modules/stockfish/Copying.txt",
  `${destination}/COPYING.txt`,
);
await writeFile(
  `${destination}/SOURCE.txt`,
  "Stockfish.js 19.0.1 by Nathan Rugg and contributors. GPLv3.\nUnmodified stockfish@19.0.1 lite single-threaded build.\nCorresponding source and build instructions: https://github.com/nmrugg/stockfish.js/tree/v19.0.1\nSource archive: https://github.com/nmrugg/stockfish.js/archive/refs/tags/v19.0.1.tar.gz\n",
);
