// src/utils/projectScanner.ts
import { invoke } from "@tauri-apps/api/core";

export interface ProjectContext {
    frameworks: string[];
    languages: string[];
    packageManager?: "npm" | "yarn" | "pnpm" | "cargo" | "pip" | "go" | "maven" | "gradle";
    summary: string;
}

interface DirEntry {
    name: string;
    path: string;
    is_dir: boolean;
    children?: DirEntry[];
}

export async function detectProjectContext(rootPath: string): Promise<ProjectContext> {
    const context: ProjectContext = {
        frameworks: [],
        languages: [],
        packageManager: undefined,
        summary: "Generic Project",
    };

    try {
        // We only need to check the root directory for most indicators
        const rootFiles = await invoke<DirEntry[]>("read_dir_recursive", { path: rootPath, depth: 1 });
        const fileNames = new Set(rootFiles.map(f => f.name.toLowerCase()));

        // Detect Node.js
        if (fileNames.has("package.json")) {
            context.languages.push("JavaScript/TypeScript");
            try {
                const pkgJsonFile = rootFiles.find(f => f.name.toLowerCase() === "package.json");
                if (pkgJsonFile) {
                    const content = await invoke<string>("read_file", { path: pkgJsonFile.path });
                    const pkg = JSON.parse(content);
                    const deps = { ...pkg.dependencies, ...pkg.devDependencies };

                    if (deps["next"]) context.frameworks.push("Next.js");
                    if (deps["react"]) context.frameworks.push("React");
                    if (deps["vue"]) context.frameworks.push("Vue");
                    if (deps["svelte"]) context.frameworks.push("Svelte");
                    if (deps["express"]) context.frameworks.push("Express");
                    if (deps["@nestjs/core"]) context.frameworks.push("NestJS");
                    if (deps["tailwindcss"]) context.frameworks.push("Tailwind CSS");
                }
            } catch (e) {
                console.warn("Failed to parse package.json", e);
            }

            if (fileNames.has("pnpm-lock.yaml")) context.packageManager = "pnpm";
            else if (fileNames.has("yarn.lock")) context.packageManager = "yarn";
            else context.packageManager = "npm";
        }

        // Detect Rust
        if (fileNames.has("cargo.toml")) {
            context.languages.push("Rust");
            context.packageManager = "cargo";
            try {
                const cargoTomlFile = rootFiles.find(f => f.name.toLowerCase() === "cargo.toml");
                if (cargoTomlFile) {
                    const content = await invoke<string>("read_file", { path: cargoTomlFile.path });
                    if (content.includes("tauri")) context.frameworks.push("Tauri");
                    if (content.includes("actix-web")) context.frameworks.push("Actix Web");
                    if (content.includes("tokio")) context.frameworks.push("Tokio");
                    if (content.includes("rocket")) context.frameworks.push("Rocket");
                }
            } catch (e) {
                console.warn("Failed to parse Cargo.toml", e);
            }
        }

        // Detect Python
        if (fileNames.has("requirements.txt") || fileNames.has("pyproject.toml") || fileNames.has("pipfile")) {
            context.languages.push("Python");
            context.packageManager = "pip";
            if (fileNames.has("manage.py")) context.frameworks.push("Django");

            try {
                const reqFile = rootFiles.find(f => f.name.toLowerCase() === "requirements.txt");
                if (reqFile) {
                    const content = await invoke<string>("read_file", { path: reqFile.path });
                    if (content.includes("fastapi")) context.frameworks.push("FastAPI");
                    if (content.includes("flask")) context.frameworks.push("Flask");
                    if (content.includes("django")) context.frameworks.push("Django");
                }
            } catch (e) { }
        }

        // Detect Go
        if (fileNames.has("go.mod")) {
            context.languages.push("Go");
            context.packageManager = "go";
            try {
                const goModFile = rootFiles.find(f => f.name.toLowerCase() === "go.mod");
                if (goModFile) {
                    const content = await invoke<string>("read_file", { path: goModFile.path });
                    if (content.includes("gin-gonic")) context.frameworks.push("Gin");
                    if (content.includes("echo")) context.frameworks.push("Echo");
                }
            } catch (e) { }
        }

        // Detect Java
        if (fileNames.has("pom.xml") || fileNames.has("build.gradle")) {
            context.languages.push("Java");
            if (fileNames.has("pom.xml")) context.packageManager = "maven";
            if (fileNames.has("build.gradle")) context.packageManager = "gradle";

            try {
                const buildFile = rootFiles.find(f => f.name.toLowerCase() === "pom.xml" || f.name.toLowerCase() === "build.gradle");
                if (buildFile) {
                    const content = await invoke<string>("read_file", { path: buildFile.path });
                    if (content.toLowerCase().includes("spring-boot")) context.frameworks.push("Spring Boot");
                }
            } catch (e) { }
        }

        // Detect C/C++
        if (fileNames.has("cmakelists.txt") || fileNames.has("makefile")) {
            context.languages.push("C/C++");
            if (fileNames.has("cmakelists.txt")) context.frameworks.push("CMake");
            else context.frameworks.push("Make");
        }

        // Build Summary
        if (context.languages.length === 0) {
            context.summary = "Generic Project";
        } else {
            const langs = context.languages.join(", ");
            const fws = context.frameworks.length > 0 ? ` using ${context.frameworks.join(", ")}` : "";
            const pkg = context.packageManager ? ` (${context.packageManager})` : "";
            context.summary = `${langs} Project${fws}${pkg}`;
        }

    } catch (error) {
        console.warn("Project scanning failed:", error);
    }

    return context;
}
