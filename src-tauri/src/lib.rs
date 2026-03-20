mod commands;
mod lsp;
mod ai;
mod grpc_client;

use commands::{fs_commands, process_commands, terminal_commands};

pub fn run() {
    tauri::Builder::default()
        .plugin(tauri_plugin_fs::init())
        .plugin(tauri_plugin_dialog::init())
        .plugin(tauri_plugin_shell::init())
        .plugin(tauri_plugin_os::init())
        .invoke_handler(tauri::generate_handler![
            // File system
            fs_commands::read_file,
            fs_commands::write_file,
            fs_commands::read_dir_recursive,
            fs_commands::create_file,
            fs_commands::delete_file,
            fs_commands::rename_file,
            fs_commands::watch_directory,
            fs_commands::check_file_exists,
            // Terminal
            terminal_commands::create_terminal,
            terminal_commands::write_to_terminal,
            terminal_commands::resize_terminal,
            terminal_commands::kill_terminal,
            process_commands::run_command,
            // AI
            ai::ollama_complete,
            ai::ollama_chat,
            ai::api_chat,
            ai::api_complete,
            ai::index_codebase,
            ai::get_rag_context,
            ai::rag_query,
            ai::rag_agent_query,
            ai::agentic_rag_chat,
            ai::check_ollama_status,
            ai::ollama_list_local,
            ai::start_ollama,
            ai::fetch_ollama_models,
            ai::fetch_openai_models,
            ai::fetch_anthropic_models,
            ai::fetch_groq_models,
            // gRPC AI Service
            ai::grpc_ai_chat,
            ai::grpc_health_check,
            ai::grpc_fetch_models,
            ai::grpc_stream_chat,
            ai::start_grpc_service,
            ai::ollama_chat_stream,
            ai::run_agent_task,
            // LSP
            lsp::start_lsp,
            lsp::lsp_request,
            // Prompt templates
            ai::list_prompt_templates,
            ai::save_prompt_template,
            ai::export_session_markdown,
        ])
        .run(tauri::generate_context!())
        .expect("error while running tauri application");
}
