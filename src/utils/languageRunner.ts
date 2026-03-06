// src/utils/languageRunner.ts
// Language-aware command resolution for Run, Test, Lint, Format, and Init operations.

export interface LanguageCommands {
    run?: string;
    test?: string;
    lint?: string;
    format?: string;
    init?: string;
    build?: string;
}

const LANGUAGE_COMMANDS: Record<string, LanguageCommands> = {
    python: {
        run: "python3 {file}",
        test: "python3 -m pytest -v",
        lint: "python3 -m flake8 {file}",
        format: "python3 -m black {file}",
        init: "pip install -r requirements.txt",
        build: "python3 -m py_compile {file}",
    },
    typescript: {
        run: "npx tsx {file}",
        test: "npx vitest run",
        lint: "npx eslint {file}",
        format: "npx prettier --write {file}",
        init: "npm install",
        build: "npx tsc --noEmit",
    },
    javascript: {
        run: "node {file}",
        test: "npx vitest run",
        lint: "npx eslint {file}",
        format: "npx prettier --write {file}",
        init: "npm install",
        build: "node --check {file}",
    },
    rust: {
        run: "cargo run",
        test: "cargo test",
        lint: "cargo clippy",
        format: "cargo fmt",
        init: "cargo build",
        build: "cargo build --release",
    },
    go: {
        run: "go run {file}",
        test: "go test ./...",
        lint: "go vet {file}",
        format: "gofmt -w {file}",
        init: "go mod tidy",
        build: "go build",
    },
    java: {
        run: "javac {file} && java {class}",
        test: "mvn test",
        lint: undefined,
        format: undefined,
        init: "mvn install",
        build: "javac {file}",
    },
    cpp: {
        run: "g++ {file} -o /tmp/ncode_out && /tmp/ncode_out",
        test: undefined,
        lint: undefined,
        format: "clang-format -i {file}",
        init: "make",
        build: "g++ -c {file}",
    },
    c: {
        run: "gcc {file} -o /tmp/ncode_out && /tmp/ncode_out",
        test: undefined,
        lint: undefined,
        format: "clang-format -i {file}",
        init: "make",
        build: "gcc -c {file}",
    },
    ruby: {
        run: "ruby {file}",
        test: "bundle exec rspec",
        lint: "rubocop {file}",
        format: "rubocop -a {file}",
        init: "bundle install",
    },
    php: {
        run: "php {file}",
        test: "php vendor/bin/phpunit",
        lint: "php -l {file}",
        format: undefined,
        init: "composer install",
    },
    shell: {
        run: "bash {file}",
        test: undefined,
        lint: "shellcheck {file}",
        format: undefined,
        init: undefined,
    },
    kotlin: {
        run: "kotlinc {file} -include-runtime -d /tmp/ncode_out.jar && java -jar /tmp/ncode_out.jar",
        test: "gradle test",
        lint: undefined,
        format: undefined,
        init: "gradle build",
    },
    swift: {
        run: "swift {file}",
        test: "swift test",
        lint: "swiftlint {file}",
        format: "swiftformat {file}",
        init: "swift build",
    },
    dart: {
        run: "dart run {file}",
        test: "dart test",
        lint: "dart analyze {file}",
        format: "dart format {file}",
        init: "dart pub get",
    },
    csharp: {
        run: "dotnet run",
        test: "dotnet test",
        lint: undefined,
        format: "dotnet format",
        init: "dotnet restore",
        build: "dotnet build",
    },
};

function resolveCommand(
    template: string | undefined,
    filePath: string,
    fileName: string
): string | null {
    if (!template) return null;
    const className = fileName.replace(/\.\w+$/, "");
    return template
        .replace(/\{file\}/g, filePath)
        .replace(/\{class\}/g, className);
}

export function getRunCommand(language: string, filePath: string, fileName: string): string | null {
    return resolveCommand(LANGUAGE_COMMANDS[language]?.run, filePath, fileName);
}

export function getTestCommand(language: string, filePath: string, fileName: string): string | null {
    return resolveCommand(LANGUAGE_COMMANDS[language]?.test, filePath, fileName);
}

export function getLintCommand(language: string, filePath: string, fileName: string): string | null {
    return resolveCommand(LANGUAGE_COMMANDS[language]?.lint, filePath, fileName);
}

export function getFormatCommand(language: string, filePath: string, fileName: string): string | null {
    return resolveCommand(LANGUAGE_COMMANDS[language]?.format, filePath, fileName);
}

export function getInitCommand(language: string, filePath: string, fileName: string): string | null {
    return resolveCommand(LANGUAGE_COMMANDS[language]?.init, filePath, fileName);
}

export function getBuildCommand(language: string, filePath: string, fileName: string): string | null {
    return resolveCommand(LANGUAGE_COMMANDS[language]?.build, filePath, fileName);
}

export function getSupportedLanguages(): string[] {
    return Object.keys(LANGUAGE_COMMANDS);
}

export function hasRunSupport(language: string): boolean {
    return !!LANGUAGE_COMMANDS[language]?.run;
}

export function hasTestSupport(language: string): boolean {
    return !!LANGUAGE_COMMANDS[language]?.test;
}
