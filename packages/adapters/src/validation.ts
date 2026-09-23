import { z } from "zod";
const short = z.string().max(128);
const dimension = z.number().finite().int().min(0).max(32_768).optional();
const dimensions = { width: dimension, height: dimension };
const count = z.number().finite().int().min(0).max(1_000_000);
export const payloadSchema = z.strictObject({
  signals: z.strictObject({
    userAgent: z.string().max(512).optional(),
    platform: short.optional(),
    languages: z.array(z.string().max(64)).max(20).optional(),
    timezone: short.optional(),
    screen: z
      .strictObject({
        ...dimensions,
        colorDepth: z.number().int().min(0).max(64).optional(),
        pixelRatio: z.number().finite().min(0).max(16).optional(),
      })
      .optional(),
    viewport: z.strictObject(dimensions).optional(),
    hardware: z
      .strictObject({
        hardwareConcurrency: z.number().int().min(0).max(1024).optional(),
        deviceMemory: z.number().finite().min(0).max(1024).optional(),
        maxTouchPoints: z.number().int().min(0).max(256).optional(),
      })
      .optional(),
    fonts: z
      .strictObject({
        version: z.literal("local-12-v1"),
        available: z.string().regex(/^[01]{12}$/),
      })
      .optional(),
    environment: z
      .strictObject({
        runtimeMarkerCount: z.number().int().min(0).max(8).optional(),
        webdriverOwnProperty: z.boolean().optional(),
        notificationPermission: z
          .enum(["default", "granted", "denied"])
          .optional(),
        notificationQuery: z.enum(["prompt", "granted", "denied"]).optional(),
        pageFontsLoaded: z.number().int().min(0).max(100).optional(),
        pageFontsLoading: z.number().int().min(0).max(100).optional(),
        pageFontsFailed: z.number().int().min(0).max(100).optional(),
      })
      .optional(),
    automation: z
      .strictObject({ webdriver: z.boolean().optional() })
      .optional(),
    graphics: z
      .strictObject({
        webglVendor: z.string().max(512).optional(),
        webglRenderer: z.string().max(512).optional(),
      })
      .optional(),
  }),
  behavior: z
    .strictObject({
      pageAgeMs: z.number().finite().int().min(0).max(604_800_000),
      mouseMoveCount: count,
      pointerDownCount: count,
      keyDownCount: count,
      scrollCount: count,
      visibilityChangeCount: count,
      targetSampleCount: count.optional(),
      targetCenterCount: count.optional(),
      targetCornerCount: count.optional(),
      focusChangeCount: count.optional(),
      focusSampleCount: count.optional(),
      unfocusedInputCount: count.optional(),
      decoyActivationCount: count.optional(),
      mouseDistancePx: z.number().int().min(0).max(1_000_000_000).optional(),
      mouseActiveMs: z.number().int().min(0).max(1_000_000_000).optional(),
      mouseSampleCount: count.optional(),
      mouseLargeStepCount: count.optional(),
      mouseIntervalCount: count.optional(),
      mouseIntervalMeanMs: z.number().int().min(0).max(1000).optional(),
      mouseIntervalStdDevMs: z.number().int().min(0).max(1000).optional(),
      interactionShortGapCount: count.optional(),
      interactionRepeatGapCount: count.optional(),
      interactionComparableGapCount: count.optional(),
      mouseDirectionChanges: count.optional(),
      mousePauseCount: count.optional(),
      scrollDistancePx: z.number().int().min(0).max(1_000_000_000).optional(),
      scrollDirectionChanges: count.optional(),
      interactionIntervalCount: count.optional(),
      interactionIntervalMeanMs: z.number().int().min(0).max(60_000).optional(),
      interactionIntervalStdDevMs: z
        .number()
        .int()
        .min(0)
        .max(60_000)
        .optional(),
    })
    .optional(),
  debug: z.boolean().optional(),
});
export class RequestError extends Error {
  constructor(
    readonly status: number,
    message: string,
  ) {
    super(message);
  }
}
export async function readPayload(
  request: Request,
  maxBytes: number,
  timeoutMs: number,
) {
  const contentLength = request.headers.get("content-length");
  if (
    contentLength &&
    (!/^\d+$/.test(contentLength) || Number(contentLength) > maxBytes)
  )
    throw new RequestError(413, "Request body too large");
  if (!request.body) throw new RequestError(400, "JSON body required");
  const reader = request.body.getReader();
  let size = 0;
  const chunks: Uint8Array[] = [];
  let timer: ReturnType<typeof setTimeout> | undefined;
  const deadline = new Promise<never>((_, reject) => {
    timer = setTimeout(() => {
      reject(new RequestError(408, "Request body timed out"));
      void reader.cancel().catch(() => {});
    }, timeoutMs);
  });
  try {
    while (true) {
      const { value, done } = await Promise.race([reader.read(), deadline]);
      if (done) break;
      size += value.byteLength;
      if (size > maxBytes) {
        void reader.cancel().catch(() => {});
        throw new RequestError(413, "Request body too large");
      }
      chunks.push(value);
    }
  } finally {
    clearTimeout(timer);
    reader.releaseLock();
  }
  const bytes = new Uint8Array(size);
  let offset = 0;
  for (const chunk of chunks) {
    bytes.set(chunk, offset);
    offset += chunk.byteLength;
  }
  try {
    return payloadSchema.parse(
      JSON.parse(new TextDecoder("utf-8", { fatal: true }).decode(bytes)),
    );
  } catch {
    throw new RequestError(400, "Invalid visitor payload");
  }
}
