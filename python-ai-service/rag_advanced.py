"""
Advanced RAG (Retrieval-Augmented Generation) System

Provides sophisticated code retrieval, chunking, and context building.
"""

import logging
import posixpath
import re
from typing import Dict, List, Tuple, Optional, Set
from dataclasses import dataclass, asdict
from collections import defaultdict

logger = logging.getLogger(__name__)

# ============================================================================
# DATA STRUCTURES
# ============================================================================

@dataclass
class CodeChunk:
    """A chunk of code with metadata"""
    file_path: str
    content: str
    start_line: int
    end_line: int
    language: str
    chunk_type: str  # "class", "function", "module", "block"
    name: str  # Function/class name if applicable
    imports: List[str] = None
    dependencies: List[str] = None
    
    def __post_init__(self):
        if self.imports is None:
            self.imports = []
        if self.dependencies is None:
            self.dependencies = []

@dataclass
class RetrievalContext:
    """Context for code generation/analysis"""
    primary_chunks: List[CodeChunk]
    related_chunks: List[CodeChunk]
    dependencies: Dict[str, str]  # name -> content mapping
    imports: List[str]
    project_structure: str
    language_info: Dict[str, str]  # language-specific info

# ============================================================================
# ADVANCED CODE CHUNKER
# ============================================================================

class AdvancedCodeChunker:
    """Intelligently chunks code while preserving context"""
    
    LANGUAGE_DELIMITERS = {
        "python": {
            "class": r"^class\s+(\w+)",
            "function": r"^def\s+(\w+)",
            "async_function": r"^async\s+def\s+(\w+)",
            "import": r"^(?:import|from)\s+",
        },
        "rust": {
            "impl": r"^impl\s+(\w+)",
            "fn": r"^(?:pub\s+)?(?:async\s+)?fn\s+(\w+)",
            "struct": r"^(?:pub\s+)?struct\s+(\w+)",
            "enum": r"^(?:pub\s+)?enum\s+(\w+)",
        },
        "typescript": {
            "class": r"^(?:export\s+)?class\s+(\w+)",
            "function": r"^(?:export\s+)?(?:async\s+)?function\s+(\w+)",
            "arrow_function": r"^(?:const|let|var)\s+(\w+)\s*=.*=>",
            "interface": r"^(?:export\s+)?interface\s+(\w+)",
        },
        "java": {
            "class": r"^(?:public\s+)?class\s+(\w+)",
            "interface": r"^(?:public\s+)?interface\s+(\w+)",
            "method": r"^\s+(?:public|private|protected)?\s*(?:static\s+)?(?:\w+\s+)*(\w+)\s*\(",
        },
    }
    
    @staticmethod
    def chunk_by_structure(
        code: str,
        file_path: str,
        language: str,
        chunk_size: int = 50,
        overlap: int = 10,
    ) -> List[CodeChunk]:
        """Chunk code by structural blocks (functions, classes)"""
        chunks = []
        lines = code.split("\n")
        
        # Try to detect language if not provided
        if not language or language == "unknown":
            language = AdvancedCodeChunker._detect_language(file_path)
        
        # Get delimiters for language
        delimiters = AdvancedCodeChunker.LANGUAGE_DELIMITERS.get(language, {})
        
        # Identify structural boundaries
        boundaries = AdvancedCodeChunker._find_boundaries(lines, delimiters, language)
        
        # Create chunks at boundaries
        for start, end, name, chunk_type in boundaries:
            if end - start > 0:
                content = "\n".join(lines[start:end])
                
                chunk = CodeChunk(
                    file_path=file_path,
                    content=content,
                    start_line=start + 1,  # 1-indexed
                    end_line=end,  # 1-indexed
                    language=language,
                    chunk_type=chunk_type,
                    name=name or "unnamed",
                    imports=AdvancedCodeChunker._extract_imports(content, language),
                    dependencies=AdvancedCodeChunker._extract_dependencies(content, language),
                )
                chunks.append(chunk)
        
        # Fill gaps with line-based chunking
        covered = set()
        for start, end, _, _ in boundaries:
            covered.update(range(start, end))
        
        current_chunk_start = 0
        for line_no in range(len(lines)):
            if line_no not in covered and line_no - current_chunk_start >= chunk_size:
                chunk_end = min(line_no, current_chunk_start + chunk_size)
                if chunk_end - current_chunk_start > 0:
                    content = "\n".join(lines[current_chunk_start:chunk_end])
                    chunk = CodeChunk(
                        file_path=file_path,
                        content=content,
                        start_line=current_chunk_start + 1,
                        end_line=chunk_end,
                        language=language,
                        chunk_type="block",
                        name="code_block",
                    )
                    chunks.append(chunk)
                current_chunk_start = chunk_end - overlap
        
        return chunks
    
    @staticmethod
    def _detect_language(file_path: str) -> str:
        """Detect language from file extension"""
        ext_map = {
            ".py": "python",
            ".rs": "rust",
            ".ts": "typescript",
            ".tsx": "typescript",
            ".js": "javascript",
            ".jsx": "javascript",
            ".java": "java",
            ".go": "go",
            ".cpp": "cpp",
            ".c": "c",
            ".cs": "csharp",
        }
        for ext, lang in ext_map.items():
            if file_path.endswith(ext):
                return lang
        return "unknown"
    
    @staticmethod
    def _find_boundaries(
        lines: List[str],
        delimiters: Dict[str, str],
        language: str,
    ) -> List[Tuple[int, int, str, str]]:
        """Find structural boundaries in code"""
        boundaries = []
        current_start = 0
        
        for line_no, line in enumerate(lines):
            for chunk_type, pattern in delimiters.items():
                match = re.match(pattern, line)
                if match:
                    # Found a new boundary
                    if current_start < line_no:
                        boundaries.append((current_start, line_no, "auto", "block"))
                    
                    name = match.group(1) if match.groups() else None
                    current_start = line_no
                    
                    # Find end of this structure (simple heuristic: next same-level item)
                    indent = len(line) - len(line.lstrip())
                    end = line_no + 1
                    
                    while end < len(lines):
                        next_line = lines[end]
                        if next_line.strip() and not next_line.startswith(" " * (indent + 1)):
                            if re.match(pattern, next_line):
                                break
                        end += 1
                    
                    boundaries.append((current_start, end, name, chunk_type))
                    current_start = end
                    break
        
        # Add final block
        if current_start < len(lines):
            boundaries.append((current_start, len(lines), "final", "block"))
        
        return boundaries
    
    @staticmethod
    def _extract_imports(code: str, language: str) -> List[str]:
        """Extract imports from code"""
        imports = []
        
        if language == "python":
            for match in re.finditer(r"^(?:import|from)\s+([\w.]+)", code, re.MULTILINE):
                imports.append(match.group(1))
        elif language in ["typescript", "javascript"]:
            for match in re.finditer(r"(?:import|require)\s+(?:.*from\s+)?['\"]([^'\"]+)['\"]", code):
                imports.append(match.group(1))
        elif language == "rust":
            for match in re.finditer(r"^use\s+([\w:]+)", code, re.MULTILINE):
                imports.append(match.group(1))
        
        return imports
    
    @staticmethod
    def _extract_dependencies(code: str, language: str) -> List[str]:
        """Extract function/class dependencies"""
        deps = []
        
        # Simple pattern: look for identifiers that look like they're being called
        for match in re.finditer(r"\b([A-Z][a-z]+(?:[A-Z][a-z]+)*)\b", code):
            deps.append(match.group(1))
        
        return list(set(deps))

# ============================================================================
# SMART RETRIEVAL
# ============================================================================

class SmartRetriever:
    """Intelligently retrieves relevant code chunks"""
    
    @staticmethod
    def retrieve_for_query(
        chunks: List[CodeChunk],
        query: str,
        max_chunks: int = 20,
    ) -> Tuple[List[CodeChunk], Dict[str, float]]:
        """Retrieve most relevant chunks for query"""
        scores = {}
        
        # Keyword matching
        query_terms = set(term.lower() for term in re.findall(r"\w+", query))
        
        for chunk in chunks:
            score = 0.0
            
            # Content matching
            chunk_text = (chunk.content + chunk.name + chunk.file_path).lower()
            for term in query_terms:
                score += chunk_text.count(term) * 0.5
            
            # Type matching (if query mentions specific types)
            if "class" in query and chunk.chunk_type == "class":
                score += 5
            if "function" in query and chunk.chunk_type == "function":
                score += 5
            if any(err in query.lower() for err in ["error", "exception"]):
                if "except" in chunk.content or "try" in chunk.content or "error" in chunk.content:
                    score += 3
            
            # Dependency matching
            for dep in chunk.dependencies or []:
                if dep.lower() in query_terms:
                    score += 2
            
            scores[chunk.file_path] = score
        
        # Sort by score
        ranked = sorted(
            ((c, scores.get(c.file_path, 0)) for c in chunks),
            key=lambda x: x[1],
            reverse=True
        )
        
        selected = [chunk for chunk, _ in ranked[:max_chunks]]
        return selected, {c.file_path: scores.get(c.file_path, 0) for c in selected}

# ============================================================================
# CONTEXT BUILDER
# ============================================================================

class ContextBuilder:
    """Builds rich context for AI from code chunks"""
    
    @staticmethod
    def build_context(
        primary_chunks: List[CodeChunk],
        related_chunks: List[CodeChunk],
        include_structure: bool = True,
    ) -> RetrievalContext:
        """Build retrieval context"""
        
        # Collect unique dependencies
        all_deps = {}
        for chunk in primary_chunks + related_chunks:
            for dep in chunk.dependencies or []:
                all_deps[dep] = "imported"  # Could enhance with actual resolution
        
        # Collect imports
        imports = []
        for chunk in primary_chunks + related_chunks:
            imports.extend(chunk.imports or [])
        imports = list(set(imports))
        
        # Build project structure
        project_structure = ""
        if include_structure:
            file_groups = defaultdict(list)
            for chunk in primary_chunks + related_chunks:
                file_groups[chunk.file_path].append(chunk.name)
            
            project_structure = "Project Structure:\n"
            for file, names in sorted(file_groups.items()):
                project_structure += f"- {file}\n"
                for name in names[:3]:  # Limit to 3 per file
                    project_structure += f"  - {name}\n"
                if len(names) > 3:
                    project_structure += f"  - ... and {len(names) - 3} more\n"
        
        # Language info
        lang_groups = defaultdict(int)
        for chunk in primary_chunks + related_chunks:
            lang_groups[chunk.language] += 1
        
        language_info = {
            "primary_language": max(lang_groups, key=lang_groups.get) if lang_groups else "unknown",
            "languages": list(lang_groups.keys()),
        }
        
        return RetrievalContext(
            primary_chunks=primary_chunks,
            related_chunks=related_chunks,
            dependencies=all_deps,
            imports=imports,
            project_structure=project_structure,
            language_info=language_info,
        )
    
    @staticmethod
    def format_context_for_prompt(context: RetrievalContext) -> str:
        """Format context as readable prompt text"""
        parts = []
        
        # Project structure
        if context.project_structure:
            parts.append(context.project_structure)
        
        # Primary code
        if context.primary_chunks:
            parts.append("\n## Primary Code:\n")
            for chunk in context.primary_chunks[:5]:  # Limit to 5 for token budget
                parts.append(f"\n### {chunk.file_path}:{chunk.start_line}-{chunk.end_line}")
                parts.append(f"Type: {chunk.chunk_type}, Name: {chunk.name}")
                parts.append(f"```{chunk.language}\n{chunk.content[:500]}\n```")
        
        # Related code (summary only)
        if context.related_chunks:
            parts.append("\n## Related Code (summaries):\n")
            for chunk in context.related_chunks[:3]:
                parts.append(f"- {chunk.file_path}:{chunk.start_line} ({chunk.chunk_type}: {chunk.name})")
        
        # Dependencies
        if context.dependencies:
            parts.append(f"\n## Key Dependencies: {', '.join(list(context.dependencies.keys())[:10])}")
        
        return "\n".join(parts)

# ============================================================================
# VECTOR SIMILARITY (Simple TF-IDF based)
# ============================================================================

class VectorRetrieval:
    """Simple vector-based retrieval using TF-IDF"""
    
    @staticmethod
    def compute_similarity(text1: str, text2: str) -> float:
        """Compute similarity between two texts (0-1)"""
        words1 = set(re.findall(r"\w+", text1.lower()))
        words2 = set(re.findall(r"\w+", text2.lower()))
        
        if not words1 or not words2:
            return 0.0
        
        intersection = len(words1 & words2)
        union = len(words1 | words2)
        
        return intersection / union if union > 0 else 0.0
    
    @staticmethod
    def find_similar_chunks(
        query: str,
        chunks: List[CodeChunk],
        threshold: float = 0.3,
        top_k: int = 10,
    ) -> List[CodeChunk]:
        """Find chunks similar to query"""
        scored = []
        
        for chunk in chunks:
            similarity = VectorRetrieval.compute_similarity(query, chunk.content)
            if similarity >= threshold:
                scored.append((chunk, similarity))
        
        scored.sort(key=lambda x: x[1], reverse=True)
        return [chunk for chunk, _ in scored[:top_k]]


# ============================================================================
# ARCHITECTURE DEPENDENCY ANALYSIS
# ============================================================================

@dataclass
class DependencyGraphAnalysis:
    """Dependency graph extracted from code context."""
    dependency_map: Dict[str, List[str]]
    circular_dependencies: List[List[str]]
    import_count: int
    internal_edge_count: int


class ArchitectureDependencyAnalyzer:
    """
    Parses import/require statements from RAG code blocks and builds a file-level
    dependency graph, including circular dependency detection.
    """

    FILE_BLOCK_RE = re.compile(
        r"//\s*File:\s*(?P<file>[^\n(]+?)(?:\s*\(lines\s+\d+\s*-\s*\d+\))?\s*\n```[^\n]*\n(?P<code>[\s\S]*?)```",
        re.MULTILINE,
    )

    IMPORT_PATTERNS = [
        re.compile(r"^\s*import(?:\s+type)?(?:[\s\w{},*$]+from\s+)?['\"]([^'\"]+)['\"]", re.MULTILINE),
        re.compile(r"^\s*export(?:[\s\w{},*$]+from\s+)?['\"]([^'\"]+)['\"]", re.MULTILINE),
        re.compile(r"require\(\s*['\"]([^'\"]+)['\"]\s*\)"),
        re.compile(r"import\(\s*['\"]([^'\"]+)['\"]\s*\)"),
        re.compile(r"^\s*from\s+([A-Za-z0-9_\.]+)\s+import\s+", re.MULTILINE),
        re.compile(r"^\s*import\s+([A-Za-z0-9_\.]+)", re.MULTILINE),
    ]

    FILE_EXTENSIONS = (".ts", ".tsx", ".js", ".jsx", ".mjs", ".cjs", ".py")

    @staticmethod
    def analyze_from_rag_context(context_text: str) -> DependencyGraphAnalysis:
        file_blocks = ArchitectureDependencyAnalyzer._extract_file_blocks(context_text)
        known_files = set(file_blocks.keys())

        dependency_map: Dict[str, List[str]] = {}
        import_count = 0
        internal_edge_count = 0

        for file_path, code in file_blocks.items():
            specs = ArchitectureDependencyAnalyzer._extract_import_specs(code)
            import_count += len(specs)

            targets: List[str] = []
            seen_targets: Set[str] = set()
            for spec in specs:
                resolved = ArchitectureDependencyAnalyzer._resolve_internal_target(
                    source_file=file_path,
                    specifier=spec,
                    known_files=known_files,
                )
                if resolved and resolved not in seen_targets:
                    seen_targets.add(resolved)
                    targets.append(resolved)
                    internal_edge_count += 1

            dependency_map[file_path] = targets

        circular_dependencies = ArchitectureDependencyAnalyzer._detect_cycles(dependency_map)

        return DependencyGraphAnalysis(
            dependency_map=dependency_map,
            circular_dependencies=circular_dependencies,
            import_count=import_count,
            internal_edge_count=internal_edge_count,
        )

    @staticmethod
    def format_for_prompt(analysis: DependencyGraphAnalysis, max_edges_per_file: int = 8) -> str:
        lines: List[str] = [
            "## Dependency Graph Analysis",
            f"- Files analyzed: {len(analysis.dependency_map)}",
            f"- Import/require statements parsed: {analysis.import_count}",
            f"- Internal dependency edges: {analysis.internal_edge_count}",
            "",
            "### Dependency Map",
        ]

        if not analysis.dependency_map:
            lines.append("- (no files parsed from retrieved context)")
        else:
            for file_path in sorted(analysis.dependency_map.keys()):
                deps = analysis.dependency_map[file_path]
                if not deps:
                    lines.append(f"- {file_path} -> (no internal dependencies)")
                    continue
                shown = deps[:max_edges_per_file]
                suffix = ""
                if len(deps) > max_edges_per_file:
                    suffix = f" ... (+{len(deps) - max_edges_per_file} more)"
                lines.append(f"- {file_path} -> {', '.join(shown)}{suffix}")

        lines.append("")
        lines.append("### Circular Dependencies")
        if analysis.circular_dependencies:
            for cycle in analysis.circular_dependencies:
                lines.append(f"- ⚠️ {' -> '.join(cycle)}")
        else:
            lines.append("- None detected")

        return "\n".join(lines).strip()

    @staticmethod
    def _extract_file_blocks(context_text: str) -> Dict[str, str]:
        blocks: Dict[str, str] = {}
        for match in ArchitectureDependencyAnalyzer.FILE_BLOCK_RE.finditer(context_text or ""):
            raw_file = match.group("file").strip()
            code = match.group("code")
            if not raw_file or raw_file in blocks:
                continue
            blocks[ArchitectureDependencyAnalyzer._normalize_path(raw_file)] = code
        return blocks

    @staticmethod
    def _extract_import_specs(code: str) -> List[str]:
        specs: List[str] = []
        seen: Set[str] = set()
        for pattern in ArchitectureDependencyAnalyzer.IMPORT_PATTERNS:
            for match in pattern.finditer(code or ""):
                spec = (match.group(1) or "").strip()
                if spec and spec not in seen:
                    seen.add(spec)
                    specs.append(spec)
        return specs

    @staticmethod
    def _resolve_internal_target(source_file: str, specifier: str, known_files: Set[str]) -> Optional[str]:
        spec = specifier.strip()
        if not spec:
            return None

        # Handle common absolute alias formats like "@/foo/bar"
        alias_candidate = None
        if spec.startswith("@/"):
            alias_candidate = spec[2:]
        elif spec.startswith("src/"):
            alias_candidate = spec

        source_dir = posixpath.dirname(source_file)
        candidates: List[str] = []

        if spec.startswith("."):
            base = ArchitectureDependencyAnalyzer._normalize_path(posixpath.join(source_dir, spec))
            candidates.extend(ArchitectureDependencyAnalyzer._expand_candidates(base))
        elif spec.startswith("/"):
            base = ArchitectureDependencyAnalyzer._normalize_path(spec)
            candidates.extend(ArchitectureDependencyAnalyzer._expand_candidates(base))
        elif alias_candidate:
            base = ArchitectureDependencyAnalyzer._normalize_path(alias_candidate)
            candidates.extend(ArchitectureDependencyAnalyzer._expand_candidates(base))
        elif "." in spec:
            # Python-style module import (e.g., package.module)
            base = ArchitectureDependencyAnalyzer._normalize_path(spec.replace(".", "/"))
            candidates.extend(ArchitectureDependencyAnalyzer._expand_candidates(base))
        else:
            # Likely third-party package
            return None

        for candidate in candidates:
            direct = ArchitectureDependencyAnalyzer._match_known_file(candidate, known_files)
            if direct:
                return direct

        return None

    @staticmethod
    def _expand_candidates(base_path: str) -> List[str]:
        candidates = [base_path]
        root, ext = posixpath.splitext(base_path)
        if not ext:
            for file_ext in ArchitectureDependencyAnalyzer.FILE_EXTENSIONS:
                candidates.append(f"{base_path}{file_ext}")
            for file_ext in ArchitectureDependencyAnalyzer.FILE_EXTENSIONS:
                candidates.append(posixpath.join(base_path, f"index{file_ext}"))
        return [ArchitectureDependencyAnalyzer._normalize_path(c) for c in candidates]

    @staticmethod
    def _match_known_file(candidate: str, known_files: Set[str]) -> Optional[str]:
        if candidate in known_files:
            return candidate

        suffix = f"/{candidate.lstrip('./')}"
        matches = [f for f in known_files if f.endswith(suffix)]
        if len(matches) == 1:
            return matches[0]
        return None

    @staticmethod
    def _normalize_path(path: str) -> str:
        normalized = (path or "").replace("\\", "/")
        return posixpath.normpath(normalized)

    @staticmethod
    def _detect_cycles(graph: Dict[str, List[str]]) -> List[List[str]]:
        state: Dict[str, int] = {}  # 0=unvisited, 1=visiting, 2=done
        stack: List[str] = []
        cycle_keys: Set[Tuple[str, ...]] = set()
        cycles: List[List[str]] = []

        def canonical_cycle(nodes: List[str]) -> Tuple[str, ...]:
            core = nodes[:-1]
            if not core:
                return tuple()
            rotations = [tuple(core[i:] + core[:i]) for i in range(len(core))]
            reversed_core = list(reversed(core))
            rotations += [tuple(reversed_core[i:] + reversed_core[:i]) for i in range(len(reversed_core))]
            return min(rotations)

        def dfs(node: str) -> None:
            state[node] = 1
            stack.append(node)

            for neighbor in graph.get(node, []):
                if neighbor not in state:
                    dfs(neighbor)
                elif state[neighbor] == 1:
                    try:
                        start_idx = stack.index(neighbor)
                    except ValueError:
                        continue
                    cycle = stack[start_idx:] + [neighbor]
                    key = canonical_cycle(cycle)
                    if key and key not in cycle_keys:
                        cycle_keys.add(key)
                        cycles.append(list(key) + [key[0]])

            stack.pop()
            state[node] = 2

        for node in sorted(graph.keys()):
            if node not in state:
                dfs(node)

        return cycles
