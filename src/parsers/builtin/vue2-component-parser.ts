import { readFileSync, existsSync } from "fs";
import { join, basename } from "path";
import { glob } from "glob";
import type {
  ParserPlugin,
  ComponentResult,
} from "../types.js";

const PROP_RE = /props:\s*\{([^}]*(?:\{[^}]*\}[^}]*)*)\}/s;
const PROP_ITEM_RE = /(\w+):\s*\{([^}]*)\}/g;
const PROP_TYPE_RE = /type:\s*(\w+)/;
const PROP_REQUIRED_RE = /required:\s*(true|false)/;
const EMIT_RE = /\$emit\(['"]([^'"]+)['"]/g;
const EMITS_OPTION_RE = /emits:\s*\[([^\]]*)\]/;
const SLOT_RE = /<slot\s+name=['"]([^'"]+)['"]/g;
const DEFAULT_SLOT_RE = /<slot\s*(?:\s|\/?>)/g;
const SETUP_RE = /setup\s*\(/;

class Vue2ComponentParser implements ParserPlugin {
  id = "vue2-component";
  type = "component" as const;
  displayName = "Vue 2 SFC Parser";

  private srcDirs: string[] = [];
  private projectRoot = "";

  async init(
    options: Record<string, unknown>,
    projectRoot: string
  ): Promise<void> {
    this.projectRoot = projectRoot;
    this.srcDirs = (options.srcDirs as string[]) ?? ["components", "pages"];
  }

  async parse(nameOrPath: string): Promise<ComponentResult> {
    let filePath: string;

    if (nameOrPath.endsWith(".vue")) {
      filePath = join(this.projectRoot, nameOrPath);
    } else {
      const found = await this.findComponentFile(nameOrPath);
      if (!found) throw new Error(`Component "${nameOrPath}" not found`);
      filePath = found;
    }

    if (!existsSync(filePath)) {
      throw new Error(`File not found: ${filePath}`);
    }

    const source = readFileSync(filePath, "utf-8");
    let scriptContent = "";

    try {
      const sfc = await import("@vue/compiler-sfc");
      const parsed = sfc.parseComponent(source);
      scriptContent = parsed.script?.content ?? "";
    } catch {
      const scriptMatch = source.match(
        /<script[^>]*>([\s\S]*?)<\/script>/
      );
      scriptContent = scriptMatch?.[1] ?? "";
    }

    const templateMatch = source.match(
      /<template[^>]*>([\s\S]*?)<\/template>/
    );
    const templateContent = templateMatch?.[1] ?? "";

    const props = this.extractProps(scriptContent);
    const emits = this.extractEmits(scriptContent);
    const slots = this.extractSlots(templateContent);
    const usesCompositionApi = SETUP_RE.test(scriptContent);

    const name =
      basename(filePath, ".vue");
    const relativePath = filePath.replace(this.projectRoot + "/", "");

    return {
      parserType: "component",
      parserId: this.id,
      name,
      path: relativePath,
      props,
      emits,
      slots,
      meta: { usesCompositionApi },
    };
  }

  async discover(): Promise<string[]> {
    const files: string[] = [];
    for (const dir of this.srcDirs) {
      const pattern = join(this.projectRoot, dir, "**/*.vue");
      const found = await glob(pattern, { ignore: ["**/node_modules/**"] });
      files.push(
        ...found.map((f) => f.replace(this.projectRoot + "/", ""))
      );
    }
    return files;
  }

  private async findComponentFile(name: string): Promise<string | null> {
    const kebab = name.replace(/([a-z])([A-Z])/g, "$1-$2").toLowerCase();
    for (const dir of this.srcDirs) {
      const pattern = join(this.projectRoot, dir, "**/*.vue");
      const found = await glob(pattern, { ignore: ["**/node_modules/**"] });
      for (const f of found) {
        const base = basename(f, ".vue");
        if (
          base === name ||
          base === kebab ||
          base.toLowerCase() === name.toLowerCase()
        ) {
          return f;
        }
      }
    }
    return null;
  }

  private extractProps(
    script: string
  ): { name: string; type?: string; required?: boolean }[] {
    const props: { name: string; type?: string; required?: boolean }[] = [];
    const propsMatch = script.match(PROP_RE);
    if (!propsMatch) return props;

    const propsBlock = propsMatch[1];
    let match: RegExpExecArray | null;
    PROP_ITEM_RE.lastIndex = 0;
    while ((match = PROP_ITEM_RE.exec(propsBlock))) {
      const name = match[1];
      const body = match[2];
      const type = body.match(PROP_TYPE_RE)?.[1];
      const required = body.match(PROP_REQUIRED_RE)?.[1] === "true";
      props.push({ name, type, required });
    }
    return props;
  }

  private extractEmits(script: string): string[] {
    const emits = new Set<string>();

    const emitsOption = script.match(EMITS_OPTION_RE);
    if (emitsOption) {
      const items = emitsOption[1].match(/['"]([^'"]+)['"]/g);
      items?.forEach((item) => emits.add(item.replace(/['"]/g, "")));
    }

    let match: RegExpExecArray | null;
    EMIT_RE.lastIndex = 0;
    while ((match = EMIT_RE.exec(script))) {
      emits.add(match[1]);
    }

    return [...emits];
  }

  private extractSlots(template: string): string[] {
    const slots = new Set<string>();
    let match: RegExpExecArray | null;

    SLOT_RE.lastIndex = 0;
    while ((match = SLOT_RE.exec(template))) {
      slots.add(match[1]);
    }

    DEFAULT_SLOT_RE.lastIndex = 0;
    if (DEFAULT_SLOT_RE.test(template)) {
      slots.add("default");
    }

    return [...slots];
  }
}

export default new Vue2ComponentParser();
