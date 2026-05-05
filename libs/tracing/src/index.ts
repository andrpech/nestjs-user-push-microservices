// `@app/tracing` is a side-effect-only library. Apps `import '@app/tracing/register'`
// at the top of main.ts to start the OpenTelemetry SDK before other modules load.

// Lib version — exported so tsc has something to emit and oxlint doesn't choke
// on `export {}`.
export const TRACING_LIB_VERSION = '0.1.0'
