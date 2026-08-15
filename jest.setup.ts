import "@testing-library/jest-dom";

// Polyfill TextEncoder and TextDecoder for jsdom
if (typeof TextEncoder === "undefined") {
  const { TextEncoder, TextDecoder } = require("util");
  global.TextEncoder = TextEncoder;
  global.TextDecoder = TextDecoder;
}

// Polyfill TextEncoderStream and TextDecoderStream for jsdom
// @ts-ignore
if (typeof TextEncoderStream === "undefined") {
  // @ts-ignore
  global.TextEncoderStream = class {};
}
// @ts-ignore
if (typeof TextDecoderStream === "undefined") {
  // @ts-ignore
  global.TextDecoderStream = class {};
}

// Polyfill Web Streams for jsdom
if (typeof ReadableStream === "undefined") {
  const streams = require("stream/web");
  global.ReadableStream = streams.ReadableStream;
  global.WritableStream = streams.WritableStream;
  global.TransformStream = streams.TransformStream;
}

// Polyfill structuredClone for jsdom
// @ts-ignore
if (typeof structuredClone === "undefined") {
  // @ts-ignore
  global.structuredClone = (val: any) => JSON.parse(JSON.stringify(val));
}

// Polyfill Request, Response, and Headers for Next.js 15 unit testing in jsdom
if (typeof Request === "undefined") {
  const primitives = require("next/dist/compiled/@edge-runtime/primitives");
  // @ts-ignore
  global.Request = primitives.Request;
  // @ts-ignore
  global.Response = primitives.Response;
  // @ts-ignore
  global.Headers = primitives.Headers;
}

// src/backend/queue/index.ts opens a shared BullMQ/ioredis connection at
// import time, and BullMQ never closes an externally-provided connection
// on its own. Any test file that actually loads the real module (as
// opposed to one that `jest.mock`s it away, which never populates
// require.cache under its real path) leaks that connection and blocks
// Jest from exiting. Close it here, once per test file, but only when the
// real module was genuinely loaded.
afterAll(async () => {
  let resolvedPath: string | undefined;
  try {
    resolvedPath = require.resolve("@/backend/queue");
  } catch {
    return;
  }

  if (require.cache[resolvedPath]) {
    const { closeQueueConnections } = require("@/backend/queue");
    await closeQueueConnections();
  }
});
