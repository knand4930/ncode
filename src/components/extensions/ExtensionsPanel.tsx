// src/components/extensions/ExtensionsPanel.tsx
import { useState } from "react";
import { Search, Download, Check, Star } from "lucide-react";

// Built-in extensions (Monaco handles most language features)
const BUILT_IN_EXTENSIONS = [
  {
    id: "theme-one-dark",
    name: "One Dark Pro",
    description: "Atom's iconic One Dark theme",
    author: "binaryify",
    category: "Themes",
    installed: true,
    stars: 9.8,
    downloads: "12M",
    icon: "🌙",
  },
  {
    id: "theme-github",
    name: "GitHub Theme",
    description: "GitHub's VS Code theme",
    author: "GitHub",
    category: "Themes",
    installed: false,
    stars: 9.5,
    downloads: "8M",
    icon: "🐙",
  },
  {
    id: "prettier",
    name: "Prettier",
    description: "Code formatter",
    author: "Prettier",
    category: "Formatters",
    installed: true,
    stars: 9.7,
    downloads: "30M",
    icon: "✨",
  },
  {
    id: "eslint",
    name: "ESLint",
    description: "JavaScript/TypeScript linting",
    author: "Microsoft",
    category: "Linters",
    installed: false,
    stars: 9.6,
    downloads: "25M",
    icon: "🔍",
  },
  {
    id: "gitlens",
    name: "GitLens",
    description: "Supercharge Git capabilities",
    author: "GitKraken",
    category: "SCM",
    installed: false,
    stars: 9.8,
    downloads: "20M",
    icon: "🔗",
  },
  {
    id: "copilot-alt",
    name: "NebulaAI",
    description: "Built-in AI (uses your Ollama)",
    author: "NCode",
    category: "AI",
    installed: true,
    stars: 10,
    downloads: "built-in",
    icon: "✦",
  },
  {
    id: "docker",
    name: "Docker",
    description: "Docker support",
    author: "Microsoft",
    category: "Tools",
    installed: false,
    stars: 9.2,
    downloads: "15M",
    icon: "🐳",
  },
  {
    id: "remote-ssh",
    name: "Remote SSH",
    description: "Connect to remote servers",
    author: "Microsoft",
    category: "Remote",
    installed: false,
    stars: 9.4,
    downloads: "10M",
    icon: "🌐",
  },
];

const CATEGORIES = ["All", "AI", "Themes", "Languages", "Formatters", "Linters", "SCM", "Tools", "Remote"];

export function ExtensionsPanel() {
  const [query, setQuery] = useState("");
  const [category, setCategory] = useState("All");
  const [installed, setInstalled] = useState<Set<string>>(
    new Set(BUILT_IN_EXTENSIONS.filter((e) => e.installed).map((e) => e.id))
  );

  const filtered = BUILT_IN_EXTENSIONS.filter((ext) => {
    const matchQuery =
      !query ||
      ext.name.toLowerCase().includes(query.toLowerCase()) ||
      ext.description.toLowerCase().includes(query.toLowerCase());
    const matchCat = category === "All" || ext.category === category;
    return matchQuery && matchCat;
  });

  const toggleInstall = (id: string) => {
    setInstalled((s) => {
      const n = new Set(s);
      n.has(id) ? n.delete(id) : n.add(id);
      return n;
    });
  };

  return (
    <div className="extensions-panel">
      <div className="extensions-header">
        <span className="sidebar-title">EXTENSIONS</span>
      </div>

      <div className="extensions-search">
        <Search size={13} />
        <input
          value={query}
          onChange={(e) => setQuery(e.target.value)}
          placeholder="Search extensions..."
        />
      </div>

      <div className="extensions-categories">
        {CATEGORIES.map((cat) => (
          <button
            key={cat}
            className={`ext-cat-btn ${category === cat ? "active" : ""}`}
            onClick={() => setCategory(cat)}
          >
            {cat}
          </button>
        ))}
      </div>

      <div className="extensions-list">
        {filtered.map((ext) => {
          const isInstalled = installed.has(ext.id);
          return (
            <div key={ext.id} className="extension-item">
              <div className="ext-icon">{ext.icon}</div>
              <div className="ext-info">
                <div className="ext-name-row">
                  <strong>{ext.name}</strong>
                  <span className="ext-category">{ext.category}</span>
                </div>
                <p>{ext.description}</p>
                <div className="ext-meta">
                  <span>by {ext.author}</span>
                  <span>
                    <Star size={10} /> {ext.stars}
                  </span>
                  <span>↓ {ext.downloads}</span>
                </div>
              </div>
              <button
                className={`ext-install-btn ${isInstalled ? "installed" : ""}`}
                onClick={() => toggleInstall(ext.id)}
              >
                {isInstalled ? (
                  <>
                    <Check size={12} /> Installed
                  </>
                ) : (
                  <>
                    <Download size={12} /> Install
                  </>
                )}
              </button>
            </div>
          );
        })}
      </div>
    </div>
  );
}
