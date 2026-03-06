import type {
  ParserPlugin,
  ParserType,
  ComponentResult,
  StoreResult,
  ServiceResult,
  RouteResult,
  ParserResult,
} from "./types.js";
export interface ParserDef {
  id: string;
  options?: Record<string, unknown>;
}

const BUILTIN_PARSER_MAP: Record<string, string> = {
  "vue2-component": "./builtin/vue2-component-parser.js",
  "vuex-store": "./builtin/vuex-store-parser.js",
  "axios-service": "./builtin/axios-service-parser.js",
  "nuxt2-route": "./builtin/nuxt2-route-parser.js",
};

export class ParserRegistry {
  private plugins = new Map<string, ParserPlugin>();

  async init(parsers: ParserDef[], projectRoot: string): Promise<void> {
    if (!parsers.length) {
      console.error("[parsers] No parsers configured");
      return;
    }

    for (const parserDef of parsers) {
      const plugin = await this.loadParser(parserDef.id);
      if (!plugin) continue;

      try {
        await plugin.init(parserDef.options ?? {}, projectRoot);
        this.plugins.set(parserDef.id, plugin);
        console.error(`[parsers] Loaded "${parserDef.id}" (${plugin.displayName})`);
      } catch (err) {
        console.error(`[parsers] Failed to init "${parserDef.id}":`, err);
      }
    }
  }

  private async loadParser(id: string): Promise<ParserPlugin | null> {
    const builtinPath = BUILTIN_PARSER_MAP[id];
    if (!builtinPath) {
      console.error(`[parsers] Unknown parser "${id}". Available: ${Object.keys(BUILTIN_PARSER_MAP).join(", ")}`);
      return null;
    }

    try {
      const mod = await import(builtinPath);
      return mod.default as ParserPlugin;
    } catch (err) {
      const code = (err as NodeJS.ErrnoException).code;
      if (code === "ERR_MODULE_NOT_FOUND" || code === "MODULE_NOT_FOUND") {
        console.error(`[parsers] Skipping "${id}": dependency not installed`);
        return null;
      }
      throw err;
    }
  }

  getParser(id: string): ParserPlugin | undefined {
    return this.plugins.get(id);
  }

  getParsersOfType(type: ParserType): ParserPlugin[] {
    return [...this.plugins.values()].filter((p) => p.type === type);
  }

  async parseComponent(nameOrPath: string): Promise<ComponentResult | string> {
    const parsers = this.getParsersOfType("component");
    if (parsers.length === 0) return "No component parser configured for this project.";

    for (const parser of parsers) {
      try {
        const result = await parser.parse(nameOrPath);
        return result as ComponentResult;
      } catch {
        continue;
      }
    }
    return `Component "${nameOrPath}" not found by any configured parser.`;
  }

  async parseStore(module: string): Promise<StoreResult | string> {
    const parsers = this.getParsersOfType("store");
    if (parsers.length === 0) return "No store parser configured for this project.";

    for (const parser of parsers) {
      try {
        return (await parser.parse(module)) as StoreResult;
      } catch {
        continue;
      }
    }
    return `Store module "${module}" not found by any configured parser.`;
  }

  async parseService(service: string): Promise<ServiceResult | string> {
    const parsers = this.getParsersOfType("service");
    if (parsers.length === 0) return "No service parser configured for this project.";

    for (const parser of parsers) {
      try {
        return (await parser.parse(service)) as ServiceResult;
      } catch {
        continue;
      }
    }
    return `Service "${service}" not found by any configured parser.`;
  }

  async parseRoutes(): Promise<RouteResult | string> {
    const parsers = this.getParsersOfType("route");
    if (parsers.length === 0) return "No route parser configured for this project.";

    const parser = parsers[0];
    return (await parser.parse("")) as RouteResult;
  }

  async discoverAll(type?: ParserType): Promise<Record<string, string[]>> {
    const result: Record<string, string[]> = {};
    const parsers = type
      ? this.getParsersOfType(type)
      : [...this.plugins.values()];

    for (const parser of parsers) {
      try {
        result[parser.id] = await parser.discover();
      } catch (err) {
        console.error(`[parsers] discover failed for "${parser.id}":`, err);
        result[parser.id] = [];
      }
    }
    return result;
  }
}
