use anyhow::Result;
use clap::{Parser, Subcommand};
use repograph_graph_engine::{build_graph, calculate_metrics};
use repograph_parser_engine::{parse_repository, ParserConfig};
use repograph_storage_engine::{GraphStore, SqliteGraphStore};
use std::fs;
use std::path::PathBuf;

#[derive(Debug, Parser)]
#[command(name = "repograph")]
#[command(about = "RepoGraph Intelligence structural repository engine")]
struct Cli {
    #[command(subcommand)]
    command: Command,
}

#[derive(Debug, Subcommand)]
enum Command {
    /// Analyze a repository, build its graph, and persist it to SQLite.
    Analyze {
        #[arg(default_value = ".")]
        repo: PathBuf,
        #[arg(long)]
        out: Option<PathBuf>,
        #[arg(long, default_value_t = false)]
        json: bool,
    },
    /// Print the structural graph as JSON.
    Graph {
        #[arg(default_value = ".")]
        repo: PathBuf,
        #[arg(long)]
        graph_db: Option<PathBuf>,
    },
    /// Print repository metrics as JSON.
    Stats {
        #[arg(default_value = ".")]
        repo: PathBuf,
        #[arg(long)]
        graph_db: Option<PathBuf>,
    },
}

fn main() -> Result<()> {
    let cli = Cli::parse();
    match cli.command {
        Command::Analyze { repo, out, json } => analyze(repo, out, json),
        Command::Graph { repo, graph_db } => {
            let graph = load_or_analyze(repo, graph_db)?;
            println!("{}", serde_json::to_string_pretty(&graph)?);
            Ok(())
        }
        Command::Stats { repo, graph_db } => {
            let graph = load_or_analyze(repo, graph_db)?;
            println!("{}", serde_json::to_string_pretty(&calculate_metrics(&graph))?);
            Ok(())
        }
    }
}

fn analyze(repo: PathBuf, out: Option<PathBuf>, json: bool) -> Result<()> {
    let repo = repo.canonicalize()?;
    let files = parse_repository(&repo, &ParserConfig::default())?;
    let graph = build_graph(&repo, &files);
    let output = out.unwrap_or_else(|| repo.join(".repograph").join("graph.sqlite"));

    if let Some(parent) = output.parent() {
        fs::create_dir_all(parent)?;
    }
    let mut store = SqliteGraphStore::open(&output)?;
    store.save_graph(&graph)?;

    if json {
        println!("{}", serde_json::to_string_pretty(&graph)?);
    } else {
        let metrics = calculate_metrics(&graph);
        println!("Analyzed {}", repo.display());
        println!("Graph database: {}", output.display());
        println!("Files: {}", metrics.files);
        println!("Symbols: {}", metrics.symbols);
        println!("Internal dependencies: {}", metrics.internal_dependencies);
        println!("External dependencies: {}", metrics.external_dependencies);
    }
    Ok(())
}

fn load_or_analyze(repo: PathBuf, graph_db: Option<PathBuf>) -> Result<repograph_shared_types::Graph> {
    if let Some(graph_db) = graph_db {
        return SqliteGraphStore::open(graph_db)?.load_graph();
    }

    let repo = repo.canonicalize()?;
    let files = parse_repository(&repo, &ParserConfig::default())?;
    Ok(build_graph(&repo, &files))
}

