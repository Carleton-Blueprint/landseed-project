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
