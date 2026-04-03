// src/utils/errorParser.ts — PyCharm-level multi-language diagnostics

export type ErrorSeverity = "error" | "warning" | "info" | "hint";

export type ErrorCategory =
  | "missing_package"   | "version_conflict"  | "import_error"
  | "export_error"      | "syntax_error"       | "type_error"
  | "runtime_error"     | "uninstall_hint"     | "network_error"
  | "permission_error"  | "unused_variable"    | "unused_import"
  | "broad_exception"   | "code_smell"         | "typo"
  | "deprecation"       | "security"           | "performance"
  | "style"             | "logic_error"        | "null_safety";

export interface DetectedError {
  language: string;
  category: ErrorCategory;
  severity: ErrorSeverity;
  title: string;
  detail: string;
  packageName?: string;
  packageVersion?: string;
  installCommand?: string;
  uninstallCommand?: string;
  updateCommand?: string;
  docsUrl?: string;
  file?: string;
  line?: number;
  column?: number;
  endLine?: number;
  endColumn?: number;
  rawLine?: string;
  source?: string;       // e.g. "pylint", "eslint", "tsc", "rustc"
  code?: string;         // e.g. "E501", "TS2345", "E0432"
  suggestion?: string;   // quick-fix suggestion text
}

interface PatternDef {
  regex: RegExp;
  category: ErrorCategory;
  severity: ErrorSeverity;
  source?: string;
  build: (m: RegExpMatchArray, line: string) => Partial<DetectedError>;
}

interface LangDef {
  language: string;
  patterns: PatternDef[];
}

function jsInstall(pkg: string) { return `npm install ${pkg}`; }
function jsDevInstall(pkg: string) { return `npm install --save-dev ${pkg}`; }

const LANG_DEFS: LangDef[] = [

// ── Python ────────────────────────────────────────────────────────────────────
{
  language: "python",
  patterns: [
    // Import errors
    { regex: /ModuleNotFoundError: No module named '([^']+)'/, category: "missing_package", severity: "error",
      build: (m) => { const pkg = m[1].split(".")[0]; return { packageName: pkg, title: `Missing package: ${pkg}`, detail: `Python cannot find '${m[1]}'. Install it with pip.`, installCommand: `pip install ${pkg}`, docsUrl: `https://pypi.org/project/${pkg}/` }; } },
    { regex: /ImportError: cannot import name '([^']+)' from '([^']+)'/, category: "import_error", severity: "error",
      build: (m) => ({ title: `Cannot import '${m[1]}' from '${m[2]}'`, detail: `'${m[1]}' does not exist in '${m[2]}'. The package may be outdated.`, packageName: m[2].split(".")[0], updateCommand: `pip install --upgrade ${m[2].split(".")[0]}` }) },
    { regex: /ImportError: No module named ([^\s\n]+)/, category: "missing_package", severity: "error",
      build: (m) => { const pkg = m[1].replace(/['"]/g, "").split(".")[0]; return { packageName: pkg, title: `Missing package: ${pkg}`, detail: `Module '${m[1]}' is not installed.`, installCommand: `pip install ${pkg}`, docsUrl: `https://pypi.org/project/${pkg}/` }; } },
    // File/line location
    { regex: /File "([^"]+)", line (\d+)/, category: "runtime_error", severity: "error",
      build: (m) => ({ file: m[1], line: parseInt(m[2]), title: `Error at ${m[1].split(/[\\/]/).pop()}:${m[2]}`, detail: "" }) },
    // Syntax / type errors
    { regex: /SyntaxError: (.+)/, category: "syntax_error", severity: "error",
      build: (m) => ({ title: `SyntaxError: ${m[1].slice(0, 60)}`, detail: m[1] }) },
    { regex: /TypeError: (.+)/, category: "type_error", severity: "error",
      build: (m) => ({ title: `TypeError: ${m[1].slice(0, 60)}`, detail: m[1] }) },
    { regex: /ValueError: (.+)/, category: "runtime_error", severity: "error",
      build: (m) => ({ title: `ValueError: ${m[1].slice(0, 60)}`, detail: m[1] }) },
    { regex: /AttributeError: module '([^']+)' has no attribute '([^']+)'/, category: "import_error", severity: "error",
      build: (m) => ({ packageName: m[1], title: `Attribute missing: ${m[1]}.${m[2]}`, detail: `Module '${m[1]}' has no attribute '${m[2]}'. The package may be outdated.`, updateCommand: `pip install --upgrade ${m[1]}` }) },
    { regex: /AttributeError: '([^']+)' object has no attribute '([^']+)'/, category: "type_error", severity: "error",
      build: (m) => ({ title: `AttributeError: '${m[1]}' has no '${m[2]}'`, detail: `Object of type '${m[1]}' does not have attribute '${m[2]}'.` }) },
    { regex: /NameError: name '([^']+)' is not defined/, category: "runtime_error", severity: "error",
      build: (m) => ({ title: `NameError: '${m[1]}' is not defined`, detail: `'${m[1]}' is used before assignment or not imported.` }) },
    { regex: /KeyError: (.+)/, category: "runtime_error", severity: "error",
      build: (m) => ({ title: `KeyError: ${m[1].slice(0, 50)}`, detail: `Dictionary key ${m[1]} does not exist.` }) },
    { regex: /IndexError: (.+)/, category: "runtime_error", severity: "error",
      build: (m) => ({ title: `IndexError: ${m[1].slice(0, 50)}`, detail: m[1] }) },
    { regex: /RecursionError: (.+)/, category: "runtime_error", severity: "error",
      build: (m) => ({ title: `RecursionError`, detail: m[1], suggestion: "Check for infinite recursion or increase sys.setrecursionlimit()" }) },
    { regex: /ZeroDivisionError: (.+)/, category: "logic_error", severity: "error",
      build: (m) => ({ title: `ZeroDivisionError`, detail: m[1], suggestion: "Add a check: if divisor != 0" }) },
    // PyCharm-style inspections
    { regex: /W0611.*'([^']+)' imported but unused/, category: "unused_import", severity: "warning", source: "pylint",
      build: (m) => ({ title: `Unused import: '${m[1]}'`, detail: `'${m[1]}' is imported but never used. Remove it or use it.`, suggestion: `Remove: import ${m[1]}` }) },
    { regex: /W0612.*Unused variable '([^']+)'/, category: "unused_variable", severity: "warning", source: "pylint",
      build: (m) => ({ title: `Unused variable: '${m[1]}'`, detail: `Variable '${m[1]}' is assigned but never used.`, suggestion: `Rename to '_${m[1]}' to suppress, or remove it.` }) },
    { regex: /W0613.*Unused argument '([^']+)'/, category: "unused_variable", severity: "warning", source: "pylint",
      build: (m) => ({ title: `Unused argument: '${m[1]}'`, detail: `Argument '${m[1]}' is never used in the function body.`, suggestion: `Prefix with underscore: _${m[1]}` }) },
    { regex: /W0703.*Catching too general exception ([^\s]+)/, category: "broad_exception", severity: "warning", source: "pylint",
      build: (m) => ({ title: `Too broad exception: ${m[1]}`, detail: `Catching '${m[1]}' is too broad. Catch specific exceptions instead.`, suggestion: "Replace with specific exception types, e.g. except ValueError, TypeError:" }) },
    { regex: /except\s+Exception\s*(?:as\s+\w+)?\s*:/, category: "broad_exception", severity: "warning", source: "inspection",
      build: () => ({ title: "Too broad exception clause", detail: "Catching 'Exception' is too broad. Specify the exception types you expect.", suggestion: "Use specific exceptions: except (ValueError, TypeError):" }) },
    { regex: /except\s*:/, category: "broad_exception", severity: "warning", source: "inspection",
      build: () => ({ title: "Bare except clause", detail: "Bare 'except:' catches all exceptions including SystemExit and KeyboardInterrupt.", suggestion: "Use 'except Exception:' at minimum, or specify exact types." }) },
    { regex: /W0611.*'([^']+)' in the try block.*should also be defined in the except block/, category: "broad_exception", severity: "warning", source: "pylint",
      build: (m) => ({ title: `'${m[1]}' in try block should be in except block`, detail: `'${m[1]}' is used in the try block with 'except ImportError' but not defined in the except block.` }) },
    { regex: /Local variable '([^']+)' value is not used/, category: "unused_variable", severity: "warning", source: "inspection",
      build: (m) => ({ title: `Local variable '${m[1]}' value is not used`, detail: `The value assigned to '${m[1]}' is never read.`, suggestion: `Use '_' or remove the assignment.` }) },
    { regex: /E501.*line too long \((\d+).*\)/, category: "style", severity: "info", source: "flake8",
      build: (m) => ({ title: `Line too long (${m[1]} chars)`, detail: `PEP 8 recommends max 79 characters per line.`, suggestion: "Break the line or use implicit line continuation." }) },
    { regex: /E302.*expected 2 blank lines/, category: "style", severity: "info", source: "flake8",
      build: () => ({ title: "Expected 2 blank lines before function/class", detail: "PEP 8: top-level definitions should be separated by 2 blank lines." }) },
    { regex: /W0105.*String statement has no effect/, category: "code_smell", severity: "warning", source: "pylint",
      build: () => ({ title: "String statement has no effect", detail: "A string literal used as a statement has no effect. Did you mean a docstring?" }) },
    { regex: /C0301.*Line too long \((\d+)\/(\d+)\)/, category: "style", severity: "info", source: "pylint",
      build: (m) => ({ title: `Line too long (${m[1]}/${m[2]})`, detail: `Line exceeds maximum length of ${m[2]} characters.` }) },
    { regex: /Typo: In word '([^']+)'/, category: "typo", severity: "hint", source: "inspection",
      build: (m) => ({ title: `Typo: '${m[1]}'`, detail: `'${m[1]}' may be a typo.`, suggestion: `Check spelling of '${m[1]}'` }) },
    // pip errors
    { regex: /pip.*ERROR: Could not find a version that satisfies the requirement ([^\s]+)/, category: "missing_package", severity: "error",
      build: (m) => ({ packageName: m[1], title: `Package not found: ${m[1]}`, detail: `pip could not find '${m[1]}' on PyPI.`, docsUrl: `https://pypi.org/search/?q=${encodeURIComponent(m[1])}` }) },
    { regex: /pip.*ERROR: No matching distribution found for ([^\s]+)/, category: "missing_package", severity: "error",
      build: (m) => ({ packageName: m[1], title: `No distribution: ${m[1]}`, detail: `No matching distribution for '${m[1]}'. May not support your Python version.` }) },
    { regex: /Successfully installed ([^\n]+)/, category: "missing_package", severity: "info",
      build: (m) => ({ title: `Installed: ${m[1].trim()}`, detail: `Successfully installed: ${m[1].trim()}` }) },
    // Deprecation
    { regex: /DeprecationWarning: (.+)/, category: "deprecation", severity: "warning",
      build: (m) => ({ title: `DeprecationWarning`, detail: m[1], suggestion: "Update to the recommended API." }) },
    { regex: /PendingDeprecationWarning: (.+)/, category: "deprecation", severity: "info",
      build: (m) => ({ title: `PendingDeprecationWarning`, detail: m[1] }) },
    // Security
    { regex: /B[0-9]{3}.*\[bandit\].*(.+)/, category: "security", severity: "warning", source: "bandit",
      build: (m) => ({ title: `Security issue`, detail: m[1] }) },
    { regex: /assert\s+/, category: "security", severity: "hint", source: "inspection",
      build: () => ({ title: "Assert used in production code", detail: "assert statements are disabled with -O flag. Use explicit checks instead." }) },
  ],
},

// ── JavaScript / TypeScript ───────────────────────────────────────────────────
{
  language: "javascript",
  patterns: [
    { regex: /Cannot find module '([^']+)'/, category: "missing_package", severity: "error",
      build: (m) => { const isRel = m[1].startsWith("."); const pkg = isRel ? null : m[1].startsWith("@") ? m[1].split("/").slice(0,2).join("/") : m[1].split("/")[0]; return pkg ? { packageName: pkg, title: `Missing module: ${pkg}`, detail: `Module '${m[1]}' not found.`, installCommand: jsInstall(pkg), docsUrl: `https://www.npmjs.com/package/${pkg}` } : { title: `Module not found: ${m[1]}`, detail: `Cannot resolve '${m[1]}'. Check the file path.`, category: "import_error" as ErrorCategory }; } },
    { regex: /Module not found: Error: Can't resolve '([^']+)'/, category: "missing_package", severity: "error",
      build: (m) => { const pkg = m[1].startsWith(".") ? null : m[1].startsWith("@") ? m[1].split("/").slice(0,2).join("/") : m[1].split("/")[0]; return pkg ? { packageName: pkg, title: `Unresolved module: ${pkg}`, detail: `Bundler cannot resolve '${m[1]}'.`, installCommand: jsInstall(pkg) } : { title: `Unresolved path: ${m[1]}`, detail: `Cannot resolve '${m[1]}'.` }; } },
    { regex: /npm ERR! 404 Not Found.*\/([^\s]+)/, category: "missing_package", severity: "error",
      build: (m) => ({ packageName: m[1], title: `npm 404: ${m[1]}`, detail: `Package '${m[1]}' not found on npm registry.`, docsUrl: `https://www.npmjs.com/search?q=${encodeURIComponent(m[1])}` }) },
    { regex: /npm ERR! code ERESOLVE/, category: "version_conflict", severity: "error",
      build: () => ({ title: "npm dependency conflict (ERESOLVE)", detail: "npm cannot resolve conflicting peer dependencies.", installCommand: "npm install --legacy-peer-deps" }) },
    { regex: /npm warn.*peer dep missing: ([^\s,]+)/i, category: "version_conflict", severity: "warning",
      build: (m) => ({ packageName: m[1].split("@")[0], title: `Missing peer dep: ${m[1]}`, detail: `Peer dependency '${m[1]}' is missing.`, installCommand: jsInstall(m[1].split("@")[0]) }) },
    { regex: /SyntaxError: (.+)/, category: "syntax_error", severity: "error",
      build: (m) => ({ title: `SyntaxError: ${m[1].slice(0,60)}`, detail: m[1] }) },
    { regex: /TypeError: (.+)/, category: "type_error", severity: "error",
      build: (m) => ({ title: `TypeError: ${m[1].slice(0,60)}`, detail: m[1] }) },
    { regex: /ReferenceError: (.+) is not defined/, category: "runtime_error", severity: "error",
      build: (m) => ({ title: `ReferenceError: '${m[1]}' not defined`, detail: `'${m[1]}' is used but never declared or imported.` }) },
    { regex: /UnhandledPromiseRejection.*: (.+)/, category: "runtime_error", severity: "error",
      build: (m) => ({ title: "Unhandled Promise Rejection", detail: m[1], suggestion: "Add .catch() or use try/catch with await." }) },
    // ESLint patterns
    { regex: /no-unused-vars.*'([^']+)' is defined but never used/, category: "unused_variable", severity: "warning", source: "eslint",
      build: (m) => ({ title: `Unused variable: '${m[1]}'`, detail: `'${m[1]}' is defined but never used.`, suggestion: `Prefix with underscore: _${m[1]}` }) },
    { regex: /no-unused-vars.*'([^']+)' is assigned a value but never used/, category: "unused_variable", severity: "warning", source: "eslint",
      build: (m) => ({ title: `Unused assignment: '${m[1]}'`, detail: `'${m[1]}' is assigned but never read.` }) },
    { regex: /no-undef.*'([^']+)' is not defined/, category: "runtime_error", severity: "error", source: "eslint",
      build: (m) => ({ title: `Undefined: '${m[1]}'`, detail: `'${m[1]}' is not defined. Add an import or declare it.` }) },
    { regex: /no-console.*Unexpected console statement/, category: "code_smell", severity: "warning", source: "eslint",
      build: () => ({ title: "console statement", detail: "console.log/warn/error should be removed from production code.", suggestion: "Remove or replace with a proper logger." }) },
    { regex: /eqeqeq.*Expected '===' and instead saw '=='/, category: "code_smell", severity: "warning", source: "eslint",
      build: () => ({ title: "Use === instead of ==", detail: "Strict equality (===) avoids type coercion bugs.", suggestion: "Replace == with ===" }) },
    { regex: /prefer-const.*'([^']+)' is never reassigned/, category: "style", severity: "info", source: "eslint",
      build: (m) => ({ title: `Use const for '${m[1]}'`, detail: `'${m[1]}' is never reassigned. Use const instead of let.`, suggestion: `Change 'let ${m[1]}' to 'const ${m[1]}'` }) },
    { regex: /at (.+):(\d+):(\d+)/, category: "runtime_error", severity: "error",
      build: (m) => ({ file: m[1], line: parseInt(m[2]), column: parseInt(m[3]), title: `Error at ${m[1].split(/[\\/]/).pop()}:${m[2]}`, detail: "" }) },
  ],
},
{
  language: "typescript",
  patterns: [
    { regex: /Cannot find module '([^']+)' or its corresponding type declarations/, category: "missing_package", severity: "error", source: "tsc",
      build: (m) => { const pkg = m[1].startsWith(".") ? null : m[1].startsWith("@") ? m[1].split("/").slice(0,2).join("/") : m[1].split("/")[0]; const typesPkg = pkg ? `@types/${pkg.replace(/^@[^/]+\//, "")}` : null; return pkg ? { packageName: pkg, title: `Missing types: ${pkg}`, detail: `TypeScript cannot find '${m[1]}' or its type declarations.`, installCommand: jsInstall(pkg), updateCommand: typesPkg ? jsDevInstall(typesPkg) : undefined, docsUrl: `https://www.npmjs.com/package/${pkg}` } : { title: `Module not found: ${m[1]}`, detail: `Cannot resolve '${m[1]}'.` }; } },
    { regex: /error TS(\d+): (.+)/, category: "type_error", severity: "error", source: "tsc",
      build: (m) => ({ code: `TS${m[1]}`, title: `TS${m[1]}: ${m[2].slice(0,70)}`, detail: m[2] }) },
    { regex: /([^\s(]+\.tsx?)\((\d+),(\d+)\): error TS(\d+): (.+)/, category: "type_error", severity: "error", source: "tsc",
      build: (m) => ({ file: m[1], line: parseInt(m[2]), column: parseInt(m[3]), code: `TS${m[4]}`, title: `TS${m[4]} in ${m[1].split(/[\\/]/).pop()}:${m[2]}`, detail: m[5] }) },
    { regex: /([^\s(]+\.tsx?)\((\d+),(\d+)\): warning TS(\d+): (.+)/, category: "type_error", severity: "warning", source: "tsc",
      build: (m) => ({ file: m[1], line: parseInt(m[2]), column: parseInt(m[3]), code: `TS${m[4]}`, title: `TS${m[4]} warning in ${m[1].split(/[\\/]/).pop()}:${m[2]}`, detail: m[5] }) },
    { regex: /Property '([^']+)' does not exist on type '([^']+)'/, category: "type_error", severity: "error", source: "tsc",
      build: (m) => ({ title: `Property '${m[1]}' missing on '${m[2]}'`, detail: `TypeScript: property '${m[1]}' does not exist on type '${m[2]}'.` }) },
    { regex: /Object is possibly 'null'/, category: "null_safety", severity: "error", source: "tsc",
      build: () => ({ title: "Object is possibly null", detail: "This value may be null. Add a null check or use optional chaining (?.).", suggestion: "Use: value?.property or if (value !== null)" }) },
    { regex: /Object is possibly 'undefined'/, category: "null_safety", severity: "error", source: "tsc",
      build: () => ({ title: "Object is possibly undefined", detail: "This value may be undefined. Add a check or use optional chaining.", suggestion: "Use: value?.property or value ?? defaultValue" }) },
    { regex: /Type '([^']+)' is not assignable to type '([^']+)'/, category: "type_error", severity: "error", source: "tsc",
      build: (m) => ({ title: `Type mismatch: '${m[1].slice(0,30)}' → '${m[2].slice(0,30)}'`, detail: `Type '${m[1]}' is not assignable to type '${m[2]}'.` }) },
    { regex: /'([^']+)' is declared but its value is never read/, category: "unused_variable", severity: "warning", source: "tsc",
      build: (m) => ({ title: `Unused: '${m[1]}'`, detail: `'${m[1]}' is declared but never read.`, suggestion: `Prefix with underscore: _${m[1]}` }) },
    { regex: /Argument of type '([^']+)' is not assignable to parameter of type '([^']+)'/, category: "type_error", severity: "error", source: "tsc",
      build: (m) => ({ title: `Wrong argument type`, detail: `Argument '${m[1].slice(0,40)}' is not assignable to '${m[2].slice(0,40)}'.` }) },
  ],
},

// ── Rust ──────────────────────────────────────────────────────────────────────
{
  language: "rust",
  patterns: [
    { regex: /error\[E0432\]: unresolved import `([^`]+)`/, category: "import_error", severity: "error", source: "rustc",
      build: (m) => { const crate = m[1].split("::")[0]; return { packageName: crate, title: `Unresolved import: ${m[1]}`, detail: `Crate '${crate}' is not in Cargo.toml.`, installCommand: `cargo add ${crate}`, docsUrl: `https://crates.io/crates/${crate}` }; } },
    { regex: /error\[E0433\]: failed to resolve: use of undeclared crate or module `([^`]+)`/, category: "missing_package", severity: "error", source: "rustc",
      build: (m) => ({ packageName: m[1], title: `Undeclared crate: ${m[1]}`, detail: `Crate '${m[1]}' is not declared.`, installCommand: `cargo add ${m[1]}`, docsUrl: `https://crates.io/crates/${m[1]}` }) },
    { regex: /error\[E0308\]: mismatched types/, category: "type_error", severity: "error", source: "rustc",
      build: () => ({ title: "Mismatched types", detail: "The types don't match. Check the expected vs found types in the error output." }) },
    { regex: /error\[E0382\]: borrow of moved value: `([^`]+)`/, category: "runtime_error", severity: "error", source: "rustc",
      build: (m) => ({ title: `Borrow of moved value: '${m[1]}'`, detail: `'${m[1]}' was moved and cannot be borrowed again. Clone it or restructure ownership.`, suggestion: `Use .clone() or restructure to avoid the move.` }) },
    { regex: /error\[E0502\]: cannot borrow `([^`]+)` as mutable because it is also borrowed as immutable/, category: "runtime_error", severity: "error", source: "rustc",
      build: (m) => ({ title: `Borrow conflict: '${m[1]}'`, detail: `Cannot borrow '${m[1]}' as mutable while it is borrowed as immutable.` }) },
    { regex: /error\[E(\d+)\]: (.+)/, category: "runtime_error", severity: "error", source: "rustc",
      build: (m) => ({ code: `E${m[1]}`, title: `Rust E${m[1]}: ${m[2].slice(0,60)}`, detail: m[2] }) },
    { regex: /  --> ([^:]+):(\d+):(\d+)/, category: "runtime_error", severity: "error", source: "rustc",
      build: (m) => ({ file: m[1], line: parseInt(m[2]), column: parseInt(m[3]), title: `Error at ${m[1].split(/[\\/]/).pop()}:${m[2]}`, detail: "" }) },
    { regex: /warning: unused import: `([^`]+)`/, category: "unused_import", severity: "warning", source: "rustc",
      build: (m) => ({ title: `Unused import: ${m[1]}`, detail: `Import '${m[1]}' is declared but never used.`, suggestion: `Remove: use ${m[1]};` }) },
    { regex: /warning: unused variable: `([^`]+)`/, category: "unused_variable", severity: "warning", source: "rustc",
      build: (m) => ({ title: `Unused variable: '${m[1]}'`, detail: `Variable '${m[1]}' is assigned but never used.`, suggestion: `Prefix with underscore: _${m[1]}` }) },
    { regex: /warning: dead_code.*`([^`]+)` is never used/, category: "unused_variable", severity: "warning", source: "rustc",
      build: (m) => ({ title: `Dead code: '${m[1]}'`, detail: `'${m[1]}' is defined but never used.` }) },
    { regex: /warning: deprecated.*`([^`]+)`/, category: "deprecation", severity: "warning", source: "rustc",
      build: (m) => ({ title: `Deprecated: '${m[1]}'`, detail: `'${m[1]}' is deprecated. Check the docs for the replacement.` }) },
    { regex: /error: package `([^`]+)` in Cargo\.lock .+ is not compatible/, category: "version_conflict", severity: "error",
      build: (m) => ({ packageName: m[1], title: `Version conflict: ${m[1]}`, detail: `Cargo.lock has an incompatible version of '${m[1]}'.`, updateCommand: `cargo update -p ${m[1]}` }) },
  ],
},
// ── Go ────────────────────────────────────────────────────────────────────────
{
  language: "go",
  patterns: [
    { regex: /cannot find package "([^"]+)"/, category: "missing_package", severity: "error",
      build: (m) => ({ packageName: m[1], title: `Missing Go package: ${m[1]}`, detail: `Go cannot find '${m[1]}'.`, installCommand: `go get ${m[1]}`, docsUrl: `https://pkg.go.dev/${m[1]}` }) },
    { regex: /no required module provides package ([^\s;:]+)/, category: "missing_package", severity: "error",
      build: (m) => ({ packageName: m[1], title: `Module not in go.mod: ${m[1]}`, detail: `Package '${m[1]}' is not in go.mod.`, installCommand: `go get ${m[1]}` }) },
    { regex: /"([^"]+)" imported and not used/, category: "unused_import", severity: "error",
      build: (m) => ({ title: `Unused import: "${m[1]}"`, detail: `Go requires all imports to be used. Remove '${m[1]}'.`, suggestion: `Remove: import "${m[1]}"` }) },
    { regex: /([^:]+\.go):(\d+):(\d+): (.+)/, category: "runtime_error", severity: "error",
      build: (m) => ({ file: m[1], line: parseInt(m[2]), column: parseInt(m[3]), title: `Go error in ${m[1].split(/[\\/]/).pop()}:${m[2]}`, detail: m[4] }) },
    { regex: /undefined: ([^\s]+)/, category: "import_error", severity: "error",
      build: (m) => ({ title: `Undefined: ${m[1]}`, detail: `'${m[1]}' is undefined. Check imports or spelling.` }) },
    { regex: /declared and not used: ([^\s]+)/, category: "unused_variable", severity: "error",
      build: (m) => ({ title: `Declared but not used: ${m[1]}`, detail: `Go requires all declared variables to be used.`, suggestion: `Remove or use '${m[1]}'` }) },
  ],
},
// ── Java ──────────────────────────────────────────────────────────────────────
{
  language: "java",
  patterns: [
    { regex: /package ([^\s]+) does not exist/, category: "missing_package", severity: "error",
      build: (m) => ({ packageName: m[1], title: `Package not found: ${m[1]}`, detail: `Java package '${m[1]}' does not exist. Add the dependency to pom.xml or build.gradle.`, docsUrl: `https://mvnrepository.com/search?q=${encodeURIComponent(m[1])}` }) },
    { regex: /error: cannot find symbol[\s\S]{0,60}symbol:\s+class ([^\s]+)/, category: "import_error", severity: "error",
      build: (m) => ({ title: `Cannot find class: ${m[1]}`, detail: `Class '${m[1]}' is not found. Add the import or dependency.` }) },
    { regex: /([^:]+\.java):(\d+): error: (.+)/, category: "runtime_error", severity: "error",
      build: (m) => ({ file: m[1], line: parseInt(m[2]), title: `Java error in ${m[1].split(/[\\/]/).pop()}:${m[2]}`, detail: m[3] }) },
    { regex: /BUILD FAILURE/, category: "runtime_error", severity: "error",
      build: () => ({ title: "Maven/Gradle build failed", detail: "Build failed. Check the error output above." }) },
    { regex: /NullPointerException/, category: "null_safety", severity: "error",
      build: () => ({ title: "NullPointerException", detail: "A null reference was dereferenced.", suggestion: "Add null checks or use Optional<T>." }) },
  ],
},
// ── Ruby ──────────────────────────────────────────────────────────────────────
{
  language: "ruby",
  patterns: [
    { regex: /(?:LoadError|cannot load such file) -- ([^\s()\n]+)/, category: "missing_package", severity: "error",
      build: (m) => ({ packageName: m[1], title: `Missing gem: ${m[1]}`, detail: `Ruby cannot load '${m[1]}'.`, installCommand: `gem install ${m[1]}`, docsUrl: `https://rubygems.org/gems/${m[1]}` }) },
    { regex: /Gem::MissingSpecError: Could not find '([^']+)'/, category: "missing_package", severity: "error",
      build: (m) => ({ packageName: m[1].split(" ")[0], title: `Gem not in Gemfile: ${m[1]}`, detail: `Gem '${m[1]}' is missing from the bundle.`, installCommand: `bundle add ${m[1].split(" ")[0]}` }) },
    { regex: /NameError: uninitialized constant ([^\s]+)/, category: "import_error", severity: "error",
      build: (m) => ({ title: `Uninitialized constant: ${m[1]}`, detail: `'${m[1]}' is not defined. Missing require or wrong constant name.` }) },
    { regex: /([^:]+\.rb):(\d+):in `(.+)': (.+)/, category: "runtime_error", severity: "error",
      build: (m) => ({ file: m[1], line: parseInt(m[2]), title: `Ruby error in ${m[1].split(/[\\/]/).pop()}:${m[2]}`, detail: `${m[4]} (in \`${m[3]}\`)` }) },
  ],
},
// ── PHP ───────────────────────────────────────────────────────────────────────
{
  language: "php",
  patterns: [
    { regex: /(?:Class|Interface|Trait) ['"]?([^'"]+)['"]? not found/, category: "missing_package", severity: "error",
      build: (m) => ({ packageName: m[1], title: `Class not found: ${m[1]}`, detail: `PHP class '${m[1]}' is not found.`, installCommand: `composer require ${m[1].toLowerCase().replace(/\\/g, "/")}` }) },
    { regex: /PHP (Fatal|Parse|Warning) error: (.+) in ([^:]+):(\d+)/, category: "syntax_error", severity: "error",
      build: (m) => ({ file: m[3], line: parseInt(m[4]), title: `PHP ${m[1]} error`, detail: m[2] }) },
  ],
},
// ── C / C++ ───────────────────────────────────────────────────────────────────
{
  language: "cpp",
  patterns: [
    { regex: /fatal error: ([^:]+\.h(?:pp)?): No such file or directory/, category: "missing_package", severity: "error",
      build: (m) => ({ packageName: m[1], title: `Missing header: ${m[1]}`, detail: `Header '${m[1]}' not found.`, installCommand: `# sudo apt install lib<name>-dev  OR  brew install <name>` }) },
    { regex: /undefined reference to `([^`]+)'/, category: "import_error", severity: "error",
      build: (m) => ({ title: `Undefined reference: ${m[1]}`, detail: `Linker cannot find '${m[1]}'. Add the library with -l<name>.` }) },
    { regex: /([^:]+\.(c|cpp|h|hpp)):(\d+):(\d+): error: (.+)/, category: "runtime_error", severity: "error",
      build: (m) => ({ file: m[1], line: parseInt(m[3]), column: parseInt(m[4]), title: `C/C++ error in ${m[1].split(/[\\/]/).pop()}:${m[3]}`, detail: m[5] }) },
    { regex: /([^:]+\.(c|cpp|h|hpp)):(\d+):(\d+): warning: (.+)/, category: "runtime_error", severity: "warning",
      build: (m) => ({ file: m[1], line: parseInt(m[3]), column: parseInt(m[4]), title: `C/C++ warning in ${m[1].split(/[\\/]/).pop()}:${m[3]}`, detail: m[5] }) },
    { regex: /([^:]+\.(c|cpp|h|hpp)):(\d+):(\d+): note: (.+)/, category: "code_smell", severity: "info",
      build: (m) => ({ file: m[1], line: parseInt(m[3]), column: parseInt(m[4]), title: `Note in ${m[1].split(/[\\/]/).pop()}:${m[3]}`, detail: m[5] }) },
  ],
},
// ── Dart / Flutter ────────────────────────────────────────────────────────────
{
  language: "dart",
  patterns: [
    { regex: /Target of URI doesn't exist: '([^']+)'/, category: "missing_package", severity: "error",
      build: (m) => ({ packageName: m[1].split("/")[0].replace("package:", ""), title: `Missing Dart package: ${m[1]}`, detail: `URI target '${m[1]}' does not exist.`, installCommand: `flutter pub add ${m[1].split("/")[0].replace("package:", "")}` }) },
    { regex: /Error: Cannot find '([^']+)' in '([^']+)'/, category: "import_error", severity: "error",
      build: (m) => ({ title: `Cannot find '${m[1]}' in '${m[2]}'`, detail: `Dart cannot find '${m[1]}'.`, installCommand: `flutter pub get` }) },
    { regex: /The getter '([^']+)' isn't defined for the class '([^']+)'/, category: "type_error", severity: "error",
      build: (m) => ({ title: `Getter '${m[1]}' not defined on '${m[2]}'`, detail: `Class '${m[2]}' has no getter '${m[1]}'.` }) },
  ],
},
// ── Swift ─────────────────────────────────────────────────────────────────────
{
  language: "swift",
  patterns: [
    { regex: /no such module '([^']+)'/, category: "missing_package", severity: "error",
      build: (m) => ({ packageName: m[1], title: `Missing Swift module: ${m[1]}`, detail: `Swift cannot find module '${m[1]}'.`, installCommand: `swift package add ${m[1]}` }) },
    { regex: /error: ([^:]+\.swift):(\d+):(\d+): error: (.+)/, category: "runtime_error", severity: "error",
      build: (m) => ({ file: m[1], line: parseInt(m[2]), column: parseInt(m[3]), title: `Swift error in ${m[1].split(/[\\/]/).pop()}:${m[2]}`, detail: m[4] }) },
    { regex: /warning: ([^:]+\.swift):(\d+):(\d+): warning: (.+)/, category: "runtime_error", severity: "warning",
      build: (m) => ({ file: m[1], line: parseInt(m[2]), column: parseInt(m[3]), title: `Swift warning in ${m[1].split(/[\\/]/).pop()}:${m[2]}`, detail: m[4] }) },
  ],
},
// ── Shell / Bash ──────────────────────────────────────────────────────────────
{
  language: "shell",
  patterns: [
    { regex: /command not found: ([^\s]+)/, category: "runtime_error", severity: "error",
      build: (m) => ({ title: `Command not found: ${m[1]}`, detail: `'${m[1]}' is not installed or not in PATH.`, suggestion: `Install ${m[1]} or check your PATH.` }) },
    { regex: /Permission denied: '([^']+)'/, category: "permission_error", severity: "error",
      build: (m) => ({ title: `Permission denied: ${m[1]}`, detail: `Cannot access '${m[1]}'. Check file permissions.`, suggestion: `Run: chmod +x ${m[1]}` }) },
    { regex: /No such file or directory: '([^']+)'/, category: "runtime_error", severity: "error",
      build: (m) => ({ title: `File not found: ${m[1]}`, detail: `'${m[1]}' does not exist.` }) },
    { regex: /ENOENT: no such file or directory, open '([^']+)'/, category: "runtime_error", severity: "error",
      build: (m) => ({ title: `ENOENT: ${m[1].split(/[\\/]/).pop()}`, detail: `File '${m[1]}' does not exist.` }) },
    { regex: /EACCES: permission denied, open '([^']+)'/, category: "permission_error", severity: "error",
      build: (m) => ({ title: `EACCES: ${m[1].split(/[\\/]/).pop()}`, detail: `Permission denied accessing '${m[1]}'.` }) },
    { regex: /EADDRINUSE: address already in use :::(\d+)/, category: "runtime_error", severity: "error",
      build: (m) => ({ title: `Port ${m[1]} already in use`, detail: `Port ${m[1]} is occupied by another process.`, suggestion: `Run: lsof -i :${m[1]} | kill -9 <PID>` }) },
    { regex: /ENOMEM: not enough memory/, category: "runtime_error", severity: "error",
      build: () => ({ title: "Out of memory", detail: "The process ran out of memory.", suggestion: "Increase available memory or optimize memory usage." }) },
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
  if (/Traceback|ModuleNotFoundError|ImportError|pip\s|\.py['":\s]|SyntaxError.*line \d/i.test(output)) out.push("python");
  if (/error TS\d+|\.tsx?\(\d+,\d+\)|tsc\s/i.test(output)) out.push("typescript");
  if (/Cannot find module|npm ERR!|node_modules|\.js:\d+:\d+|UnhandledPromiseRejection/i.test(output)) out.push("javascript");
  if (/error\[E\d+\]|rustc|cargo\s|warning: unused/i.test(output)) out.push("rust");
  if (/\.go:\d+:\d+:|cannot find package|go get/i.test(output)) out.push("go");
  if (/\.java:\d+: error:|BUILD FAILURE|mvn|gradle/i.test(output)) out.push("java");
  if (/\.rb:\d+:in|LoadError|Gem::/i.test(output)) out.push("ruby");
  if (/PHP (Fatal|Parse|Warning)|composer\s/i.test(output)) out.push("php");
  if (/\.cpp:\d+:\d+:|\.c:\d+:\d+:|g\+\+|gcc\s/i.test(output)) out.push("cpp");
  if (/flutter|dart\s|pubspec/i.test(output)) out.push("dart");
  if (/\.swift:\d+/i.test(output)) out.push("swift");
  if (/command not found|ENOENT|EACCES|EADDRINUSE/i.test(output)) out.push("shell");
  if (out.length === 0) out.push("javascript", "python", "shell");
  return out;
}

// ── Main parse function ───────────────────────────────────────────────────────

export function parseTerminalErrors(output: string, hintLanguage?: string): DetectedError[] {
  const clean = stripAnsi(output);
  const lines = clean.split(/\r?\n/);
  const results: DetectedError[] = [];
  const seen = new Set<string>();

  const langs = hintLanguage
    ? [hintLanguage, ...guessLanguages(clean).filter(l => l !== hintLanguage)]
    : guessLanguages(clean);

  for (const lang of langs) {
    const def = LANG_DEFS.find(d => d.language === lang);
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
          source: built.source ?? pat.source,
          ...built,
        });
      }
    }
  }

  return results;
}

// ── Static analysis of file content (no terminal needed) ─────────────────────

export function analyzeFileContent(content: string, language: string, filePath: string): DetectedError[] {
  const results: DetectedError[] = [];
  const lines = content.split("\n");
  const fileName = filePath.split(/[\\/]/).pop() ?? filePath;

  if (language === "python") {
    lines.forEach((line, i) => {
      const ln = i + 1;
      // Broad exception
      if (/^\s*except\s*:/.test(line)) {
        results.push({ language: "python", category: "broad_exception", severity: "warning", source: "inspection",
          file: filePath, line: ln, title: "Bare except clause", detail: "Bare 'except:' catches all exceptions including SystemExit.", suggestion: "Use 'except Exception:' or specific types." });
      }
      if (/^\s*except\s+Exception\s*(?:as\s+\w+)?\s*:/.test(line)) {
        results.push({ language: "python", category: "broad_exception", severity: "warning", source: "inspection",
          file: filePath, line: ln, title: "Too broad exception clause", detail: "Catching 'Exception' is too broad. Specify the exception types you expect.", suggestion: "Use specific exceptions: except (ValueError, TypeError):" });
      }
      // Unused variable (simple heuristic: _ prefix convention)
      const unusedMatch = line.match(/^\s+(\w+)\s*=\s*.+#\s*noqa/);
      if (unusedMatch) {
        results.push({ language: "python", category: "unused_variable", severity: "info", source: "inspection",
          file: filePath, line: ln, title: `noqa suppression: ${unusedMatch[1]}`, detail: "Error suppressed with # noqa." });
      }
      // TODO/FIXME
      const todoMatch = line.match(/\b(TODO|FIXME|HACK|XXX)\b[:\s]*(.*)/i);
      if (todoMatch) {
        results.push({ language: "python", category: "code_smell", severity: "hint", source: "inspection",
          file: filePath, line: ln, title: `${todoMatch[1]}: ${todoMatch[2].slice(0, 50)}`, detail: `${todoMatch[1]} comment at line ${ln}.` });
      }
      // print() in non-test files
      if (/^\s*print\s*\(/.test(line) && !fileName.includes("test")) {
        results.push({ language: "python", category: "code_smell", severity: "hint", source: "inspection",
          file: filePath, line: ln, title: "print() statement", detail: "print() should be replaced with proper logging in production code.", suggestion: "Use: import logging; logging.info(...)" });
      }
    });
  }

  if (language === "typescript" || language === "javascript") {
    lines.forEach((line, i) => {
      const ln = i + 1;
      // console.log
      if (/console\.(log|warn|error|debug)\s*\(/.test(line) && !line.includes("// eslint-disable")) {
        results.push({ language, category: "code_smell", severity: "hint", source: "inspection",
          file: filePath, line: ln, title: "console statement", detail: "console statements should be removed from production code.", suggestion: "Remove or replace with a logger." });
      }
      // TODO/FIXME
      const todoMatch = line.match(/\b(TODO|FIXME|HACK|XXX)\b[:\s]*(.*)/i);
      if (todoMatch) {
        results.push({ language, category: "code_smell", severity: "hint", source: "inspection",
          file: filePath, line: ln, title: `${todoMatch[1]}: ${todoMatch[2].slice(0, 50)}`, detail: `${todoMatch[1]} comment at line ${ln}.` });
      }
      // any type
      if (/:\s*any\b/.test(line) && !line.includes("// eslint-disable")) {
        results.push({ language, category: "type_error", severity: "hint", source: "inspection",
          file: filePath, line: ln, title: "Explicit 'any' type", detail: "Using 'any' disables TypeScript type checking.", suggestion: "Replace with a specific type or 'unknown'." });
      }
      // == instead of ===
      if (/[^=!<>]==[^=]/.test(line) && !/['"`].*==.*['"`]/.test(line)) {
        results.push({ language, category: "code_smell", severity: "warning", source: "inspection",
          file: filePath, line: ln, title: "Use === instead of ==", detail: "Loose equality (==) can cause unexpected type coercion.", suggestion: "Replace == with ===" });
      }
    });
  }

  if (language === "rust") {
    lines.forEach((line, i) => {
      const ln = i + 1;
      const todoMatch = line.match(/\b(TODO|FIXME|HACK|unimplemented!|todo!)\b[:\s]*(.*)/i);
      if (todoMatch) {
        results.push({ language: "rust", category: "code_smell", severity: "hint", source: "inspection",
          file: filePath, line: ln, title: `${todoMatch[1]}: ${todoMatch[2].slice(0, 50)}`, detail: `${todoMatch[1]} at line ${ln}.` });
      }
      if (/\.unwrap\(\)/.test(line)) {
        results.push({ language: "rust", category: "null_safety", severity: "warning", source: "inspection",
          file: filePath, line: ln, title: "unwrap() may panic", detail: "unwrap() panics if the value is None/Err.", suggestion: "Use ? operator, unwrap_or(), or match instead." });
      }
    });
  }

  return results;
}

// ── Helpers ───────────────────────────────────────────────────────────────────

export function getMissingPackages(errors: DetectedError[]): DetectedError[] {
  return errors.filter(e => e.category === "missing_package" && !!e.installCommand);
}

export function getMarkerErrors(errors: DetectedError[]): DetectedError[] {
  return errors.filter(e => e.severity === "error" || e.severity === "warning");
}

export function formatErrorsForAI(errors: DetectedError[]): string {
  if (errors.length === 0) return "";
  const lines = errors.map(e => {
    const loc = e.file ? ` in ${e.file}${e.line ? `:${e.line}` : ""}` : "";
    const fix = e.installCommand ? ` → install: \`${e.installCommand}\`` : e.updateCommand ? ` → update: \`${e.updateCommand}\`` : "";
    return `- [${e.language}/${e.category}] ${e.title}${loc}${fix}\n  ${e.detail}`;
  });
  return `[DETECTED ERRORS — ${errors.length} issue(s)]\n${lines.join("\n")}`;
}

export function severityLabel(s: ErrorSeverity): string {
  return s === "error" ? "Error" : s === "warning" ? "Warning" : s === "hint" ? "Hint" : "Info";
}

export function categoryIcon(c: ErrorCategory): string {
  const map: Record<ErrorCategory, string> = {
    missing_package: "📦", version_conflict: "⚠️", import_error: "🔗",
    export_error: "📤", syntax_error: "✏️", type_error: "🔷",
    runtime_error: "💥", uninstall_hint: "🗑️", network_error: "🌐",
    permission_error: "🔒", unused_variable: "👻", unused_import: "🗑️",
    broad_exception: "🪤", code_smell: "🧹", typo: "✍️",
    deprecation: "⏳", security: "🔐", performance: "⚡",
    style: "🎨", logic_error: "🧠", null_safety: "🚫",
  };
  return map[c] ?? "❗";
}

export function severityOrder(s: ErrorSeverity): number {
  return s === "error" ? 0 : s === "warning" ? 1 : s === "info" ? 2 : 3;
}
