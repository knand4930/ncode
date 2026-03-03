#!/usr/bin/env python3
"""
Main entry point for AI Service

Usage:
    python -m ai_service
    python main.py
"""

import asyncio
import logging
import sys
from server import run_server
from config import settings

# Configure logging
logger = logging.getLogger(__name__)
logging.basicConfig(
    level=getattr(logging, settings.log_level.upper()),
    format='%(asctime)s - %(name)s - %(levelname)s - %(message)s'
)


def main():
    """Main entry point"""
    logger.info("=" * 70)
    logger.info("NCode AI Service - gRPC Server")
    logger.info("=" * 70)
    logger.info(f"Config:")
    logger.info(f"  - gRPC: {settings.grpc_host}:{settings.grpc_port}")
    logger.info(f"  - Log level: {settings.log_level}")
    logger.info(f"  - Ollama URL: {settings.ollama_base_url}")
    logger.info(f"  - Caching: {'Enabled' if settings.enable_caching else 'Disabled'}")
    logger.info(f"  - Streaming: {'Enabled' if settings.enable_streaming else 'Disabled'}")
    logger.info("=" * 70)
    
    try:
        asyncio.run(run_server())
    except KeyboardInterrupt:
        logger.info("Shutting down...")
        return 0
    except Exception as e:
        logger.error(f"Fatal error: {e}", exc_info=True)
        return 1


if __name__ == "__main__":
    sys.exit(main())
