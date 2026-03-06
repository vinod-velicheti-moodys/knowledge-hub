export type ParserType = "component" | "store" | "service" | "route";

export interface ParserResult {
  parserType: ParserType;
  parserId: string;
  [key: string]: unknown;
}

export interface ComponentResult extends ParserResult {
  parserType: "component";
  name: string;
  path: string;
  props: { name: string; type?: string; required?: boolean }[];
  emits: string[];
  slots: string[];
  meta?: Record<string, unknown>;
}

export interface StoreResult extends ParserResult {
  parserType: "store";
  name: string;
  actions: string[];
  mutations?: string[];
  getters?: string[];
  services?: string[];
  stateShape?: Record<string, string>;
  operations?: { name: string; type: string; description?: string }[];
}

export interface ServiceResult extends ParserResult {
  parserType: "service";
  name: string;
  baseUrl?: string;
  methods: { name: string; verb: string; url: string; returnType?: string }[];
}

export interface RouteResult extends ParserResult {
  parserType: "route";
  routes: { path: string; component: string; name?: string }[];
}

export interface ParserPlugin {
  id: string;
  type: ParserType;
  displayName: string;

  init(options: Record<string, unknown>, projectRoot: string): Promise<void>;
  parse(target: string): Promise<ParserResult>;
  discover(): Promise<string[]>;
}
