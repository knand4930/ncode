// src/utils/errorParser.ts — Multi-language package & error diagnostics

export type ErrorSeverity = "error" | "warning" | "info";
export type ErrorCategory =
  | "missing_package"
  | "version_conflict"
  | "import_error"
  | "export_error"
  | "syntax_error"
  | "type_error"
  | "runtime_error"
  | "uninstall_hint"
  | "network_error"
  | "permission_error";

export interface DetectedError {
  language: string;
  category: ErrorCategory;
  severity: ErrorSeverity;
  title: string;           // short headline, e.g. "Missing package: requests"
  detail: string;          // full human-readable explanation
  packageName?: string;
  packageVersion?: string; // version that caused the conflict
  installCommand?: string;
  uninstallCommand?: string;
  updateCommand?: string;
  docsUrl?: string;
  file?: string;
  line?: number;
  column?: number;
  rawLine?: string;
}

// ── Language pattern definitions ─────────────────────────────────────────────

interface PatternDef {
  regex: RegExp;
  category: ErrorCategory;
  severity: ErrorSeverity;
  build: (m: RegExpMatchArray, line: string) => Partial<DetectedError>;
}

interface LangDef {
  language: string;
  patterns: PatternDef[];
}

// Helper: npm/yarn/pnpm install command based on lock file presence
function jsInstall(pkg: string): string {
  return `npm install ${pkg}`;
}
function jsDevInstall(pkg: string): string {
  return `npm install --save-dev ${pkg}`;
}

const LANG_DEFS: LangDef[] = [

  // ── Python ────────────────────────────────────────────────────────────────
  {
    language: "python",
    patterns: [
      {
        regex: /ModuleNotFoundError: No module named '([^']+)'/,
        category: "missing_package", severity: "error",
        build: (m) => {
          const pkg = m[1].split(".")[0];
          return {
            packageName: pkg,
            title: `Missing package: ${pkg}`,
            detail: `Python cannot find the module '${m[1]}'. Install it with pip.`,
            installCommand: `pip install ${pkg}`,
            docsUrl: `https://pypi.org/project/${pkg}/`,
          };
        },
      },
      {
        regex: /ImportError: cannot import name '([^']+)' from '([^']+)'/,
        category: "import_error", severity: "error",
        build: (m) => ({
          title: `Import error: '${m[1]}' not found in '${m[2]}'`,
          detail: `'${m[1]}' does not exist in module '${m[2]}'. Check the module version or spelling.`,
          packageName: m[2].split(".")[0],
          updateCommand: `pip install --upgrade ${m[2].split(".")[0]}`,
        }),
      },
      {
        regex: /ImportError: No module named ([^\s\n]+)/,
        category: "missing_package", severity: "error",
        build: (m) => {
          const pkg = m[1].replace(/['"]/g, "").split(".")[0];
          return {
            packageName: pkg,
            title: `Missing package: ${pkg}`,
            detail: `Module '${m[1]}' is not installed.`,
            installCommand: `pip install ${pkg}`,
            docsUrl: `https://pypi.org/project/${pkg}/`,
          };
        },
      },
      {
        regex: /cannot import name '([^']+)'/,
        category: "import_error", severity: "error",
        build: (m) => ({
          title: `Cannot import '${m[1]}'`,
          detail: `The name '${m[1]}' does not exist in the imported module. The package may be outdated or the API changed.`,
        }),
      },
      {
        regex: /File "([^"]+)", line (\d+)/,
        category: "runtime_error", severity: "error",
        build: (m) => ({ file: m[1], line: parseInt(m[2]), title: `Error in ${m[1]}:${m[2]}`, detail: "" }),
      },
      {
        regex: /SyntaxError: (.+)/,
        category: "syntax_error", severity: "error",
        build: (m) => ({ title: `Syntax error`, detail: m[1] }),
      },
      {
        regex: /TypeError: (.+)/,
        category: "type_error", severity: "error",
        build: (m) => ({ title: `Type error`, detail: m[1] }),
      },
      {
        regex: /AttributeError: module '([^']+)' has no attribute '([^']+)'/,
        category: "import_error", severity: "error",
        build: (m) => ({
          packageName: m[1],
          title: `Attribute missing: ${m[1]}.${m[2]}`,
          detail: `Module '${m[1]}' has no attribute '${m[2]}'. The package may be outdated.`,
          updateCommand: `pip install --upgrade ${m[1]}`,
        }),
      },
      {
        regex: /pip.*ERROR: Could not find a version that satisfies the requirement ([^\s]+)/,
        category: "missing_package", severity: "error",
        build: (m) => ({
          packageName: m[1],
          title: `Package not found on PyPI: ${m[1]}`,
          detail: `pip could not find '${m[1]}' on PyPI. Check the package name spelling.`,
          docsUrl: `https://pypi.org/search/?q=${encodeURIComponent(m[1])}`,
        }),
      },
      {
        regex: /pip.*ERROR: No matching distribution found for ([^\s]+)/,
        category: "missing_package", severity: "error",
        build: (m) => ({
          packageName: m[1],
          title: `No distribution found: ${m[1]}`,
          detail: `No matching distribution for '${m[1]}'. It may not support your Python version.`,
        }),
      },
      {
        regex: /pip.*WARNING: Requirement already satisfied: ([^\s]+)/,
        category: "missing_package", severity: "info",
        build: (m) => ({
          packageName: m[1].split("==")[0],
          title: `Already installed: ${m[1]}`,
          detail: `Package '${m[1]}' is already installed.`,
        }),
      },
      {
        regex: /Successfully installed ([^\n]+)/,
        category: "missing_package", severity: "info",
        build: (m) => ({
          title: `Installed: ${m[1].trim()}`,
          detail: `Successfully installed: ${m[1].trim()}`,
        }),
      },
    ],
  },

  // ── JavaScript / Node ─────────────────────────────────────────────────────
  {
    language: "javascript",
    patterns: [
      {
        regex: /Cannot find module '([^']+)'/,
        category: "missing_package", severity: "error",
        build: (m) => {
          const isRelative = m[1].startsWith(".");
          const pkg = isRelative ? null : m[1].startsWith("@") ? m[1].split("/").slice(0, 2).join("/") : m[1].split("/")[0];
          return pkg
            ? { packageName: pkg, title: `Missing package: ${pkg}`, detail: `Module '${m[1]}' not found. Install it.`, installCommand: jsInstall(pkg), docsUrl: `https://www.npmjs.com/package/${pkg}` }
            : { title: `Module not found: ${m[1]}`, detail: `Cannot resolve relative module '${m[1]}'. Check the file path.`, category: "import_error" as ErrorCategory };
        },
      },
      {
        regex: /Module not found: Error: Can't resolve '([^']+)'/,
        category: "missing_package", severity: "error",
        build: (m) => {
          const pkg = m[1].startsWith(".") ? null : m[1].startsWith("@") ? m[1].split("/").slice(0, 2).join("/") : m[1].split("/")[0];
          return pkg
            ? { packageName: pkg, title: `Unresolved module: ${pkg}`, detail: `Webpack/bundler cannot resolve '${m[1]}'.`, installCommand: jsInstall(pkg) }
            : { title: `Unresolved path: ${m[1]}`, detail: `Cannot resolve '${m[1]}'. Check the import path.` };
        },
      },
      {
        regex: /npm ERR! 404 Not Found - GET https:\/\/registry\.npmjs\.org\/([^\s]+)/,
        category: "missing_package", severity: "error",
        build: (m) => ({
          packageName: m[1],
          title: `Package not found on npm: ${m[1]}`,
          detail: `npm registry returned 404 for '${m[1]}'. The package name may be wrong.`,
          docsUrl: `https://www.npmjs.com/search?q=${encodeURIComponent(m[1])}`,
        }),
      },
      {
        regex: /npm ERR! code ERESOLVE/,
        category: "version_conflict", severity: "error",
        build: () => ({
          title: `npm dependency conflict (ERESOLVE)`,
          detail: `npm cannot resolve conflicting peer dependencies. Try: npm install --legacy-peer-deps`,
          installCommand: `npm install --legacy-peer-deps`,
        }),
      },
      {
        regex: /npm warn.*peer dep missing: ([^\s,]+)/i,
        category: "version_conflict", severity: "warning",
        build: (m) => ({
          packageName: m[1].split("@")[0],
          title: `Missing peer dependency: ${m[1]}`,
          detail: `A peer dependency '${m[1]}' is missing. Install it to avoid issues.`,
          installCommand: jsInstall(m[1].split("@")[0]),
        }),
      },
      {
        regex: /npm ERR! code E404/,
        category: "missing_package", severity: "error",
        build: () => ({ title: `npm 404 — package not found`, detail: `npm could not find the package in the registry.` }),
      },
      {
        regex: /SyntaxError: (.+)/,
        category: "syntax_error", severity: "error",
        build: (m) => ({ title: `Syntax error`, detail: m[1] }),
      },
      {
        regex: /TypeError: (.+)/,
        category: "type_error", severity: "error",
        build: (m) => ({ title: `Type error`, detail: m[1] }),
      },
      {
        regex: /ReferenceError: (.+) is not defined/,
        category: "runtime_error", severity: "error",
        build: (m) => ({ title: `ReferenceError: ${m[1]} is not defined`, detail: `'${m[1]}' is used but never declared or imported.` }),
      },
      {
        regex: /at (.+):(\d+):(\d+)/,
        category: "runtime_error", severity: "error",
        build: (m) => ({ file: m[1], line: parseInt(m[2]), column: parseInt(m[3]), title: `Error at ${m[1]}:${m[2]}`, detail: "" }),
      },
    ],
  },

  // ── TypeScript ────────────────────────────────────────────────────────────
  {
    language: "typescript",
    patterns: [
      {
        regex: /Cannot find module '([^']+)' or its corresponding type declarations/,
        category: "missing_package", severity: "error",
        build: (m) => {
          const pkg = m[1].startsWith(".") ? null : m[1].startsWith("@") ? m[1].split("/").slice(0, 2).join("/") : m[1].split("/")[0];
          const typesPkg = pkg ? `@types/${pkg.replace(/^@[^/]+\//, "")}` : null;
          return pkg
            ? {
                packageName: pkg,
                title: `Missing package or types: ${pkg}`,
                detail: `TypeScript cannot find '${m[1]}' or its type declarations. Install the package and/or its @types.`,
                installCommand: jsInstall(pkg),
                updateCommand: typesPkg ? jsDevInstall(typesPkg) : undefined,
                docsUrl: `https://www.npmjs.com/package/${pkg}`,
              }
            : { title: `Module not found: ${m[1]}`, detail: `Cannot resolve '${m[1]}'. Check the path.` };
        },
      },
      {
        regex: /error TS(\d+): (.+)/,
        category: "type_error", severity: "error",
        build: (m) => ({ title: `TS${m[1]}: ${m[2].slice(0, 80)}`, detail: m[2] }),
      },
      {
        regex: /([^\s(]+\.tsx?)\((\d+),(\d+)\): error TS(\d+): (.+)/,
        category: "type_error", severity: "error",
        build: (m) => ({ file: m[1], line: parseInt(m[2]), column: parseInt(m[3]), title: `TS${m[4]} in ${m[1]}:${m[2]}`, detail: m[5] }),
      },
      {
        regex: /Property '([^']+)' does not exist on type '([^']+)'/,
        category: "type_error", severity: "error",
        build: (m) => ({ title: `Property '${m[1]}' missing on '${m[2]}'`, detail: `TypeScript: property '${m[1]}' does not exist on type '${m[2]}'.` }),
      },
    ],
  },

  // ── Rust ──────────────────────────────────────────────────────────────────
  {
    language: "rust",
    patterns: [
      {
        regex: /error\[E0432\]: unresolved import `([^`]+)`/,
        category: "import_error", severity: "error",
        build: (m) => {
          const crate = m[1].split("::")[0];
          return {
            packageName: crate,
            title: `Unresolved import: ${m[1]}`,
            detail: `Crate '${crate}' is not in Cargo.toml. Add it with cargo add.`,
            installCommand: `cargo add ${crate}`,
            docsUrl: `https://crates.io/crates/${crate}`,
          };
        },
      },
      {
        regex: /error\[E0433\]: failed to resolve: use of undeclared crate or module `([^`]+)`/,
        category: "missing_package", severity: "error",
        build: (m) => ({
          packageName: m[1],
          title: `Undeclared crate: ${m[1]}`,
          detail: `Crate '${m[1]}' is not declared. Add it to Cargo.toml.`,
          installCommand: `cargo add ${m[1]}`,
          docsUrl: `https://crates.io/crates/${m[1]}`,
        }),
      },
      {
        regex: /error: package `([^`]+)` in Cargo\.lock .+ is not compatible/,
        category: "version_conflict", severity: "error",
        build: (m) => ({
          packageName: m[1],
          title: `Version conflict: ${m[1]}`,
          detail: `Cargo.lock has an incompatible version of '${m[1]}'. Run cargo update.`,
          updateCommand: `cargo update -p ${m[1]}`,
        }),
      },
      {
        regex: /error\[E(\d+)\]: (.+)/,
        category: "runtime_error", severity: "error",
        build: (m) => ({ title: `Rust E${m[1]}`, detail: m[2] }),
      },
      {
        regex: /  --> ([^:]+):(\d+):(\d+)/,
        category: "runtime_error", severity: "error",
        build: (m) => ({ file: m[1], line: parseInt(m[2]), column: parseInt(m[3]), title: `Error at ${m[1]}:${m[2]}`, detail: "" }),
      },
      {
        regex: /warning: unused import: `([^`]+)`/,
        category: "import_error", severity: "warning",
        build: (m) => ({ title: `Unused import: ${m[1]}`, detail: `Import '${m[1]}' is declared but never used.` }),
      },
    ],
  },

  // ── Go ────────────────────────────────────────────────────────────────────
  {
    language: "go",
    patterns: [
      {
        regex: /cannot find package "([^"]+)"/,
        category: "missing_package", severity: "error",
        build: (m) => ({
          packageName: m[1],
          title: `Missing Go package: ${m[1]}`,
          detail: `Go cannot find package '${m[1]}'. Fetch it with go get.`,
          installCommand: `go get ${m[1]}`,
          docsUrl: `https://pkg.go.dev/${m[1]}`,
        }),
      },
      {
        regex: /no required module provides package ([^\s;:]+)/,
        category: "missing_package", severity: "error",
        build: (m) => ({
          packageName: m[1],
          title: `Module not in go.mod: ${m[1]}`,
          detail: `Package '${m[1]}' is not in go.mod. Add it with go get.`,
          installCommand: `go get ${m[1]}`,
          docsUrl: `https://pkg.go.dev/${m[1]}`,
        }),
      },
      {
        regex: /"([^"]+)" imported and not used/,
        category: "import_error", severity: "error",
        build: (m) => ({
          title: `Unused import: "${m[1]}"`,
          detail: `Go requires all imports to be used. Remove or use '${m[1]}'.`,
          uninstallCommand: `# Remove import "${m[1]}" from your file`,
        }),
      },
      {
        regex: /undefined: ([^\s]+)/,
        category: "import_error", severity: "error",
        build: (m) => ({ title: `Undefined: ${m[1]}`, detail: `'${m[1]}' is undefined. Check imports or spelling.` }),
      },
      {
        regex: /([^:]+\.go):(\d+):(\d+): (.+)/,
        category: "runtime_error", severity: "error",
        build: (m) => ({ file: m[1], line: parseInt(m[2]), column: parseInt(m[3]), title: `Go error in ${m[1]}:${m[2]}`, detail: m[4] }),
      },
    ],
  },

  // ── Java ──────────────────────────────────────────────────────────────────
  {
    language: "java",
    patterns: [
      {
        regex: /package ([^\s]+) does not exist/,
        category: "missing_package", severity: "error",
        build: (m) => ({
          packageName: m[1],
          title: `Package not found: ${m[1]}`,
          detail: `Java package '${m[1]}' does not exist. Add the dependency to pom.xml or build.gradle.`,
          installCommand: `# Add Maven dependency for ${m[1]} to pom.xml`,
          docsUrl: `https://mvnrepository.com/search?q=${encodeURIComponent(m[1])}`,
        }),
      },
      {
        regex: /error: cannot find symbol[\s\S]{0,60}symbol:\s+class ([^\s]+)/,
        category: "import_error", severity: "error",
        build: (m) => ({
          title: `Cannot find class: ${m[1]}`,
          detail: `Class '${m[1]}' is not found. Add the import or the dependency.`,
          docsUrl: `https://mvnrepository.com/search?q=${encodeURIComponent(m[1])}`,
        }),
      },
      {
        regex: /([^:]+\.java):(\d+): error: (.+)/,
        category: "runtime_error", severity: "error",
        build: (m) => ({ file: m[1], line: parseInt(m[2]), title: `Java error in ${m[1]}:${m[2]}`, detail: m[3] }),
      },
      {
        regex: /BUILD FAILURE/,
        category: "runtime_error", severity: "error",
        build: () => ({ title: `Maven/Gradle build failed`, detail: `Build failed. Check the error output above for details.` }),
      },
    ],
  },

  // ── Ruby ──────────────────────────────────────────────────────────────────
  {
    language: "ruby",
    patterns: [
      {
        regex: /(?:LoadError|cannot load such file) -- ([^\s()\n]+)/,
        category: "missing_package", severity: "error",
        build: (m) => ({
          packageName: m[1],
          title: `Missing gem: ${m[1]}`,
          detail: `Ruby cannot load '${m[1]}'. Install the gem.`,
          installCommand: `gem install ${m[1]}`,
          docsUrl: `https://rubygems.org/gems/${m[1]}`,
        }),
      },
      {
        regex: /Gem::MissingSpecError: Could not find '([^']+)'/,
        category: "missing_package", severity: "error",
        build: (m) => ({
          packageName: m[1].split(" ")[0],
          title: `Gem not in Gemfile: ${m[1]}`,
          detail: `Gem '${m[1]}' is missing from the bundle. Add it to Gemfile and run bundle install.`,
          installCommand: `bundle add ${m[1].split(" ")[0]}`,
        }),
      },
      {
        regex: /NameError: uninitialized constant ([^\s]+)/,
        category: "import_error", severity: "error",
        build: (m) => ({
          title: `Uninitialized constant: ${m[1]}`,
          detail: `'${m[1]}' is not defined. Missing require or wrong constant name.`,
        }),
      },
      {
        regex: /([^:]+\.rb):(\d+):in `(.+)': (.+)/,
        category: "runtime_error", severity: "error",
        build: (m) => ({ file: m[1], line: parseInt(m[2]), title: `Ruby error in ${m[1]}:${m[2]}`, detail: `${m[4]} (in \`${m[3]}\`)` }),
      },
    ],
  },

  // ── PHP ───────────────────────────────────────────────────────────────────
  {
    language: "php",
    patterns: [
      {
        regex: /(?:Class|Interface|Trait) ['"]?([^'"]+)['"]? not found/,
        category: "missing_package", severity: "error",
        build: (m) => ({
          packageName: m[1],
          title: `Class not found: ${m[1]}`,
          detail: `PHP class '${m[1]}' is not found. Install the package via Composer.`,
          installCommand: `composer require ${m[1].toLowerCase().replace(/\\/g, "/")}`,
          docsUrl: `https://packagist.org/search/?q=${encodeURIComponent(m[1])}`,
        }),
      },
      {
        regex: /require(?:_once)?\s*\(?\s*['"]([^'"]+)['"]\s*\)?\s*: failed to open stream/,
        category: "import_error", severity: "error",
        build: (m) => ({
          title: `File not found: ${m[1]}`,
          detail: `PHP cannot open '${m[1]}'. Check the file path or run composer install.`,
          installCommand: `composer install`,
        }),
      },
      {
        regex: /PHP (Fatal|Parse|Warning) error: (.+) in ([^:]+):(\d+)/,
        category: "syntax_error", severity: "error",
        build: (m) => ({ file: m[3], line: parseInt(m[4]), title: `PHP ${m[1]} error`, detail: m[2] }),
      },
      {
        regex: /\[RuntimeException\] .+package ([^\s]+) .+ not found/,
        category: "missing_package", severity: "error",
        build: (m) => ({
          packageName: m[1],
          title: `Composer package not found: ${m[1]}`,
          detail: `Composer cannot find '${m[1]}'. Check the package name on Packagist.`,
          docsUrl: `https://packagist.org/search/?q=${encodeURIComponent(m[1])}`,
        }),
      },
    ],
  },

  // ── C / C++ ───────────────────────────────────────────────────────────────
  {
    language: "cpp",
    patterns: [
      {
        regex: /fatal error: ([^:]+\.h(?:pp)?): No such file or directory/,
        category: "missing_package", severity: "error",
        build: (m) => ({
          packageName: m[1],
          title: `Missing header: ${m[1]}`,
          detail: `Header '${m[1]}' not found. Install the development package that provides it.`,
          installCommand: `# sudo apt install lib<name>-dev  OR  brew install <name>`,
        }),
      },
      {
        regex: /undefined reference to `([^`]+)'/,
        category: "import_error", severity: "error",
        build: (m) => ({
          title: `Undefined reference: ${m[1]}`,
          detail: `Linker cannot find '${m[1]}'. Add the library with -l<name> or install the dev package.`,
        }),
      },
      {
        regex: /([^:]+\.(c|cpp|h|hpp)):(\d+):(\d+): error: (.+)/,
        category: "runtime_error", severity: "error",
        build: (m) => ({ file: m[1], line: parseInt(m[3]), column: parseInt(m[4]), title: `C/C++ error in ${m[1]}:${m[3]}`, detail: m[5] }),
      },
      {
        regex: /([^:]+\.(c|cpp|h|hpp)):(\d+):(\d+): warning: (.+)/,
        category: "runtime_error", severity: "warning",
        build: (m) => ({ file: m[1], line: parseInt(m[3]), column: parseInt(m[4]), title: `C/C++ warning in ${m[1]}:${m[3]}`, detail: m[5] }),
      },
    ],
  },

  // ── Dart / Flutter ────────────────────────────────────────────────────────
  {
    language: "dart",
    patterns: [
      {
        regex: /Because .+ depends on ([^\s]+) .+ which doesn't match/,
        category: "version_conflict", severity: "error",
        build: (m) => ({
          packageName: m[1],
          title: `Version conflict: ${m[1]}`,
          detail: `Dart package '${m[1]}' has a version conflict. Run flutter pub upgrade.`,
          updateCommand: `flutter pub upgrade ${m[1]}`,
        }),
      },
      {
        regex: /Error: Cannot find '([^']+)' in '([^']+)'/,
        category: "import_error", severity: "error",
        build: (m) => ({
          title: `Cannot find '${m[1]}' in '${m[2]}'`,
          detail: `Dart cannot find '${m[1]}'. Check imports or run flutter pub get.`,
          installCommand: `flutter pub get`,
        }),
      },
      {
        regex: /Target of URI doesn't exist: '([^']+)'/,
        category: "missing_package", severity: "error",
        build: (m) => ({
          packageName: m[1].split("/")[0].replace("package:", ""),
          title: `Missing Dart package: ${m[1]}`,
          detail: `URI target '${m[1]}' does not exist. Add the package to pubspec.yaml.`,
          installCommand: `flutter pub add ${m[1].split("/")[0].replace("package:", "")}`,
          docsUrl: `https://pub.dev/packages/${m[1].split("/")[0].replace("package:", "")}`,
        }),
      },
    ],
  },

  // ── Swift ─────────────────────────────────────────────────────────────────
  {
    language: "swift",
    patterns: [
      {
        regex: /no such module '([^']+)'/,
        category: "missing_package", severity: "error",
        build: (m) => ({
          packageName: m[1],
          title: `Missing Swift module: ${m[1]}`,
          detail: `Swift cannot find module '${m[1]}'. Add it via Swift Package Manager.`,
          installCommand: `swift package add ${m[1]}`,
          docsUrl: `https://swiftpackageindex.com/search?query=${encodeURIComponent(m[1])}`,
        }),
      },
      {
        regex: /error: ([^:]+\.swift):(\d+):(\d+): error: (.+)/,
        category: "runtime_error", severity: "error",
        build: (m) => ({ file: m[1], line: parseInt(m[2]), column: parseInt(m[3]), title: `Swift error in ${m[1]}:${m[2]}`, detail: m[4] }),
      },
    ],
  },
];

// ── ANSI strip ────────────────────────────────────────────────────────────────
function stripAnsi(s: string): string {
  return s.replace(/\x1b\[[0-9;]*[mGKHFJA-Za-z]/g, "");
}

// ── Language auto-detection ───────────────────────────────────────────────────
function guessLanguages(output: string): string[] {
  const out: string[] = [];
  if (/Traceback|ModuleNotFoundError|ImportError|pip\s|\.py['":\s]/i.test(output)) out.push("python");
  if (/error TS\d+|\.tsx?\(\d+,\d+\)|tsc\s/i.test(output)) out.push("typescript");
  if (/Cannot find module|npm ERR!|node_modules|\.js:\d+:\d+/i.test(output)) out.push("javascript");
  if (/error\[E\d+\]|rustc|cargo\s/i.test(output)) out.push("rust");
  if (/\.go:\d+:\d+:|cannot find package|go get/i.test(output)) out.push("go");
  if (/\.java:\d+: error:|BUILD FAILURE|mvn|gradle/i.test(output)) out.push("java");
  if (/\.rb:\d+:in|LoadError|Gem::/i.test(output)) out.push("ruby");
  if (/PHP (Fatal|Parse|Warning)|composer\s/i.test(output)) out.push("php");
  if (/\.cpp:\d+:\d+:|\.c:\d+:\d+:|g\+\+|gcc\s/i.test(output)) out.push("cpp");
  if (/flutter|dart\s|pubspec/i.test(output)) out.push("dart");
  if (/swift\s|\.swift:\d+/i.test(output)) out.push("swift");
  if (out.length === 0) out.push("javascript", "python"); // fallback
  return out;
}

// ── Main parse function ───────────────────────────────────────────────────────

/**
 * Parse terminal output and return rich diagnostic objects.
 */
export function parseTerminalErrors(
  output: string,
  hintLanguage?: string
): DetectedError[] {
  const clean = stripAnsi(output);
  const lines = clean.split(/\r?\n/);
  const results: DetectedError[] = [];
  const seen = new Set<string>();

  const langs = hintLanguage
    ? [hintLanguage, ...guessLanguages(clean).filter((l) => l !== hintLanguage)]
    : guessLanguages(clean);

  for (const lang of langs) {
    const def = LANG_DEFS.find((d) => d.language === lang);
    if (!def) continue;

    for (const line of lines) {
      for (const pat of def.patterns) {
        const m = line.match(pat.regex);
        if (!m) continue;
        const built = pat.build(m, line);
        const key = `${lang}:${pat.category}:${built.packageName ?? built.title ?? line.slice(0, 60)}`;
        if (seen.has(key)) continue;
        seen.add(key);
        results.push({
          language: lang,
          category: built.category ?? pat.category,
          severity: built.severity ?? pat.severity,
          title: built.title ?? line.trim(),
          detail: built.detail ?? "",
          rawLine: line.trim(),
          ...built,
        });
      }
    }
  }

  return results;
}

/** Only missing-package errors that have an install command */
export function getMissingPackages(errors: DetectedError[]): DetectedError[] {
  return errors.filter(
    (e) => e.category === "missing_package" && !!e.installCommand
  );
}

/** All errors that should show as Monaco markers */
export function getMarkerErrors(errors: DetectedError[]): DetectedError[] {
  return errors.filter((e) => e.severity === "error" || e.severity === "warning");
}

/** Format for AI context injection */
export function formatErrorsForAI(errors: DetectedError[]): string {
  if (errors.length === 0) return "";
  const lines = errors.map((e) => {
    const loc = e.file ? ` in ${e.file}${e.line ? `:${e.line}` : ""}` : "";
    const fix = e.installCommand ? ` → install: \`${e.installCommand}\`` : e.updateCommand ? ` → update: \`${e.updateCommand}\`` : "";
    return `- [${e.language}/${e.category}] ${e.title}${loc}${fix}\n  ${e.detail}`;
  });
  return `[DETECTED ERRORS — ${errors.length} issue(s)]\n${lines.join("\n")}`;
}

/** Human-readable severity label */
export function severityLabel(s: ErrorSeverity): string {
  return s === "error" ? "Error" : s === "warning" ? "Warning" : "Info";
}

/** Category icon */
export function categoryIcon(c: ErrorCategory): string {
  const map: Record<ErrorCategory, string> = {
    missing_package: "📦",
    version_conflict: "⚠️",
    import_error: "🔗",
    export_error: "📤",
    syntax_error: "✏️",
    type_error: "🔷",
    runtime_error: "💥",
    uninstall_hint: "🗑️",
    network_error: "🌐",
    permission_error: "🔒",
  };
  return map[c] ?? "❗";
}
