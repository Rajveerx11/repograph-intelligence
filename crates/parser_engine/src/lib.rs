use anyhow::{anyhow, Context, Result};
use regex::Regex;
use repograph_shared_types::{Export, Import, Language, NodeKind, Reference, SourceFile, Symbol};
use std::collections::HashSet;
use std::fs;
use std::path::Path;
use tree_sitter::Parser;
use walkdir::WalkDir;

const DEFAULT_MAX_FILE_BYTES: u64 = 2 * 1024 * 1024;
const DEFAULT_MAX_FILES: usize = 20_000;
const DEFAULT_MAX_DEPTH: usize = 64;

#[derive(Debug, Clone)]
pub struct ParserConfig {
    pub max_file_bytes: u64,
    pub max_files: usize,
    pub max_depth: usize,
    pub ignored_directories: HashSet<String>,
}

impl Default for ParserConfig {
    fn default() -> Self {
        Self {
            max_file_bytes: DEFAULT_MAX_FILE_BYTES,
            max_files: DEFAULT_MAX_FILES,
            max_depth: DEFAULT_MAX_DEPTH,
            ignored_directories: default_ignored_directories(),
        }
    }
}

pub fn parse_repository(root: impl AsRef<Path>, config: &ParserConfig) -> Result<Vec<SourceFile>> {
    let root = root.as_ref().canonicalize().context("repository root is not readable")?;
    let mut parsed = Vec::new();

    for entry in WalkDir::new(&root)
        .max_depth(config.max_depth)
        .into_iter()
        .filter_entry(|entry| should_descend(entry.path(), &config.ignored_directories))
    {
        let entry = entry?;
        if !entry.file_type().is_file() {
            continue;
        }

        if parsed.len() >= config.max_files {
            return Err(anyhow!(
                "repository scan exceeded max file count of {}",
                config.max_files
            ));
        }

        let Some(language) = language_for_path(entry.path()) else {
            continue;
        };

        let metadata = entry.metadata()?;
        if metadata.len() > config.max_file_bytes {
            continue;
        }

        parsed.push(parse_source_file(&root, entry.path(), language)?);
    }

    parsed.sort_by(|left, right| left.relative_path.cmp(&right.relative_path));
    Ok(parsed)
}

pub fn parse_source_file(root: &Path, path: &Path, language: Language) -> Result<SourceFile> {
    let source = fs::read_to_string(path)
        .with_context(|| format!("failed to read source file {}", path.display()))?;
    validate_with_tree_sitter(language, &source)?;

    let relative_path = normalize_path(
        path.strip_prefix(root)
            .with_context(|| format!("{} is not inside {}", path.display(), root.display()))?,
    );

    let facts = match language {
        Language::JavaScript | Language::TypeScript => extract_javascript_like(&source),
        Language::Python => extract_python(&source),
    };

    Ok(SourceFile {
        absolute_path: path.display().to_string(),
        relative_path,
        language,
        line_count: source.lines().count().max(1),
        symbols: facts.symbols,
        imports: facts.imports,
        exports: facts.exports,
        references: facts.references,
    })
}

#[derive(Default)]
struct FileFacts {
    symbols: Vec<Symbol>,
    imports: Vec<Import>,
    exports: Vec<Export>,
    references: Vec<Reference>,
}

fn extract_javascript_like(source: &str) -> FileFacts {
    let import_patterns = [
        Regex::new(r#"\bimport\s+(?:type\s+)?(?:(?P<names>[\s\S]*?)\s+from\s+)?["'](?P<specifier>[^"']+)["']"#).unwrap(),
        Regex::new(r#"\bexport\s+(?:type\s+)?(?:[\s\S]*?\s+from\s+)["'](?P<specifier>[^"']+)["']"#).unwrap(),
        Regex::new(r#"\brequire\s*\(\s*["'](?P<specifier>[^"']+)["']\s*\)"#).unwrap(),
        Regex::new(r#"\bimport\s*\(\s*["'](?P<specifier>[^"']+)["']\s*\)"#).unwrap(),
    ];
    let symbol_patterns = [
        (NodeKind::Class, Regex::new(r#"\b(?:export\s+)?(?:default\s+)?class\s+([A-Za-z_$][\w$]*)"#).unwrap()),
        (NodeKind::Interface, Regex::new(r#"\bexport\s+interface\s+([A-Za-z_$][\w$]*)"#).unwrap()),
        (NodeKind::Function, Regex::new(r#"\b(?:export\s+)?(?:default\s+)?(?:async\s+)?function\s+([A-Za-z_$][\w$]*)"#).unwrap()),
        (NodeKind::Function, Regex::new(r#"\bexport\s+const\s+([A-Za-z_$][\w$]*)\s*=\s*(?:async\s*)?\("#).unwrap()),
        (NodeKind::Method, Regex::new(r#"(?m)^\s{2,}(?:async\s+)?([A-Za-z_$][\w$]*)\s*\([^)]*\)\s*\{"#).unwrap()),
    ];
    let export_patterns = [
        Regex::new(r#"\bexport\s+(?:default\s+)?(?:async\s+)?(?:function|class|interface|const|let|var)\s+([A-Za-z_$][\w$]*)"#).unwrap(),
        Regex::new(r#"\bexport\s*\{([^}]+)\}"#).unwrap(),
    ];

    let mut facts = FileFacts::default();
    let mut seen_imports = HashSet::new();

    for pattern in import_patterns {
        for capture in pattern.captures_iter(source) {
            let Some(specifier_match) = capture.name("specifier") else {
                continue;
            };
            let specifier = specifier_match.as_str().to_string();
            if !seen_imports.insert(specifier.clone()) {
                continue;
            }
            let imported_names = capture
                .name("names")
                .map(|matched| parse_imported_names(matched.as_str()))
                .unwrap_or_default();
            facts.imports.push(Import {
                line: line_for_offset(source, specifier_match.start()),
                is_relative: specifier.starts_with('.'),
                specifier,
                imported_names,
            });
        }
    }

    let mut seen_symbols = HashSet::new();
    for (kind, pattern) in symbol_patterns {
        for capture in pattern.captures_iter(source) {
            let Some(matched) = capture.get(1) else {
                continue;
            };
            let name = matched.as_str().to_string();
            if seen_symbols.insert(format!("{kind:?}:{name}")) {
                facts.symbols.push(Symbol {
                    name,
                    kind: kind.clone(),
                    line: line_for_offset(source, matched.start()),
                    column: column_for_offset(source, matched.start()),
                });
            }
        }
    }

    let mut seen_exports = HashSet::new();
    for pattern in export_patterns {
        for capture in pattern.captures_iter(source) {
            let Some(matched) = capture.get(1) else {
                continue;
            };
            for name in split_export_names(matched.as_str()) {
                if seen_exports.insert(name.clone()) {
                    facts.exports.push(Export {
                        name,
                        line: line_for_offset(source, matched.start()),
                    });
                }
            }
        }
    }

    facts.references = extract_references(source, &facts.symbols);
    facts
}

fn extract_python(source: &str) -> FileFacts {
    let import_pattern = Regex::new(r#"(?m)^\s*import\s+(.+)$"#).unwrap();
    let from_import_pattern = Regex::new(r#"(?m)^\s*from\s+([.\w]+)\s+import\s+(.+)$"#).unwrap();
    let class_pattern = Regex::new(r#"(?m)^class\s+([A-Za-z_]\w*)"#).unwrap();
    let def_pattern = Regex::new(r#"(?m)^(\s*)(?:async\s+)?def\s+([A-Za-z_]\w*)"#).unwrap();

    let mut facts = FileFacts::default();

    for capture in import_pattern.captures_iter(source) {
        let Some(matched) = capture.get(1) else {
            continue;
        };
        for module_name in matched.as_str().split(',').map(clean_alias).filter(|item| !item.is_empty()) {
            facts.imports.push(Import {
                is_relative: module_name.starts_with('.'),
                line: line_for_offset(source, matched.start()),
                specifier: module_name.to_string(),
                imported_names: Vec::new(),
            });
        }
    }

    for capture in from_import_pattern.captures_iter(source) {
        let Some(module_match) = capture.get(1) else {
            continue;
        };
        let imported_names = capture
            .get(2)
            .map(|matched| {
                matched
                    .as_str()
                    .split(',')
                    .map(clean_alias)
                    .filter(|item| !item.is_empty())
                    .map(ToOwned::to_owned)
                    .collect()
            })
            .unwrap_or_default();
        facts.imports.push(Import {
            is_relative: module_match.as_str().starts_with('.'),
            line: line_for_offset(source, module_match.start()),
            specifier: module_match.as_str().to_string(),
            imported_names,
        });
    }

    for capture in class_pattern.captures_iter(source) {
        let Some(matched) = capture.get(1) else {
            continue;
        };
        facts.symbols.push(Symbol {
            name: matched.as_str().to_string(),
            kind: NodeKind::Class,
            line: line_for_offset(source, matched.start()),
            column: column_for_offset(source, matched.start()),
        });
    }

    for capture in def_pattern.captures_iter(source) {
        let Some(name_match) = capture.get(2) else {
            continue;
        };
        let indent = capture.get(1).map(|matched| matched.as_str().len()).unwrap_or(0);
        facts.symbols.push(Symbol {
            name: name_match.as_str().to_string(),
            kind: if indent > 0 { NodeKind::Method } else { NodeKind::Function },
            line: line_for_offset(source, name_match.start()),
            column: column_for_offset(source, name_match.start()),
        });
    }

    facts.exports = facts
        .symbols
        .iter()
        .filter(|symbol| symbol.column == 1)
        .map(|symbol| Export {
            name: symbol.name.clone(),
            line: symbol.line,
        })
        .collect();
    facts.references = extract_references(source, &facts.symbols);
    facts
}

fn validate_with_tree_sitter(language: Language, source: &str) -> Result<()> {
    let mut parser = Parser::new();
    match language {
        Language::JavaScript => parser.set_language(tree_sitter_javascript::language())?,
        Language::TypeScript => parser.set_language(tree_sitter_typescript::language_typescript())?,
        Language::Python => parser.set_language(tree_sitter_python::language())?,
    }
    parser
        .parse(source, None)
        .ok_or_else(|| anyhow!("tree-sitter parser failed to produce an AST"))?;
    Ok(())
}

fn extract_references(source: &str, symbols: &[Symbol]) -> Vec<Reference> {
    let symbol_names: HashSet<_> = symbols.iter().map(|symbol| symbol.name.as_str()).collect();
    let identifier_pattern = Regex::new(r#"\b[A-Za-z_$][\w$]*\b"#).unwrap();
    let mut references = Vec::new();

    for matched in identifier_pattern.find_iter(source) {
        if symbol_names.contains(matched.as_str()) {
            references.push(Reference {
                name: matched.as_str().to_string(),
                line: line_for_offset(source, matched.start()),
                column: column_for_offset(source, matched.start()),
            });
        }
    }

    references
}

fn parse_imported_names(raw: &str) -> Vec<String> {
    raw.replace('{', "")
        .replace('}', "")
        .split(',')
        .map(clean_alias)
        .filter(|item| !item.is_empty() && *item != "type" && *item != "*")
        .map(ToOwned::to_owned)
        .collect()
}

fn split_export_names(raw: &str) -> Vec<String> {
    raw.split(',')
        .map(clean_alias)
        .filter(|item| !item.is_empty())
        .map(ToOwned::to_owned)
        .collect()
}

fn clean_alias(raw: &str) -> &str {
    raw.trim()
        .split_once(" as ")
        .map(|(name, _)| name.trim())
        .unwrap_or_else(|| raw.trim())
}

fn line_for_offset(source: &str, offset: usize) -> usize {
    source[..offset.min(source.len())].bytes().filter(|byte| *byte == b'\n').count() + 1
}

fn column_for_offset(source: &str, offset: usize) -> usize {
    let prefix = &source[..offset.min(source.len())];
    prefix.rsplit_once('\n').map(|(_, line)| line.len() + 1).unwrap_or(prefix.len() + 1)
}

fn language_for_path(path: &Path) -> Option<Language> {
    match path.extension().and_then(|value| value.to_str()) {
        Some("js" | "jsx" | "mjs" | "cjs") => Some(Language::JavaScript),
        Some("ts" | "tsx") => Some(Language::TypeScript),
        Some("py") => Some(Language::Python),
        _ => None,
    }
}

fn normalize_path(path: &Path) -> String {
    path.components()
        .map(|component| component.as_os_str().to_string_lossy())
        .collect::<Vec<_>>()
        .join("/")
}

fn should_descend(path: &Path, ignored_directories: &HashSet<String>) -> bool {
    path.file_name()
        .and_then(|name| name.to_str())
        .map(|name| !ignored_directories.contains(name))
        .unwrap_or(true)
}

fn default_ignored_directories() -> HashSet<String> {
    [
        ".git",
        ".hg",
        ".repograph",
        ".svn",
        ".next",
        ".nuxt",
        ".turbo",
        ".venv",
        "__pycache__",
        "build",
        "coverage",
        "dist",
        "node_modules",
        "target",
        "venv",
    ]
    .into_iter()
    .map(ToOwned::to_owned)
    .collect()
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn extracts_typescript_symbols_imports_and_exports() {
        let source = r#"
import { helper as renamed } from "./util";
export interface Service {}
export function main() { return renamed(); }
"#;
        let facts = extract_javascript_like(source);

        assert_eq!(facts.imports[0].specifier, "./util");
        assert!(facts.exports.iter().any(|item| item.name == "main"));
        assert!(facts.symbols.iter().any(|item| item.name == "Service"));
        assert!(facts.symbols.iter().any(|item| item.name == "main"));
    }

    #[test]
    fn extracts_python_methods_as_methods() {
        let source = "class App:\n    def run(self):\n        return 42\n";
        let facts = extract_python(source);

        assert!(facts.symbols.iter().any(|item| item.kind == NodeKind::Class));
        assert!(facts.symbols.iter().any(|item| item.kind == NodeKind::Method));
    }
}
