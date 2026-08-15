import { readFile, writeFile } from "node:fs/promises";
import {
  Uint8ArrayReader,
  Uint8ArrayWriter,
  ZipReader,
  ZipWriter
} from "@zip.js/zip.js";

const source = new Uint8Array(await readFile(new URL("./wayline-hangzhou-orbit.kmz", import.meta.url)));
const reader = new ZipReader(new Uint8ArrayReader(source), {
  checkSignature: true,
  strictness: "strict"
});
const entries = await reader.getEntries();
const documents = new Map();
for (const entry of entries) {
  if (entry.directory || (entry.filename !== "template.kml" && entry.filename !== "waylines.wpml")) continue;
  documents.set(entry.filename, await entry.getData(new Uint8ArrayWriter()));
}
await reader.close();

const output = new Uint8ArrayWriter();
const writer = new ZipWriter(output);
const fixedDate = new Date("2020-01-01T00:00:00.000Z");
for (const name of ["template.kml", "waylines.wpml"]) {
  const bytes = documents.get(name);
  if (bytes === undefined) throw new Error(`Missing ${name} in source fixture`);
  await writer.add(`wpmz/${name}`, new Uint8ArrayReader(bytes), {
    level: 0,
    lastModDate: fixedDate
  });
}
const canonical = await writer.close();
await writeFile(new URL("./dji-canonical-hangzhou-orbit.kmz", import.meta.url), canonical);
