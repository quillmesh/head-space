// Textdateien, die beim Bauen eingebunden werden (Bun: import … with { type: 'text' })
declare module '*.md' { const text: string; export default text; }
