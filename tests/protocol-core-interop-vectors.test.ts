import { readFile } from "node:fs/promises";
import { describe, expect, it } from "vitest";
import { RelayFrameCodec } from "../src/modules/relay-link/protocol-core/index.js";

type Expected =
  | Readonly<{ readonly kind: "decoded"; readonly canonicalWire: string }>
  | Readonly<{ readonly kind: "rejected"; readonly code: string }>
  | Readonly<{ readonly kind: "ignored"; readonly type: string }>;

type InteropVector = Readonly<{
  readonly id: string;
  readonly wire: string;
  readonly expected: Expected;
}>;

type InteropVectorDocument = Readonly<{
  readonly format: "sky-command-relay-interop-v1";
  readonly revision: 1;
  readonly vectors: readonly InteropVector[];
}>;

async function loadVectors(): Promise<InteropVectorDocument> {
  const source = await readFile(new URL("./fixtures/relay-v1-interop-vectors.json", import.meta.url), "utf8");
  return JSON.parse(source) as InteropVectorDocument;
}

describe("RelayFrameCodec relay-v1 cross-language vectors", () => {
  it("decodes and canonically re-encodes every shared accepted frame", async () => {
    const document = await loadVectors();

    expect(document.format).toBe("sky-command-relay-interop-v1");
    expect(document.revision).toBe(1);

    for (const vector of document.vectors.filter((candidate) => candidate.expected.kind === "decoded")) {
      const decoded = RelayFrameCodec.decode(new TextEncoder().encode(vector.wire));
      expect(decoded.kind, vector.id).toBe("decoded");
      if (decoded.kind !== "decoded") continue;

      const encoded = RelayFrameCodec.encode(decoded.frame);
      expect(encoded.ok, vector.id).toBe(true);
      if (!encoded.ok) continue;
      expect(new TextDecoder().decode(encoded.value), vector.id).toBe(vector.expected.canonicalWire);
    }
  });

  it("returns the vector's stable disposition for every rejected or ignored frame", async () => {
    const document = await loadVectors();

    for (const vector of document.vectors.filter((candidate) => candidate.expected.kind !== "decoded")) {
      const decoded = RelayFrameCodec.decode(new TextEncoder().encode(vector.wire));
      expect(decoded.kind, vector.id).toBe(vector.expected.kind);
      if (vector.expected.kind === "rejected" && decoded.kind === "rejected") {
        expect(decoded.error.code, vector.id).toBe(vector.expected.code);
      }
      if (vector.expected.kind === "ignored" && decoded.kind === "ignored") {
        expect(decoded.type, vector.id).toBe(vector.expected.type);
      }
    }
  });
});
