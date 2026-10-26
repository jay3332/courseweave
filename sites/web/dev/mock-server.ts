/* oxlint-disable eslint/max-lines -- the mock API in one place: routing and catalog documents */
// An in-memory stand-in for the web API (docs/src/api/web-api.md), so the website runs and its stores can be tested
// before the Rust API is ready. Catalog documents come from a directory of Courseweave-format files; personal records
// live in memory with revisions and 409s like the real ones (mock-records.ts). Development and tests only: it trusts
// every request and checks little beyond what the website needs to see the API's behavior.
import { createHash } from "node:crypto";
import { readdir, readFile } from "node:fs/promises";
import { join } from "node:path";
import {
  error,
  isObj,
  json,
  MockCollection,
  MockDocument,
  MockFriends,
  MockSaved,
  noContent,
  type Json,
  type RecordRequest,
} from "./mock-records.ts";

export interface MockUser {
  subject: string;
  name: string;
  andrewId: string;
  email: string;
  isAdmin: boolean;
}

export interface MockOptions {
  /** A directory of Courseweave-format catalog files (its public/data), or null for no catalog. */
  catalogDir: string | null;
  /** Start signed in. */
  signedIn?: boolean;
  /** Who's signed in. */
  user?: MockUser;
  /** The clock, for records' timestamps. */
  now?: () => number;
}

/** A fault to inject: the next matching request fails this way. */
export type Fault =
  | { status: number; body?: unknown; headers?: Record<string, string> }
  | "network";

const DEFAULT_USER: MockUser = {
  subject: "mock-subject",
  name: "Scotty Dog",
  andrewId: "scotty",
  email: "scotty@andrew.cmu.edu",
  isAdmin: false,
};

const MEMBER_ONLY = /^(?:teaching|fce\/.+|programs\/.+|syllabi\/.+)$/u;
const SEGMENT = /^[A-Za-z0-9_-]+$/u;

/** The file a document name maps to in a Courseweave public/data directory, or null. */
export function catalogFile(name: string): string | null {
  const parts = name.split("/");
  if (!parts.every((s) => SEGMENT.test(s))) return null;
  const [head = "", a, b] = parts;
  if (parts.length === 1)
    return ["build", "terms", "offerings", "teaching"].includes(head) ? `${head}.json` : null;
  if (parts.length === 2 && head === "term") return `${a}.json`;
  if (parts.length === 2 && head === "catalog" && a === "index") return "catalog/index.json";
  if (parts.length === 3 && head === "catalog" && a === "details")
    return `catalog/details/${b}.json`;
  if (parts.length === 2 && head === "fce" && (a === "summary" || a === "instructors"))
    return `fce/${a}.json`;
  if (parts.length === 3 && head === "fce" && a === "courses") return `fce/courses/${b}.json`;
  if (parts.length === 2 && ["programs", "syllabi", "finals"].includes(head))
    return `${head}/${a}.json`;
  return null;
}

/** A term document as signed-out visitors get it: no instructors, no rooms. */
export function publicTerm(doc: unknown): unknown {
  if (!isObj(doc) || !Array.isArray(doc.courses)) return doc;
  // A deep copy, emptied in place.
  const copy: unknown = structuredClone(doc);
  const courses = isObj(copy) && Array.isArray(copy.courses) ? copy.courses : [];
  for (const c of courses) {
    if (!isObj(c)) continue;
    c.instructors = [];
    for (const s of Array.isArray(c.sections) ? c.sections : []) {
      if (!isObj(s)) continue;
      s.instructors = [];
      for (const m of Array.isArray(s.meetings) ? s.meetings : []) {
        if (isObj(m)) Object.assign(m, { building: null, room: null });
      }
    }
  }
  return copy;
}

const EMPTY_RECORD: Json = { entries: [], overrides: {}, profile: {} };
const DEFAULT_PREFERENCES: Json = {
  calendarDisplay: { section: true, time: true, location: true, title: false },
  activeSchedule: {},
  activePlanId: null,
  planLayout: "cards",
  sectionPicker: "dropdown",
  onboarding: { asked: false, promptHidden: false },
};

export class MockServer {
  signedIn: boolean;
  user: MockUser;
  readonly schedules: MockCollection;
  readonly plans: MockCollection;
  readonly record: MockDocument;
  readonly preferences: MockDocument;
  readonly saved: MockSaved;
  readonly friends: MockFriends;
  /** Every request, as "METHOD /path", for tests. */
  readonly log: string[] = [];
  readonly #catalogDir: string | null;
  readonly #faults: { method: string; path: RegExp; fault: Fault }[] = [];

  constructor(options: MockOptions) {
    const now = options.now ?? (() => Date.now());
    this.#catalogDir = options.catalogDir;
    this.signedIn = options.signedIn ?? false;
    this.user = options.user ?? DEFAULT_USER;
    this.schedules = new MockCollection("schedule", now);
    this.plans = new MockCollection("plan", now);
    this.record = new MockDocument(EMPTY_RECORD, now);
    this.preferences = new MockDocument(DEFAULT_PREFERENCES, now);
    this.saved = new MockSaved(now);
    this.friends = new MockFriends(now);
  }

  /** Makes the next request matching `method` and `path` fail with `fault`. */
  fail(method: string, path: RegExp, fault: Fault): void {
    this.#faults.push({ method, path, fault });
  }

  /** `fetch`, answered by this server: for an ApiClient in tests. */
  readonly fetch = (input: string, init?: RequestInit): Promise<Response> =>
    this.handle(new Request(new URL(input, "http://mock.test"), init));

  /** Answers a request like the API would. Throws a TypeError for "network" faults, like fetch. */
  async handle(request: Request): Promise<Response> {
    const url = new URL(request.url);
    this.log.push(`${request.method} ${url.pathname}`);
    const at = this.#faults.findIndex(
      (f) => f.method === request.method && f.path.test(url.pathname),
    );
    if (at >= 0) {
      const [{ fault }] = this.#faults.splice(at, 1);
      if (fault === "network") throw new TypeError("Failed to fetch");
      return json(
        fault.status,
        fault.body ?? { code: "unavailable", message: "Injected failure." },
        fault.headers,
      );
    }
    try {
      return await this.#route(request, url);
    } catch (e) {
      return error(500, "unavailable", e instanceof Error ? e.message : String(e));
    }
  }

  async #route(request: Request, url: URL): Promise<Response> {
    const path = url.pathname;
    if (path === "/api/health") return new Response("ok");
    if (path === "/auth/login") return this.#login(url);
    if (path === "/auth/logout") {
      this.signedIn = false;
      return request.method === "GET"
        ? new Response(null, { status: 303, headers: { Location: "/" } })
        : noContent();
    }
    if (path.startsWith("/api/catalog/")) {
      return this.#catalog(request, decodeURIComponent(path.slice("/api/catalog/".length)));
    }
    if (path.startsWith("/api/shared-schedules/")) {
      return this.schedules.shared(decodeURIComponent(path.slice("/api/shared-schedules/".length)));
    }
    if (path === "/api/me")
      return this.signedIn
        ? json(200, this.user)
        : error(401, "auth", "Sign in with your CMU account.");
    if (!path.startsWith("/api/")) return error(404, "not_found", "Not part of the mock API.");
    if (!this.signedIn) return error(401, "auth", "Sign in with your CMU account.");
    const read = request.method === "GET" || request.method === "DELETE";
    const body: unknown = read ? {} : await request.json().catch(() => ({}));
    const req: RecordRequest = {
      method: request.method,
      parts: path
        .split("/")
        .slice(2)
        .map((p) => decodeURIComponent(p)),
      body: isObj(body) ? body : {},
      url,
    };
    return this.#personal(req);
  }

  #login(url: URL): Response {
    const as = url.searchParams.get("as");
    if (as !== null && /^[a-z0-9_-]{1,64}$/u.test(as)) {
      this.user = {
        subject: `mock-${as}`,
        name: as,
        andrewId: as,
        email: `${as}@andrew.cmu.edu`,
        isAdmin: false,
      };
    }
    this.signedIn = true;
    const back = url.searchParams.get("returnTo") ?? "/";
    const safe =
      back.startsWith("/") && !back.startsWith("//") && !back.startsWith("/auth") ? back : "/";
    return new Response(null, { status: 303, headers: { Location: safe } });
  }

  #personal(req: RecordRequest): Response {
    switch (req.parts[0]) {
      case "schedules":
        return this.schedules.handle(req);
      case "plans":
        return this.plans.handle(req);
      case "record":
        return this.record.handle(req);
      case "preferences":
        return this.preferences.handle(req);
      case "saved":
        return this.saved.handle(req);
      case "friends":
        return this.friends.handle(req);
      case "finals":
        if (req.method === "GET") return json(200, []);
        if (req.method === "DELETE") return noContent();
        return error(400, "bad_request", "The mock API doesn't import calendars.");
      case "account":
        if (req.method !== "DELETE") break;
        this.schedules.records.clear();
        this.plans.records.clear();
        this.saved.courses.clear();
        this.record.value = { ...EMPTY_RECORD, revision: 0, updatedAt: 0 };
        this.signedIn = false;
        return noContent();
      default:
        break;
    }
    return error(404, "not_found", "Not part of the mock API.");
  }

  async #catalog(request: Request, name: string): Promise<Response> {
    if (request.method !== "GET")
      return error(400, "bad_request", "Catalog documents are read-only.");
    if (MEMBER_ONLY.test(name) && !this.signedIn) {
      return error(401, "auth", "Sign in with your CMU account to see this.");
    }
    const doc =
      name === "fce/courses/index" ? await this.#fcePrefixes() : await this.#readDocument(name);
    if (doc === undefined) return error(404, "not_found", `No catalog document "${name}".`);
    const text = JSON.stringify(doc);
    const hash = createHash("sha256").update(text).digest("base64url").slice(0, 27);
    const etag = `"${hash}${this.signedIn ? "m" : "p"}"`;
    const headers = {
      "Content-Type": "application/json",
      ETag: etag,
      "Cache-Control": "private, no-cache",
    };
    if (request.headers.get("If-None-Match") === etag)
      return new Response(null, { status: 304, headers });
    return new Response(text, { status: 200, headers });
  }

  /** A catalog file as the caller may see it, or undefined when there's none. */
  async #readDocument(name: string): Promise<unknown> {
    const file = catalogFile(name);
    if (file === null || this.#catalogDir === null) return undefined;
    let doc: unknown;
    try {
      doc = JSON.parse(await readFile(join(this.#catalogDir, file), "utf8"));
    } catch {
      return undefined;
    }
    if (this.signedIn) return doc;
    if (name.startsWith("term/")) return publicTerm(doc);
    if (name.startsWith("finals/") && Array.isArray(doc)) {
      const copy: unknown[] = structuredClone(doc);
      for (const e of copy) if (isObj(e)) e.instructors = [];
      return copy;
    }
    return doc;
  }

  async #fcePrefixes(): Promise<string[] | undefined> {
    if (this.#catalogDir === null) return undefined;
    try {
      const files = await readdir(join(this.#catalogDir, "fce", "courses"));
      return files
        .filter((f) => /^\d{2}\.json$/u.test(f))
        .map((f) => f.slice(0, 2))
        .toSorted();
    } catch {
      return undefined;
    }
  }
}

export function createMockServer(options: MockOptions): MockServer {
  return new MockServer(options);
}
