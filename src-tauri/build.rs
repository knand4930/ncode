fn main() {
    // Compile protobuf definitions for gRPC
    #[cfg(not(feature = "skip-protobuf-build"))]
    {
        // Use vendored protoc so local protobuf compiler installation is optional.
        let protoc_path = protoc_bin_vendored::protoc_bin_path()
            .expect("Failed to locate vendored protoc binary");
        std::env::set_var("PROTOC", protoc_path);

        let proto_dir = "../python-ai-service";
        
        tonic_build::configure()
            .compile(
                &["ai_service.proto"],
                &[proto_dir],
            )
            .expect("Failed to compile protobuf definitions");
        
        println!("cargo:rerun-if-changed={}/ai_service.proto", proto_dir);
        println!("cargo:rerun-if-changed=build.rs");
    }
    
    tauri_build::build();
}
