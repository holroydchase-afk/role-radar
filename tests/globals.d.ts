// Test-only: what the demo page and demo/mock-claude.js put on window, as the browser tests read it.
export {};

interface MockSnapshot { exists: boolean; data(): Record<string, any> | undefined }
interface MockDoc {
  get(): Promise<MockSnapshot>;
  set(doc: object): Promise<void>;
  update(patch: object): Promise<void>;
  onSnapshot(next: (s: MockSnapshot) => void, error?: (e: unknown) => void): () => void;
}
interface MockDb {
  doc(path: string): MockDoc;
  collection(path: string): {
    get(): Promise<{ docs: { id: string; data(): Record<string, any> }[] }>;
    onSnapshot(next: (s: { docs: { id: string; data(): Record<string, any> }[] }) => void, error?: (e: unknown) => void): () => void;
  };
}

declare global {
  interface Window {
    /** The platform API; demo/mock-claude.js stands in for it. */
    claude: { use(name: "db"): Promise<MockDb>; use(name: string): Promise<any> };
    /** Database paths the page subscribed to, in order (mock only). */
    __RR_DB_READS__: string[];
    /** Connector calls the page made (mock only). */
    __RR_MCP_CALLS__: { server: string; tool: string; input: Record<string, any> }[];
    /** Releases a collection held back with ?hold= (mock only). */
    __RR_RELEASE__(name: string): void;
    /** Set only if hostile markup ran script: the XSS tests expect them to stay undefined. */
    __x?: unknown;
    __xss?: unknown;
  }
}
